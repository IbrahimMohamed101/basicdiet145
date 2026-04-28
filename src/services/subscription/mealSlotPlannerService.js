const mongoose = require("mongoose");
const BuilderProtein = require("../../models/BuilderProtein");
const BuilderCarb = require("../../models/BuilderCarb");
const { isValidObjectId } = mongoose;
const {
  buildPaymentRequirement,
  buildPlannerRevisionHash,
} = require("./subscriptionDayCommercialStateService");
const { validateCarbSelections } = require("../../utils/subscription/carbSelectionValidator");

const SYSTEM_CURRENCY = "SAR";
const MEAL_PLANNER_RULES_VERSION = "meal_planner_rules.v1";
const DEFAULT_SLOT_KEY_PREFIX = "slot_";

const CUSTOM_PREMIUM_SALAD_TYPE = "custom_premium_salad";
const SANDWICH_TYPE = "sandwich";
const STANDARD_COMBO_TYPE = "standard_combo";

const CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA = 3000;

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

function normalizeMealSlotsInput({ mealSlots }) {
  return (Array.isArray(mealSlots) ? mealSlots : []).map((slot) => {
    const resolvedSlotIndex = Number(slot && slot.slotIndex);
    const rawSlot = slot && typeof slot.toObject === "function" ? slot.toObject() : slot;
    const normalizedSlot = rawSlot && typeof rawSlot === "object" ? { ...rawSlot } : {};
    normalizedSlot.slotIndex = resolvedSlotIndex;
    normalizedSlot.slotKey = resolveMealSlotKey({ ...rawSlot, slotIndex: resolvedSlotIndex });
    return normalizedSlot;
  });
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

function getMealPlannerRules() {
  return {
    version: MEAL_PLANNER_RULES_VERSION,
    beef: { proteinFamilyKey: "beef", maxSlotsPerDay: 1 },
    standardCarbs: {
      categoryKey: "standard_carbs",
      maxTypes: 2,
      maxTotalGrams: 300,
      unit: "grams",
    },
  };
}

function projectMaterializedAndLegacyFromSlots({ processedSlots, now }) {
  const materializedMeals = [];
  const selections = [];
  const premiumSelections = [];
  const baseMealSlots = [];

  for (const slot of Array.isArray(processedSlots) ? processedSlots : []) {
    if (slot.status !== "complete") continue;

    const selectionType = String(slot.selectionType || "").trim() || STANDARD_COMBO_TYPE;
    
    if (selectionType === SANDWICH_TYPE && slot.sandwichId) {
      const materialized = {
        slotKey: slot.slotKey,
        sandwichId: slot.sandwichId,
        proteinId: null,
        carbId: null,
        selectionType: SANDWICH_TYPE,
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

    if (!slot.proteinId || !slot.carbId) continue;

    const materialized = {
      slotKey: slot.slotKey,
      proteinId: slot.proteinId,
      carbId: slot.carbId,
      selectionType,
      isPremium: Boolean(slot.isPremium),
      premiumSource: slot.premiumSource || "none",
      premiumExtraFeeHalala: Number(slot.premiumExtraFeeHalala || 0),
      comboKey: `${slot.proteinId}:${slot.carbId}`,
      operationalSku: `${slot.proteinId}:${slot.carbId}`,
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
    && !isSandwichSlot(slot)
  );
}

function isSandwichSlot(slot) {
  return Boolean(
    slot
    && String(slot.selectionType || "").trim() === SANDWICH_TYPE
  );
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
    const selectionType = String(slot && slot.selectionType ? slot.selectionType.trim() : "") || STANDARD_COMBO_TYPE;
    
    if (selectionType === SANDWICH_TYPE) {
      plannerMeta.completeSlotCount += 1;
      continue;
    }

    let status = String(slot && slot.status ? slot.status : "empty");
    const hasProtein = Boolean(slot && slot.proteinId);
    const hasCarb = Boolean(slot && slot.carbId);

    if (selectionType === CUSTOM_PREMIUM_SALAD_TYPE) {
      if (hasProtein && hasCarb) status = "complete";
      else if (hasProtein || hasCarb) status = "partial";
      else status = "empty";
    } else {
      if (hasProtein && hasCarb) status = "complete";
      else if (hasProtein || hasCarb) status = "partial";
      else status = "empty";
    }

    if (status === "complete") plannerMeta.completeSlotCount += 1;
    else if (status === "partial") plannerMeta.partialSlotCount += 1;
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
  );

  return { plannerMeta, slotErrors };
}

async function projectMaterializedAndLegacyForExistingSlots({ mealSlots, now = new Date() }) {
  return projectMaterializedAndLegacyFromSlots({ processedSlots: Array.isArray(mealSlots) ? mealSlots : [], now });
}

function buildPremiumExtraPaymentDraft() {
  return undefined;
}

async function buildMealSlotDraft({ mealSlots, mealsPerDayLimit, subscription, session = null }) {
  const normalizedMealSlots = normalizeMealSlotsInput({ mealSlots });
  const normalizedSlotErrors = [
    ...collectDuplicateSlotErrors({ mealSlots: normalizedMealSlots }),
    ...collectSlotCountErrors({ mealSlots: normalizedMealSlots, requiredSlotCount: mealsPerDayLimit }),
  ];
  const normalizedValidation = mapPlannerValidationResult(normalizedSlotErrors);
  if (normalizedValidation) return normalizedValidation;

  const proteinIds = [...new Set(normalizedMealSlots.map((s) => s.proteinId).filter(Boolean))];
  
  const carbIdsSet = new Set();
  for (const s of normalizedMealSlots) {
    if (s.carbId) carbIdsSet.add(s.carbId);
    if (Array.isArray(s.carbSelections)) {
      for (const cs of s.carbSelections) {
        if (cs.carbId) carbIdsSet.add(cs.carbId);
      }
    }
  }
  const carbIds = [...carbIdsSet];

  const validProteinIds = proteinIds.filter(id => isValidObjectId(id));
  const validCarbIds = carbIds.filter(id => isValidObjectId(id));


  const proteinsQuery = BuilderProtein.find({ _id: { $in: validProteinIds } });
  const carbsQuery = BuilderCarb.find({ _id: { $in: validCarbIds } });
  if (session) {
    proteinsQuery.session(session);
    carbsQuery.session(session);
  }

  const [proteins, carbs] = await Promise.all([proteinsQuery.lean(), carbsQuery.lean()]);
  const proteinMap = new Map(proteins.map((protein) => [String(protein._id), protein]));
  const carbMap = new Map(carbs.map((carb) => [String(carb._id), carb]));

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

  for (const slot of normalizedMealSlots) {
    const selectionType = String(slot && slot.selectionType ? slot.selectionType.trim() : "") || STANDARD_COMBO_TYPE;
    
    if (selectionType === SANDWICH_TYPE) {
      const processedSlot = {
        slotIndex: slot.slotIndex,
        slotKey: slot.slotKey,
        status: "complete",
        proteinId: null,
        carbId: null,
        sandwichId: slot.sandwichId || null,
        selectionType: SANDWICH_TYPE,
        customSalad: null,
        proteinFamilyKey: null,
        proteinDisplayCategoryKey: null,
        proteinRuleTags: [],
        carbDisplayCategoryKey: null,
        carbSelections: [],
        isPremium: false,
        premiumSource: "none",
        premiumExtraFeeHalala: 0,
      };
      plannerMeta.completeSlotCount += 1;
      processedSlots.push(processedSlot);
      continue;
    }

    if (selectionType === CUSTOM_PREMIUM_SALAD_TYPE) {
      const protein = slot.proteinId ? proteinMap.get(String(slot.proteinId)) : null;
      const carb = slot.carbId ? carbMap.get(String(slot.carbId)) : null;
      
      const isPremiumProtein = Boolean(protein && protein.isPremium);
      const hasValidProtein = Boolean(protein);
      const hasValidCarb = Boolean(carb);
      
      let premiumSource = "none";
      let premiumExtraFeeHalala = 0;
      
      if (isPremiumProtein) {
        const tempBalances = processedSlots._tempBalances || (processedSlots._tempBalances = new Map());
        if (processedSlots.length === 0 && subscription && Array.isArray(subscription.premiumBalance)) {
          for (const row of subscription.premiumBalance) {
            const id = String(row.proteinId);
            tempBalances.set(id, (tempBalances.get(id) || 0) + Number(row.remainingQty || 0));
          }
        }
        
        const avail = tempBalances.get(String(slot.proteinId)) || 0;
        if (avail > 0) {
          premiumSource = "balance";
          tempBalances.set(String(slot.proteinId), avail - 1);
          plannerMeta.premiumSlotCount += 1;
          plannerMeta.premiumCoveredByBalanceCount += 1;
        } else {
          premiumSource = "pending_payment";
          premiumExtraFeeHalala = CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA;
          plannerMeta.premiumSlotCount += 1;
          plannerMeta.premiumPendingPaymentCount += 1;
          plannerMeta.premiumTotalHalala += CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA;
        }
      }

      const processedSlot = {
        slotIndex: slot.slotIndex,
        slotKey: slot.slotKey,
        status: hasValidProtein && hasValidCarb ? "complete" : "partial",
        proteinId: slot.proteinId || null,
        carbId: slot.carbId || null,
        sandwichId: null,
        selectionType: CUSTOM_PREMIUM_SALAD_TYPE,
        customSalad: slot.customSalad || null,
        proteinFamilyKey: protein ? protein.proteinFamilyKey : null,
        proteinDisplayCategoryKey: protein ? protein.displayCategoryKey : null,
        proteinRuleTags: protein ? protein.ruleTags : [],
        carbDisplayCategoryKey: carb ? carb.displayCategoryKey : null,
        carbSelections: [],
        isPremium: isPremiumProtein,
        premiumSource,
        premiumExtraFeeHalala: isPremiumProtein ? premiumExtraFeeHalala : CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA,
      };

      if (processedSlot.status === "complete") {
        plannerMeta.completeSlotCount += 1;
      } else {
        plannerMeta.partialSlotCount += 1;
      }
      processedSlots.push(processedSlot);
      continue;
    }

    const protein = slot.proteinId ? proteinMap.get(String(slot.proteinId)) : null;
    
    // Resolve and validate carbSelections
    let requestedCarbSelections = slot.carbSelections;
    if (requestedCarbSelections === undefined && slot.carbId) {
      requestedCarbSelections = [{ carbId: slot.carbId, grams: 300 }];
    }
    
    // Here we use the rules explicitly defined
    const carbRules = getMealPlannerRules().standardCarbs;
    const carbValidation = validateCarbSelections(requestedCarbSelections, carbMap, carbRules);
    if (!carbValidation.valid) {
      return buildMealPlannerValidationResult({
        code: carbValidation.errorCode,
        message: carbValidation.errorMessage,
        slotErrors: [{
          slotIndex: slot.slotIndex,
          field: "carb",
          code: carbValidation.errorCode,
          message: carbValidation.errorMessage,
        }]
      });
    }

    const validatedCarbSelections = carbValidation.selections;
    const primaryCarbId = validatedCarbSelections.length > 0 ? validatedCarbSelections[0].carbId : null;
    const carb = primaryCarbId ? carbMap.get(String(primaryCarbId)) : null;

    const processedSlot = {
      slotIndex: slot.slotIndex,
      slotKey: slot.slotKey,
      status: "empty",
      proteinId: slot.proteinId || null,
      carbId: primaryCarbId || null,
      sandwichId: null,
      selectionType: selectionType,
      customSalad: null,
      proteinFamilyKey: protein ? protein.proteinFamilyKey : null,
      proteinDisplayCategoryKey: protein ? protein.displayCategoryKey : null,
      proteinRuleTags: protein ? protein.ruleTags : [],
      carbDisplayCategoryKey: carb ? carb.displayCategoryKey : null,
      carbSelections: validatedCarbSelections,
      isPremium: Boolean(protein && protein.isPremium),
      premiumCreditCost: 0,
      premiumSource: "none",
      premiumExtraFeeHalala: protein && protein.isPremium ? Number(protein.extraFeeHalala || 0) : 0,
    };

    if (processedSlot.proteinId && processedSlot.carbId) {
      if (protein && carb) {
        processedSlot.status = "complete";
        plannerMeta.completeSlotCount += 1;
      } else {
        processedSlot.status = "partial";
        plannerMeta.partialSlotCount += 1;
      }
    } else if (processedSlot.proteinId || processedSlot.carbId) {
      processedSlot.status = "partial";
      plannerMeta.partialSlotCount += 1;
    } else {
      plannerMeta.emptySlotCount += 1;
    }

    if (isBaseBeefSlot(processedSlot)) plannerMeta.beefSlotCount += 1;

    const tempBalances = processedSlots._tempBalances || (processedSlots._tempBalances = new Map());
    
    // Initialize temporary balances only once per draft build
    if (processedSlots.length === 0 && subscription && Array.isArray(subscription.premiumBalance)) {
        for (const row of subscription.premiumBalance) {
            const key = row.premiumKey;
            if (key) {
                tempBalances.set(key, (tempBalances.get(key) || 0) + Number(row.remainingQty || 0));
            }
        }
    }

    if (processedSlot.isPremium) {
      const key = processedSlot.premiumKey;
      const avail = key ? (tempBalances.get(key) || 0) : 0;
      if (avail > 0) {
        processedSlot.premiumSource = "balance";
        processedSlot.premiumCreditCost = 1;
        tempBalances.set(key, avail - 1);
        plannerMeta.premiumSlotCount += 1;
        plannerMeta.premiumCoveredByBalanceCount += 1;
      } else {
        processedSlot.premiumSource = "pending_payment";
        plannerMeta.premiumSlotCount += 1;
        plannerMeta.premiumPendingPaymentCount += 1;
        plannerMeta.premiumTotalHalala += processedSlot.premiumExtraFeeHalala;
      }
    }

    processedSlots.push(processedSlot);
  }

  const countValidation = mapPlannerValidationResult(collectSlotCountErrors({
    mealSlots: processedSlots,
    requiredSlotCount: mealsPerDayLimit,
    completeSlotCount: plannerMeta.completeSlotCount,
  }));
  if (countValidation) return countValidation;

  if (plannerMeta.beefSlotCount > 1) {
    return buildMealPlannerValidationResult({
      code: "BEEF_LIMIT_EXCEEDED",
      message: "Only one beef meal is allowed per day",
      slotErrors: processedSlots.filter((slot) => isBaseBeefSlot(slot)).map((slot) => ({
        slotIndex: slot.slotIndex,
        field: "protein",
        code: "BEEF_LIMIT_EXCEEDED",
        message: "Only one beef meal is allowed per day",
      })),
    });
  }

  plannerMeta.isConfirmable = Boolean(
    plannerMeta.isDraftValid
      && plannerMeta.partialSlotCount === 0
      && plannerMeta.completeSlotCount === plannerMeta.requiredSlotCount
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
    consumedPremiumByProtein: {},
  };
}

module.exports = {
  SYSTEM_CURRENCY,
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
  isSandwichSlot,
  isBaseBeefSlot,
  recomputePlannerMetaFromSlots,
  projectMaterializedAndLegacyFromSlots,
  projectMaterializedAndLegacyForExistingSlots,
  buildPremiumExtraPaymentDraft,
  buildMealSlotDraft,
};
