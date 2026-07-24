"use strict";

const MenuOption = require("../models/MenuOption");
const MenuOptionGroup = require("../models/MenuOptionGroup");
const MenuProduct = require("../models/MenuProduct");
const ProductGroupOption = require("../models/ProductGroupOption");
const ProductOptionGroup = require("../models/ProductOptionGroup");
const {
  filterGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("./catalog/catalogAvailabilityService");
const orderMenuService = require("./orders/orderMenuService");
const {
  isCustomerVisibleOption,
  serializePublicOption,
} = require("./orders/menuCatalogPresenter");

const STATE_KEY = Symbol.for("basicdiet.oneTimeCarbCatalogAuthority.state");
const WRAPPER_MARKER = "__oneTimeCarbCatalogAuthority";
const BASIC_MEAL_KEY = "basic_meal";
const CARB_GROUP_KEYS = new Set(["carb", "carbs", "standard_carb", "standard_carbs"]);

function token(value) {
  return String(value || "").trim().toLowerCase();
}

function isCarbGroup(group = {}) {
  const values = [
    group.key,
    group.sourceKey,
    group.name,
    group.nameI18n && group.nameI18n.ar,
    group.nameI18n && group.nameI18n.en,
  ].map(token).filter(Boolean);
  return values.some((value) => (
    CARB_GROUP_KEYS.has(value)
    || value.includes("carb")
    || value.includes("نشويات")
    || value.includes("نشوية")
  ));
}

function oneTimeAvailabilityQuery() {
  return {
    $or: [
      { availableFor: { $exists: false } },
      { availableFor: { $size: 0 } },
      { availableFor: "one_time" },
    ],
  };
}

function publishedCatalogQuery(extra = {}) {
  return {
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
    publishedAt: { $ne: null },
    ...extra,
  };
}

function activeRelationQuery(extra = {}) {
  return {
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
    ...extra,
  };
}

async function loadPublishedOneTimeCarbAuthority({ lang = "en" } = {}) {
  const product = await MenuProduct.findOne({
    ...publishedCatalogQuery({ key: BASIC_MEAL_KEY }),
    ...oneTimeAvailabilityQuery(),
  }).lean();
  if (!product) return null;

  const groupRelations = await ProductOptionGroup.find(
    activeRelationQuery({ productId: product._id })
  ).sort({ sortOrder: 1, createdAt: 1 }).lean();
  if (!groupRelations.length) return null;

  const groups = await MenuOptionGroup.find({
    ...publishedCatalogQuery({
      _id: { $in: groupRelations.map((relation) => relation.groupId) },
    }),
  }).lean();
  const groupsById = new Map(groups.map((group) => [String(group._id), group]));
  const carbRelation = groupRelations.find((relation) => (
    isCarbGroup(groupsById.get(String(relation.groupId)))
  ));
  if (!carbRelation) return null;

  const group = groupsById.get(String(carbRelation.groupId));
  const optionRelations = await ProductGroupOption.find(activeRelationQuery({
    productId: product._id,
    groupId: group._id,
  })).sort({ sortOrder: 1, createdAt: 1 }).lean();
  if (!optionRelations.length) return null;

  const rawOptions = await MenuOption.find({
    ...publishedCatalogQuery({
      _id: { $in: optionRelations.map((relation) => relation.optionId) },
      groupId: group._id,
    }),
    ...oneTimeAvailabilityQuery(),
  }).lean();
  const catalogItemsById = await loadCatalogItemsByIdForDocs(rawOptions);
  const options = filterGloballyAvailable(rawOptions, catalogItemsById);
  const optionsById = new Map(options.map((option) => [String(option._id), option]));

  const serializedOptions = optionRelations
    .map((relation) => {
      const option = optionsById.get(String(relation.optionId));
      if (!option || !isCustomerVisibleOption(option, group, product)) return null;
      return serializePublicOption(relation, option, lang);
    })
    .filter(Boolean)
    .sort((left, right) => (
      Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
      || String(left.key || "").localeCompare(String(right.key || ""))
    ));

  return {
    productId: String(product._id),
    productKey: product.key,
    groupId: String(group._id),
    groupKey: group.key,
    options: orderMenuService.dedupeOneTimeOptions(serializedOptions),
  };
}

function replaceProductCarbOptions(products = [], authority = null) {
  if (!authority || !Array.isArray(authority.options) || !authority.options.length) {
    return products;
  }
  return (Array.isArray(products) ? products : []).map((product) => {
    const isTarget = String(product && (product.id || product.productId) || "") === authority.productId
      || token(product && product.key) === token(authority.productKey);
    if (!isTarget) return product;

    return {
      ...product,
      optionGroups: (Array.isArray(product.optionGroups) ? product.optionGroups : []).map((group) => {
        const matchesGroup = String(group && (group.id || group.groupId) || "") === authority.groupId
          || isCarbGroup(group);
        if (!matchesGroup) return group;
        return {
          ...group,
          options: authority.options.map((option) => ({ ...option })),
          optionSections: [],
        };
      }),
    };
  });
}

function applyPublishedOneTimeCarbAuthority(menu = {}, authority = null) {
  if (!authority || !authority.options || !authority.options.length) return menu;

  const categories = (Array.isArray(menu.categories) ? menu.categories : []).map((category) => ({
    ...category,
    products: replaceProductCarbOptions(category.products, authority),
  }));
  const publicMenuV2 = menu.publicMenuV2 && typeof menu.publicMenuV2 === "object"
    ? {
      ...menu.publicMenuV2,
      sections: (Array.isArray(menu.publicMenuV2.sections) ? menu.publicMenuV2.sections : []).map((section) => ({
        ...section,
        products: replaceProductCarbOptions(section.products, authority),
      })),
    }
    : menu.publicMenuV2;

  return {
    ...menu,
    categories,
    ...(publicMenuV2 ? { publicMenuV2 } : {}),
  };
}

function installOneTimeCarbCatalogAuthority() {
  const state = globalThis[STATE_KEY] || { installed: false };
  globalThis[STATE_KEY] = state;
  if (state.installed) return state;

  const original = orderMenuService.getOneTimeOrderMenu.bind(orderMenuService);
  const wrapped = async function databaseAuthoritativeOneTimeCarbs(options = {}) {
    const menu = await original(options);
    const authority = await loadPublishedOneTimeCarbAuthority({
      lang: options.lang || "en",
    });
    return applyPublishedOneTimeCarbAuthority(menu, authority);
  };
  wrapped[WRAPPER_MARKER] = true;
  wrapped.__original = original;
  orderMenuService.getOneTimeOrderMenu = wrapped;

  state.installed = true;
  state.databaseAuthoritative = true;
  return state;
}

installOneTimeCarbCatalogAuthority();

module.exports = {
  BASIC_MEAL_KEY,
  CARB_GROUP_KEYS,
  applyPublishedOneTimeCarbAuthority,
  installOneTimeCarbCatalogAuthority,
  isCarbGroup,
  loadPublishedOneTimeCarbAuthority,
  replaceProductCarbOptions,
};
