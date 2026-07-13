const mongoose = require("mongoose");
const MenuOption = require("../../models/MenuOption");
const MenuOptionGroup = require("../../models/MenuOptionGroup");
const MenuProduct = require("../../models/MenuProduct");
const ProductGroupOption = require("../../models/ProductGroupOption");
const ProductOptionGroup = require("../../models/ProductOptionGroup");
const {
  MEAL_SELECTION_TYPES,
  PREMIUM_LARGE_SALAD_PREMIUM_KEY,
  PREMIUM_LARGE_SALAD_PRESET_KEY,
  PREMIUM_MEAL_PROTEIN_KEYS,
  STANDARD_CARB_RULES,
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS,
  SYSTEM_CURRENCY,
  normalizeProteinDisplayCategoryKey,
  normalizeProteinFamilyKey,
  normalizeSaladIngredientGroupKey,
} = require("../../config/mealPlannerContract");
const {
  buildMealSlotKey,
  getMealPlannerRules,
  projectMaterializedAndLegacyFromSlots,
} = require("./mealSlotPlannerService");
const {
  loadClientPremiumUpgradeConfigState,
  resolvePremiumUpgrade,
  resolveSubscriptionPremiumUpgradePricing,
} = require("./premiumUpgradeConfigService");
const {
  filterGloballyAvailable,
  isLinkedDocGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("../catalog/catalogAvailabilityService");
const mealBuilderConfigService = require("./mealBuilderConfigService");
const {
  isSubscriptionPremiumLargeSaladProtein,
} = require("./premiumLargeSaladEligibilityService");

const CANONICAL_PLANNER_CONTRACT_VERSION = "meal_planner_menu.v3";
const MENU_PROTEIN_GROUP_KEY = "proteins";
const MENU_CARB_GROUP_KEY = "carbs";
const MENU_SALAD_EXTRA_PROTEIN_GROUP_KEY = "extra_protein_50g";
const PREMIUM_MEAL_PROTEIN_KEY_SET = new Set(PREMIUM_MEAL_PROTEIN_KEYS);
const PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEY_SET = new Set(SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS);

const SELECTION_TYPE_PRODUCT_RULES = Object.freeze({
  [MEAL_SELECTION_TYPES.STANDARD_MEAL]: {
    itemTypes: new Set(["basic_meal"]),
    keys: new Set(["basic_meal"]),
  },
  [MEAL_SELECTION_TYPES.PREMIUM_MEAL]: {
    itemTypes: new Set(["basic_meal"]),
    keys: new Set(["basic_meal"]),
  },
  [MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD]: {
    itemTypes: new Set(["premium_large_salad"]),
    keys: new Set(["premium_large_salad"]),
  },
  [MEAL_SELECTION_TYPES.SANDWICH]: {
    itemTypes: new Set(["cold_sandwich"]),
    keys: null,
  },
  [MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT]: {
    itemTypes: null,
    keys: null,
  },
});

function localizedPair(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      ar: typeof value.ar === "string" ? value.ar : "",
      en: typeof value.en === "string" ? value.en : "",
    };
  }
  const scalar = typeof value === "string" ? value : "";
  return { ar: scalar, en: scalar };
}

function hasCanonicalSlotShape(slot) {
  return Boolean(slot && slot.productId && Array.isArray(slot.selectedOptions));
}

function isCanonicalPlannerRequest({ contractVersion, mealSlots }) {
  const version = String(contractVersion || "").trim().toLowerCase();
  if (version === "v3" || version === CANONICAL_PLANNER_CONTRACT_VERSION) return true;
  return (Array.isArray(mealSlots) ? mealSlots : []).some(hasCanonicalSlotShape);
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ""));
}

function normalizeId(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function buildSlotError({
  slotIndex,
  code,
  message,
  field,
  productId = null,
  groupId = null,
  optionId = null,
  stale = false,
}) {
  return {
    slotIndex: Number(slotIndex || 0) || null,
    code,
    message,
    field,
    productId: productId ? String(productId) : undefined,
    groupId: groupId ? String(groupId) : undefined,
    optionId: optionId ? String(optionId) : undefined,
    hint: stale ? "Refresh planner catalog and retry." : undefined,
  };
}

function buildBuilderMembershipError({ slotIndex, field, code, message, productId, groupId = null, optionId = null }) {
  return buildSlotError({
    slotIndex,
    field,
    code,
    message,
    productId,
    groupId,
    optionId,
    stale: true,
  });
}

function buildCanonicalValidationFailure(slotErrors, debug = undefined) {
  const first = Array.isArray(slotErrors) && slotErrors.length ? slotErrors[0] : null;
  return {
    valid: false,
    errorCode: first?.code || "INVALID_MEAL_PLAN",
    errorMessage: first?.message || "Meal planner validation failed",
    slotErrors: slotErrors || [],
    rules: getMealPlannerRules(),
    debug,
  };
}

function isSubscriptionEnabled(doc) {
  if (!doc) return false;
  if (doc.availableForSubscription === false) return false;
  if (!Array.isArray(doc.availableFor) || doc.availableFor.length === 0) return true;
  return doc.availableFor.includes("subscription");
}

function validateCatalogDocState({ doc, slotIndex, field, entity, id }) {
  const codeEntity = entity === "GROUP" ? "OPTION_GROUP" : entity;
  if (!doc) {
    return buildSlotError({
      slotIndex,
      field,
      code: `PLANNER_${codeEntity}_NOT_FOUND`,
      message: `${entity.toLowerCase()} not found`,
      productId: entity === "PRODUCT" ? id : null,
      groupId: entity === "GROUP" ? id : null,
      optionId: entity === "OPTION" ? id : null,
      stale: true,
    });
  }
  if (doc.isActive === false) {
    return buildSlotError({
      slotIndex,
      field,
      code: `PLANNER_${codeEntity}_INACTIVE`,
      message: `${entity.toLowerCase()} is inactive`,
      productId: entity === "PRODUCT" ? id : null,
      groupId: entity === "GROUP" ? id : null,
      optionId: entity === "OPTION" ? id : null,
      stale: true,
    });
  }
  if (doc.publishedAt === null || doc.publishedAt === undefined) {
    return buildSlotError({
      slotIndex,
      field,
      code: `PLANNER_${codeEntity}_UNPUBLISHED`,
      message: `${entity.toLowerCase()} is unpublished`,
      productId: entity === "PRODUCT" ? id : null,
      groupId: entity === "GROUP" ? id : null,
      optionId: entity === "OPTION" ? id : null,
      stale: true,
    });
  }
  if (doc.isVisible === false || doc.isAvailable === false) {
    const unavailableCode = entity === "PRODUCT"
      ? "PLANNER_PRODUCT_UNAVAILABLE"
      : entity === "OPTION"
        ? "PLANNER_OPTION_UNAVAILABLE"
        : "PLANNER_OPTION_GROUP_UNAVAILABLE";
    return buildSlotError({
      slotIndex,
      field,
      code: unavailableCode,
      message: `${entity.toLowerCase()} is unavailable`,
      productId: entity === "PRODUCT" ? id : null,
      groupId: entity === "GROUP" ? id : null,
      optionId: entity === "OPTION" ? id : null,
      stale: true,
    });
  }
  return null;
}

function validateProductSelectionType({ product, selectionType, slotIndex }) {
  const rule = SELECTION_TYPE_PRODUCT_RULES[selectionType];
  if (!rule) {
    return buildSlotError({
      slotIndex,
      field: "selectionType",
      code: "INVALID_SELECTION_TYPE",
      message: "Invalid selection type",
      productId: product?._id,
    });
  }
  const itemType = String(product?.itemType || "").trim();
  const key = String(product?.key || "").trim();
  const validItemType = !rule.itemTypes || rule.itemTypes.has(itemType);
  const validKey = !rule.keys || rule.keys.has(key);
  if (!validItemType && !validKey) {
    return buildSlotError({
      slotIndex,
      field: "productId",
      code: "PLANNER_PRODUCT_UNAVAILABLE",
      message: "Product is not valid for this planner selection type",
      productId: product?._id,
      stale: true,
    });
  }
  return null;
}

function validateRelationState({ relation, slotIndex, field, productId, groupId, optionId = null, entity }) {
  const relationCodePrefix = entity === "GROUP"
    ? "PLANNER_OPTION_GROUP_RELATION"
    : "PLANNER_PRODUCT_OPTION_RELATION";
  if (!relation) {
    return buildSlotError({
      slotIndex,
      field,
      code: `${relationCodePrefix}_NOT_FOUND`,
      message: `${entity.toLowerCase()} relation is not attached to the selected product`,
      productId,
      groupId,
      optionId,
      stale: true,
    });
  }
  if (relation.isActive === false || relation.isVisible === false || relation.isAvailable === false) {
    return buildSlotError({
      slotIndex,
      field,
      code: `${relationCodePrefix}_UNAVAILABLE`,
      message: `${entity.toLowerCase()} relation is inactive or unavailable`,
      productId,
      groupId,
      optionId,
      stale: true,
    });
  }
  return null;
}

function canonicalSaladGroupKey(groupKey) {
  const raw = String(groupKey || "").trim().toLowerCase();
  if (raw === "vegetables_legumes") return "vegetables";
  if (raw === "sauces") return "sauce";
  if (raw === "proteins") return "protein";
  return normalizeSaladIngredientGroupKey(raw) || raw;
}

function isPremiumMealProtein(option) {
  const premiumKey = String(option?.premiumKey || "").trim().toLowerCase();
  const key = String(option?.key || "").trim().toLowerCase();
  return PREMIUM_MEAL_PROTEIN_KEY_SET.has(premiumKey) || PREMIUM_MEAL_PROTEIN_KEY_SET.has(key);
}

function buildDisplaySnapshot({ product, optionRowsById, groupRowsById, selectedOptions }) {
  return {
    product: {
      id: String(product._id),
      key: product.key || "",
      name: localizedPair(product.name),
      imageUrl: product.imageUrl || "",
    },
    groups: selectedOptions.map((selection) => {
      const group = groupRowsById.get(String(selection.groupId));
      const option = optionRowsById.get(String(selection.optionId));
      return {
        groupId: String(selection.groupId),
        groupKey: selection.groupKey,
        groupName: localizedPair(group?.name),
        optionId: String(selection.optionId),
        optionKey: selection.optionKey,
        optionName: localizedPair(option?.name),
        quantity: Number(selection.quantity || 1),
        grams: selection.grams === null || selection.grams === undefined ? null : Number(selection.grams || 0),
      };
    }),
  };
}

function buildPricingSnapshot({ product, selectedOptions }) {
  const optionsTotalHalala = selectedOptions.reduce((sum, selection) => sum + Number(selection.totalPriceHalala || 0), 0);
  return {
    basePriceHalala: Number(product.priceHalala || 0),
    optionsTotalHalala,
    premiumExtraFeeHalala: 0,
    totalHalala: Number(product.priceHalala || 0) + optionsTotalHalala,
    currency: product.currency || SYSTEM_CURRENCY,
  };
}

function buildConfirmationSnapshot({ product, selectedOptions, optionRowsById, groupRowsById, pricingSnapshot }) {
  return {
    confirmedAt: new Date(),
    product: {
      id: String(product._id),
      key: product.key || "",
      name: localizedPair(product.name),
      priceHalala: Number(product.priceHalala || 0),
      currency: product.currency || SYSTEM_CURRENCY,
    },
    selectedOptions: selectedOptions.map((selection) => {
      const group = groupRowsById.get(String(selection.groupId));
      const option = optionRowsById.get(String(selection.optionId));
      return {
        groupId: String(selection.groupId),
        groupKey: selection.groupKey,
        groupName: localizedPair(group?.name),
        optionId: String(selection.optionId),
        optionKey: selection.optionKey,
        optionName: localizedPair(option?.name),
        quantity: Number(selection.quantity || 1),
        grams: selection.grams === null || selection.grams === undefined ? null : Number(selection.grams || 0),
        unitPriceHalala: Number(selection.unitPriceHalala || 0),
        totalPriceHalala: Number(selection.totalPriceHalala || 0),
      };
    }),
    pricing: pricingSnapshot,
  };
}

function selectedOptionField(slotIndex, optionIndex, field) {
  return `mealSlots[${slotIndex}].selectedOptions[${optionIndex}].${field}`;
}

function premiumUpgradePricing(upgrade) {
  const configuredDelta = Number(upgrade.priceHalala);
  return {
    extraFeeHalala: configuredDelta,
    priceHalala: configuredDelta,
    currency: upgrade.currency,
    source: upgrade.priceSource || "resolvePremiumUpgrade",
  };
}

async function validateCanonicalMealSlots({
  mealSlots,
  mealsPerDayLimit,
  maxSlotCount = null,
  subscription,
  session = null,
  forConfirmation = false,
} = {}) {
  const slots = Array.isArray(mealSlots) ? mealSlots : [];
  const slotErrors = [];
  const processedSlots = [];
  const resolvedMaxSlotCount = Number(maxSlotCount === null || maxSlotCount === undefined ? mealsPerDayLimit : maxSlotCount);

  if (resolvedMaxSlotCount >= 0 && slots.length > resolvedMaxSlotCount) {
    slotErrors.push(buildSlotError({
      slotIndex: null,
      field: "mealSlots",
      code: "SLOT_COUNT_EXCEEDED",
      message: `Only ${resolvedMaxSlotCount} meal slots are allowed for this day`,
    }));
  }

  const tempBalances = new Map();
  if (subscription && Array.isArray(subscription.premiumBalance)) {
    for (const row of subscription.premiumBalance) {
      if (row.premiumKey) {
        tempBalances.set(row.premiumKey, (tempBalances.get(row.premiumKey) || 0) + Number(row.remainingQty || 0));
      }
    }
  }

  const premiumConfigState = await loadClientPremiumUpgradeConfigState({ session });
  let premiumLargeSaladPricing = { extraFeeHalala: 0, priceHalala: 0 };
  if (slots.some((slot) => slot?.selectionType === MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD)) {
    premiumLargeSaladPricing = premiumUpgradePricing(
      await resolveSubscriptionPremiumUpgradePricing(PREMIUM_LARGE_SALAD_PREMIUM_KEY, { session })
    );
  }
  let builderMembership;
  try {
    builderMembership = await mealBuilderConfigService.buildPublishedMembership();
  } catch (_err) {
    return buildCanonicalValidationFailure([buildBuilderMembershipError({
      slotIndex: null,
      field: "mealBuilder",
      code: "PLANNER_BUILDER_CONFIG_UNAVAILABLE",
      message: "Published Meal Builder config is unavailable",
      productId: null,
    })]);
  }

  const debugSlots = [];

  for (let slotArrayIndex = 0; slotArrayIndex < slots.length; slotArrayIndex += 1) {
    const slot = slots[slotArrayIndex] || {};
    const slotIndex = Number(slot.slotIndex || slotArrayIndex + 1);
    const productId = normalizeId(slot.productId);
    const selectionType = String(slot.selectionType || "").trim();

    const debugSlot = {
      slotIndex,
      selectionType,
      productId: productId ? String(productId) : "",
      productName: "",
      rawSelectedOptions: JSON.parse(JSON.stringify(slot.selectedOptions || [])),
      productConfiguration: {
        productId: productId ? String(productId) : "",
        productName: "",
        selectionType,
        groups: [],
      },
      expectedGroups: [],
      receivedGroups: [],
      missingGroups: [],
      receivedOptions: [],
      receivedOptionsDetailed: [],
      matchedGroups: [],
      unknownGroups: [],
      invalidOptions: [],
      groupValidation: [],
      selectedOptionsAnalysis: [],
      validationTimeline: ["✓ Slot initialization started"],
      humanReadableSummary: "",
    };
    debugSlots.push(debugSlot);

    if (
      !forConfirmation
      && (
      slot.proteinId || slot.sandwichId || slot.salad || slot.carbId
      || (Array.isArray(slot.carbs) && slot.carbs.length > 0)
      )
    ) {
      debugSlot.validationTimeline.push("✗ Slot includes legacy fields along with canonical ones");
      slotErrors.push(buildSlotError({
        slotIndex,
        field: `mealSlots[${slotArrayIndex}]`,
        code: "PLANNER_MIXED_LEGACY_CANONICAL_SLOT",
        message: "Canonical planner slot must not include legacy selection fields",
        productId,
      }));
      continue;
    }

    if (!isValidObjectId(productId)) {
      debugSlot.validationTimeline.push("✗ Product ID is invalid or missing");
      slotErrors.push(buildSlotError({
        slotIndex,
        field: `mealSlots[${slotArrayIndex}].productId`,
        code: "PLANNER_PRODUCT_NOT_FOUND",
        message: "Product id is required",
        productId,
        stale: true,
      }));
      continue;
    }

    const productQuery = MenuProduct.findById(productId);
    const product = await (session ? productQuery.session(session) : productQuery).lean();
    if (product) {
      debugSlot.productName = (product.name && (product.name.en || product.name.ar)) || product.name || "";
      debugSlot.productConfiguration.productName = debugSlot.productName;
      debugSlot.validationTimeline.push(`✓ Product found: "${debugSlot.productName}"`);
    } else {
      debugSlot.validationTimeline.push("✗ Product not found in database");
    }
    let error = validateCatalogDocState({ doc: product, slotIndex, field: `mealSlots[${slotArrayIndex}].productId`, entity: "PRODUCT", id: productId });
    if (error) {
      debugSlot.validationTimeline.push("✗ Product validation state is invalid (inactive or deleted)");
      slotErrors.push(error);
      continue;
    }
    debugSlot.validationTimeline.push("✓ Product active");
    if (!isSubscriptionEnabled(product)) {
      debugSlot.validationTimeline.push("✗ Product is not subscription-enabled");
      slotErrors.push(buildSlotError({
        slotIndex,
        field: `mealSlots[${slotArrayIndex}].productId`,
        code: "PLANNER_PRODUCT_NOT_SUBSCRIPTION_ENABLED",
        message: "Product is not enabled for subscription planning",
        productId,
        stale: true,
      }));
      continue;
    }
    const catalogItemsById = await loadCatalogItemsByIdForDocs([product]);
    if (!isLinkedDocGloballyAvailable(product, catalogItemsById)) {
      debugSlot.validationTimeline.push("✗ Product catalog item is unavailable");
      slotErrors.push(buildSlotError({
        slotIndex,
        field: `mealSlots[${slotArrayIndex}].productId`,
        code: "PLANNER_PRODUCT_UNAVAILABLE",
        message: "Product catalog item is unavailable",
        productId,
        stale: true,
      }));
      continue;
    }
    error = validateProductSelectionType({ product, selectionType, slotIndex });
    if (error) {
      debugSlot.validationTimeline.push(`✗ Selection type mismatch: product is of type ${product.selectionType || "default"} but slot received ${selectionType}`);
      slotErrors.push(error);
      continue;
    }
    debugSlot.validationTimeline.push(`✓ SelectionType valid (${selectionType})`);
    if (
      builderMembership.hasPublishedConfig
      && !mealBuilderConfigService.isProductIncluded(builderMembership.membership, selectionType, productId)
    ) {
      debugSlot.validationTimeline.push("✗ Product not included in published Meal Builder");
      slotErrors.push(buildBuilderMembershipError({
        slotIndex,
        field: `mealSlots[${slotArrayIndex}].productId`,
        code: "PLANNER_BUILDER_PRODUCT_NOT_INCLUDED",
        message: "Product is not included in the published Meal Builder",
        productId,
      }));
      continue;
    }
    debugSlot.validationTimeline.push("✓ Product verified in Meal Builder config");

    const selectedOptionsInput = Array.isArray(slot.selectedOptions) ? slot.selectedOptions : [];
    const groupRelationRows = await (session
      ? ProductOptionGroup.find({ productId }).session(session)
      : ProductOptionGroup.find({ productId })).lean();
    const selectedGroupIds = selectedOptionsInput
      .map((selection) => normalizeId(selection?.groupId))
      .filter(isValidObjectId);
    const groupIds = [
      ...new Set([
        ...groupRelationRows.map((relation) => String(relation.groupId)),
        ...selectedGroupIds,
      ]),
    ];
    const groupRows = await (session
      ? MenuOptionGroup.find({ _id: { $in: groupIds } }).session(session)
      : MenuOptionGroup.find({ _id: { $in: groupIds } })).lean();
    const groupRowsById = new Map(groupRows.map((group) => [String(group._id), group]));
    const groupRelationsById = new Map(groupRelationRows.map((relation) => [String(relation.groupId), relation]));

    for (const relation of groupRelationRows) {
      const group = groupRowsById.get(String(relation.groupId));
      if (!group) continue;
      if (relation.isActive === false || relation.isVisible === false || relation.isAvailable === false) continue;
      debugSlot.expectedGroups.push({
        groupId: String(relation.groupId),
        groupKey: String(group.key || ""),
        min: Number(relation.minSelections || 0),
        max: relation.maxSelections === null || relation.maxSelections === undefined ? null : Number(relation.maxSelections),
      });
    }

    const optionIds = selectedOptionsInput.map((selection) => selection?.optionId).filter(Boolean);
    const optionRows = await (session
      ? MenuOption.find({ _id: { $in: optionIds.filter(isValidObjectId) } }).session(session)
      : MenuOption.find({ _id: { $in: optionIds.filter(isValidObjectId) } })).lean();
    const optionCatalogItemsById = await loadCatalogItemsByIdForDocs(optionRows);
    const optionRowsById = new Map(filterGloballyAvailable(optionRows, optionCatalogItemsById).map((option) => [String(option._id), option]));
    const rawOptionRowsById = new Map(optionRows.map((option) => [String(option._id), option]));

    const optionRelationRows = await (session
      ? ProductGroupOption.find({ productId }).session(session)
      : ProductGroupOption.find({ productId })).lean();
    const optionRelationByComposite = new Map(optionRelationRows.map((relation) => [
      `${String(relation.groupId)}:${String(relation.optionId)}`,
      relation,
    ]));

    const selectedOptions = [];
    const selectedByGroup = new Map();
    const saladGroups = {};
    const legacyCarbs = [];
    let proteinSelection = null;

    for (let optionIndex = 0; optionIndex < selectedOptionsInput.length; optionIndex += 1) {
      const selected = selectedOptionsInput[optionIndex] || {};
      const groupId = normalizeId(selected.groupId);
      const optionId = normalizeId(selected.optionId);
      const quantity = selected.quantity === undefined || selected.quantity === null ? 1 : Number(selected.quantity);

      const debugGroup = groupRowsById.get(groupId ? String(groupId) : "");
      const debugOption = optionRowsById.get(optionId ? String(optionId) : "");

      const analysis = {
        optionId: optionId ? String(optionId) : "",
        optionKey: selected.optionKey || "",
        groupId: groupId ? String(groupId) : "",
        groupKey: selected.groupKey || "",
        matched: false,
        reason: "",
        countedInGroup: "",
      };
      debugSlot.selectedOptionsAnalysis.push(analysis);

      if (!debugGroup) {
        debugSlot.unknownGroups.push({
          groupId: groupId ? String(groupId) : "",
          groupKey: selected.groupKey || "",
        });
        analysis.reason = "GROUP_NOT_FOUND_IN_CATALOG";
      }
      if (!debugOption) {
        const rawOption = rawOptionRowsById.get(optionId);
        const reason = rawOption ? "OPTION_INACTIVE" : "OPTION_NOT_FOUND";
        debugSlot.invalidOptions.push({
          optionId: optionId ? String(optionId) : "",
          optionKey: selected.optionKey || "",
          reason,
        });
        analysis.reason = reason;
      }

      if (debugGroup && debugOption) {
        debugSlot.receivedOptions.push({
          groupKey: debugGroup.key || selected.groupKey || "",
          optionKey: debugOption.key || selected.optionKey || "",
        });
      }

      debugSlot.receivedOptionsDetailed.push({
        groupId: groupId ? String(groupId) : "",
        groupKey: debugGroup ? (debugGroup.key || selected.groupKey || "") : (selected.groupKey || ""),
        optionId: optionId ? String(optionId) : "",
        optionKey: debugOption ? (debugOption.key || selected.optionKey || "") : (selected.optionKey || ""),
      });

      if (!Number.isInteger(quantity) || quantity < 1) {
        analysis.reason = "QUANTITY_INVALID: must be a positive integer";
        slotErrors.push(buildSlotError({
          slotIndex,
          field: selectedOptionField(slotArrayIndex, optionIndex, "quantity"),
          code: "PLANNER_INVALID_QUANTITY",
          message: "Selected option quantity must be a positive integer",
          productId,
          groupId,
          optionId,
        }));
        continue;
      }
      if (!isValidObjectId(groupId)) {
        analysis.reason = "GROUP_ID_INVALID: missing or not a valid ObjectId";
        slotErrors.push(buildSlotError({
          slotIndex,
          field: selectedOptionField(slotArrayIndex, optionIndex, "groupId"),
          code: "PLANNER_GROUP_NOT_FOUND",
          message: "Option group id is required",
          productId,
          groupId,
          optionId,
          stale: true,
        }));
        continue;
      }
      if (!isValidObjectId(optionId)) {
        analysis.reason = "OPTION_ID_INVALID: missing or not a valid ObjectId";
        slotErrors.push(buildSlotError({
          slotIndex,
          field: selectedOptionField(slotArrayIndex, optionIndex, "optionId"),
          code: "PLANNER_OPTION_NOT_FOUND",
          message: "Option id is required",
          productId,
          groupId,
          optionId,
          stale: true,
        }));
        continue;
      }

      const group = groupRowsById.get(groupId);
      error = validateCatalogDocState({ doc: group, slotIndex, field: selectedOptionField(slotArrayIndex, optionIndex, "groupId"), entity: "GROUP", id: groupId });
      if (error) {
        analysis.reason = "GROUP_STATE_INVALID: group is inactive or deleted";
        slotErrors.push(error);
        continue;
      }
      const groupRelation = groupRelationsById.get(groupId);
      error = validateRelationState({ relation: groupRelation, slotIndex, field: selectedOptionField(slotArrayIndex, optionIndex, "groupId"), productId, groupId, entity: "GROUP" });
      if (error) {
        analysis.reason = "GROUP_RELATION_INVALID: group is not linked or not active for this product";
        slotErrors.push(error);
        continue;
      }
      if (
        builderMembership.hasPublishedConfig
        && !mealBuilderConfigService.isGroupIncluded(builderMembership.membership, selectionType, productId, groupId)
      ) {
        analysis.reason = "GROUP_NOT_INCLUDED_IN_BUILDER: group is not part of the published builder config";
        slotErrors.push(buildBuilderMembershipError({
          slotIndex,
          field: selectedOptionField(slotArrayIndex, optionIndex, "groupId"),
          code: "PLANNER_BUILDER_GROUP_NOT_INCLUDED",
          message: "Option group is not included in the published Meal Builder for this product",
          productId,
          groupId,
          optionId,
        }));
        continue;
      }

      const rawOption = rawOptionRowsById.get(optionId);
      error = validateCatalogDocState({ doc: rawOption, slotIndex, field: selectedOptionField(slotArrayIndex, optionIndex, "optionId"), entity: "OPTION", id: optionId });
      if (error) {
        analysis.reason = "OPTION_STATE_INVALID: option is inactive or deleted in catalog";
        slotErrors.push(error);
        continue;
      }
      const option = optionRowsById.get(optionId);
      if (!option) {
        analysis.reason = "OPTION_UNAVAILABLE: option is unavailable globally";
        slotErrors.push(buildSlotError({
          slotIndex,
          field: selectedOptionField(slotArrayIndex, optionIndex, "optionId"),
          code: "PLANNER_OPTION_UNAVAILABLE",
          message: "Option catalog item is unavailable",
          productId,
          groupId,
          optionId,
          stale: true,
        }));
        continue;
      }
      if (!isSubscriptionEnabled(option)) {
        analysis.reason = "OPTION_NOT_SUBSCRIPTION_ENABLED: option does not support subscriptions";
        slotErrors.push(buildSlotError({
          slotIndex,
          field: selectedOptionField(slotArrayIndex, optionIndex, "optionId"),
          code: "PLANNER_OPTION_UNAVAILABLE",
          message: "Option is not enabled for subscription planning",
          productId,
          groupId,
          optionId,
          stale: true,
        }));
        continue;
      }
      if (String(option.groupId) !== groupId) {
        const expectedGroup = groupRowsById.get(String(option.groupId))?.key || String(option.groupId);
        const receivedGroup = group?.key || groupId;
        debugSlot.invalidOptions.push({
          optionId: optionId ? String(optionId) : "",
          optionKey: option.key || selected.optionKey || "",
          reason: "GROUP_MISMATCH",
          expectedGroup,
          receivedGroup,
        });
        analysis.reason = `GROUP_MISMATCH: option belongs to ${expectedGroup} but selected under ${receivedGroup}`;
        slotErrors.push(buildSlotError({
          slotIndex,
          field: selectedOptionField(slotArrayIndex, optionIndex, "optionId"),
          code: "PLANNER_OPTION_GROUP_MISMATCH",
          message: "Option does not belong to the selected group",
          productId,
          groupId,
          optionId,
          stale: true,
        }));
        continue;
      }

      const optionRelation = optionRelationByComposite.get(`${groupId}:${optionId}`);
      error = validateRelationState({ relation: optionRelation, slotIndex, field: selectedOptionField(slotArrayIndex, optionIndex, "optionId"), productId, groupId, optionId, entity: "OPTION" });
      if (error) {
        analysis.reason = "OPTION_RELATION_INVALID: option is not active or linked to this product group";
        slotErrors.push(error);
        continue;
      }
      if (
        builderMembership.hasPublishedConfig
        && !mealBuilderConfigService.isOptionIncluded(builderMembership.membership, selectionType, productId, groupId, optionId)
      ) {
        analysis.reason = "OPTION_NOT_INCLUDED_IN_BUILDER: option is not part of the published builder config for this group";
        slotErrors.push(buildBuilderMembershipError({
          slotIndex,
          field: selectedOptionField(slotArrayIndex, optionIndex, "optionId"),
          code: "PLANNER_BUILDER_OPTION_NOT_INCLUDED",
          message: "Option is not included in the published Meal Builder for this product group",
          productId,
          groupId,
          optionId,
        }));
        continue;
      }

      const groupKey = String(group.key || selected.groupKey || "").trim();
      const canonicalGroupKey = selectionType === MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD
        ? canonicalSaladGroupKey(groupKey)
        : groupKey;

      if (
        selectionType === MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD
        && (PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEY_SET.has(canonicalGroupKey) || groupKey === MENU_SALAD_EXTRA_PROTEIN_GROUP_KEY)
      ) {
        analysis.reason = "SALAD_EXTRA_PROTEIN_EXCLUDED: extra protein options are excluded for salad selection type";
        slotErrors.push(buildSlotError({
          slotIndex,
          field: selectedOptionField(slotArrayIndex, optionIndex, "groupId"),
          code: "PLANNER_OPTION_GROUP_UNAVAILABLE",
          message: "Extra protein is not available for subscription premium large salad",
          productId,
          groupId,
          optionId,
          stale: true,
        }));
        continue;
      }

      if (
        selectionType === MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD
        && canonicalGroupKey === "protein"
        && !isSubscriptionPremiumLargeSaladProtein(option)
      ) {
        analysis.reason = "SALAD_PROTEIN_NOT_ALLOWED: protein option is not in the salad allowlist";
        slotErrors.push(buildSlotError({
          slotIndex,
          field: selectedOptionField(slotArrayIndex, optionIndex, "optionId"),
          code: "SALAD_PROTEIN_NOT_ALLOWED",
          message: "Selected protein is not available for subscription premium large salad",
          productId,
          groupId,
          optionId,
          stale: true,
        }));
        continue;
      }

      const unitPriceHalala = Number(optionRelation.extraPriceHalala ?? option.extraPriceHalala ?? 0);
      const normalizedSelection = {
        groupId,
        groupKey,
        canonicalGroupKey,
        optionId,
        optionKey: option.key || selected.optionKey || "",
        quantity,
        grams: selected.grams === undefined || selected.grams === null
          ? (groupKey === MENU_CARB_GROUP_KEY ? 150 : null)
          : Number(selected.grams),
        unitPriceHalala,
        totalPriceHalala: unitPriceHalala * quantity,
        extraWeightUnitGrams: Number(optionRelation.extraWeightUnitGrams ?? option.extraWeightUnitGrams ?? 0),
        extraWeightPriceHalala: Number(optionRelation.extraWeightPriceHalala ?? option.extraWeightPriceHalala ?? 0),
      };

      selectedOptions.push(normalizedSelection);
      selectedByGroup.set(groupId, (selectedByGroup.get(groupId) || 0) + quantity);

      analysis.matched = true;
      analysis.countedInGroup = groupKey;

      if (groupKey === MENU_PROTEIN_GROUP_KEY) {
        proteinSelection = { option, selected: normalizedSelection };
      }
      if (groupKey === MENU_CARB_GROUP_KEY) {
        legacyCarbs.push({ carbId: optionId, grams: Number(normalizedSelection.grams || 150) });
      }
      if (selectionType === MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD) {
        const saladKey = canonicalGroupKey;
        if (!saladGroups[saladKey]) saladGroups[saladKey] = [];
        saladGroups[saladKey].push(optionId);
      }
    }
    const uniqueReceivedGroups = new Set();
    for (const opt of debugSlot.receivedOptions) {
      if (opt.groupKey) uniqueReceivedGroups.add(opt.groupKey);
    }
    debugSlot.receivedGroups = Array.from(uniqueReceivedGroups);

    for (const relation of groupRelationRows) {
      const group = groupRowsById.get(String(relation.groupId));
      if (!group) continue;
      if (relation.isActive === false || relation.isVisible === false || relation.isAvailable === false) continue;
      const selectedCount = selectedByGroup.get(String(relation.groupId)) || 0;
      const min = Number(relation.minSelections || 0);
      const max = relation.maxSelections === null || relation.maxSelections === undefined ? null : Number(relation.maxSelections);

      const satisfied = (selectedCount >= min) && (max === null || selectedCount <= max);
      debugSlot.matchedGroups.push({
        groupKey: group.key || "",
        satisfied,
      });

      debugSlot.groupValidation.push({
        groupId: String(relation.groupId),
        groupKey: group.key || "",
        requiredMin: min,
        requiredMax: max,
        received: selectedCount,
        status: satisfied ? "PASS" : "FAIL",
      });

      if (satisfied) {
        debugSlot.validationTimeline.push(`✓ Group "${group.key || relation.groupId}" validation passed (${selectedCount} selected, range: ${min}-${max !== null ? max : "unlimited"})`);
      } else {
        if (selectedCount < min) {
          debugSlot.validationTimeline.push(`✗ Group "${group.key || relation.groupId}" validation failed: received ${selectedCount}, requires at least ${min}`);
        } else {
          debugSlot.validationTimeline.push(`✗ Group "${group.key || relation.groupId}" validation failed: received ${selectedCount}, allows at most ${max}`);
        }
      }

      if (selectedCount < min) {
        debugSlot.missingGroups.push(group.key || "");
      }

      if (selectedCount < min) {
        slotErrors.push(buildSlotError({
          slotIndex,
          field: `mealSlots[${slotArrayIndex}].selectedOptions`,
          code: "PLANNER_MIN_SELECTION_NOT_MET",
          message: `${group.key} requires at least ${min} selection${min === 1 ? "" : "s"}`,
          productId,
          groupId: relation.groupId,
        }));
      }
      if (max !== null && selectedCount > max) {
        slotErrors.push(buildSlotError({
          slotIndex,
          field: `mealSlots[${slotArrayIndex}].selectedOptions`,
          code: "PLANNER_MAX_SELECTION_EXCEEDED",
          message: `${group.key} allows at most ${max} selection${max === 1 ? "" : "s"}`,
          productId,
          groupId: relation.groupId,
        }));
      }
    }

    if (selectionType === MEAL_SELECTION_TYPES.PREMIUM_MEAL && proteinSelection && !isPremiumMealProtein(proteinSelection.option)) {
      slotErrors.push(buildSlotError({
        slotIndex,
        field: `mealSlots[${slotArrayIndex}].selectedOptions`,
        code: "PLANNER_OPTION_RELATION_NOT_FOUND",
        message: "Premium meal requires a premium protein option",
        productId,
        groupId: proteinSelection.selected.groupId,
        optionId: proteinSelection.selected.optionId,
      }));
    }
    if (selectionType === MEAL_SELECTION_TYPES.PREMIUM_MEAL && proteinSelection) {
      const selectedPremiumKey = proteinSelection.option.premiumKey || proteinSelection.option.key || null;
      if (selectedPremiumKey && !premiumConfigState.isAllowed(selectedPremiumKey)) {
        slotErrors.push(buildSlotError({
          slotIndex,
          field: `mealSlots[${slotArrayIndex}].selectedOptions`,
          code: "PREMIUM_UPGRADE_CONFIG_UNAVAILABLE",
          message: "Premium upgrade is not available",
          productId,
          groupId: proteinSelection.selected.groupId,
          optionId: proteinSelection.selected.optionId,
          stale: true,
        }));
      }
    }
    if (selectionType === MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD && !premiumLargeSaladPricing) {
      slotErrors.push(buildSlotError({
        slotIndex,
        field: `mealSlots[${slotArrayIndex}].productId`,
        code: "PREMIUM_UPGRADE_CONFIG_UNAVAILABLE",
        message: "Premium large salad is not available",
        productId,
        stale: true,
      }));
    }
    if (selectionType === MEAL_SELECTION_TYPES.STANDARD_MEAL && proteinSelection && isPremiumMealProtein(proteinSelection.option)) {
      slotErrors.push(buildSlotError({
        slotIndex,
        field: `mealSlots[${slotArrayIndex}].selectedOptions`,
        code: "PLANNER_OPTION_RELATION_NOT_FOUND",
        message: "Standard meal cannot use a premium protein option",
        productId,
        groupId: proteinSelection.selected.groupId,
        optionId: proteinSelection.selected.optionId,
      }));
    }
    if ((selectionType === MEAL_SELECTION_TYPES.STANDARD_MEAL || selectionType === MEAL_SELECTION_TYPES.PREMIUM_MEAL) && legacyCarbs.length > 0) {
      const uniqueCarbs = new Set(legacyCarbs.map((carb) => String(carb.carbId)));
      const totalGrams = legacyCarbs.reduce((sum, carb) => sum + Number(carb.grams || 0), 0);
      if (uniqueCarbs.size !== legacyCarbs.length || legacyCarbs.length > STANDARD_CARB_RULES.maxTypes || totalGrams > STANDARD_CARB_RULES.maxTotalGrams) {
        slotErrors.push(buildSlotError({
          slotIndex,
          field: `mealSlots[${slotArrayIndex}].selectedOptions`,
          code: "PLANNER_MAX_SELECTION_EXCEEDED",
          message: "Carb selection exceeds planner rules",
          productId,
        }));
      }
    }

    const pricingSnapshot = buildPricingSnapshot({ product, selectedOptions });
    let premiumKey = null;
    let isPremium = false;
    let premiumSource = "none";
    let premiumExtraFeeHalala = 0;

    if (selectionType === MEAL_SELECTION_TYPES.PREMIUM_MEAL && proteinSelection) {
      isPremium = true;
      premiumKey = proteinSelection.option.premiumKey || proteinSelection.option.key || null;
      const upgrade = await resolveSubscriptionPremiumUpgradePricing(premiumKey, {
        optionDoc: proteinSelection.option,
        session,
      });
      premiumExtraFeeHalala = upgrade.priceHalala;
    } else if (selectionType === MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD) {
      isPremium = true;
      premiumKey = PREMIUM_LARGE_SALAD_PREMIUM_KEY;
      premiumExtraFeeHalala = Number(premiumLargeSaladPricing?.extraFeeHalala || 0);
    }

    if (isPremium) {
      const persistedPremiumSource = String(slot.premiumSource || "").trim();
      if (persistedPremiumSource === "paid_extra" || persistedPremiumSource === "paid") {
        premiumSource = persistedPremiumSource === "paid" ? "paid" : "paid_extra";
      } else {
        const available = premiumKey ? (tempBalances.get(premiumKey) || 0) : 0;
        if (available > 0) {
          premiumSource = "balance";
          tempBalances.set(premiumKey, available - 1);
          premiumExtraFeeHalala = 0;
        } else {
          premiumSource = "pending_payment";
        }
      }
    }

    const displaySnapshot = buildDisplaySnapshot({ product, optionRowsById, groupRowsById, selectedOptions });
    const processedSlot = {
      slotIndex,
      slotKey: slot.slotKey || buildMealSlotKey(slotIndex),
      status: "complete",
      selectionType,
      contractVersion: CANONICAL_PLANNER_CONTRACT_VERSION,
      productId,
      productKey: product.key || "",
      selectedOptions,
      pricingSnapshot,
      displaySnapshot,
      fulfillmentSnapshot: {
        operationalSku: `${product.key || productId}:${selectedOptions.map((selection) => selection.optionKey || selection.optionId).join("+")}`,
        kitchenLabel: displaySnapshot.product.name,
      },
      confirmationSnapshot: forConfirmation
        ? buildConfirmationSnapshot({ product, selectedOptions, optionRowsById, groupRowsById, pricingSnapshot })
        : slot.confirmationSnapshot || undefined,
      proteinId: proteinSelection ? proteinSelection.selected.optionId : null,
      proteinKey: proteinSelection ? proteinSelection.option.key : null,
      proteinFamilyKey: proteinSelection ? normalizeProteinFamilyKey(proteinSelection.option.proteinFamilyKey || proteinSelection.option.displayCategoryKey) : null,
      proteinDisplayCategoryKey: proteinSelection
        ? normalizeProteinDisplayCategoryKey(proteinSelection.option.displayCategoryKey, {
          isPremium: isPremiumMealProtein(proteinSelection.option),
          proteinFamilyKey: proteinSelection.option.proteinFamilyKey,
        })
        : null,
      proteinRuleTags: proteinSelection && Array.isArray(proteinSelection.option.ruleTags) ? proteinSelection.option.ruleTags : [],
      carbs: legacyCarbs,
      sandwichId: selectionType === MEAL_SELECTION_TYPES.SANDWICH ? productId : null,
      salad: selectionType === MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD ? {
        presetKey: PREMIUM_LARGE_SALAD_PRESET_KEY,
        groups: saladGroups,
      } : null,
      isPremium,
      premiumKey,
      premiumSource,
      premiumExtraFeeHalala,
      updatedAt: new Date(),
    };

    processedSlots.push(processedSlot);
  }

  for (const ds of debugSlots) {
    const errors = slotErrors.filter((err) => Number(err.slotIndex) === Number(ds.slotIndex));
    if (errors.length === 0) {
      ds.validationTimeline.push("✓ All validation checks passed");
    } else {
      ds.validationTimeline.push(`✗ Validation failed: ${errors[0].message}`);
    }
    ds.humanReadableSummary = buildHumanReadableSummary(ds, slotErrors);
  }

  if (slotErrors.length) {
    const debug = {
      slots: debugSlots,
      normalizedPayload: { mealSlots: slots },
    };
    if (process.env.NODE_ENV !== "production") {
      console.log("\n=== CANONICAL PLANNER VALIDATION DIAGNOSTICS ===");
      for (const ds of debugSlots) {
        console.log(formatSlotDiagnosticReport(ds));
      }
    }
    return buildCanonicalValidationFailure(slotErrors, debug);
  }

  const plannerMeta = {
    requiredSlotCount: Number(mealsPerDayLimit || 0),
    emptySlotCount: Math.max(0, Number(mealsPerDayLimit || 0) - processedSlots.length),
    partialSlotCount: 0,
    completeSlotCount: processedSlots.length,
    beefSlotCount: processedSlots.filter((slot) => slot.proteinFamilyKey === "beef" && !slot.isPremium).length,
    premiumSlotCount: processedSlots.filter((slot) => slot.isPremium).length,
    premiumCoveredByBalanceCount: processedSlots.filter((slot) => slot.isPremium && slot.premiumSource === "balance").length,
    premiumPendingPaymentCount: processedSlots.filter((slot) => slot.isPremium && slot.premiumSource === "pending_payment").length,
    premiumPaidExtraCount: processedSlots.filter((slot) => slot.isPremium && (slot.premiumSource === "paid" || slot.premiumSource === "paid_extra")).length,
    premiumTotalHalala: processedSlots
      .filter((slot) => slot.isPremium && slot.premiumSource === "pending_payment")
      .reduce((sum, slot) => sum + Number(slot.premiumExtraFeeHalala || 0), 0),
    maxSlotCount: resolvedMaxSlotCount,
    isDraftValid: true,
    isConfirmable: false,
    lastEditedAt: new Date(),
  };
  plannerMeta.isConfirmable = Boolean(
    plannerMeta.partialSlotCount === 0
      && plannerMeta.completeSlotCount >= plannerMeta.requiredSlotCount
      && plannerMeta.premiumPendingPaymentCount === 0
  );

  const materializedProjection = projectMaterializedAndLegacyFromSlots({ processedSlots, now: new Date() });

  return {
    valid: true,
    processedSlots,
    plannerMeta,
    materializedMeals: materializedProjection.materializedMeals,
    selections: materializedProjection.selections,
    premiumUpgradeSelections: materializedProjection.premiumSelections,
    baseMealSlots: materializedProjection.baseMealSlots,
    debug: {
      slots: debugSlots,
      normalizedPayload: { mealSlots: slots },
    },
  };
}

function buildHumanReadableSummary(debugSlot, slotErrors) {
  const errors = slotErrors.filter((err) => Number(err.slotIndex) === Number(debugSlot.slotIndex));
  const isValid = errors.length === 0;

  const lines = [];
  lines.push(`Slot ${debugSlot.slotIndex} (${debugSlot.selectionType || "unknown"})`);
  lines.push(``);
  lines.push(`Product:`);
  lines.push(`  ${debugSlot.productName || debugSlot.productId || "Unknown Product"}`);
  lines.push(``);

  lines.push(`Expected:`);
  if (debugSlot.expectedGroups && debugSlot.expectedGroups.length > 0) {
    for (const group of debugSlot.expectedGroups) {
      const min = group.min || 0;
      const max = group.max ? `max ${group.max}` : "unlimited";
      const minReq = min > 0 ? `${min} required` : "optional";
      const val = (debugSlot.groupValidation || []).find((v) => v.groupId === group.groupId);
      const statusIcon = val && val.status === "FAIL" ? "✗" : "✓";
      lines.push(`  ${statusIcon} ${group.groupKey} (${minReq}, ${max})`);
    }
  } else {
    lines.push(`  ✓ (none)`);
  }
  lines.push(``);

  lines.push(`Received:`);
  if (debugSlot.rawSelectedOptions && debugSlot.rawSelectedOptions.length > 0) {
    const matchedAnalysis = (debugSlot.selectedOptionsAnalysis || []).filter((a) => a.matched);
    if (matchedAnalysis.length > 0) {
      const grouped = {};
      for (const opt of matchedAnalysis) {
        const groupKey = opt.countedInGroup || "other";
        if (!grouped[groupKey]) grouped[groupKey] = [];
        grouped[groupKey].push(`${opt.optionKey || opt.optionId} (x1)`);
      }
      for (const groupKey of Object.keys(grouped)) {
        lines.push(`  ✓ ${groupKey}: ${grouped[groupKey].join(", ")}`);
      }
    } else {
      lines.push(`  No options matched catalog expectations.`);
    }

    const unmatched = (debugSlot.selectedOptionsAnalysis || []).filter((a) => !a.matched);
    if (unmatched.length > 0) {
      lines.push(``);
      lines.push(`  Unmatched/Invalid Options Received:`);
      for (const opt of unmatched) {
        lines.push(`  ✗ Option: ${opt.optionKey || opt.optionId} (Group: ${opt.groupKey || opt.groupId})`);
        lines.push(`    ↳ Reason: ${opt.reason}`);
      }
    }
  } else {
    lines.push(`  ✗ none`);
  }
  lines.push(``);

  lines.push(`Result:`);
  lines.push(`  ${isValid ? "Validation Passed" : "Validation Failed"}`);
  lines.push(``);

  if (!isValid) {
    lines.push(`Reason:`);
    for (const err of errors) {
      lines.push(`  ${err.message}`);
    }
    lines.push(``);

    lines.push(`Suggested Fix:`);
    const codes = new Set(errors.map((e) => e.code));
    if (codes.has("PLANNER_MIN_SELECTION_NOT_MET")) {
      const failedGroups = errors.filter((e) => e.code === "PLANNER_MIN_SELECTION_NOT_MET").map((e) => e.groupId);
      const failedKeys = debugSlot.expectedGroups.filter((g) => failedGroups.includes(g.groupId)).map((g) => `"${g.groupKey}"`);
      lines.push(`  Send selectedOptions entries that belong to the missing required group(s): ${failedKeys.join(", ")}.`);
    } else if (codes.has("PLANNER_MAX_SELECTION_EXCEEDED")) {
      lines.push(`  Reduce the quantity or number of selected options for the failing group.`);
    } else if (codes.has("PLANNER_OPTION_GROUP_MISMATCH")) {
      lines.push(`  Ensure optionId matches the correct groupId as configured in the catalog.`);
    } else if (codes.has("PLANNER_PRODUCT_NOT_FOUND")) {
      lines.push(`  Verify that the productId exists and is active/subscription-enabled in the catalog.`);
    } else if (codes.has("PLANNER_PRODUCT_UNAVAILABLE")) {
      lines.push(`  Verify product catalog pricing is available for the user's location/market.`);
    } else {
      lines.push(`  Verify the payload keys and IDs match the product catalog option groups.`);
    }
  }

  return lines.join("\n");
}

function formatSlotDiagnosticReport(debugSlot) {
  const lines = [];
  lines.push(`=================================================`);
  lines.push(`SLOT #${debugSlot.slotIndex}`);
  lines.push(`=================================================`);
  lines.push(`PRODUCT: ${debugSlot.productName || "Unknown"} (${debugSlot.productId})`);
  lines.push(`SELECTION TYPE: ${debugSlot.selectionType}`);
  lines.push(``);

  lines.push(`RAW SELECTED OPTIONS RECEIVED:`);
  if (!debugSlot.rawSelectedOptions || debugSlot.rawSelectedOptions.length === 0) {
    lines.push(`  (none)`);
  } else {
    for (const opt of debugSlot.rawSelectedOptions) {
      lines.push(`  - optionId: ${opt.optionId}, groupId: ${opt.groupId}, optionKey: ${opt.optionKey || "(none)"}, groupKey: ${opt.groupKey || "(none)"}`);
    }
  }
  lines.push(``);

  lines.push(`PRODUCT CONFIGURATION:`);
  lines.push(`  Selection Type: ${debugSlot.productConfiguration.selectionType}`);
  lines.push(`  Configured Groups:`);
  if (!debugSlot.productConfiguration.groups || debugSlot.productConfiguration.groups.length === 0) {
    lines.push(`    (none)`);
  } else {
    for (const g of debugSlot.productConfiguration.groups) {
      lines.push(`    - groupKey: ${g.groupKey} (groupId: ${g.groupId}) [min: ${g.min}, max: ${g.max !== null ? g.max : "unlimited"}]`);
    }
  }
  lines.push(``);

  lines.push(`GROUP VALIDATION STATS:`);
  if (!debugSlot.groupValidation || debugSlot.groupValidation.length === 0) {
    lines.push(`  (none)`);
  } else {
    for (const g of debugSlot.groupValidation) {
      lines.push(`  - [${g.status}] ${g.groupKey}: received ${g.received} (required: ${g.requiredMin} to ${g.requiredMax !== null ? g.requiredMax : "unlimited"})`);
    }
  }
  lines.push(``);

  lines.push(`SELECTED OPTIONS ANALYSIS:`);
  if (!debugSlot.selectedOptionsAnalysis || debugSlot.selectedOptionsAnalysis.length === 0) {
    lines.push(`  (none)`);
  } else {
    for (const opt of debugSlot.selectedOptionsAnalysis) {
      const matchStatus = opt.matched ? `MATCHED to "${opt.countedInGroup}"` : `REJECTED (Reason: ${opt.reason})`;
      lines.push(`  - Option: ${opt.optionKey || "unknown"} (${opt.optionId}) | Group: ${opt.groupKey || "unknown"} (${opt.groupId})`);
      lines.push(`    Status: ${matchStatus}`);
    }
  }
  lines.push(``);

  lines.push(`VALIDATION TIMELINE:`);
  for (const step of debugSlot.validationTimeline) {
    lines.push(`  ${step}`);
  }
  lines.push(``);

  lines.push(`HUMAN-READABLE ERROR SUMMARY:`);
  lines.push(debugSlot.humanReadableSummary || "  (none)");

  return lines.join("\n");
}

module.exports = {
  CANONICAL_PLANNER_CONTRACT_VERSION,
  hasCanonicalSlotShape,
  isCanonicalPlannerRequest,
  validateCanonicalMealSlots,
  formatSlotDiagnosticReport,
};
