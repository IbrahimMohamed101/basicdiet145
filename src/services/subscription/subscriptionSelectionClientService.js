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
      mealSlots,
      requestedOneTimeAddonIds,
    } = requestEntry;

    if (!Array.isArray(mealSlots)) {
      rawResults.push({
        date,
        ok: false,
        code: "LEGACY_DAY_SELECTION_UNSUPPORTED",
        message: "Bulk day selection requires canonical mealSlots payload.",
      });
      continue;
    }

    try {
      const result = await performDaySelectionUpdate({
        userId,
        subscriptionId,
        date,
        mealSlots,
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
            mealSlotCount: mealSlots.length,
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



module.exports = {
  updateBulkDaySelectionsForClient,
  async consumeAddonSelectionForClient({ subscriptionId, dayId, date: dateReq, addonId, qty = 1, userId }) {
    return buildErrorResult(
      422,
      "LEGACY_ADDON_SELECTION_ENDPOINT_UNSUPPORTED",
      "Addon helper endpoint is no longer supported. Submit canonical mealSlots via /days/:date/selection."
    );
  },
  async removeAddonSelectionForClient({ subscriptionId, dayId, date: dateReq, addonId, userId }) {
    return buildErrorResult(
      422,
      "LEGACY_ADDON_SELECTION_ENDPOINT_UNSUPPORTED",
      "Addon helper endpoint is no longer supported. Submit canonical mealSlots via /days/:date/selection."
    );
  },
  async consumePremiumSelectionForClient({ subscriptionId, dayId, date: dateReq, baseSlotKey, proteinId, userId }) {
    return buildErrorResult(
      422,
      "LEGACY_PREMIUM_SELECTION_ENDPOINT_UNSUPPORTED",
      "Premium helper endpoint is no longer supported. Submit canonical mealSlots via /days/:date/selection."
    );
  },
  async removePremiumSelectionForClient({ subscriptionId, dayId, date: dateReq, baseSlotKey, userId }) {
    return buildErrorResult(
      422,
      "LEGACY_PREMIUM_SELECTION_ENDPOINT_UNSUPPORTED",
      "Premium helper endpoint is no longer supported. Submit canonical mealSlots via /days/:date/selection."
    );
  },
};
