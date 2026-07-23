"use strict";

const mongoose = require("mongoose");

const MenuOption = require("../models/MenuOption");
const MenuOptionGroup = require("../models/MenuOptionGroup");
const MenuProduct = require("../models/MenuProduct");
const ProductGroupOption = require("../models/ProductGroupOption");
const ProductOptionGroup = require("../models/ProductOptionGroup");
const {
  CUSTOMER_VISIBLE_CARB_KEYS,
} = require("../config/mealPlannerContract");
const menuPricingService = require("./orders/menuPricingService");
const orderMenuService = require("./orders/orderMenuService");

const STATE_KEY = Symbol.for("basicdiet.oneTimeCarbGramContract.state");
const WRAPPER_MARKER = "__oneTimeCarbGramContract";
const CARB_GROUP_KEYS = new Set(["carb", "carbs"]);
const CUSTOMER_VISIBLE_CARB_KEY_SET = new Set(CUSTOMER_VISIBLE_CARB_KEYS);
const DEFAULT_CARB_GRAM_STEP = 50;
const BASIC_MEAL_PRODUCT_KEY = "basic_meal";
const RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000;

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

function isCarbGroup(group = {}) {
  return CARB_GROUP_KEYS.has(token(group.key));
}

function isPublishedAndAvailable(doc = {}) {
  return Boolean(doc)
    && doc.isActive !== false
    && doc.isVisible !== false
    && doc.isAvailable !== false
    && Boolean(doc.publishedAt);
}

function isAvailableForOneTime(doc = {}) {
  return !Array.isArray(doc.availableFor)
    || doc.availableFor.length === 0
    || doc.availableFor.includes("one_time");
}

function runtimeState() {
  const state = globalThis[STATE_KEY] || {
    installed: false,
    reconciliationPromise: null,
    lastReconciledAt: 0,
    lastReconciliationResult: null,
  };
  globalThis[STATE_KEY] = state;
  return state;
}

async function reconcileOneTimeBasicMealCarbRelations() {
  const product = await MenuProduct.findOne({ key: BASIC_MEAL_PRODUCT_KEY }).lean();
  if (!isPublishedAndAvailable(product) || !isAvailableForOneTime(product)) {
    return { productId: null, insertedRelations: 0, eligibleOptions: 0 };
  }

  const groupRelations = await ProductOptionGroup.find({
    productId: product._id,
    isActive: { $ne: false },
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
  }).lean();
  if (!groupRelations.length) {
    return {
      productId: String(product._id),
      insertedRelations: 0,
      eligibleOptions: 0,
    };
  }

  const groupIds = groupRelations.map((relation) => relation.groupId);
  const groups = await MenuOptionGroup.find({ _id: { $in: groupIds } }).lean();
  const carbGroups = groups.filter((group) => isCarbGroup(group) && isPublishedAndAvailable(group));
  if (!carbGroups.length) {
    return {
      productId: String(product._id),
      insertedRelations: 0,
      eligibleOptions: 0,
    };
  }

  const carbGroupIds = carbGroups.map((group) => group._id);
  const options = (await MenuOption.find({
    groupId: { $in: carbGroupIds },
    key: { $in: [...CUSTOMER_VISIBLE_CARB_KEY_SET] },
  }).sort({ sortOrder: 1, createdAt: 1 }).lean())
    .filter((option) => isPublishedAndAvailable(option) && isAvailableForOneTime(option));

  if (!options.length) {
    return {
      productId: String(product._id),
      insertedRelations: 0,
      eligibleOptions: 0,
    };
  }

  const existingRelations = await ProductGroupOption.find({
    productId: product._id,
    groupId: { $in: carbGroupIds },
    optionId: { $in: options.map((option) => option._id) },
  }).select("groupId optionId").lean();
  const existingKeys = new Set(
    existingRelations.map((relation) => `${relation.groupId}:${relation.optionId}`)
  );

  const missingOptions = options.filter(
    (option) => !existingKeys.has(`${option.groupId}:${option._id}`)
  );
  if (!missingOptions.length) {
    return {
      productId: String(product._id),
      insertedRelations: 0,
      eligibleOptions: options.length,
    };
  }

  let insertedRelations = 0;
  try {
    const result = await ProductGroupOption.bulkWrite(
      missingOptions.map((option) => ({
        updateOne: {
          filter: {
            productId: product._id,
            groupId: option.groupId,
            optionId: option._id,
          },
          update: {
            $setOnInsert: {
              productId: product._id,
              groupId: option.groupId,
              optionId: option._id,
              extraPriceHalala: null,
              extraWeightUnitGrams: null,
              extraWeightPriceHalala: null,
              isActive: true,
              isVisible: true,
              isAvailable: true,
              sortOrder: Number(option.sortOrder || 0),
            },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    insertedRelations = Number(result.upsertedCount || 0);
  } catch (error) {
    if (error && error.code !== 11000) throw error;
  }

  return {
    productId: String(product._id),
    insertedRelations,
    eligibleOptions: options.length,
  };
}

async function ensureOneTimeBasicMealCarbRelations({ force = false } = {}) {
  const state = runtimeState();
  const fresh = Date.now() - Number(state.lastReconciledAt || 0) < RECONCILIATION_INTERVAL_MS;
  if (!force && fresh && state.lastReconciliationResult) {
    return state.lastReconciliationResult;
  }
  if (state.reconciliationPromise) return state.reconciliationPromise;

  state.reconciliationPromise = reconcileOneTimeBasicMealCarbRelations()
    .then((result) => {
      state.lastReconciledAt = Date.now();
      state.lastReconciliationResult = result;
      return result;
    })
    .finally(() => {
      state.reconciliationPromise = null;
    });
  return state.reconciliationPromise;
}

function applyCarbGramDefaultsToGroups(groups = []) {
  if (!Array.isArray(groups)) return groups;
  return groups.map((group) => {
    if (!isCarbGroup(group)) return group;
    return {
      ...group,
      options: (Array.isArray(group.options) ? group.options : []).map((option) => {
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
      .select("_id key")
      .lean(),
    MenuOption.find({ _id: { $in: optionIds } })
      .select("_id extraWeightUnitGrams extraWeightPriceHalala")
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
    if (!isCarbGroup(group)) return;
    const option = optionsById.get(reference.optionId);
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
  const state = runtimeState();
  if (state.installed) return;
  state.installed = true;

  const originalGetOneTimeOrderMenu =
    orderMenuService.getOneTimeOrderMenu.bind(orderMenuService);
  const wrappedGetOneTimeOrderMenu = async function oneTimeCarbGramMenu(options) {
    await ensureOneTimeBasicMealCarbRelations();
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
    await ensureOneTimeBasicMealCarbRelations();
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
  BASIC_MEAL_PRODUCT_KEY,
  CARB_GROUP_KEYS,
  DEFAULT_CARB_GRAM_STEP,
  applyOneTimeCarbGramContract,
  ensureOneTimeBasicMealCarbRelations,
  installOneTimeCarbGramContract,
  isCarbGroup,
  reconcileOneTimeBasicMealCarbRelations,
};
