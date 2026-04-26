"use strict";

const { logger } = require("../../utils/logger");
const { localizeWriteDayPayload } = require("../../utils/subscription/subscriptionWriteLocalization");
const {
  buildControllerErrorDetails,
  logWalletIntegrityError,
  serializeSubscriptionDayForClient,
  shapeMealPlannerReadFields,
} = require("./subscriptionClientSupportService");
const {
  performDaySelectionUpdate,
  performConsumePremiumSelection,
  performRemovePremiumSelection,
  performConsumeAddonSelection,
  performRemoveAddonSelection,
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

function buildSuccessResult(status, data) {
  return {
    ok: true,
    status,
    data,
  };
}

async function updateBulkDaySelectionsForClient({
  subscriptionId,
  requests,
  userId,
  lang,
  runtime,
  writeLogSafelyFn,
  loadWalletCatalogMapsSafelyFn,
}) {
  const rawResults = [];
  const serializedDays = [];

  for (const requestEntry of requests) {
    const {
      date,
      selections,
      premiumSelections,
      requestedOneTimeAddonIds,
    } = requestEntry;

    try {
      const result = await performDaySelectionUpdate({
        userId,
        subscriptionId,
        date,
        selections,
        premiumSelections,
        requestedOneTimeAddonIds,
        lang,
        runtime,
      });

      if (!result.idempotent) {
        await writeLogSafelyFn({
          entityType: "subscription_day",
          entityId: result.day._id,
          action: "day_selection_bulk_update",
          byUserId: userId,
          byRole: "client",
          meta: {
            date,
            selectionsCount: selections.length,
            premiumCount: premiumSelections.length,
            totalRequestedDates: requests.length,
          },
        }, { subscriptionId, date });
      }

      const serializedDay = serializeSubscriptionDayForClient(
        result.subscription,
        result.day.toObject ? result.day.toObject() : result.day,
        runtime
      );
      serializedDays.push({
        subscription: result.subscription,
        day: serializedDay,
      });
      rawResults.push({
        date,
        ok: true,
        idempotent: Boolean(result.idempotent),
      });
    } catch (err) {
      if (err && err.code === "DATA_INTEGRITY_ERROR") {
        logWalletIntegrityError("update_bulk_day_selections_refund", {
          subscriptionId,
          date,
          reason: err.message,
        });
      }

      rawResults.push({
        date,
        ok: false,
        code: err && err.code ? err.code : "INTERNAL",
        message: err && err.message ? err.message : "Selection failed",
        ...(buildControllerErrorDetails(err) ? { details: buildControllerErrorDetails(err) } : {}),
      });
    }
  }

  const catalog = await loadWalletCatalogMapsSafelyFn({
    days: serializedDays.map((entry) => entry.day),
    lang,
    context: "update_bulk_day_selections_result",
  });

  const localizedDayByDate = new Map(
    serializedDays.map((entry) => [
      String(entry.day.date),
      shapeMealPlannerReadFields({
        subscription: entry.subscription,
        day: localizeWriteDayPayload(entry.day, {
          lang,
          addonNames: catalog.addonNames,
        }),
        lang,
      }),
    ])
  );

  const results = rawResults.map((entry) => (
    entry.ok
      ? {
        ...entry,
        data: localizedDayByDate.get(String(entry.date)) || null,
      }
      : entry
  ));

  return buildSuccessResult(200, {
    summary: {
      totalDates: requests.length,
      updatedCount: results.filter((entry) => entry.ok && !entry.idempotent).length,
      idempotentCount: results.filter((entry) => entry.ok && entry.idempotent).length,
      failedCount: results.filter((entry) => !entry.ok).length,
    },
    results,
  });
}

async function consumeAddonSelectionForClient({
  subscriptionId,
  dayId,
  date,
  addonId,
  qty,
  userId,
}) {
  try {
    const result = await performConsumeAddonSelection({
      userId,
      subscriptionId,
      dayId,
      date,
      addonId,
      qty,
    });

    return buildSuccessResult(200, {
      subscriptionId: result.subscriptionId,
      addonId: String(result.addonId),
      remainingQtyTotal: result.remainingQtyTotal,
    });
  } catch (err) {
    if (err.status && err.code) {
      return buildErrorResult(err.status, err.code, err.message);
    }
    logger.error("Addon selection failed", { subscriptionId, date, error: err.message, stack: err.stack });
    return buildErrorResult(500, "INTERNAL", "Addon selection failed");
  }
}

async function removeAddonSelectionForClient({
  subscriptionId,
  dayId,
  date,
  addonId,
  userId,
}) {
  try {
    const result = await performRemoveAddonSelection({
      userId,
      subscriptionId,
      dayId,
      date,
      addonId,
    });

    return buildSuccessResult(200, { subscriptionId: result.subscriptionId });
  } catch (err) {
    if (err.status && err.code) {
      return buildErrorResult(err.status, err.code, err.message);
    }
    logger.error("Addon selection refund failed", { subscriptionId, date, error: err.message, stack: err.stack });
    return buildErrorResult(500, "INTERNAL", "Addon selection refund failed");
  }
}

async function consumePremiumSelectionForClient({
  subscriptionId,
  dayId,
  date,
  baseSlotKey,
  proteinId,
  userId,
}) {
  try {
    const result = await performConsumePremiumSelection({
      userId,
      subscriptionId,
      dayId,
      date,
      baseSlotKey,
      proteinId,
    });

    return buildSuccessResult(200, {
      subscriptionId: result.subscriptionId,
      proteinId: String(result.proteinId),
      remainingQtyTotal: result.remainingQtyTotal,
    });
  } catch (err) {
    if (err.status && err.code) {
      return buildErrorResult(err.status, err.code, err.message);
    }
    logger.error("Premium selection failed", { subscriptionId, date, error: err.message, stack: err.stack });
    return buildErrorResult(500, "INTERNAL", "Premium selection failed");
  }
}

async function removePremiumSelectionForClient({
  subscriptionId,
  dayId,
  date,
  baseSlotKey,
  userId,
}) {
  try {
    const result = await performRemovePremiumSelection({
      userId,
      subscriptionId,
      dayId,
      date,
      baseSlotKey,
    });

    return buildSuccessResult(200, { subscriptionId: result.subscriptionId });
  } catch (err) {
    if (err.status && err.code) {
      return buildErrorResult(err.status, err.code, err.message);
    }
    logger.error("Premium selection refund failed", { subscriptionId, date, error: err.message, stack: err.stack });
    return buildErrorResult(500, "INTERNAL", "Premium selection refund failed");
  }
}

module.exports = {
  consumePremiumSelectionForClient,
  consumeAddonSelectionForClient,
  removeAddonSelectionForClient,
  removePremiumSelectionForClient,
  updateBulkDaySelectionsForClient,
};
