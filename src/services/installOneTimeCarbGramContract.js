"use strict";

const mongoose = require("mongoose");

const MenuOption = require("../models/MenuOption");
const MenuOptionGroup = require("../models/MenuOptionGroup");
const MenuProduct = require("../models/MenuProduct");
const ProductGroupOption = require("../models/ProductGroupOption");
const ProductOptionGroup = require("../models/ProductOptionGroup");
const {
  STANDARD_CARB_CATEGORY_KEY,
  STANDARD_CARB_RULES,
} = require("../config/mealPlannerContract");
const menuPricingService = require("./orders/menuPricingService");
const orderMenuService = require("./orders/orderMenuService");

const STATE_KEY = Symbol.for("basicdiet.oneTimeCarbGramContract.state");
const WRAPPER_MARKER = "__oneTimeCarbGramContract";
const BASIC_MEAL_PRODUCT_KEY = "basic_meal";
const STANDARD_MEAL_SELECTION_TYPE = "standard_meal";
const CARB_GROUP_KEYS = new Set(["carb", "carbs"]);
const DEFAULT_CARB_GRAM_STEP = 50;
const MAX_CARB_TOTAL_GRAMS = Number(STANDARD_CARB_RULES.maxTotalGrams || 300);
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

function isPublishedAndAvailable(doc = {}) {
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

function supportsChannel(doc = {}, channel) {
  return !Array.isArray(doc.availableFor)
    || doc.availableFor.length === 0
    || doc.availableFor.includes(channel);
}

function isCarbGroup(group = {}) {
  return CARB_GROUP_KEYS.has(token(group.key));
}

function isBasicMeal(product = {}) {
  return token(product.key) === BASIC_MEAL_PRODUCT_KEY;
}

function isEligibleBasicMealCarbOption(option = {}) {
  if (!isPublishedAndAvailable(option)) return false;

  const selectionType = token(option.selectionType);
  if (selectionType && selectionType !== STANDARD_MEAL_SELECTION_TYPE) return false;

  const displayCategoryKey = token(option.displayCategoryKey);
  if (displayCategoryKey && displayCategoryKey !== STANDARD_CARB_CATEGORY_KEY) {
    return false;
  }

  return true;
}

function relationIdentity(groupId, optionId) {
  return `${String(groupId || "")}:${String(optionId || "")}`;
}

function policyIdentity(productId, groupId, optionId) {
  return `${String(productId || "")}:${relationIdentity(groupId, optionId)}`;
}

function requestIdentity(itemIndex, groupId, optionId) {
  return `${itemIndex}:${relationIdentity(groupId, optionId)}`;
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

function effectiveRelationNumber(relation, option, field) {
  if (relation && relation[field] !== null && relation[field] !== undefined) {
    return Number(relation[field] || 0);
  }
  return Number(option && option[field] ? option[field] : 0);
}

async function findOneTimeBasicMeal() {
  const products = await MenuProduct.find({ key: BASIC_MEAL_PRODUCT_KEY })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();
  return products.find((product) => (
    isPublishedAndAvailable(product) && supportsChannel(product, "one_time")
  )) || null;
}

async function reconcileOneTimeBasicMealCarbRelations() {
  const product = await findOneTimeBasicMeal();
  if (!product) {
    return {
      productId: null,
      eligibleOptions: 0,
      insertedRelations: 0,
      updatedRelations: 0,
      updatedChannels: 0,
      preservedHiddenRelations: 0,
    };
  }

  const allGroupRelations = await ProductOptionGroup.find({
    productId: product._id,
  }).lean();
  const activeGroupRelations = allGroupRelations.filter(isRelationAvailable);
  if (!activeGroupRelations.length) {
    return {
      productId: String(product._id),
      eligibleOptions: 0,
      insertedRelations: 0,
      updatedRelations: 0,
      updatedChannels: 0,
      preservedHiddenRelations: 0,
    };
  }

  const groupIds = activeGroupRelations.map((relation) => relation.groupId);
  const groups = await MenuOptionGroup.find({ _id: { $in: groupIds } }).lean();
  const carbGroups = groups.filter((group) => (
    isCarbGroup(group) && isPublishedAndAvailable(group)
  ));
  if (!carbGroups.length) {
    return {
      productId: String(product._id),
      eligibleOptions: 0,
      insertedRelations: 0,
      updatedRelations: 0,
      updatedChannels: 0,
      preservedHiddenRelations: 0,
    };
  }

  const carbGroupIds = carbGroups.map((group) => group._id);
  const authoredOptions = (await MenuOption.find({
    groupId: { $in: carbGroupIds },
  }).sort({ sortOrder: 1, createdAt: 1 }).lean())
    .filter(isEligibleBasicMealCarbOption);

  if (!authoredOptions.length) {
    return {
      productId: String(product._id),
      eligibleOptions: 0,
      insertedRelations: 0,
      updatedRelations: 0,
      updatedChannels: 0,
      preservedHiddenRelations: 0,
    };
  }

  const existingRelations = await ProductGroupOption.find({
    productId: product._id,
    groupId: { $in: carbGroupIds },
    optionId: { $in: authoredOptions.map((option) => option._id) },
  }).lean();
  const relationsByIdentity = new Map(existingRelations.map((relation) => [
    relationIdentity(relation.groupId, relation.optionId),
    relation,
  ]));

  const preservedHiddenRelations = existingRelations.filter(
    (relation) => !isRelationAvailable(relation)
  ).length;
  const eligibleOptions = authoredOptions.filter((option) => {
    const relation = relationsByIdentity.get(
      relationIdentity(option.groupId, option._id)
    );
    return !relation || isRelationAvailable(relation);
  });

  let updatedChannels = 0;
  const channelOperations = eligibleOptions
    .filter((option) => !supportsChannel(option, "one_time"))
    .map((option) => ({
      updateOne: {
        filter: {
          _id: option._id,
          isActive: { $ne: false },
          isVisible: { $ne: false },
          isAvailable: { $ne: false },
          publishedAt: { $ne: null },
        },
        update: { $addToSet: { availableFor: "one_time" } },
      },
    }));
  if (channelOperations.length) {
    const result = await MenuOption.bulkWrite(channelOperations, { ordered: false });
    updatedChannels = Number(result.modifiedCount || 0);
  }

  const relationOperations = [];
  for (const option of eligibleOptions) {
    const identity = relationIdentity(option.groupId, option._id);
    const relation = relationsByIdentity.get(identity);
    const optionStep = positiveInteger(option.extraWeightUnitGrams, 0);

    if (!relation) {
      relationOperations.push({
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
              extraWeightUnitGrams: optionStep || DEFAULT_CARB_GRAM_STEP,
              extraWeightPriceHalala: null,
              isActive: true,
              isVisible: true,
              isAvailable: true,
              sortOrder: Number(option.sortOrder || 0),
            },
          },
          upsert: true,
        },
      });
      continue;
    }

    const relationStep = positiveInteger(relation.extraWeightUnitGrams, 0);
    const relationHasExplicitStep = relation.extraWeightUnitGrams !== null
      && relation.extraWeightUnitGrams !== undefined;
    if (relationStep > 0 || (!relationHasExplicitStep && optionStep > 0)) {
      continue;
    }

    relationOperations.push({
      updateOne: {
        filter: {
          _id: relation._id,
          isActive: { $ne: false },
          isVisible: { $ne: false },
          isAvailable: { $ne: false },
        },
        update: {
          $set: {
            extraWeightUnitGrams: optionStep || DEFAULT_CARB_GRAM_STEP,
          },
        },
      },
    });
  }

  let insertedRelations = 0;
  let updatedRelations = 0;
  if (relationOperations.length) {
    try {
      const result = await ProductGroupOption.bulkWrite(
        relationOperations,
        { ordered: false }
      );
      insertedRelations = Number(result.upsertedCount || 0);
      updatedRelations = Number(result.modifiedCount || 0);
    } catch (error) {
      if (!error || error.code !== 11000) throw error;
    }
  }

  return {
    productId: String(product._id),
    eligibleOptions: eligibleOptions.length,
    insertedRelations,
    updatedRelations,
    updatedChannels,
    preservedHiddenRelations,
  };
}

async function ensureOneTimeBasicMealCarbRelations({ force = false } = {}) {
  const state = runtimeState();
  const stillFresh = Date.now() - Number(state.lastReconciledAt || 0)
    < RECONCILIATION_INTERVAL_MS;
  if (!force && stillFresh && state.lastReconciliationResult) {
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

function decorateCarbGroup(group = {}) {
  if (!isCarbGroup(group)) return group;
  return {
    ...group,
    options: (Array.isArray(group.options) ? group.options : []).map((option) => ({
      ...option,
      extraWeightUnitGrams: positiveInteger(
        option.extraWeightUnitGrams,
        DEFAULT_CARB_GRAM_STEP
      ),
      extraWeightPriceHalala: nonNegativeInteger(
        option.extraWeightPriceHalala,
        0
      ),
    })),
  };
}

function decorateBasicMealProduct(product = {}) {
  if (!isBasicMeal(product)) return product;
  return {
    ...product,
    optionGroups: (Array.isArray(product.optionGroups) ? product.optionGroups : [])
      .map(decorateCarbGroup),
  };
}

function applyOneTimeCarbGramContract(menu = {}) {
  const categories = (Array.isArray(menu.categories) ? menu.categories : []).map(
    (category) => ({
      ...category,
      products: (Array.isArray(category.products) ? category.products : [])
        .map(decorateBasicMealProduct),
    })
  );

  const publicMenuV2 = menu.publicMenuV2 && typeof menu.publicMenuV2 === "object"
    ? {
        ...menu.publicMenuV2,
        sections: (Array.isArray(menu.publicMenuV2.sections)
          ? menu.publicMenuV2.sections
          : []).map((section) => ({
          ...section,
          products: (Array.isArray(section.products) ? section.products : [])
            .map(decorateBasicMealProduct),
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
  if (Array.isArray(item.selections && item.selections.options)) {
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

async function loadBasicMealCarbPolicies(items = []) {
  const references = [];
  items.forEach((item, itemIndex) => {
    const productId = item.productId || item.menuProductId;
    const location = selectedOptionsLocation(item);
    location.values.forEach((selection) => {
      references.push({
        itemIndex,
        productId: String(productId || ""),
        groupId: String(selection && selection.groupId ? selection.groupId : ""),
        optionId: String(selection && selection.optionId ? selection.optionId : ""),
      });
    });
  });

  const validReferences = references.filter((reference) => (
    mongoose.Types.ObjectId.isValid(reference.productId)
    && mongoose.Types.ObjectId.isValid(reference.groupId)
    && mongoose.Types.ObjectId.isValid(reference.optionId)
  ));
  if (!validReferences.length) return new Map();

  const productIds = [...new Set(validReferences.map((row) => row.productId))];
  const groupIds = [...new Set(validReferences.map((row) => row.groupId))];
  const optionIds = [...new Set(validReferences.map((row) => row.optionId))];

  const [products, groups, options, relations] = await Promise.all([
    MenuProduct.find({ _id: { $in: productIds } }).select("_id key").lean(),
    MenuOptionGroup.find({ _id: { $in: groupIds } }).select("_id key").lean(),
    MenuOption.find({ _id: { $in: optionIds } })
      .select(
        "_id groupId selectionType displayCategoryKey availableFor isActive isVisible isAvailable publishedAt extraWeightUnitGrams extraWeightPriceHalala"
      )
      .lean(),
    ProductGroupOption.find({
      productId: { $in: productIds },
      groupId: { $in: groupIds },
      optionId: { $in: optionIds },
    })
      .select(
        "productId groupId optionId isActive isVisible isAvailable extraWeightUnitGrams extraWeightPriceHalala"
      )
      .lean(),
  ]);

  const productsById = new Map(products.map((product) => [String(product._id), product]));
  const groupsById = new Map(groups.map((group) => [String(group._id), group]));
  const optionsById = new Map(options.map((option) => [String(option._id), option]));
  const relationsByIdentity = new Map(relations.map((relation) => [
    policyIdentity(relation.productId, relation.groupId, relation.optionId),
    relation,
  ]));

  const policies = new Map();
  for (const reference of validReferences) {
    const product = productsById.get(reference.productId);
    const group = groupsById.get(reference.groupId);
    const option = optionsById.get(reference.optionId);
    const relation = relationsByIdentity.get(
      policyIdentity(reference.productId, reference.groupId, reference.optionId)
    );

    if (!isBasicMeal(product) || !isCarbGroup(group)) continue;
    if (!isEligibleBasicMealCarbOption(option)) continue;
    if (!supportsChannel(option, "one_time")) continue;
    if (!isRelationAvailable(relation)) continue;

    const stepGrams = positiveInteger(
      effectiveRelationNumber(relation, option, "extraWeightUnitGrams"),
      DEFAULT_CARB_GRAM_STEP
    );
    const pricePerStepHalala = nonNegativeInteger(
      effectiveRelationNumber(relation, option, "extraWeightPriceHalala"),
      0
    );
    policies.set(
      policyIdentity(reference.productId, reference.groupId, reference.optionId),
      {
        stepGrams,
        pricePerStepHalala,
        isIncluded: pricePerStepHalala === 0,
      }
    );
  }

  return policies;
}

function invalidWeightError(message, details = {}) {
  const error = new Error(message);
  error.code = "INVALID_WEIGHT";
  error.status = 400;
  error.details = details;
  return error;
}

function normalizeBasicMealCarbSelections(items, policies) {
  const restoreIncludedGrams = new Map();
  const sanitizedItems = (Array.isArray(items) ? items : []).map((item, itemIndex) => {
    const productId = item.productId || item.menuProductId;
    const location = selectedOptionsLocation(item);
    let totalCarbGrams = 0;

    const selections = location.values.map((selection) => {
      const identity = policyIdentity(
        productId,
        selection && selection.groupId,
        selection && selection.optionId
      );
      const policy = policies.get(identity);
      if (!policy) return selection;

      const rawGrams = selection && selection.extraWeightGrams;
      const grams = rawGrams === undefined || rawGrams === null || rawGrams === ""
        ? policy.stepGrams
        : Number(rawGrams);
      if (!Number.isInteger(grams) || grams < 0) {
        throw invalidWeightError(
          "Carb grams must be an integer greater than or equal to zero"
        );
      }
      if (grams > 0 && grams % policy.stepGrams !== 0) {
        throw invalidWeightError(
          `Carb grams must be selected in ${policy.stepGrams}g steps`,
          { stepGrams: policy.stepGrams }
        );
      }

      totalCarbGrams += grams;
      if (!policy.isIncluded) {
        return { ...selection, extraWeightGrams: grams };
      }

      const requestKey = requestIdentity(
        itemIndex,
        selection && selection.groupId,
        selection && selection.optionId
      );
      if (!restoreIncludedGrams.has(requestKey)) {
        restoreIncludedGrams.set(requestKey, []);
      }
      restoreIncludedGrams.get(requestKey).push({ grams, policy });
      return { ...selection, extraWeightGrams: 0 };
    });

    if (totalCarbGrams > MAX_CARB_TOTAL_GRAMS) {
      throw invalidWeightError(
        `Total carb grams must not exceed ${MAX_CARB_TOTAL_GRAMS}g`,
        { maxTotalGrams: MAX_CARB_TOTAL_GRAMS }
      );
    }

    return withSelectedOptions(item, location, selections);
  });

  return { sanitizedItems, restoreIncludedGrams };
}

function restoreIncludedSelections(pricedItems, restoreIncludedGrams) {
  return (Array.isArray(pricedItems) ? pricedItems : []).map((pricedItem, itemIndex) => {
    const source = Array.isArray(pricedItem.selectedOptions)
      ? pricedItem.selectedOptions
      : Array.isArray(pricedItem.selections && pricedItem.selections.selectedOptions)
        ? pricedItem.selections.selectedOptions
        : [];

    const restored = source.map((selection) => {
      const requestKey = requestIdentity(
        itemIndex,
        selection && selection.groupId,
        selection && selection.optionId
      );
      const queue = restoreIncludedGrams.get(requestKey);
      if (!queue || !queue.length) return selection;
      const entry = queue.shift();
      return {
        ...selection,
        extraWeightGrams: entry.grams,
        extraWeightUnitGrams: entry.policy.stepGrams,
        extraWeightPriceHalala: 0,
        totalHalala: Number(selection.totalHalala || 0),
      };
    });

    return {
      ...pricedItem,
      selectedOptions: restored,
      selections: pricedItem.selections
        ? { ...pricedItem.selections, selectedOptions: restored }
        : pricedItem.selections,
    };
  });
}

function installOneTimeCarbGramContract() {
  const state = runtimeState();
  if (state.installed) return;
  state.installed = true;

  const originalGetOneTimeOrderMenu =
    orderMenuService.getOneTimeOrderMenu.bind(orderMenuService);
  const wrappedGetOneTimeOrderMenu = async function oneTimeCarbGramMenu(options) {
    await ensureOneTimeBasicMealCarbRelations();
    const menu = await originalGetOneTimeOrderMenu(options);
    return applyOneTimeCarbGramContract(menu);
  };
  wrappedGetOneTimeOrderMenu[WRAPPER_MARKER] = true;
  orderMenuService.getOneTimeOrderMenu = wrappedGetOneTimeOrderMenu;

  const originalPriceMenuCart = menuPricingService.priceMenuCart.bind(
    menuPricingService
  );
  const wrappedPriceMenuCart = async function oneTimeCarbGramPricing(args = {}) {
    await ensureOneTimeBasicMealCarbRelations();
    const items = Array.isArray(args.items) ? args.items : [];
    const policies = await loadBasicMealCarbPolicies(items);
    if (!policies.size) return originalPriceMenuCart(args);

    const { sanitizedItems, restoreIncludedGrams } =
      normalizeBasicMealCarbSelections(items, policies);
    const result = await originalPriceMenuCart({
      ...args,
      items: sanitizedItems,
    });
    return {
      ...result,
      items: restoreIncludedSelections(result.items, restoreIncludedGrams),
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
  MAX_CARB_TOTAL_GRAMS,
  applyOneTimeCarbGramContract,
  ensureOneTimeBasicMealCarbRelations,
  installOneTimeCarbGramContract,
  isBasicMeal,
  isCarbGroup,
  isEligibleBasicMealCarbOption,
  reconcileOneTimeBasicMealCarbRelations,
};
