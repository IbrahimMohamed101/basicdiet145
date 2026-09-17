"use strict";

const mongoose = require("mongoose");

const MenuOption = require("../models/MenuOption");
const MenuOptionGroup = require("../models/MenuOptionGroup");
const ProductGroupOption = require("../models/ProductGroupOption");
const menuPricingService = require("./orders/menuPricingService");
const orderMenuService = require("./orders/orderMenuService");

const STATE_KEY = Symbol.for("basicdiet.oneTimeCarbGramContract.state");
const WRAPPER_MARKER = "__oneTimeCarbGramContract";
const CARB_GROUP_KEYS = new Set([
  "carb",
  "carbs",
  "standard_carb",
  "standard_carbs",
]);
const DEFAULT_CARB_GRAM_STEP = 50;

function token(value) {
  return String(value || "").trim().toLowerCase();
}

function positiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function includesCarbHint(value) {
  const normalized = token(value);
  return normalized.includes("carb")
    || normalized.includes("نشويات")
    || normalized.includes("نشوية");
}

function isCarbGroup(group = {}, option = {}) {
  const directKeys = [group.key, group.sourceKey].map(token).filter(Boolean);
  if (directKeys.some((value) => CARB_GROUP_KEYS.has(value))) return true;

  const directValues = [
    group.key,
    group.sourceKey,
    group.name,
    group.nameI18n && group.nameI18n.ar,
    group.nameI18n && group.nameI18n.en,
  ];
  if (directValues.some(includesCarbHint)) return true;

  return includesCarbHint(option.displayCategoryKey);
}

function applyCarbGramDefaultsToGroups(groups = []) {
  if (!Array.isArray(groups)) return groups;
  return groups.map((group) => {
    const options = Array.isArray(group.options) ? group.options : [];
    if (!isCarbGroup(group) && !options.some((option) => isCarbGroup(group, option))) {
      return group;
    }
    return {
      ...group,
      options: options.map((option) => {
        if (!isCarbGroup(group, option)) return option;
        const pricePerStepHalala = nonNegativeInteger(
          option.extraWeightPriceHalala,
          0
        );
        if (pricePerStepHalala > 0) return option;
        return {
          ...option,
          extraWeightUnitGrams: positiveInteger(
            option.extraWeightUnitGrams,
            DEFAULT_CARB_GRAM_STEP
          ),
          extraWeightPriceHalala: 0,
        };
      }),
    };
  });
}

function applyOneTimeCarbGramContract(menu = {}) {
  const categories = (Array.isArray(menu.categories) ? menu.categories : []).map(
    (category) => ({
      ...category,
      products: (Array.isArray(category.products) ? category.products : []).map(
        (product) => ({
          ...product,
          optionGroups: applyCarbGramDefaultsToGroups(product.optionGroups),
        })
      ),
    })
  );

  const publicMenuV2 = menu.publicMenuV2
    ? {
        ...menu.publicMenuV2,
        sections: (
          Array.isArray(menu.publicMenuV2.sections)
            ? menu.publicMenuV2.sections
            : []
        ).map((section) => ({
          ...section,
          products: (Array.isArray(section.products) ? section.products : []).map(
            (product) => ({
              ...product,
              optionGroups: applyCarbGramDefaultsToGroups(product.optionGroups),
            })
          ),
        })),
      }
    : menu.publicMenuV2;

  return {
    ...menu,
    categories,
    ...(publicMenuV2 ? { publicMenuV2 } : {}),
  };
}

function selectedOptionsLocation(item = {}) {
  if (Array.isArray(item.selectedOptions)) {
    return { kind: "selectedOptions", values: item.selectedOptions };
  }
  if (Array.isArray(item.options)) {
    return { kind: "options", values: item.options };
  }
  if (Array.isArray(item.selections?.options)) {
    return { kind: "selections.options", values: item.selections.options };
  }
  return { kind: "selectedOptions", values: [] };
}

function withSelectedOptions(item, location, values) {
  if (location.kind === "options") return { ...item, options: values };
  if (location.kind === "selections.options") {
    return {
      ...item,
      selections: { ...(item.selections || {}), options: values },
    };
  }
  return { ...item, selectedOptions: values };
}

function policyKey(productId, groupId, optionId) {
  return `${String(productId || "")}:${String(groupId || "")}:${String(
    optionId || ""
  )}`;
}

function requestKey(itemIndex, groupId, optionId) {
  return `${itemIndex}:${String(groupId || "")}:${String(optionId || "")}`;
}

function relationValue(relation, option, field) {
  if (relation && relation[field] !== null && relation[field] !== undefined) {
    return Number(relation[field] || 0);
  }
  return Number(option?.[field] || 0);
}

async function loadIncludedCarbPolicies(items = []) {
  const references = [];
  items.forEach((item) => {
    const productId = item.productId || item.menuProductId;
    const { values } = selectedOptionsLocation(item);
    values.forEach((selection) => {
      references.push({
        productId: String(productId || ""),
        groupId: String(selection?.groupId || ""),
        optionId: String(selection?.optionId || ""),
      });
    });
  });

  const validReferences = references.filter(
    (reference) =>
      mongoose.Types.ObjectId.isValid(reference.productId) &&
      mongoose.Types.ObjectId.isValid(reference.groupId) &&
      mongoose.Types.ObjectId.isValid(reference.optionId)
  );
  if (!validReferences.length) return new Map();

  const groupIds = [...new Set(validReferences.map((row) => row.groupId))];
  const optionIds = [...new Set(validReferences.map((row) => row.optionId))];
  const productIds = [...new Set(validReferences.map((row) => row.productId))];

  const [groups, options, relations] = await Promise.all([
    MenuOptionGroup.find({ _id: { $in: groupIds } })
      .select("_id key name")
      .lean(),
    MenuOption.find({ _id: { $in: optionIds } })
      .select(
        "_id displayCategoryKey extraWeightUnitGrams extraWeightPriceHalala"
      )
      .lean(),
    ProductGroupOption.find({
      productId: { $in: productIds },
      groupId: { $in: groupIds },
      optionId: { $in: optionIds },
    })
      .select(
        "productId groupId optionId extraWeightUnitGrams extraWeightPriceHalala"
      )
      .lean(),
  ]);

  const groupsById = new Map(groups.map((group) => [String(group._id), group]));
  const optionsById = new Map(
    options.map((option) => [String(option._id), option])
  );
  const relationsByKey = new Map(
    relations.map((relation) => [
      policyKey(relation.productId, relation.groupId, relation.optionId),
      relation,
    ])
  );

  const policies = new Map();
  validReferences.forEach((reference) => {
    const group = groupsById.get(reference.groupId);
    const option = optionsById.get(reference.optionId);
    if (!isCarbGroup(group, option)) return;
    const relation = relationsByKey.get(
      policyKey(reference.productId, reference.groupId, reference.optionId)
    );
    const pricePerStepHalala = nonNegativeInteger(
      relationValue(relation, option, "extraWeightPriceHalala"),
      0
    );
    if (pricePerStepHalala > 0) return;
    policies.set(
      policyKey(reference.productId, reference.groupId, reference.optionId),
      {
        stepGrams: positiveInteger(
          relationValue(relation, option, "extraWeightUnitGrams"),
          DEFAULT_CARB_GRAM_STEP
        ),
        pricePerStepHalala: 0,
      }
    );
  });

  return policies;
}

function invalidWeightError(message) {
  const error = new Error(message);
  error.code = "INVALID_WEIGHT";
  error.status = 400;
  return error;
}

function restoreIncludedCarbSelections({
  pricedItems,
  requestedGrams,
  policiesByItem,
}) {
  return (Array.isArray(pricedItems) ? pricedItems : []).map(
    (pricedItem, itemIndex) => {
      const source = Array.isArray(pricedItem.selectedOptions)
        ? pricedItem.selectedOptions
        : Array.isArray(pricedItem.selections?.selectedOptions)
          ? pricedItem.selections.selectedOptions
          : [];
      const restored = source.map((selection) => {
        const key = requestKey(itemIndex, selection.groupId, selection.optionId);
        const gramsQueue = requestedGrams.get(key);
        const policyQueue = policiesByItem.get(key);
        if (!gramsQueue?.length || !policyQueue?.length) return selection;
        const grams = gramsQueue.shift();
        const policy = policyQueue.shift();
        return {
          ...selection,
          extraWeightGrams: grams,
          extraWeightUnitGrams: policy.stepGrams,
          extraWeightPriceHalala: 0,
        };
      });
      return {
        ...pricedItem,
        selectedOptions: restored,
        selections: pricedItem.selections
          ? { ...pricedItem.selections, selectedOptions: restored }
          : pricedItem.selections,
      };
    }
  );
}

function installOneTimeCarbGramContract() {
  const state = globalThis[STATE_KEY] || { installed: false };
  globalThis[STATE_KEY] = state;
  if (state.installed) return;
  state.installed = true;

  const originalGetOneTimeOrderMenu =
    orderMenuService.getOneTimeOrderMenu.bind(orderMenuService);
  const wrappedGetOneTimeOrderMenu = async function oneTimeCarbGramMenu(options) {
    return applyOneTimeCarbGramContract(
      await originalGetOneTimeOrderMenu(options)
    );
  };
  wrappedGetOneTimeOrderMenu[WRAPPER_MARKER] = true;
  orderMenuService.getOneTimeOrderMenu = wrappedGetOneTimeOrderMenu;

  const originalPriceMenuCart = menuPricingService.priceMenuCart.bind(
    menuPricingService
  );
  const wrappedPriceMenuCart = async function oneTimeCarbGramPricing(args = {}) {
    const items = Array.isArray(args.items) ? args.items : [];
    const policies = await loadIncludedCarbPolicies(items);
    if (!policies.size) return originalPriceMenuCart(args);

    const requestedGrams = new Map();
    const policiesByItem = new Map();
    const sanitizedItems = items.map((item, itemIndex) => {
      const productId = item.productId || item.menuProductId;
      const location = selectedOptionsLocation(item);
      const sanitizedSelections = location.values.map((selection) => {
        const policy = policies.get(
          policyKey(productId, selection?.groupId, selection?.optionId)
        );
        if (!policy) return selection;

        const rawGrams = selection?.extraWeightGrams;
        const grams =
          rawGrams === undefined || rawGrams === null || rawGrams === ""
            ? policy.stepGrams
            : Number(rawGrams);
        if (!Number.isInteger(grams) || grams < 0) {
          throw invalidWeightError(
            "Carb grams must be an integer greater than or equal to zero"
          );
        }
        if (grams > 0 && grams % policy.stepGrams !== 0) {
          throw invalidWeightError(
            `Carb grams must be selected in ${policy.stepGrams}g steps`
          );
        }

        const key = requestKey(itemIndex, selection.groupId, selection.optionId);
        if (!requestedGrams.has(key)) requestedGrams.set(key, []);
        if (!policiesByItem.has(key)) policiesByItem.set(key, []);
        requestedGrams.get(key).push(grams);
        policiesByItem.get(key).push(policy);

        return { ...selection, extraWeightGrams: 0 };
      });
      return withSelectedOptions(item, location, sanitizedSelections);
    });

    const result = await originalPriceMenuCart({
      ...args,
      items: sanitizedItems,
    });
    return {
      ...result,
      items: restoreIncludedCarbSelections({
        pricedItems: result.items,
        requestedGrams,
        policiesByItem,
      }),
    };
  };
  wrappedPriceMenuCart[WRAPPER_MARKER] = true;
  menuPricingService.priceMenuCart = wrappedPriceMenuCart;
}

installOneTimeCarbGramContract();

module.exports = {
  CARB_GROUP_KEYS,
  DEFAULT_CARB_GRAM_STEP,
  applyOneTimeCarbGramContract,
  installOneTimeCarbGramContract,
  isCarbGroup,
};
