"use strict";

const MenuOption = require("../models/MenuOption");
const ProductGroupOption = require("../models/ProductGroupOption");
const {
  filterGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("./catalog/catalogAvailabilityService");
const {
  serializePublicOption,
} = require("./orders/menuCatalogPresenter");
const menuCatalogService = require("./orders/menuCatalogService");
const {
  availableForChannelQuery,
} = require("./subscription/subscriptionMenuEligibilityPolicyService");

const STATE_KEY = Symbol.for("basicdiet.oneTimeBasicMealCarbCatalog.state");
const WRAPPER_MARKER = "__oneTimeBasicMealCarbCatalog";
const BASIC_MEAL_PRODUCT_KEY = "basic_meal";
const CARB_GROUP_KEYS = new Set(["carb", "carbs"]);

function token(value) {
  return String(value || "").trim().toLowerCase();
}

function isCarbGroup(group = {}) {
  return CARB_GROUP_KEYS.has(token(group.key));
}

function isCustomerAvailable(doc = {}) {
  return Boolean(doc)
    && doc.isActive !== false
    && doc.isVisible !== false
    && doc.isAvailable !== false
    && Boolean(doc.publishedAt);
}

function isRelationAvailable(doc = {}) {
  return Boolean(doc)
    && doc.isActive !== false
    && doc.isVisible !== false
    && doc.isAvailable !== false;
}

function findPublicBasicMeal(menu = {}) {
  for (const category of Array.isArray(menu.categories) ? menu.categories : []) {
    const products = Array.isArray(category.products) ? category.products : [];
    const product = products.find((row) => token(row && row.key) === BASIC_MEAL_PRODUCT_KEY);
    if (product) return product;
  }
  return null;
}

async function loadPublicCarbOptions({ productId, groupId, lang }) {
  const relations = (await ProductGroupOption.find({
    productId,
    groupId,
    isActive: { $ne: false },
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
  }).sort({ sortOrder: 1, createdAt: 1 }).lean()).filter(isRelationAvailable);
  if (!relations.length) return [];

  const relationByOptionId = new Map(relations.map((relation) => [
    String(relation.optionId),
    relation,
  ]));
  const optionRows = await MenuOption.find({
    _id: { $in: relations.map((relation) => relation.optionId) },
    groupId,
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
    publishedAt: { $ne: null },
    ...availableForChannelQuery("one_time"),
  }).lean();
  const catalogItemsById = await loadCatalogItemsByIdForDocs(optionRows);
  const options = filterGloballyAvailable(optionRows, catalogItemsById)
    .filter(isCustomerAvailable);

  return options
    .map((option) => {
      const relation = relationByOptionId.get(String(option._id));
      return relation ? serializePublicOption(relation, option, lang) : null;
    })
    .filter(Boolean)
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
}

async function hydrateOneTimeBasicMealCarbs(menu = {}, { lang = "en" } = {}) {
  const basicMeal = findPublicBasicMeal(menu);
  if (!basicMeal) return menu;

  const publicCarbGroup = (Array.isArray(basicMeal.optionGroups)
    ? basicMeal.optionGroups
    : []).find(isCarbGroup);
  if (!publicCarbGroup) return menu;

  const productId = String(basicMeal.id || basicMeal._id || "");
  const groupId = String(publicCarbGroup.groupId || publicCarbGroup.id || "");
  if (!productId || !groupId) return menu;

  const options = await loadPublicCarbOptions({ productId, groupId, lang });
  if (!options.length) return menu;

  return {
    ...menu,
    categories: (Array.isArray(menu.categories) ? menu.categories : []).map((category) => ({
      ...category,
      products: (Array.isArray(category.products) ? category.products : []).map((product) => {
        if (token(product && product.key) !== BASIC_MEAL_PRODUCT_KEY) return product;
        return {
          ...product,
          optionGroups: (Array.isArray(product.optionGroups)
            ? product.optionGroups
            : []).map((group) => (
            isCarbGroup(group) ? { ...group, options } : group
          )),
        };
      }),
    })),
  };
}

function installOneTimeBasicMealCarbCatalog() {
  const state = globalThis[STATE_KEY] || { installed: false };
  globalThis[STATE_KEY] = state;
  if (state.installed) return;

  const originalGetPublishedMenu = menuCatalogService.getPublishedMenu;
  if (originalGetPublishedMenu[WRAPPER_MARKER]) {
    state.installed = true;
    return;
  }

  const wrappedGetPublishedMenu = async function getPublishedMenuWithBasicMealCarbs(
    options = {}
  ) {
    const menu = await originalGetPublishedMenu(options);
    return hydrateOneTimeBasicMealCarbs(menu, options);
  };
  wrappedGetPublishedMenu[WRAPPER_MARKER] = true;
  menuCatalogService.getPublishedMenu = wrappedGetPublishedMenu;
  state.installed = true;
}

installOneTimeBasicMealCarbCatalog();

module.exports = {
  BASIC_MEAL_PRODUCT_KEY,
  hydrateOneTimeBasicMealCarbs,
  installOneTimeBasicMealCarbCatalog,
  isCarbGroup,
  loadPublicCarbOptions,
};
