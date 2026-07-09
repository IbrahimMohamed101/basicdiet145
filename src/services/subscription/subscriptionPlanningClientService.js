"use strict";

const Subscription = require("../../models/Subscription");
const { logger } = require("../../utils/logger");
const { localizeWriteDayPayload } = require("../../utils/subscription/subscriptionWriteLocalization");
const {
  buildControllerErrorDetails,
  serializeSubscriptionDayForClient,
  shapeMealPlannerReadFields,
} = require("./subscriptionClientSupportService");
const {
  performDaySelectionUpdate,
  performDaySelectionValidation,
  performDayPlanningConfirmation,
} = require("./subscriptionSelectionService");
const { localizePolicyErrorMessage } = require("./subscriptionDayModificationPolicyService");

function buildErrorResult(status, code, message, details) {
  return {
    ok: false,
    status,
    code,
    message,
    details,
  };
}

function buildSuccessResult(status, data, extra = {}) {
  return {
    ok: true,
    status,
    data,
    ...extra,
  };
}

function resolveClientFacingErrorMessage(err, lang) {
  return localizePolicyErrorMessage(err, lang) || (err && err.message) || "";
}

const LEGACY_PREMIUM_LARGE_SALAD_TYPE = "premium_large_salad";
const LEGACY_SANDWICH_TYPE = "sandwich";
const ALLOWED_LEGACY_SALAD_GROUP_KEYS = new Set([
  "leafy_greens",
  "vegetables",
  "vegetables_legumes",
  "protein",
  "proteins",
  "cheese_nuts",
  "fruits",
  "sauce",
  "sauces",
  "extra_protein_50g",
]);

function isPlainObject(value) {
  return Boolean(
    value
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.prototype.toString.call(value) === "[object Object]"
  );
}

function validationError(message, details) {
  return {
    ok: false,
    status: 400,
    code: "VALIDATION_ERROR",
    message,
    details,
  };
}

function validateIdList(value, field) {
  if (value === undefined) return null;
  if (!Array.isArray(value)) {
    return validationError(`${field} must be an array`, { field });
  }
  for (let index = 0; index < value.length; index += 1) {
    if (
      value[index] === undefined
      || value[index] === null
      || Array.isArray(value[index])
      || isPlainObject(value[index])
      || !String(value[index]).trim()
    ) {
      return validationError(`${field}[${index}] must be a non-empty string`, {
        field: `${field}[${index}]`,
      });
    }
  }
  return null;
}

function validateLegacyCarbsShape(slot, slotIndex) {
  if (slot.carbs === undefined || slot.carbs === null) return null;
  if (!Array.isArray(slot.carbs)) {
    return validationError(`mealSlots[${slotIndex}].carbs must be an array`, {
      field: `mealSlots[${slotIndex}].carbs`,
    });
  }
  for (let carbIndex = 0; carbIndex < slot.carbs.length; carbIndex += 1) {
    const carb = slot.carbs[carbIndex];
    if (!isPlainObject(carb)) {
      return validationError(`mealSlots[${slotIndex}].carbs[${carbIndex}] must be an object`, {
        field: `mealSlots[${slotIndex}].carbs[${carbIndex}]`,
      });
    }
    if (typeof carb.carbId !== "string" || !carb.carbId.trim()) {
      return validationError(`mealSlots[${slotIndex}].carbs[${carbIndex}].carbId must be a non-empty string`, {
        field: `mealSlots[${slotIndex}].carbs[${carbIndex}].carbId`,
      });
    }
    if (!Number.isInteger(Number(carb.grams)) || Number(carb.grams) <= 0) {
      return validationError(`mealSlots[${slotIndex}].carbs[${carbIndex}].grams must be a positive integer`, {
        field: `mealSlots[${slotIndex}].carbs[${carbIndex}].grams`,
      });
    }
  }
  return null;
}

function validateLegacyPremiumSaladShape(slot, slotIndex) {
  if (!isPlainObject(slot.salad)) {
    return validationError(`mealSlots[${slotIndex}].salad must be an object`, {
      field: `mealSlots[${slotIndex}].salad`,
    });
  }
  if (!isPlainObject(slot.salad.groups)) {
    return validationError(`mealSlots[${slotIndex}].salad.groups must be an object`, {
      field: `mealSlots[${slotIndex}].salad.groups`,
    });
  }

  const groups = slot.salad.groups;
  for (const groupKey of Object.keys(groups)) {
    if (!ALLOWED_LEGACY_SALAD_GROUP_KEYS.has(groupKey)) {
      return validationError(`Invalid salad group: ${groupKey}`, {
        field: `mealSlots[${slotIndex}].salad.groups.${groupKey}`,
        code: "INVALID_SALAD_GROUP",
      });
    }
    if (!Array.isArray(groups[groupKey])) {
      return validationError(`mealSlots[${slotIndex}].salad.groups.${groupKey} must be an array`, {
        field: `mealSlots[${slotIndex}].salad.groups.${groupKey}`,
      });
    }
    for (let itemIndex = 0; itemIndex < groups[groupKey].length; itemIndex += 1) {
      if (typeof groups[groupKey][itemIndex] !== "string" || !groups[groupKey][itemIndex].trim()) {
        return validationError(`mealSlots[${slotIndex}].salad.groups.${groupKey}[${itemIndex}] must be a non-empty string`, {
          field: `mealSlots[${slotIndex}].salad.groups.${groupKey}[${itemIndex}]`,
        });
      }
    }
  }

  const proteinGroup = Array.isArray(groups.protein)
    ? groups.protein
    : (Array.isArray(groups.proteins) ? groups.proteins : null);
  if (!proteinGroup || proteinGroup.length !== 1) {
    return validationError("Exactly one protein is required for premium large salad", {
      field: `mealSlots[${slotIndex}].salad.groups.protein`,
      code: "SALAD_PROTEIN_REQUIRED",
    });
  }

  const sauceGroup = Array.isArray(groups.sauce)
    ? groups.sauce
    : (Array.isArray(groups.sauces) ? groups.sauces : null);
  if (!sauceGroup || sauceGroup.length !== 1) {
    return validationError("Exactly one sauce is required for premium large salad", {
      field: `mealSlots[${slotIndex}].salad.groups.sauce`,
      code: "SALAD_SAUCE_REQUIRED",
    });
  }

  return null;
}

function validateMealSlotsRequestShape({ mealSlots, requestedOneTimeAddonIds }) {
  if (!Array.isArray(mealSlots)) {
    return validationError("mealSlots array is required", { field: "mealSlots" });
  }

  const addonError = validateIdList(requestedOneTimeAddonIds, "addonsOneTime");
  if (addonError) return addonError;

  for (let slotIndex = 0; slotIndex < mealSlots.length; slotIndex += 1) {
    const slot = mealSlots[slotIndex];
    if (!isPlainObject(slot)) {
      return validationError(`mealSlots[${slotIndex}] must be an object`, {
        field: `mealSlots[${slotIndex}]`,
      });
    }

    const isCanonicalSlot = Boolean(slot.productId && Array.isArray(slot.selectedOptions));
    if (isCanonicalSlot) continue;

    if (!Number.isInteger(Number(slot.slotIndex)) || Number(slot.slotIndex) <= 0) {
      return validationError(`mealSlots[${slotIndex}].slotIndex must be a positive integer`, {
        field: `mealSlots[${slotIndex}].slotIndex`,
      });
    }
    if (typeof slot.selectionType !== "string" || !slot.selectionType.trim()) {
      return validationError(`mealSlots[${slotIndex}].selectionType must be a non-empty string`, {
        field: `mealSlots[${slotIndex}].selectionType`,
      });
    }

    if (slot.selectionType === LEGACY_PREMIUM_LARGE_SALAD_TYPE) {
      const saladError = validateLegacyPremiumSaladShape(slot, slotIndex);
      if (saladError) return saladError;
      if (slot.carbs !== undefined && Array.isArray(slot.carbs) && slot.carbs.length > 0) {
        return validationError("Carbs are not allowed with premium large salad", {
          field: `mealSlots[${slotIndex}].carbs`,
          code: "CARBS_NOT_ALLOWED",
        });
      }
      continue;
    }

    if (slot.selectionType === LEGACY_SANDWICH_TYPE) {
      if (slot.carbs !== undefined && Array.isArray(slot.carbs) && slot.carbs.length > 0) {
        return validationError("Carbs are not allowed with sandwich selections", {
          field: `mealSlots[${slotIndex}].carbs`,
          code: "SANDWICH_EXCLUSIVITY_VIOLATION",
        });
      }
      continue;
    }

    const carbsError = validateLegacyCarbsShape(slot, slotIndex);
    if (carbsError) return carbsError;
  }

  return null;
}

async function updateDaySelectionForClient({
  subscriptionId,
  date,
  body = {},
  userId,
  lang,
  runtime,
  writeLogSafelyFn,
  loadWalletCatalogMapsSafelyFn,
  logWalletIntegrityErrorFn,
}) {
  const selections = Array.isArray(body.selections) ? body.selections : (Array.isArray(body.meals) ? body.meals : []);
  const premiumSelections = Array.isArray(body.premiumSelections) ? body.premiumSelections : [];
  const mealSlots = Array.isArray(body.mealSlots) ? body.mealSlots : undefined;
  const contractVersion = body.contractVersion || body.plannerContractVersion || body.version;
  const requestedOneTimeAddonIds =
    body.addonsOneTime !== undefined ? body.addonsOneTime : body.oneTimeAddonSelections;
  const shapeError = validateMealSlotsRequestShape({ mealSlots: body.mealSlots, requestedOneTimeAddonIds });
  if (shapeError) return shapeError;

  try {
    const result = await performDaySelectionUpdate({
      userId,
      subscriptionId,
      date,
      selections,
      premiumSelections,
      mealSlots,
      contractVersion,
      requestedOneTimeAddonIds,
      lang,
      runtime,
    });

    if (!result.idempotent) {
      await writeLogSafelyFn({
        entityType: "subscription_day",
        entityId: result.day._id,
        action: "day_selection_update",
        byUserId: userId,
        byRole: "client",
        meta: result.logMeta,
      }, { subscriptionId, date });
    }

    const serializedDay = serializeSubscriptionDayForClient(
      result.subscription,
      result.day.toObject ? result.day.toObject() : result.day,
      runtime
    );
    const catalog = await loadWalletCatalogMapsSafelyFn({
      days: [serializedDay],
      lang,
      context: result.idempotent ? "update_day_selection_idempotent" : "update_day_selection_result",
    });

    const shapedDay = shapeMealPlannerReadFields({
      subscription: result.subscription,
      day: localizeWriteDayPayload(serializedDay, {
        lang,
        addonNames: catalog.addonNames,
      }),
      lang,
    });

    return buildSuccessResult(shapedDay.paymentRequirement?.requiresPayment ? 402 : 200, shapedDay, {
      idempotent: Boolean(result.idempotent),
    });
  } catch (err) {
    if (err && err.code === "DATA_INTEGRITY_ERROR") {
      logWalletIntegrityErrorFn("update_day_selection_refund", {
        subscriptionId,
        date,
        reason: err.message,
      });
      return buildErrorResult(409, "DATA_INTEGRITY_ERROR", err.message);
    }
    if (
      err.code === "VALIDATION_ERROR"
      || err.code === "INVALID_ONE_TIME_ADDON_SELECTION"
      || err.code === "ONE_TIME_ADDON_CATEGORY_CONFLICT"
    ) {
      return buildErrorResult(400, err.code, err.message);
    }
    if (err.status && err.code) {
      return buildErrorResult(err.status, err.code, resolveClientFacingErrorMessage(err, lang), buildControllerErrorDetails(err, lang));
    }
    logger.error("Update day selection failed", { subscriptionId, date, error: err.message, stack: err.stack });
    return buildErrorResult(500, "INTERNAL", "Selection failed");
  }
}

async function appendDayMealsForClient({
  subscriptionId,
  date,
  body = {},
  userId,
  lang,
  runtime,
  writeLogSafelyFn,
  loadWalletCatalogMapsSafelyFn,
  logWalletIntegrityErrorFn,
}) {
  const mealSlots = Array.isArray(body.mealSlots) ? body.mealSlots : undefined;
  const contractVersion = body.contractVersion || body.plannerContractVersion || body.version;
  const requestedOneTimeAddonIds =
    body.addonsOneTime !== undefined ? body.addonsOneTime : body.oneTimeAddonSelections;
  const shapeError = validateMealSlotsRequestShape({ mealSlots: body.mealSlots, requestedOneTimeAddonIds });
  if (shapeError) return shapeError;

  try {
    const result = await performDaySelectionUpdate({
      userId,
      subscriptionId,
      date,
      mealSlots,
      contractVersion,
      requestedOneTimeAddonIds,
      lang,
      runtime,
      appendOnly: true,
    });

    await writeLogSafelyFn({
      entityType: "subscription_day",
      entityId: result.day._id,
      action: "day_meals_append",
      byUserId: userId,
      byRole: "client",
      meta: {
        date,
        appendedMealSlotCount: mealSlots.length,
      },
    }, { subscriptionId, date });

    const serializedDay = serializeSubscriptionDayForClient(
      result.subscription,
      result.day.toObject ? result.day.toObject() : result.day,
      runtime
    );
    const catalog = await loadWalletCatalogMapsSafelyFn({
      days: [serializedDay],
      lang,
      context: "append_day_meals_result",
    });

    const shapedDay = shapeMealPlannerReadFields({
      subscription: result.subscription,
      day: localizeWriteDayPayload(serializedDay, {
        lang,
        addonNames: catalog.addonNames,
      }),
      lang,
    });

    return buildSuccessResult(200, shapedDay, {
      idempotent: Boolean(result.idempotent),
    });
  } catch (err) {
    if (err && err.code === "DATA_INTEGRITY_ERROR") {
      logWalletIntegrityErrorFn("append_day_meals_refund", {
        subscriptionId,
        date,
        reason: err.message,
      });
      return buildErrorResult(409, "DATA_INTEGRITY_ERROR", err.message);
    }
    if (err.status && err.code) {
      return buildErrorResult(err.status, err.code, resolveClientFacingErrorMessage(err, lang), buildControllerErrorDetails(err, lang));
    }
    logger.error("Append day meals failed", { subscriptionId, date, error: err.message, stack: err.stack });
    return buildErrorResult(500, "INTERNAL", "Append meals failed");
  }
}

async function validateDaySelectionForClient({
  subscriptionId,
  date,
  mealSlots,
  contractVersion,
  requestedOneTimeAddonIds,
  userId,
  lang,
}) {
  const shapeError = validateMealSlotsRequestShape({ mealSlots, requestedOneTimeAddonIds });
  if (shapeError) return shapeError;

  try {
    const sub = await Subscription.findById(subscriptionId).lean();
    if (!sub) {
      return buildErrorResult(404, "NOT_FOUND", "Subscription not found");
    }
    if (String(sub.userId) !== String(userId)) {
      return buildErrorResult(403, "FORBIDDEN", "Forbidden");
    }

    const result = await performDaySelectionValidation({
      userId,
      subscriptionId,
      date,
      mealSlots,
      contractVersion,
      requestedOneTimeAddonIds,
    });
    return buildSuccessResult(200, shapeMealPlannerReadFields({
      subscription: sub,
      day: result,
      lang,
    }));
  } catch (err) {
    if (
      err.code === "VALIDATION_ERROR"
      || err.code === "INVALID_ONE_TIME_ADDON_SELECTION"
      || err.code === "ONE_TIME_ADDON_CATEGORY_CONFLICT"
    ) {
      return buildErrorResult(400, err.code, err.message);
    }
    if (err.status && err.code) {
      return buildErrorResult(err.status, err.code, resolveClientFacingErrorMessage(err, lang), buildControllerErrorDetails(err, lang));
    }
    logger.error("Validate day selection failed", { subscriptionId, date, error: err.message, stack: err.stack });
    return buildErrorResult(500, "INTERNAL", "Validation failed");
  }
}

async function confirmDayPlanningForClient({
  subscriptionId,
  date,
  userId,
  lang,
  runtime,
  writeLogSafelyFn,
  loadWalletCatalogMapsSafelyFn,
}) {
  const sub = await Subscription.findById(subscriptionId).populate("planId");
  if (!sub) {
    return buildErrorResult(404, "NOT_FOUND", "Subscription not found");
  }
  if (String(sub.userId) !== String(userId)) {
    return buildErrorResult(403, "FORBIDDEN", "Forbidden");
  }

  try {
    const result = await performDayPlanningConfirmation({
      userId,
      subscriptionId,
      date,
      runtime,
    });

    if (!result.idempotent) {
      await writeLogSafelyFn({
        entityType: "subscription_day",
        entityId: result.day._id,
        action: "day_plan_confirm",
        byUserId: userId,
        byRole: "client",
        meta: { date },
      }, { subscriptionId, date });
    }

    const serializedDay = serializeSubscriptionDayForClient(
      result.subscription,
      result.day.toObject ? result.day.toObject() : result.day,
      runtime
    );
    const catalog = await loadWalletCatalogMapsSafelyFn({
      days: [serializedDay],
      lang,
      context: "confirm_day_planning_result",
    });

    const shapedDay = shapeMealPlannerReadFields({
      subscription: result.subscription,
      day: localizeWriteDayPayload(serializedDay, {
        lang,
        addonNames: catalog.addonNames,
      }),
      lang,
    });

    return buildSuccessResult(200, shapedDay, {
      success: true,
      plannerState: shapedDay && shapedDay.plannerState ? shapedDay.plannerState : null,
      idempotent: Boolean(result.idempotent),
    });
  } catch (err) {
    if (err.status && err.code) {
      return buildErrorResult(err.status, err.code, resolveClientFacingErrorMessage(err, lang), buildControllerErrorDetails(err, lang));
    }
    if (
      err.code === "PLANNING_INCOMPLETE"
      || err.code === "PREMIUM_PAYMENT_REQUIRED"
      || err.code === "ADDON_PAYMENT_REQUIRED"
      || err.code === "PREMIUM_OVERAGE_PAYMENT_REQUIRED"
      || err.code === "ONE_TIME_ADDON_PAYMENT_REQUIRED"
      || err.code === "SUB_INACTIVE"
      || err.code === "SUB_EXPIRED"
      || err.code === "INVALID_DATE"
      || err.code === "LOCKED"
    ) {
      logger.warn("Confirm day planning blocked", {
        subscriptionId,
        date,
        code: err.code,
        message: err.message,
      });
      return buildErrorResult(422, err.code, resolveClientFacingErrorMessage(err, lang));
    }
    logger.error("Confirm day planning failed", { subscriptionId, date, error: err.message, stack: err.stack });
    return buildErrorResult(500, "INTERNAL", "Day planning confirmation failed");
  }
}

module.exports = {
  appendDayMealsForClient,
  confirmDayPlanningForClient,
  updateDaySelectionForClient,
  validateDaySelectionForClient,
};
