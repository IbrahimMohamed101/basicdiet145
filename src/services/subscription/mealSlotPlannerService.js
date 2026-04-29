const mongoose = require("mongoose");
const BuilderProtein = require("../../models/BuilderProtein");
const BuilderCarb = require("../../models/BuilderCarb");
const Meal = require("../../models/Meal");
const MealCategory = require("../../models/MealCategory");
const SaladIngredient = require("../../models/SaladIngredient");
const { isValidObjectId } = mongoose;
const {
  LEGACY_MEAL_SELECTION_TYPES,
  PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA,
  PREMIUM_LARGE_SALAD_PREMIUM_KEY,
  PREMIUM_LARGE_SALAD_PRESET_KEY,
  SALAD_SELECTION_GROUPS,
  SANDWICH_CATEGORY_KEYS,
  STANDARD_CARB_RULES,
  SYSTEM_CURRENCY,
  getMealPlannerRules,
  normalizeProteinDisplayCategoryKey,
  normalizeProteinFamilyKey,
  normalizeSaladIngredientGroupKey,
} = require("../../config/mealPlannerContract");
const {
  buildPaymentRequirement,
  buildPlannerRevisionHash,
} = require("./subscriptionDayCommercialStateService");
const { 
  NEW_TYPES, 
  mapLegacySelectionType, 
  normalizeCarbs 
} = require("../../utils/subscription/mealTypeMapper");

const DEFAULT_SLOT_KEY_PREFIX = "slot_";

const CUSTOM_PREMIUM_SALAD_TYPE = LEGACY_MEAL_SELECTION_TYPES.CUSTOM_PREMIUM_SALAD;
const SANDWICH_TYPE = LEGACY_MEAL_SELECTION_TYPES.SANDWICH;
const STANDARD_COMBO_TYPE = LEGACY_MEAL_SELECTION_TYPES.STANDARD_COMBO;
const CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA = PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA;
const CANONICAL_PREMIUM_SALAD_KEY = PREMIUM_LARGE_SALAD_PREMIUM_KEY;

const SALAD_GROUP_KEYS = new Set(SALAD_SELECTION_GROUPS.map((group) => group.key));

function buildMealPlannerValidationResult({ code, message, slotErrors = [] }) {
  return {
    valid: false,
    errorCode: code,
    errorMessage: message,
    slotErrors,
  };
}

function buildMealSlotKey(slotIndex) {
  return `${DEFAULT_SLOT_KEY_PREFIX}${slotIndex}`;
}

function resolveMealSlotKey(slot) {
  const rawKey = slot && typeof slot.slotKey === "string" ? slot.slotKey.trim() : "";
  if (rawKey) return rawKey;
  const slotIndex = Number(slot && slot.slotIndex);
  if (Number.isInteger(slotIndex) && slotIndex > 0) return buildMealSlotKey(slotIndex);
  return "";
}

function normalizeSaladPayload(salad) {
  if (!salad || typeof salad !== "object" || Array.isArray(salad)) return salad;

  const groups = salad.groups && typeof salad.groups === "object" && !Array.isArray(salad.groups)
    ? { ...salad.groups }
    : salad.groups;

  return {
    ...salad,
    presetKey: String(salad.presetKey || PREMIUM_LARGE_SALAD_PRESET_KEY).trim() || PREMIUM_LARGE_SALAD_PRESET_KEY,
    groups,
  };
}

function normalizeMealSlotsInput({ mealSlots }) {
  return (Array.isArray(mealSlots) ? mealSlots : []).map((slot) => {
    const resolvedSlotIndex = Number(slot && slot.slotIndex);
    const rawSlot = slot && typeof slot.toObject === "function" ? slot.toObject() : slot;
    const normalizedSlot = rawSlot && typeof rawSlot === "object" ? { ...rawSlot } : {};
    normalizedSlot.slotIndex = resolvedSlotIndex;
    normalizedSlot.slotKey = resolveMealSlotKey({ ...rawSlot, slotIndex: resolvedSlotIndex });
    normalizedSlot.selectionType = mapLegacySelectionType(normalizedSlot.selectionType, normalizedSlot);
    if (!normalizedSlot.salad && normalizedSlot.customSalad && typeof normalizedSlot.customSalad === "object") {
      normalizedSlot.salad = normalizedSlot.customSalad;
    }
    if (normalizedSlot.salad && typeof normalizedSlot.salad === "object" && !Array.isArray(normalizedSlot.salad)) {
      normalizedSlot.salad = normalizeSaladPayload(normalizedSlot.salad);
    }
    normalizedSlot.carbs = normalizeCarbs(normalizedSlot, normalizedSlot.selectionType);
    return normalizedSlot;
  });
}

/** 
 * Validation Suite 
 */

function validateMealSlotShape(slot) {
  if (!slot.slotIndex || !slot.selectionType) {
    return { valid: false, code: "INVALID_SLOT_STRUCTURE", message: "Slot index and selection type are required" };
  }
  return { valid: true };
}

function hasSaladPayload(slot) {
  return Boolean(slot && slot.salad);
}

function validateStandardMeal(slot, proteins, carbsMap) {
  if (slot.sandwichId || hasSaladPayload(slot)) {
    return {
      valid: false,
      code: "STANDARD_MEAL_EXCLUSIVITY_VIOLATION",
      message: "Standard meal accepts only proteinId and carbs",
    };
  }

  const protein = proteins.get(String(slot.proteinId));
  if (!protein) return { valid: false, code: "PROTEIN_REQUIRED", message: "Standard meal requires a valid protein" };
  if (protein.isPremium) return { valid: false, code: "INVALID_PROTEIN_TYPE", message: "Standard meal cannot use premium protein" };
  
  return validateCarbSplit(slot.carbs, carbsMap);
}

function validatePremiumMeal(slot, proteins, carbsMap) {
  if (slot.sandwichId || hasSaladPayload(slot)) {
    return {
      valid: false,
      code: "PREMIUM_MEAL_EXCLUSIVITY_VIOLATION",
      message: "Premium meal accepts only proteinId and carbs",
    };
  }

  const protein = proteins.get(String(slot.proteinId));
  if (!protein) return { valid: false, code: "PROTEIN_REQUIRED", message: "Premium meal requires a valid protein" };
  if (protein.isPremium !== true) return { valid: false, code: "INVALID_PROTEIN_TYPE", message: "Premium meal requires a premium protein" };
  
  return validateCarbSplit(slot.carbs, carbsMap);
}

function validateCarbSplit(carbs, carbsMap) {
  if (!Array.isArray(carbs) || carbs.length === 0) {
    return { valid: false, code: "CARBS_REQUIRED", message: "At least one carb selection is required" };
  }
  if (carbs.length > STANDARD_CARB_RULES.maxTypes) {
    return {
      valid: false,
      code: "TOO_MANY_CARBS",
      message: `Maximum ${STANDARD_CARB_RULES.maxTypes} carb types allowed per meal`,
    };
  }

  let totalGrams = 0;
  const seenIds = new Set();
  
  for (const selection of carbs) {
    if (!selection.carbId || !carbsMap.has(String(selection.carbId))) {
      return { valid: false, code: "INVALID_CARB_ID", message: "Invalid carb selection" };
    }
    if (seenIds.has(String(selection.carbId))) {
      return { valid: false, code: "DUPLICATE_CARB", message: "Duplicate carb type in same meal" };
    }
    seenIds.add(String(selection.carbId));
    
    const grams = Number(selection.grams);
    if (!Number.isInteger(grams) || grams <= 0) {
      return { valid: false, code: "INVALID_GRAMS", message: "Carb grams must be a positive integer" };
    }
    totalGrams += grams;
  }

  if (totalGrams > STANDARD_CARB_RULES.maxTotalGrams) {
    return {
      valid: false,
      code: "CARB_LIMIT_EXCEEDED",
      message: `Total carb grams cannot exceed ${STANDARD_CARB_RULES.maxTotalGrams}g`,
    };
  }

  return { valid: true };
}

function validateSaladGroupSelectionCount(groupConfig, selectedCount) {
  if (selectedCount >= groupConfig.minSelect && selectedCount <= groupConfig.maxSelect) {
    return { valid: true };
  }

  if (groupConfig.key === "protein") {
    return {
      valid: false,
      code: "SALAD_PROTEIN_REQUIRED",
      message: "Exactly one protein is required for premium large salad",
    };
  }

  if (groupConfig.key === "sauce") {
    return {
      valid: false,
      code: "SALAD_SAUCE_REQUIRED",
      message: "Exactly one sauce is required for premium large salad",
    };
  }

  if (selectedCount < groupConfig.minSelect) {
    return {
      valid: false,
      code: "SALAD_GROUP_MIN_SELECT",
      message: `${groupConfig.key} requires at least ${groupConfig.minSelect} selections`,
    };
  }

  return {
    valid: false,
    code: "SALAD_GROUP_MAX_SELECT_EXCEEDED",
    message: `${groupConfig.key} allows at most ${groupConfig.maxSelect} selections`,
  };
}

function validatePremiumLargeSalad(slot, proteinMap, saladIngredientMap) {
  if (Array.isArray(slot.carbs) && slot.carbs.length > 0) {
    return { valid: false, code: "CARBS_NOT_ALLOWED", message: "Carbs are not allowed with premium large salad" };
  }
  if (slot.sandwichId) {
    return { valid: false, code: "SANDWICH_NOT_ALLOWED", message: "Sandwich is not allowed with premium large salad" };
  }

  const salad = normalizeSaladPayload(slot.salad);
  if (!salad || !salad.groups || typeof salad.groups !== "object" || Array.isArray(salad.groups)) {
    return { valid: false, code: "SALAD_STRUCTURE_REQUIRED", message: "Salad groups must be defined" };
  }

  for (const groupKey of Object.keys(salad.groups)) {
    if (!SALAD_GROUP_KEYS.has(groupKey)) {
      return { valid: false, code: "INVALID_SALAD_GROUP", message: `Invalid salad group: ${groupKey}` };
    }
  }

  let selectedProteinId = null;
  for (const groupConfig of SALAD_SELECTION_GROUPS) {
    const groupItems = salad.groups[groupConfig.key];
    if (groupItems !== undefined && !Array.isArray(groupItems)) {
      return {
        valid: false,
        code: "SALAD_STRUCTURE_REQUIRED",
        message: `${groupConfig.key} must be an array`,
      };
    }

    const normalizedGroupItems = Array.isArray(groupItems)
      ? groupItems.map((item) => String(item || "").trim())
      : [];

    const countValidation = validateSaladGroupSelectionCount(groupConfig, normalizedGroupItems.length);
    if (!countValidation.valid) {
      return countValidation;
    }

    if (new Set(normalizedGroupItems).size !== normalizedGroupItems.length) {
      return {
        valid: false,
        code: "DUPLICATE_SALAD_INGREDIENT",
        message: `Duplicate selections are not allowed in ${groupConfig.key}`,
      };
    }

    if (groupConfig.source === "protein") {
      if (normalizedGroupItems.length !== 1) {
        return {
          valid: false,
          code: "SALAD_PROTEIN_REQUIRED",
          message: "Exactly one protein is required for premium large salad",
        };
      }

      selectedProteinId = normalizedGroupItems[0];
      const protein = proteinMap ? proteinMap.get(selectedProteinId) : null;
      if (!protein) {
        return { valid: false, code: "SALAD_PROTEIN_INVALID", message: "Invalid salad protein" };
      }
      continue;
    }

    for (const ingredientId of normalizedGroupItems) {
      const ingredient = saladIngredientMap ? saladIngredientMap.get(String(ingredientId)) : null;
      if (!ingredient) {
        return { valid: false, code: "INVALID_SALAD_INGREDIENT", message: "Invalid salad ingredient ID" };
      }
      const ingredientGroup = normalizeSaladIngredientGroupKey(ingredient.groupKey);
      if (ingredientGroup !== groupConfig.key) {
        return { 
          valid: false, 
          code: "SALAD_INGREDIENT_GROUP_MISMATCH", 
          message: `Ingredient ${ingredientId} belongs to ${ingredientGroup || "unknown"}, not ${groupConfig.key}` 
        };
      }
    }
  }

  if (slot.proteinId && String(slot.proteinId) !== String(selectedProteinId)) {
    return { valid: false, code: "SALAD_PROTEIN_MISMATCH", message: "Salad protein mismatch" };
  }

  return { valid: true };
}

function validateSandwichMeal(slot, sandwichMap) {
  if (!slot.sandwichId) {
    return { valid: false, code: "SANDWICH_ID_REQUIRED", message: "Sandwich selection is required" };
  }
  if (slot.proteinId || (Array.isArray(slot.carbs) && slot.carbs.length > 0) || slot.salad) {
    return { valid: false, code: "SANDWICH_EXCLUSIVITY_VIOLATION", message: "Sandwich cannot be combined with other components" };
  }

  if (sandwichMap && !sandwichMap.has(String(slot.sandwichId))) {
    return { valid: false, code: "INVALID_SANDWICH_MEAL", message: "Selected meal is not a valid sandwich option" };
  }

  return { valid: true };
}

function collectDuplicateSlotErrors({ mealSlots }) {
  const slotIndexCounts = new Map();
  const slotKeyCounts = new Map();
  const slotErrors = [];

  for (const slot of Array.isArray(mealSlots) ? mealSlots : []) {
    const slotIndex = Number(slot && slot.slotIndex);
    if (!Number.isInteger(slotIndex) || slotIndex < 1) {
      slotErrors.push({
        slotIndex: Number.isFinite(slotIndex) ? slotIndex : null,
        field: "slotIndex",
        code: "INVALID_SLOT_INDEX",
        message: "Each meal slot must include a positive integer slotIndex",
      });
      continue;
    }

    slotIndexCounts.set(slotIndex, (slotIndexCounts.get(slotIndex) || 0) + 1);
    if (slot && slot.slotKey) {
      slotKeyCounts.set(slot.slotKey, (slotKeyCounts.get(slot.slotKey) || 0) + 1);
    }
  }

  for (const slot of Array.isArray(mealSlots) ? mealSlots : []) {
    const slotIndex = Number(slot && slot.slotIndex);
    const slotKey = slot && slot.slotKey ? String(slot.slotKey) : "";

    if (Number.isInteger(slotIndex) && (slotIndexCounts.get(slotIndex) || 0) > 1) {
      slotErrors.push({ slotIndex, field: "slotIndex", code: "DUPLICATE_SLOT_INDEX", message: "slotIndex values must be unique" });
    }
    if (slotKey && (slotKeyCounts.get(slotKey) || 0) > 1) {
      slotErrors.push({
        slotIndex: Number.isInteger(slotIndex) ? slotIndex : null,
        field: "slotKey",
        code: "DUPLICATE_SLOT_KEY",
        message: "slotKey values must be unique",
      });
    }
  }

  return slotErrors;
}

function collectSlotCountErrors({ mealSlots, requiredSlotCount = 0, completeSlotCount = null }) {
  const normalizedSlots = Array.isArray(mealSlots) ? mealSlots : [];
  const maxSlots = Number(requiredSlotCount || 0);
  const slotErrors = [];

  if (maxSlots >= 0 && normalizedSlots.length > maxSlots) {
    const overflowSlots = normalizedSlots.slice().sort((a, b) => Number(a.slotIndex || 0) - Number(b.slotIndex || 0)).slice(maxSlots);
    const message = `Only ${maxSlots} meal slot${maxSlots === 1 ? "" : "s"} allowed for this day`;
    slotErrors.push(...overflowSlots.map((slot) => ({
      slotIndex: Number(slot && slot.slotIndex ? slot.slotIndex : 0) || null,
      field: "mealSlots",
      code: "MEAL_SLOT_COUNT_EXCEEDED",
      message,
    })));
  }

  const resolvedCompleteCount = completeSlotCount === null
    ? normalizedSlots.filter((slot) => slot && slot.status === "complete").length
    : Number(completeSlotCount || 0);
  if (maxSlots >= 0 && resolvedCompleteCount > maxSlots && normalizedSlots.length <= maxSlots) {
    const overflowCompleteSlots = normalizedSlots.filter((slot) => slot && slot.status === "complete").sort((a, b) => Number(a.slotIndex || 0) - Number(b.slotIndex || 0)).slice(maxSlots);
    const message = `Only ${maxSlots} complete meal slot${maxSlots === 1 ? "" : "s"} allowed for this day`;
    slotErrors.push(...overflowCompleteSlots.map((slot) => ({
      slotIndex: Number(slot && slot.slotIndex ? slot.slotIndex : 0) || null,
      field: "mealSlots",
      code: "COMPLETE_SLOT_COUNT_EXCEEDED",
      message,
    })));
  }

  return slotErrors;
}

function mapPlannerValidationResult(slotErrors) {
  if (!Array.isArray(slotErrors) || !slotErrors.length) return null;
  const firstError = slotErrors[0];
  return buildMealPlannerValidationResult({
    code: firstError.code || "INVALID_MEAL_PLAN",
    message: firstError.message || "Meal planner validation failed",
    slotErrors,
  });
}

function resolveSaladProteinId(slot) {
  const proteinGroup = slot && slot.salad && slot.salad.groups && Array.isArray(slot.salad.groups.protein)
    ? slot.salad.groups.protein
    : [];
  return proteinGroup[0] || null;
}

function projectMaterializedAndLegacyFromSlots({ processedSlots, now }) {
  const materializedMeals = [];
  const selections = [];
  const premiumSelections = [];
  const baseMealSlots = [];

  for (const slot of Array.isArray(processedSlots) ? processedSlots : []) {
    if (slot.status !== "complete") continue;

    const selectionType = slot.selectionType;
    
    if (selectionType === NEW_TYPES.SANDWICH && slot.sandwichId) {
      const materialized = {
        slotKey: slot.slotKey,
        sandwichId: slot.sandwichId,
        selectionType: NEW_TYPES.SANDWICH,
        isPremium: false,
        premiumSource: "none",
        premiumExtraFeeHalala: 0,
        operationalSku: `sandwich:${slot.sandwichId}`,
        generatedAt: now,
      };
      materializedMeals.push(materialized);
      baseMealSlots.push({
        slotKey: slot.slotKey,
        mealId: slot.sandwichId,
        assignmentSource: slot.assignmentSource || "client",
        assignedAt: slot.assignedAt || now,
      });
      continue;
    }

    if (selectionType === NEW_TYPES.PREMIUM_LARGE_SALAD) {
       const saladProteinId = resolveSaladProteinId(slot);
       const materialized = {
        slotKey: slot.slotKey,
        selectionType: NEW_TYPES.PREMIUM_LARGE_SALAD,
        proteinId: saladProteinId,
        isPremium: true,
        premiumKey: CANONICAL_PREMIUM_SALAD_KEY,
        premiumSource: slot.premiumSource || "none",
        premiumExtraFeeHalala: Number(slot.premiumExtraFeeHalala || 0),
        operationalSku: `salad:${CANONICAL_PREMIUM_SALAD_KEY}`,
        generatedAt: now,
      };
      materializedMeals.push(materialized);
      
      // For Premium Large Salad, we also push the protein to baseMealSlots if available 
      if (saladProteinId) {
        selections.push(saladProteinId);
        premiumSelections.push({
          premiumKey: CANONICAL_PREMIUM_SALAD_KEY,
          proteinId: saladProteinId,
          baseSlotKey: slot.slotKey,
          unitExtraFeeHalala: Number(slot.premiumExtraFeeHalala || 0),
          currency: SYSTEM_CURRENCY,
          premiumSource: slot.premiumSource || "paid",
        });
        baseMealSlots.push({
          slotKey: slot.slotKey,
          mealId: saladProteinId,
          assignmentSource: slot.assignmentSource || "client",
          assignedAt: slot.assignedAt || now,
        });
      }
      continue;
    }

    if (!slot.proteinId || !Array.isArray(slot.carbs) || slot.carbs.length === 0) continue;

    // Operational materialization intentionally keeps one primary carb key for
    // downstream kitchen compatibility while canonical planner state retains the
    // full carbs[] split on mealSlots.
    const primaryCarbId = slot.carbs[0].carbId;
    const materialized = {
      slotKey: slot.slotKey,
      proteinId: slot.proteinId,
      carbId: primaryCarbId,
      selectionType,
      isPremium: Boolean(slot.isPremium),
      premiumSource: slot.premiumSource || "none",
      premiumKey: slot.premiumKey || null,
      premiumExtraFeeHalala: Number(slot.premiumExtraFeeHalala || 0),
      comboKey: `${slot.proteinId}:${primaryCarbId}`,
      operationalSku: `${slot.proteinId}:${primaryCarbId}`,
      generatedAt: now,
    };
    materializedMeals.push(materialized);

    if (slot.proteinId) {
      selections.push(slot.proteinId);
      baseMealSlots.push({
        slotKey: slot.slotKey,
        mealId: slot.proteinId,
        assignmentSource: slot.assignmentSource || "client",
        assignedAt: slot.assignedAt || now,
      });
    }

    if (materialized.isPremium) {
      premiumSelections.push({
        premiumKey: slot.premiumKey || null,
        proteinId: slot.proteinId,
        baseSlotKey: slot.slotKey,
        unitExtraFeeHalala: Number(slot.premiumExtraFeeHalala || 0),
        currency: SYSTEM_CURRENCY,
        premiumSource: slot.premiumSource || "paid",
      });
    }
  }

  return { materializedMeals, selections, premiumSelections, baseMealSlots };
}

async function projectMaterializedAndLegacyForExistingSlots({ mealSlots, session }) {
  // Existing slots are expected to be in processed/normalized format already.
  // We can project directly. If deep metadata resolution was needed, we'd do it here.
  return projectMaterializedAndLegacyFromSlots({ processedSlots: mealSlots, now: new Date() });
}

function mapPaymentRequirement({ plannerMeta, premiumExtraPayment = null, plannerState = "draft", status = "open" }) {
  return buildPaymentRequirement({
    plannerMeta,
    premiumExtraPayment,
    plannerState,
    status,
    currency: SYSTEM_CURRENCY,
  });
}

function buildPremiumExtraRevisionHash({ mealSlots }) {
  return buildPlannerRevisionHash({
    mealSlots: (Array.isArray(mealSlots) ? mealSlots : []).map((slot) => ({
      ...slot,
      slotKey: resolveMealSlotKey(slot),
    })),
  });
}

function isBaseBeefSlot(slot) {
  return Boolean(
    slot
    && slot.proteinFamilyKey === "beef"
    && !slot.isPremium
    && slot.selectionType !== NEW_TYPES.SANDWICH
    && slot.selectionType !== NEW_TYPES.PREMIUM_LARGE_SALAD
  );
}

function isSandwichSlot(slot) {
  return Boolean(slot && slot.selectionType === NEW_TYPES.SANDWICH);
}

function recomputePlannerMetaFromSlots({ mealSlots, requiredSlotCount = 0 }) {
  const normalizedSlots = normalizeMealSlotsInput({ mealSlots });
  const plannerMeta = {
    requiredSlotCount: Number(requiredSlotCount || 0),
    emptySlotCount: 0,
    partialSlotCount: 0,
    completeSlotCount: 0,
    beefSlotCount: 0,
    premiumSlotCount: 0,
    premiumCoveredByBalanceCount: 0,
    premiumPendingPaymentCount: 0,
    premiumPaidExtraCount: 0,
    premiumTotalHalala: 0,
    isDraftValid: true,
    isConfirmable: false,
    lastEditedAt: new Date(),
  };

  const slotErrors = collectDuplicateSlotErrors({ mealSlots: normalizedSlots });
  for (const slot of normalizedSlots) {
    if (slot.status === "complete") plannerMeta.completeSlotCount += 1;
    else if (slot.status === "partial") plannerMeta.partialSlotCount += 1;
    else plannerMeta.emptySlotCount += 1;

    if (isBaseBeefSlot(slot)) plannerMeta.beefSlotCount += 1;
    if (slot && slot.isPremium) {
      plannerMeta.premiumSlotCount += 1;
      if (slot.premiumSource === "balance") {
        plannerMeta.premiumCoveredByBalanceCount += 1;
      } else if (slot.premiumSource === "pending_payment") {
        plannerMeta.premiumPendingPaymentCount += 1;
        plannerMeta.premiumTotalHalala += Number(slot.premiumExtraFeeHalala || 0);
      } else if (slot.premiumSource === "paid_extra" || slot.premiumSource === "paid") {
        plannerMeta.premiumPaidExtraCount += 1;
      }
    }
  }

  slotErrors.push(...collectSlotCountErrors({ mealSlots: normalizedSlots, requiredSlotCount, completeSlotCount: plannerMeta.completeSlotCount }));

  if (plannerMeta.beefSlotCount > 1) {
    plannerMeta.isDraftValid = false;
    slotErrors.push(...normalizedSlots.filter((slot) => isBaseBeefSlot(slot)).map((slot) => ({
      slotIndex: slot.slotIndex,
      field: "protein",
      code: "BEEF_LIMIT_EXCEEDED",
      message: "Only one beef meal is allowed per day",
    })));
  }

  plannerMeta.isConfirmable = Boolean(
    plannerMeta.isDraftValid
      && plannerMeta.partialSlotCount === 0
      && plannerMeta.completeSlotCount === plannerMeta.requiredSlotCount
      && plannerMeta.premiumPendingPaymentCount === 0
  );

  return { plannerMeta, slotErrors };
}

async function buildMealSlotDraft({ mealSlots, mealsPerDayLimit, subscription, session = null }) {
  const normalizedMealSlots = normalizeMealSlotsInput({ mealSlots });
  const normalizedSlotErrors = [
    ...collectDuplicateSlotErrors({ mealSlots: normalizedMealSlots }),
    ...collectSlotCountErrors({ mealSlots: normalizedMealSlots, requiredSlotCount: mealsPerDayLimit }),
  ];
  
  const proteinIdsSet = new Set(normalizedMealSlots.map((s) => s.proteinId).filter(Boolean));
  const carbIdsSet = new Set();
  for (const s of normalizedMealSlots) {
    if (Array.isArray(s.carbs)) {
      for (const cs of s.carbs) {
        if (cs.carbId) carbIdsSet.add(String(cs.carbId));
      }
    }
    if (s.salad && s.salad.groups && Array.isArray(s.salad.groups.protein)) {
      for (const pid of s.salad.groups.protein) {
        if (pid) proteinIdsSet.add(String(pid));
      }
    }
  }
  const proteinIds = [...proteinIdsSet];
  const carbIds = [...carbIdsSet];

  const validProteinIds = proteinIds.filter(id => isValidObjectId(id));
  const validCarbIds = carbIds.filter(id => isValidObjectId(id));

  const [proteins, carbs, sandwichCategory, saladIngredients] = await Promise.all([
    BuilderProtein.find({
      _id: { $in: validProteinIds },
      isActive: true,
      availableForSubscription: { $ne: false },
    }).session(session).lean(),
    BuilderCarb.find({
      _id: { $in: validCarbIds },
      isActive: true,
      availableForSubscription: { $ne: false },
    }).session(session).lean(),
    MealCategory.findOne({ key: { $in: SANDWICH_CATEGORY_KEYS }, isActive: true }).session(session).lean(),
    SaladIngredient.find({ isActive: true }).session(session).lean(),
  ]);

  let sandwichMeals = [];
  if (sandwichCategory) {
    sandwichMeals = await Meal.find({ categoryId: sandwichCategory._id, isActive: true, availableForSubscription: { $ne: false } }).session(session).lean();
  }

  const proteinMap = new Map(proteins.map((p) => [String(p._id), p]));
  const carbMap = new Map(carbs.map((c) => [String(c._id), c]));
  const sandwichMap = new Map(sandwichMeals.map((m) => [String(m._id), m]));
  const saladIngredientMap = new Map(
    saladIngredients.map((ingredient) => [
      String(ingredient._id),
      {
        ...ingredient,
        groupKey: normalizeSaladIngredientGroupKey(ingredient.groupKey),
      },
    ])
  );

  const processedSlots = [];
  const plannerMeta = {
    requiredSlotCount: mealsPerDayLimit,
    emptySlotCount: 0,
    partialSlotCount: 0,
    completeSlotCount: 0,
    beefSlotCount: 0,
    premiumSlotCount: 0,
    premiumCoveredByBalanceCount: 0,
    premiumPendingPaymentCount: 0,
    premiumPaidExtraCount: 0,
    premiumTotalHalala: 0,
    isDraftValid: true,
    isConfirmable: false,
    lastEditedAt: new Date(),
  };

  const tempBalances = new Map();
  if (subscription && Array.isArray(subscription.premiumBalance)) {
    for (const row of subscription.premiumBalance) {
      if (row.premiumKey) {
        tempBalances.set(row.premiumKey, (tempBalances.get(row.premiumKey) || 0) + Number(row.remainingQty || 0));
      }
    }
  }

  for (const slot of normalizedMealSlots) {
    const processedSlot = {
      slotIndex: slot.slotIndex,
      slotKey: slot.slotKey,
      status: "empty",
      selectionType: slot.selectionType,
      proteinId: slot.proteinId || null,
      carbs: slot.carbs || [],
      sandwichId: slot.sandwichId || null,
      salad: slot.salad ? normalizeSaladPayload(slot.salad) : null,
      isPremium: false,
      premiumKey: null,
      premiumSource: "none",
      premiumExtraFeeHalala: 0,
    };

    const shapeValidation = validateMealSlotShape(processedSlot);
    let validation = shapeValidation.valid ? { valid: false } : shapeValidation;

    if (!shapeValidation.valid) {
      validation = shapeValidation;
    } else if (processedSlot.selectionType === NEW_TYPES.STANDARD_MEAL) {
      validation = validateStandardMeal(processedSlot, proteinMap, carbMap);
    } else if (processedSlot.selectionType === NEW_TYPES.PREMIUM_MEAL) {
      validation = validatePremiumMeal(processedSlot, proteinMap, carbMap);
    } else if (processedSlot.selectionType === NEW_TYPES.PREMIUM_LARGE_SALAD) {
      validation = validatePremiumLargeSalad(processedSlot, proteinMap, saladIngredientMap);
    } else if (processedSlot.selectionType === NEW_TYPES.SANDWICH) {
      validation = validateSandwichMeal(processedSlot, sandwichMap);
    }

    if (validation.valid) {
      processedSlot.status = "complete";
      plannerMeta.completeSlotCount += 1;
    } else if (processedSlot.proteinId || processedSlot.sandwichId || (processedSlot.carbs.length > 0) || processedSlot.salad) {
      normalizedSlotErrors.push({
        slotIndex: processedSlot.slotIndex,
        code: validation.code || "INVALID_SLOT",
        message: validation.message || "Invalid slot configuration",
      });
      processedSlot.status = "partial";
      plannerMeta.partialSlotCount += 1;
    } else {
      processedSlot.status = "empty";
      plannerMeta.emptySlotCount += 1;
    }

    // Premium large salad always derives proteinId from salad.groups.protein.
    if (processedSlot.selectionType === NEW_TYPES.PREMIUM_LARGE_SALAD) {
      processedSlot.proteinId = resolveSaladProteinId(processedSlot);
    }
    if (processedSlot.proteinId) {
      const p = proteinMap.get(String(processedSlot.proteinId));
      if (p) {
        processedSlot.proteinFamilyKey = normalizeProteinFamilyKey(p.proteinFamilyKey);
        processedSlot.proteinDisplayCategoryKey = normalizeProteinDisplayCategoryKey(p.displayCategoryKey, {
          isPremium: Boolean(p.isPremium),
          proteinFamilyKey: p.proteinFamilyKey,
        });
        processedSlot.proteinRuleTags = Array.isArray(p.ruleTags) ? [...p.ruleTags] : [];
        processedSlot.isPremium = Boolean(p.isPremium);
        processedSlot.premiumKey = p.premiumKey;
      }
    }

    // Handle Premium Entitlement Consumption
    const isPremiumSalad = processedSlot.selectionType === NEW_TYPES.PREMIUM_LARGE_SALAD;
    if (processedSlot.isPremium || isPremiumSalad) {
      const key = isPremiumSalad ? CANONICAL_PREMIUM_SALAD_KEY : processedSlot.premiumKey;
      const avail = key ? (tempBalances.get(key) || 0) : 0;
      
      processedSlot.isPremium = true;
      processedSlot.premiumKey = key;

      if (avail > 0) {
        processedSlot.premiumSource = "balance";
        tempBalances.set(key, avail - 1);
        plannerMeta.premiumCoveredByBalanceCount += 1;
      } else {
        processedSlot.premiumSource = "pending_payment";
        const fee = isPremiumSalad
          ? PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA
          : (proteinMap.get(String(processedSlot.proteinId))?.extraFeeHalala || 0);
        processedSlot.premiumExtraFeeHalala = Number(fee);
        plannerMeta.premiumPendingPaymentCount += 1;
        plannerMeta.premiumTotalHalala += processedSlot.premiumExtraFeeHalala;
      }
      plannerMeta.premiumSlotCount += 1;
    }

    if (isBaseBeefSlot(processedSlot)) plannerMeta.beefSlotCount += 1;
    processedSlots.push(processedSlot);
  }

  // Final count validations
  normalizedSlotErrors.push(...collectSlotCountErrors({
    mealSlots: processedSlots,
    requiredSlotCount: mealsPerDayLimit,
    completeSlotCount: plannerMeta.completeSlotCount,
  }));

  if (plannerMeta.beefSlotCount > 1) {
    normalizedSlotErrors.push(...processedSlots.filter((slot) => isBaseBeefSlot(slot)).map((slot) => ({
      slotIndex: slot.slotIndex,
      field: "protein",
      code: "BEEF_LIMIT_EXCEEDED",
      message: "Only one beef meal is allowed per day",
    })));
  }

  const normalizedValidation = mapPlannerValidationResult(normalizedSlotErrors);
  if (normalizedValidation) return normalizedValidation;

  plannerMeta.isConfirmable = Boolean(
    plannerMeta.isDraftValid
      && plannerMeta.partialSlotCount === 0
      && plannerMeta.completeSlotCount === plannerMeta.requiredSlotCount
      && plannerMeta.premiumPendingPaymentCount === 0 // Requirement 11: No pending premium payment
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
  };
}

module.exports = {
  SYSTEM_CURRENCY,
  CANONICAL_PREMIUM_SALAD_KEY,
  PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA,
  CUSTOM_PREMIUM_SALAD_TYPE,
  SANDWICH_TYPE,
  STANDARD_COMBO_TYPE,
  CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA,
  getMealPlannerRules,
  buildMealSlotKey,
  normalizeMealSlotsInput,
  collectDuplicateSlotErrors,
  collectSlotCountErrors,
  mapPaymentRequirement,
  buildPremiumExtraRevisionHash,
  isBaseBeefSlot,
  isSandwichSlot,
  recomputePlannerMetaFromSlots,
  projectMaterializedAndLegacyFromSlots,
  projectMaterializedAndLegacyForExistingSlots,
  buildMealSlotDraft,
};
