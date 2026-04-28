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



module.exports = {
  updateBulkDaySelectionsForClient,
  async consumeAddonSelectionForClient({ subscriptionId, dayId, date: dateReq, addonId, qty = 1, userId }) {
    const date = dateReq || (await SubscriptionDay.findById(dayId)).date;
    const existingDay = await SubscriptionDay.findOne({ subscriptionId, date }).lean();
    
    const requestedAddonIds = (existingDay && existingDay.addonSelections || [])
      .map(s => String(s.addonId));
    
    // Add requested quantity
    for (let i = 0; i < qty; i++) {
      requestedAddonIds.push(String(addonId));
    }
    
    const result = await performDaySelectionUpdate({
      userId,
      subscriptionId,
      date,
      mealSlots: existingDay ? existingDay.mealSlots : [],
      requestedOneTimeAddonIds: requestedAddonIds,
    });

    return buildSuccessResult(200, {
      subscriptionId: result.subscriptionId || subscriptionId,
      ok: true,
      idempotent: !!result.idempotent
    });
  },
  async removeAddonSelectionForClient({ subscriptionId, dayId, date: dateReq, addonId, userId }) {
    const date = dateReq || (await SubscriptionDay.findById(dayId)).date;
    const existingDay = await SubscriptionDay.findOne({ subscriptionId, date }).lean();
    if (!existingDay) return buildErrorResult(404, "NOT_FOUND", "Day not found");

    const requestedAddonIds = (existingDay.addonSelections || [])
      .map(s => String(s.addonId));
    
    // Remove one instance
    const idx = requestedAddonIds.indexOf(String(addonId));
    if (idx >= 0) {
      requestedAddonIds.splice(idx, 1);
    }

    const result = await performDaySelectionUpdate({
      userId,
      subscriptionId,
      date,
      mealSlots: existingDay.mealSlots,
      requestedOneTimeAddonIds: requestedAddonIds,
    });

    return buildSuccessResult(200, { ok: true });
  },
  async consumePremiumSelectionForClient({ subscriptionId, dayId, date: dateReq, baseSlotKey, proteinId, userId }) {
    const date = dateReq || (await SubscriptionDay.findById(dayId)).date;
    const existingDay = await SubscriptionDay.findOne({ subscriptionId, date }).lean();
    
    // Merge protein into specific slot
    const mealSlots = (existingDay && existingDay.mealSlots || []).map(slot => {
       if (String(slot.slotKey) === String(baseSlotKey)) {
          return { ...slot, proteinId, status: "complete" };
       }
       return slot;
    });

    const result = await performDaySelectionUpdate({
      userId,
      subscriptionId,
      date,
      mealSlots,
      requestedOneTimeAddonIds: (existingDay && existingDay.addonSelections || []).map(s => s.addonId),
    });

    return buildSuccessResult(200, {
      subscriptionId: result.subscriptionId || subscriptionId,
      proteinId,
      ok: true,
      idempotent: !!result.idempotent
    });
  },
  async removePremiumSelectionForClient({ subscriptionId, dayId, date: dateReq, baseSlotKey, userId }) {
    const date = dateReq || (await SubscriptionDay.findById(dayId)).date;
    const existingDay = await SubscriptionDay.findOne({ subscriptionId, date }).lean();
    if (!existingDay) return buildErrorResult(404, "NOT_FOUND", "Day not found");

    const mealSlots = (existingDay.mealSlots || []).map(slot => {
       if (String(slot.slotKey) === String(baseSlotKey)) {
          return { ...slot, proteinId: null, status: "partial" };
       }
       return slot;
    });

    await performDaySelectionUpdate({
      userId,
      subscriptionId,
      date,
      mealSlots,
      requestedOneTimeAddonIds: (existingDay.addonSelections || []).map(s => s.addonId),
    });

    return buildSuccessResult(200, { ok: true });
  },
};

