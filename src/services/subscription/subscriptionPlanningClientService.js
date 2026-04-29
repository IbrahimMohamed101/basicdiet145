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
  const requestedOneTimeAddonIds = body.addonsOneTime || body.oneTimeAddonSelections;

  try {
    const result = await performDaySelectionUpdate({
      userId,
      subscriptionId,
      date,
      selections,
      premiumSelections,
      mealSlots,
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

    return buildSuccessResult(200, shapedDay, {
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
      return buildErrorResult(400, "INVALID", err.message);
    }
    if (err.status && err.code) {
      return buildErrorResult(err.status, err.code, err.message, buildControllerErrorDetails(err));
    }
    logger.error("Update day selection failed", { subscriptionId, date, error: err.message, stack: err.stack });
    return buildErrorResult(500, "INTERNAL", "Selection failed");
  }
}

async function validateDaySelectionForClient({
  subscriptionId,
  date,
  mealSlots,
  requestedOneTimeAddonIds,
  userId,
  lang,
}) {
  if (!Array.isArray(mealSlots)) {
    return buildErrorResult(400, "INVALID", "mealSlots array is required");
  }

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
      return buildErrorResult(400, "INVALID", err.message);
    }
    if (err.status && err.code) {
      return buildErrorResult(err.status, err.code, err.message, buildControllerErrorDetails(err));
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
  validateFutureDateOrThrowFn,
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
    await validateFutureDateOrThrowFn(date, sub, null, { allowToday: true });
  } catch (err) {
    const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
    return buildErrorResult(status, err.code || "INVALID_DATE", err.message);
  }

  try {
    const result = await performDayPlanningConfirmation({
      userId,
      subscriptionId,
      date,
      runtime,
    });

    await writeLogSafelyFn({
      entityType: "subscription_day",
      entityId: result.day._id,
      action: "day_plan_confirm",
      byUserId: userId,
      byRole: "client",
      meta: { date },
    }, { subscriptionId, date });

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
    });
  } catch (err) {
    if (err.status && err.code) {
      return buildErrorResult(err.status, err.code, err.message, buildControllerErrorDetails(err));
    }
    if (
      err.code === "PLANNING_INCOMPLETE"
      || err.code === "PREMIUM_PAYMENT_REQUIRED"
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
      return buildErrorResult(422, err.code, err.message);
    }
    logger.error("Confirm day planning failed", { subscriptionId, date, error: err.message, stack: err.stack });
    return buildErrorResult(500, "INTERNAL", "Day planning confirmation failed");
  }
}

module.exports = {
  confirmDayPlanningForClient,
  updateDaySelectionForClient,
  validateDaySelectionForClient,
};
