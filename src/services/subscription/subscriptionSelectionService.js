const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const Addon = require("../../models/Addon");
const Setting = require("../../models/Setting");
const dateUtils = require("../../utils/date");
const { resolveMealsPerDay, applyDayWalletSelections } = require("../../utils/subscription/subscriptionDaySelectionSync");
const {
  isPhase2CanonicalDayPlanningEnabled,
  isPhase2GenericPremiumWalletEnabled,
} = require("../../utils/featureFlags");
const {
  LEGACY_PREMIUM_WALLET_MODE,
  ensureLegacyPremiumBalanceFromRemaining,
} = require("../../utils/premiumWallet");
const {
  GENERIC_PREMIUM_WALLET_MODE,
  isGenericPremiumWalletMode,
  syncPremiumRemainingFromActivePremiumWallet,
  getRemainingPremiumCredits,
  consumeGenericPremiumCredits,
  refundGenericPremiumSelectionRowsOrThrow,
} = require("../genericPremiumWalletService");
const {
  LEGACY_PREMIUM_MEAL_BUCKET_ID,
  syncPremiumRemainingFromBalance,
} = require("../../utils/premiumWallet");

const SYSTEM_CURRENCY = "SAR";
const LEGACY_DAY_PREMIUM_SLOT_PREFIX = "legacy_day_premium_slot_";

// --- PRIVATE HELPERS (Migrated from Controller - Byte-for-Byte Check) ---

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

function ensureActive(subscription, dateStr) {
  if (subscription.status !== "active") {
    const err = new Error("Subscription not active");
    err.code = "SUB_INACTIVE";
    err.status = 422;
    throw err;
  }
  if (dateStr) {
    const endDate = subscription.validityEndDate || subscription.endDate;
    const endDateStr = endDate instanceof Date || typeof endDate === 'number' ? dateUtils.toKSADateString(endDate) : endDate;
    if (endDateStr && dateUtils.isAfterKSADate(dateStr, endDateStr)) {
      const err = new Error("Subscription expired for this date");
      err.code = "SUB_EXPIRED";
      err.status = 422;
      throw err;
    }
  }
}

function validateFutureDateOrThrow(date, sub, endDateOverride) {
  if (!dateUtils.isValidKSADateString(date)) {
    const err = new Error("Invalid date format");
    err.code = "INVALID_DATE";
    err.status = 400;
    throw err;
  }
  const tomorrow = dateUtils.getTomorrowKSADate();
  if (dateUtils.isBeforeKSADate(date, tomorrow)) {
    const err = new Error("Date must be from tomorrow onward");
    err.code = "INVALID_DATE";
    err.status = 400;
    throw err;
  }
  if (sub) {
    const endDate = endDateOverride || sub.validityEndDate || sub.endDate;
    const endDateStr = endDate instanceof Date || typeof endDate === 'number' ? dateUtils.toKSADateString(endDate) : endDate;
    if (endDateStr && dateUtils.isAfterKSADate(date, endDateStr)) {
      const err = new Error("Date is outside subscription validity");
      err.code = "SUB_EXPIRED";
      err.status = 422;
      throw err;
    }
  }
}

async function enforceTomorrowCutoffOrThrow(dateStr) {
  const tomorrow = dateUtils.getTomorrowKSADate();
  if (dateStr === tomorrow) {
    const cutoffTime = await getSettingValue("cutoff_time", "00:00");
    if (!dateUtils.isBeforeCutoff(cutoffTime)) {
      const err = new Error("Selection is locked for tomorrow");
      err.code = "LOCKED";
      err.status = 400;
      throw err;
    }
  }
}

function toPremiumWalletRowsFIFO(sub) {
  const rows = Array.isArray(sub && sub.premiumBalance) ? sub.premiumBalance : [];
  return rows
    .filter((row) => Number(row && row.remainingQty) > 0)
    .sort((a, b) => new Date(a.purchasedAt || 0).getTime() - new Date(b.purchasedAt || 0).getTime());
}

function parseLegacyDayPremiumSlotIndex(baseSlotKey) {
  const raw = String(baseSlotKey || "");
  if (!raw.startsWith(LEGACY_DAY_PREMIUM_SLOT_PREFIX)) return null;
  const index = Number(raw.replace(LEGACY_DAY_PREMIUM_SLOT_PREFIX, ""));
  return Number.isSafeInteger(index) && index >= 0 ? index : null;
}

function matchSelectionDay(selection, { dayId, date }) {
  if (dayId && selection.dayId && String(selection.dayId) === String(dayId)) return true;
  if (date && selection.date === date) return true;
  return false;
}

async function resolveSubscriptionDay({ subscriptionId, dayId, date, session }) {
  if (dayId) {
    const day = await SubscriptionDay.findById(dayId).session(session);
    if (day) return day;
  }
  if (date) {
    const day = await SubscriptionDay.findOne({ subscriptionId, date }).session(session);
    if (day) return day;
  }
  return null;
}

function logWalletIntegrityError(context, meta = {}) {
  const { logger } = require("../../utils/logger");
  logger.error(`WALLET_INTEGRITY_ERROR: ${context}`, meta);
}

// --- ORCHESTRATION LAYER (Migrated from Controller) ---

async function performConsumePremiumSelection({ userId, subscriptionId, dayId, date, baseSlotKey, premiumMealId }) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(subscriptionId).session(session);
    if (!sub) {
      throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
    }
    if (String(sub.userId) !== String(userId)) {
      throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };
    }
    ensureActive(sub, date);

    const day = await resolveSubscriptionDay({ subscriptionId: sub._id, dayId, date, session });
    if (!day) {
      throw { status: 404, code: "NOT_FOUND", message: "Day not found" };
    }
    if (day.status !== "open") {
      throw { status: 409, code: "LOCKED", message: "Day is locked" };
    }

    const existingSelection = (sub.premiumSelections || []).find(
      (item) =>
        matchSelectionDay(item, { dayId: day._id, date: day.date })
        && String(item.baseSlotKey) === String(baseSlotKey)
    );
    const existingDaySelection = (day.premiumUpgradeSelections || []).find(
      (item) => String(item.baseSlotKey) === String(baseSlotKey)
    );
    if (existingSelection || existingDaySelection) {
      throw { status: 409, code: "CONFLICT", message: "baseSlotKey already upgraded for this day" };
    }

    if (isGenericPremiumWalletMode(sub)) {
      const consumedRows = consumeGenericPremiumCredits(sub, 1);
      if (!consumedRows || !consumedRows.length) {
        throw { status: 400, code: "INSUFFICIENT_PREMIUM", message: "Not enough premium credits" };
      }

      sub.premiumSelections.push({
        dayId: day._id,
        date: day.date,
        baseSlotKey: String(baseSlotKey),
        premiumMealId,
        unitExtraFeeHalala: Number(consumedRows[0].unitCreditPriceHalala || 0),
        currency: consumedRows[0].currency || "SAR",
        premiumWalletMode: GENERIC_PREMIUM_WALLET_MODE,
        premiumWalletRowId: consumedRows[0].premiumWalletRowId || null,
      });
      syncPremiumRemainingFromActivePremiumWallet(sub);
    } else {
      const hasPremiumBalanceRows = Array.isArray(sub.premiumBalance) && sub.premiumBalance.length > 0;
      const hasLegacyPremiumOnly = Number(sub.premiumRemaining || 0) > 0 && !hasPremiumBalanceRows;
      if (hasLegacyPremiumOnly) {
        const subPremiumPriceSar = Number(sub.premiumPrice);
        const settingsPremiumPriceSar = Number(await getSettingValue("premium_price", 20));
        const fallbackPremiumPriceSar = Number.isFinite(subPremiumPriceSar) && subPremiumPriceSar >= 0
          ? subPremiumPriceSar
          : Number.isFinite(settingsPremiumPriceSar) && settingsPremiumPriceSar >= 0
            ? settingsPremiumPriceSar
            : 0;
        const legacyUnitExtraFeeHalala = Math.round(fallbackPremiumPriceSar * 100);
        const migrated = ensureLegacyPremiumBalanceFromRemaining(sub, {
          premiumMealId,
          unitExtraFeeHalala: legacyUnitExtraFeeHalala,
          currency: SYSTEM_CURRENCY,
        });
        if (migrated) {
          syncPremiumRemainingFromBalance(sub);
        }
      }

      const hasRequestedPremiumBucket = (sub.premiumBalance || []).some(
        (row) => String(row.premiumMealId) === String(premiumMealId)
      );
      if (!hasRequestedPremiumBucket) {
        for (const row of sub.premiumBalance || []) {
          if (String(row.premiumMealId) !== LEGACY_PREMIUM_MEAL_BUCKET_ID) continue;
          if (Number(row.remainingQty || 0) <= 0 && Number(row.purchasedQty || 0) <= 0) continue;
          row.premiumMealId = premiumMealId;
        }
      }

      const candidates = (sub.premiumBalance || [])
        .filter((row) => String(row.premiumMealId) === String(premiumMealId) && Number(row.remainingQty) > 0)
        .sort((a, b) => new Date(a.purchasedAt).getTime() - new Date(b.purchasedAt).getTime());
      if (!candidates.length) {
        throw { status: 400, code: "INSUFFICIENT_PREMIUM", message: "Not enough premium credits" };
      }

      candidates[0].remainingQty = Number(candidates[0].remainingQty) - 1;
      sub.premiumSelections.push({
        dayId: day._id,
        date: day.date,
        baseSlotKey: String(baseSlotKey),
        premiumMealId,
        unitExtraFeeHalala: Number(candidates[0].unitExtraFeeHalala || 0),
        currency: candidates[0].currency || "SAR",
        premiumWalletMode: LEGACY_PREMIUM_WALLET_MODE,
      });
      syncPremiumRemainingFromActivePremiumWallet(sub);
    }
    applyDayWalletSelections({ subscription: sub, day });
    await sub.save({ session });
    await day.save({ session });

    await session.commitTransaction();
    session.endSession();

    const remainingQtyTotal = isGenericPremiumWalletMode(sub)
      ? getRemainingPremiumCredits(sub)
      : (sub.premiumBalance || [])
        .filter((row) => String(row.premiumMealId) === String(premiumMealId))
        .reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);

    return {
      ok: true,
      subscriptionId: sub.id,
      premiumMealId: String(premiumMealId),
      remainingQtyTotal,
    };
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    throw err;
  }
}

async function performRemovePremiumSelection({ userId, subscriptionId, dayId, date, baseSlotKey }) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(subscriptionId).session(session);
    if (!sub) {
      throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
    }
    if (String(sub.userId) !== String(userId)) {
      throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };
    }

    const targetDay = await resolveSubscriptionDay({ subscriptionId: sub._id, dayId, date, session });
    if (!targetDay) {
      throw { status: 404, code: "NOT_FOUND", message: "Day not found" };
    }
    ensureActive(sub, targetDay.date);
    if (targetDay.status !== "open") {
      throw { status: 409, code: "LOCKED", message: "Day is locked" };
    }

    const targetDayId = String(targetDay._id);
    const targetDate = targetDay.date;
    const rows = sub.premiumSelections || [];
    const index = rows.findIndex(
      (row) =>
        matchSelectionDay(row, { dayId: targetDayId, date: targetDate })
        && String(row.baseSlotKey) === String(baseSlotKey)
    );

    if (index === -1) {
      throw { status: 404, code: "NOT_FOUND", message: "Premium selection not found" };
    }

    const [removed] = rows.splice(index, 1);
    try {
      if (isGenericPremiumWalletMode(sub)) {
        refundGenericPremiumSelectionRowsOrThrow(sub, [removed]);
      } else {
        refundPremiumSelectionRowsToBalanceOrThrow(sub, [removed]);
      }
    } catch (err) {
      logWalletIntegrityError("premium_refund_remove_selection", {
        subscriptionId,
        dayId: targetDayId,
        date: targetDate,
        baseSlotKey: String(baseSlotKey),
        premiumMealId: String(removed.premiumMealId),
        unitExtraFeeHalala: Number(removed.unitExtraFeeHalala || 0),
        reason: err.message,
      });
      throw { status: 409, code: "DATA_INTEGRITY_ERROR", message: err.message };
    }

    syncPremiumRemainingFromActivePremiumWallet(sub);
    applyDayWalletSelections({ subscription: sub, day: targetDay });
    await sub.save({ session });
    await targetDay.save({ session });

    await session.commitTransaction();
    session.endSession();

    return { ok: true, subscriptionId: sub.id };
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    throw err;
  }
}

async function performConsumeAddonSelection({ userId, subscriptionId, dayId, date, addonId, qty }) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(subscriptionId).session(session);
    if (!sub) {
      throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
    }
    if (String(sub.userId) !== String(userId)) {
      throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };
    }
    ensureActive(sub, date);

    const day = await resolveSubscriptionDay({ subscriptionId: sub._id, dayId, date, session });
    if (!day) {
      throw { status: 404, code: "NOT_FOUND", message: "Day not found" };
    }
    if (day.status !== "open") {
      throw { status: 409, code: "LOCKED", message: "Day is locked" };
    }

    const hasPremiumBalanceRows = Array.isArray(sub.premiumBalance) && sub.premiumBalance.length > 0;
    const hasLegacyPremiumOnly = Number(sub.premiumRemaining || 0) > 0 && !hasPremiumBalanceRows;
    if (hasLegacyPremiumOnly) {
      const subPremiumPriceSar = Number(sub.premiumPrice);
      const settingsPremiumPriceSar = Number(await getSettingValue("premium_price", 20));
      const fallbackPremiumPriceSar = Number.isFinite(subPremiumPriceSar) && subPremiumPriceSar >= 0
        ? subPremiumPriceSar
        : Number.isFinite(settingsPremiumPriceSar) && settingsPremiumPriceSar >= 0
          ? settingsPremiumPriceSar
          : 0;
      const legacyUnitExtraFeeHalala = Math.round(fallbackPremiumPriceSar * 100);
      ensureLegacyPremiumBalanceFromRemaining(sub, {
        unitExtraFeeHalala: legacyUnitExtraFeeHalala,
        currency: SYSTEM_CURRENCY,
      });
    }

    const balances = (sub.addonBalance || [])
      .filter((row) => String(row.addonId) === String(addonId) && Number(row.remainingQty) > 0)
      .sort((a, b) => new Date(a.purchasedAt).getTime() - new Date(b.purchasedAt).getTime());

    const totalAvailable = balances.reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);
    if (totalAvailable < qty) {
      throw { status: 400, code: "INSUFFICIENT_ADDON", message: "Not enough addon credits" };
    }

    let remaining = qty;
    for (const row of balances) {
      if (remaining <= 0) break;
      const available = Number(row.remainingQty || 0);
      const deduct = Math.min(available, remaining);
      if (!deduct) continue;
      row.remainingQty = available - deduct;
      sub.addonSelections.push({
        dayId: day._id,
        date: day.date,
        addonId,
        qty: deduct,
        unitPriceHalala: Number(row.unitPriceHalala || 0),
        currency: row.currency || "SAR",
      });
      remaining -= deduct;
    }

    syncPremiumRemainingFromBalance(sub);
    applyDayWalletSelections({ subscription: sub, day });
    await sub.save({ session });
    await day.save({ session });
    await session.commitTransaction();
    session.endSession();

    const remainingQtyTotal = (sub.addonBalance || [])
      .filter((row) => String(row.addonId) === String(addonId))
      .reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);

    return {
      ok: true,
      subscriptionId: sub.id,
      addonId: String(addonId),
      remainingQtyTotal,
    };
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    throw err;
  }
}

async function performRemoveAddonSelection({ userId, subscriptionId, dayId, date, addonId }) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(subscriptionId).session(session);
    if (!sub) {
      throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
    }
    if (String(sub.userId) !== String(userId)) {
      throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };
    }

    const targetDay = await resolveSubscriptionDay({ subscriptionId: sub._id, dayId, date, session });
    if (!targetDay) {
      throw { status: 404, code: "NOT_FOUND", message: "Day not found" };
    }
    ensureActive(sub, targetDay.date);
    if (targetDay.status !== "open") {
      throw { status: 409, code: "LOCKED", message: "Day is locked" };
    }

    const hasPremiumBalanceRows = Array.isArray(sub.premiumBalance) && sub.premiumBalance.length > 0;
    const hasLegacyPremiumOnly = Number(sub.premiumRemaining || 0) > 0 && !hasPremiumBalanceRows;
    if (hasLegacyPremiumOnly) {
      const subPremiumPriceSar = Number(sub.premiumPrice);
      const settingsPremiumPriceSar = Number(await getSettingValue("premium_price", 20));
      const fallbackPremiumPriceSar = Number.isFinite(subPremiumPriceSar) && subPremiumPriceSar >= 0
        ? subPremiumPriceSar
        : Number.isFinite(settingsPremiumPriceSar) && settingsPremiumPriceSar >= 0
          ? settingsPremiumPriceSar
          : 0;
      const legacyUnitExtraFeeHalala = Math.round(fallbackPremiumPriceSar * 100);
      ensureLegacyPremiumBalanceFromRemaining(sub, {
        unitExtraFeeHalala: legacyUnitExtraFeeHalala,
        currency: SYSTEM_CURRENCY,
      });
    }

    const targetDayId = String(targetDay._id);
    const targetDate = targetDay.date;

    const toRefund = (sub.addonSelections || []).filter(
      (row) =>
        String(row.addonId) === String(addonId)
        && matchSelectionDay(row, { dayId: targetDayId, date: targetDate })
    );
    if (!toRefund.length) {
      throw { status: 404, code: "NOT_FOUND", message: "Addon selection not found" };
    }

    sub.addonSelections = (sub.addonSelections || []).filter(
      (row) =>
        !(String(row.addonId) === String(addonId) && matchSelectionDay(row, { dayId: targetDayId, date: targetDate }))
    );

    for (const row of toRefund) {
      const match = (sub.addonBalance || []).find(
        (balance) =>
          String(balance.addonId) === String(addonId)
          && Number(balance.unitPriceHalala || 0) === Number(row.unitPriceHalala || 0)
      );
      if (!match) {
        logWalletIntegrityError("addon_refund_remove_selection_missing_bucket", {
          subscriptionId,
          dayId: targetDayId,
          date: targetDate,
          addonId: String(addonId),
          unitPriceHalala: Number(row.unitPriceHalala || 0),
        });
        throw { status: 409, code: "DATA_INTEGRITY_ERROR", message: "Cannot refund addon credits because the original wallet bucket was not found" };
      }
      const nextRemainingQty = Number(match.remainingQty || 0) + Number(row.qty || 0);
      const purchasedQty = Number(match.purchasedQty || 0);
      if (nextRemainingQty > purchasedQty) {
        logWalletIntegrityError("addon_refund_remove_selection_exceeds_purchased", {
          subscriptionId,
          dayId: targetDayId,
          date: targetDate,
          addonId: String(addonId),
          unitPriceHalala: Number(row.unitPriceHalala || 0),
          attemptedRemainingQty: nextRemainingQty,
          purchasedQty,
        });
        throw { status: 409, code: "DATA_INTEGRITY_ERROR", message: "Cannot refund addon credits because refund exceeds purchased quantity" };
      }
      match.remainingQty = nextRemainingQty;
    }

    syncPremiumRemainingFromBalance(sub);
    applyDayWalletSelections({ subscription: sub, day: targetDay });
    await sub.save({ session });
    await targetDay.save({ session });
    await session.commitTransaction();
    session.endSession();

    return { ok: true, subscriptionId: sub.id };
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    throw err;
  }
}

function getLegacyDayPremiumSelections(sub, { dayId, date }) {
  const rows = Array.isArray(sub && sub.premiumSelections) ? sub.premiumSelections : [];
  const expectedDayId = dayId ? String(dayId) : null;
  return rows.filter((row) => {
    const slotKey = String(row && row.baseSlotKey ? row.baseSlotKey : "");
    if (!slotKey.startsWith(LEGACY_DAY_PREMIUM_SLOT_PREFIX)) return false;
    if (expectedDayId && row.dayId && String(row.dayId) === expectedDayId) return true;
    return Boolean(row.date && date && String(row.date) === String(date));
  });
}

function getNextLegacyDayPremiumSlotIndex(existingRows) {
  const maxIndex = existingRows.reduce((max, row) => {
    const parsed = parseLegacyDayPremiumSlotIndex(row && row.baseSlotKey);
    if (parsed === null) return max;
    return parsed > max ? parsed : max;
  }, -1);
  return maxIndex + 1;
}

function extractAddedPremiumSelectionIds(previousSelections, nextSelections, qty) {
  const remainingCounts = new Map();
  for (const mealId of Array.isArray(previousSelections) ? previousSelections : []) {
    const key = String(mealId || "");
    remainingCounts.set(key, (remainingCounts.get(key) || 0) + 1);
  }

  const added = [];
  for (const mealId of Array.isArray(nextSelections) ? nextSelections : []) {
    const key = String(mealId || "");
    const existingCount = remainingCounts.get(key) || 0;
    if (existingCount > 0) {
      remainingCounts.set(key, existingCount - 1);
      continue;
    }
    if (key) {
      added.push(key);
    }
  }

  return added.slice(0, qty);
}

function sortDayPremiumRowsByConsumedAt(rows) {
  return (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => new Date(a && a.consumedAt ? a.consumedAt : 0).getTime() - new Date(b && b.consumedAt ? b.consumedAt : 0).getTime());
}

function reconcileWalletBackedPremiumRowsForRequestedSelections(currentRows, requestedPremiumSelections) {
  const requestedCounts = new Map();
  for (const mealId of Array.isArray(requestedPremiumSelections) ? requestedPremiumSelections : []) {
    const key = String(mealId || "");
    if (!key) continue;
    requestedCounts.set(key, (requestedCounts.get(key) || 0) + 1);
  }

  const retainedRows = [];
  const refundableRows = [];
  for (const row of sortDayPremiumRowsByConsumedAt(currentRows)) {
    const key = String(row && row.premiumMealId ? row.premiumMealId : "");
    const remainingRequested = requestedCounts.get(key) || 0;
    if (remainingRequested > 0) {
      retainedRows.push(row);
      requestedCounts.set(key, remainingRequested - 1);
    } else {
      refundableRows.push(row);
    }
  }

  const retainedCounts = new Map();
  for (const row of retainedRows) {
    const key = String(row && row.premiumMealId ? row.premiumMealId : "");
    retainedCounts.set(key, (retainedCounts.get(key) || 0) + 1);
  }

  const unmetRequestedMealIds = [];
  for (const mealId of Array.isArray(requestedPremiumSelections) ? requestedPremiumSelections : []) {
    const key = String(mealId || "");
    const retainedCount = retainedCounts.get(key) || 0;
    if (retainedCount > 0) {
      retainedCounts.set(key, retainedCount - 1);
      continue;
    }
    if (key) {
      unmetRequestedMealIds.push(mealId);
    }
  }

  return {
    retainedRows,
    refundableRows,
    unmetRequestedMealIds,
  };
}

function consumePremiumBalanceFifoRows(sub, qty) {
  const rows = toPremiumWalletRowsFIFO(sub);
  const available = rows.reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);
  if (available < qty) {
    return null;
  }

  const consumed = [];
  let remaining = qty;
  for (const row of rows) {
    if (remaining <= 0) break;
    const rowAvailable = Number(row.remainingQty || 0);
    if (rowAvailable <= 0) continue;
    const used = Math.min(rowAvailable, remaining);
    row.remainingQty = rowAvailable - used;
    remaining -= used;
    for (let i = 0; i < used; i += 1) {
      consumed.push({
        premiumMealId: row.premiumMealId,
        unitExtraFeeHalala: Number(row.unitExtraFeeHalala || 0),
        currency: row.currency || SYSTEM_CURRENCY,
      });
    }
  }
  return consumed;
}

function refundPremiumSelectionRowsToBalanceOrThrow(sub, selections) {
  for (const selection of selections) {
    const match = (sub.premiumBalance || [])
      .find(
        (row) =>
          String(row.premiumMealId) === String(selection.premiumMealId)
          && Number(row.unitExtraFeeHalala || 0) === Number(selection.unitExtraFeeHalala || 0)
          && String(row.currency || SYSTEM_CURRENCY).toUpperCase()
          === String(selection.currency || SYSTEM_CURRENCY).toUpperCase()
      );
    if (!match) {
      const err = new Error("Cannot refund premium credits because the original wallet bucket was not found");
      err.code = "DATA_INTEGRITY_ERROR";
      throw err;
    }
    const nextRemainingQty = Number(match.remainingQty || 0) + 1;
    const purchasedQty = Number(match.purchasedQty || 0);
    if (nextRemainingQty > purchasedQty) {
      const err = new Error("Cannot refund premium credits because refund exceeds purchased quantity");
      err.code = "DATA_INTEGRITY_ERROR";
      throw err;
    }
    match.remainingQty = nextRemainingQty;
  }
}

// --- MAIN ORCHESTRATION ---

async function performDaySelectionUpdate({
  userId,
  subscriptionId,
  date,
  selections,
  premiumSelections,
  requestedOneTimeAddonIds,
  lang,
  runtime,
}) {
  const id = subscriptionId;

  // Basic entry checks
  validateFutureDateOrThrow(date);
  await enforceTomorrowCutoffOrThrow(date);

  const totalSelected = selections.length + premiumSelections.length;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const subInSession = await Subscription.findById(id).session(session);
    if (!subInSession) {
      throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
    }

    if (String(subInSession.userId) !== String(userId)) {
      throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };
    }

    const mealsPerDayLimit = resolveMealsPerDay(subInSession);
    if (totalSelected > mealsPerDayLimit) {
      throw { status: 400, code: "DAILY_CAP", message: "Selections exceed meals per day" };
    }

    ensureActive(subInSession, date);
    validateFutureDateOrThrow(date, subInSession);

    const existingDay = await SubscriptionDay.findOne({ subscriptionId: id, date }).session(session);

    const useCanonicalPremiumOverage = runtime.isCanonicalPremiumOverageEligible(subInSession, {
      dayPlanningFlagEnabled: isPhase2CanonicalDayPlanningEnabled(),
      genericPremiumWalletFlagEnabled: isPhase2GenericPremiumWalletEnabled(),
    });
    const useCanonicalOneTimeAddonPlanning = runtime.isCanonicalDayPlanningEligible(subInSession, {
      flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
    });

    // Idempotency check
    if (existingDay && existingDay.status === "open") {
      const toStringSet = (values) => new Set((Array.isArray(values) ? values : []).map((value) => String(value)));
      const existingRegSet = toStringSet(existingDay.selections);
      const existingPremSet = toStringSet(existingDay.premiumSelections);
      const newRegSet = toStringSet(selections);
      const newPremSet = toStringSet(premiumSelections);
      const setsEqual = (a, b) => a.size === b.size && [...a].every((value) => b.has(value));

      if (
        !useCanonicalPremiumOverage &&
        !(useCanonicalOneTimeAddonPlanning && requestedOneTimeAddonIds !== undefined) &&
        setsEqual(existingRegSet, newRegSet) &&
        setsEqual(existingPremSet, newPremSet)
      ) {
        await session.commitTransaction();
        session.endSession();
        return {
          subscription: subInSession,
          day: existingDay,
          idempotent: true,
        };
      }
    }

    if (existingDay && existingDay.status !== "open") {
      throw { status: 409, code: "LOCKED", message: "Day is locked" };
    }

    const useGenericPremiumWallet = isGenericPremiumWalletMode(subInSession);
    const usePremiumOverageFlow = runtime.isCanonicalPremiumOverageEligible(subInSession, {
      dayPlanningFlagEnabled: isPhase2CanonicalDayPlanningEnabled(),
      genericPremiumWalletFlagEnabled: isPhase2GenericPremiumWalletEnabled(),
    });

    const premiumPriceSar = Number(await getSettingValue("premium_price", 20));
    const legacyPremiumUnitHalala = Number.isFinite(premiumPriceSar) && premiumPriceSar >= 0 ? Math.round(premiumPriceSar * 100) : 0;

    if (!useGenericPremiumWallet) {
      ensureLegacyPremiumBalanceFromRemaining(subInSession, {
        unitExtraFeeHalala: legacyPremiumUnitHalala,
        currency: SYSTEM_CURRENCY,
      });
    }

    const currentLegacyRows = getLegacyDayPremiumSelections(subInSession, {
      dayId: existingDay ? existingDay._id : null,
      date,
    });
    const insertedSelectionRows = [];
    let walletBackedConsumedCount = currentLegacyRows.length;

    if (usePremiumOverageFlow) {
      const { retainedRows, refundableRows, unmetRequestedMealIds } = reconcileWalletBackedPremiumRowsForRequestedSelections(currentLegacyRows, premiumSelections);

      if (refundableRows.length > 0) {
        refundGenericPremiumSelectionRowsOrThrow(subInSession, refundableRows);
        const rowsToRemove = new Set(refundableRows);
        subInSession.premiumSelections = (subInSession.premiumSelections || []).filter((row) => !rowsToRemove.has(row));
      }

      const availableCredits = getRemainingPremiumCredits(subInSession);
      const consumeQty = Math.min(unmetRequestedMealIds.length, availableCredits);
      const consumedRows = consumeQty > 0 ? consumeGenericPremiumCredits(subInSession, consumeQty) : [];

      if (consumeQty > 0 && (!consumedRows || consumedRows.length !== consumeQty)) {
        throw { status: 409, code: "DATA_INTEGRITY_ERROR", message: "Generic premium wallet could not satisfy requested partial consumption" };
      }

      let nextSlotIndex = getNextLegacyDayPremiumSlotIndex(retainedRows);
      for (let index = 0; index < consumeQty; index += 1) {
        const consumed = consumedRows[index];
        const insertedRow = {
          dayId: existingDay ? existingDay._id : undefined,
          date,
          baseSlotKey: `${LEGACY_DAY_PREMIUM_SLOT_PREFIX}${nextSlotIndex}`,
          premiumMealId: unmetRequestedMealIds[index],
          unitExtraFeeHalala: Number(consumed.unitCreditPriceHalala || 0),
          currency: consumed.currency || SYSTEM_CURRENCY,
          premiumWalletMode: GENERIC_PREMIUM_WALLET_MODE,
          premiumWalletRowId: consumed.premiumWalletRowId || null,
        };
        subInSession.premiumSelections = subInSession.premiumSelections || [];
        subInSession.premiumSelections.push(insertedRow);
        insertedSelectionRows.push(insertedRow);
        nextSlotIndex += 1;
      }
      walletBackedConsumedCount = retainedRows.length + consumeQty;
    } else {
      const diff = premiumSelections.length - currentLegacyRows.length;
      const addedPremiumMealIds = extractAddedPremiumSelectionIds(
        existingDay && Array.isArray(existingDay.premiumSelections) ? existingDay.premiumSelections : [],
        premiumSelections,
        diff > 0 ? diff : 0
      );

      if (diff > 0) {
        const consumedRows = useGenericPremiumWallet ? consumeGenericPremiumCredits(subInSession, diff) : consumePremiumBalanceFifoRows(subInSession, diff);
        if (!consumedRows) {
          throw { status: 400, code: "INSUFFICIENT_PREMIUM", message: "Not enough premium credits" };
        }
        let nextSlotIndex = getNextLegacyDayPremiumSlotIndex(currentLegacyRows);
        const firstInsertedOffset = nextSlotIndex;
        for (const consumed of consumedRows) {
          const insertedOffset = nextSlotIndex - firstInsertedOffset;
          const insertedRow = {
            dayId: existingDay ? existingDay._id : undefined,
            date,
            baseSlotKey: `${LEGACY_DAY_PREMIUM_SLOT_PREFIX}${nextSlotIndex}`,
            premiumMealId: addedPremiumMealIds[insertedOffset] || premiumSelections[insertedOffset] || consumed.premiumMealId,
            unitExtraFeeHalala: useGenericPremiumWallet ? Number(consumed.unitCreditPriceHalala || 0) : Number(consumed.unitExtraFeeHalala || 0),
            currency: consumed.currency || SYSTEM_CURRENCY,
            premiumWalletMode: useGenericPremiumWallet ? GENERIC_PREMIUM_WALLET_MODE : LEGACY_PREMIUM_WALLET_MODE,
            premiumWalletRowId: useGenericPremiumWallet && consumed.premiumWalletRowId ? consumed.premiumWalletRowId : null,
          };
          subInSession.premiumSelections = subInSession.premiumSelections || [];
          subInSession.premiumSelections.push(insertedRow);
          insertedSelectionRows.push(insertedRow);
          nextSlotIndex += 1;
        }
      } else if (diff < 0) {
        const rowsToRefund = currentLegacyRows.slice().sort((a, b) => new Date(b.consumedAt || 0).getTime() - new Date(a.consumedAt || 0).getTime()).slice(0, -diff);
        if (useGenericPremiumWallet) {
          refundGenericPremiumSelectionRowsOrThrow(subInSession, rowsToRefund);
        } else {
          refundPremiumSelectionRowsToBalanceOrThrow(subInSession, rowsToRefund);
        }
        const rowsToRemove = new Set(rowsToRefund);
        subInSession.premiumSelections = (subInSession.premiumSelections || []).filter((row) => !rowsToRemove.has(row));
      }
      walletBackedConsumedCount = getLegacyDayPremiumSelections(subInSession, { dayId: existingDay ? existingDay._id : null, date }).length;
    }

    let finalOneTimeAddonSelections;
    if (useCanonicalOneTimeAddonPlanning) {
      if (requestedOneTimeAddonIds !== undefined) {
        const addonDocs = requestedOneTimeAddonIds.length ? await Addon.find({ _id: { $in: requestedOneTimeAddonIds }, isActive: true }).session(session).lean() : [];
        finalOneTimeAddonSelections = runtime.normalizeOneTimeAddonSelections({ requestedAddonIds: requestedOneTimeAddonIds, addonDocs, lang });
      } else {
        finalOneTimeAddonSelections = Array.isArray(existingDay && existingDay.oneTimeAddonSelections) ? existingDay.oneTimeAddonSelections : [];
      }
    }

    const update = { selections, premiumSelections };
    if (requestedOneTimeAddonIds !== undefined) {
      if (useCanonicalOneTimeAddonPlanning) {
        update.oneTimeAddonSelections = finalOneTimeAddonSelections;
      } else {
        update.addonsOneTime = requestedOneTimeAddonIds;
      }
    }

    const day = await SubscriptionDay.findOneAndUpdate({ subscriptionId: id, date: date }, update, { upsert: true, new: true, session });

    if (insertedSelectionRows.length > 0) {
      for (const row of insertedSelectionRows) {
        row.dayId = day._id;
        row.date = day.date;
      }
    }

    // --- SIDE EFFECTS (Original Order Preserved) ---
    syncPremiumRemainingFromActivePremiumWallet(subInSession);
    if (usePremiumOverageFlow) {
      runtime.applyPremiumOverageState({ day, requestedPremiumSelectionCount: premiumSelections.length, walletBackedConsumedCount });
    }
    if (useCanonicalOneTimeAddonPlanning) {
      runtime.recomputeOneTimeAddonPlanningState({ day, selections: finalOneTimeAddonSelections });
    }
    applyDayWalletSelections({ subscription: subInSession, day });
    if (runtime.isCanonicalRecurringAddonEligible(subInSession)) {
      runtime.applyRecurringAddonProjectionToDay({ subscription: subInSession, day });
    }
    if (runtime.isCanonicalDayPlanningEligible(subInSession, { flagEnabled: isPhase2CanonicalDayPlanningEnabled() })) {
      runtime.applyCanonicalDraftPlanningToDay({ subscription: subInSession, day, selections, premiumSelections, assignmentSource: "client" });
    }

    await subInSession.save({ session });
    await day.save({ session });

    await session.commitTransaction();
    session.endSession();

    return {
      subscription: subInSession,
      day,
      idempotent: false,
      logMeta: {
        date,
        selectionsCount: selections.length,
        premiumCount: premiumSelections.length,
      },
    };
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    throw err;
  }
}

async function performDayPlanningConfirmation({
  userId,
  subscriptionId,
  date,
  runtime,
}) {
  const id = subscriptionId;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const subInSession = await Subscription.findById(id).session(session);
    if (!subInSession) {
      throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
    }

    if (String(subInSession.userId) !== String(userId)) {
      throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };
    }

    if (!runtime.isCanonicalDayPlanningEligible(subInSession, {
      flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
    })) {
      throw { status: 409, code: "CANONICAL_DAY_PLANNING_DISABLED", message: "Canonical day planning is not enabled for this subscription" };
    }

    ensureActive(subInSession, date);
    validateFutureDateOrThrow(date, subInSession);

    const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).session(session);
    if (!day) {
      throw { status: 404, code: "NOT_FOUND", message: "Day not found" };
    }

    if (day.status !== "open") {
      throw { status: 409, code: "LOCKED", message: "Day is locked" };
    }

    try {
      runtime.assertCanonicalPlanningExactCount({
        subscription: subInSession,
        day,
      });
      runtime.assertNoPendingPremiumOverage({
        subscription: subInSession,
        day,
        overageEligible: runtime.isCanonicalPremiumOverageEligible(subInSession, {
          dayPlanningFlagEnabled: isPhase2CanonicalDayPlanningEnabled(),
          genericPremiumWalletFlagEnabled: isPhase2GenericPremiumWalletEnabled(),
        }),
      });
      runtime.assertNoPendingOneTimeAddonPayment({ day });
      runtime.confirmCanonicalDayPlanning({
        subscription: subInSession,
        day,
        actorRole: "client",
      });
      runtime.applyRecurringAddonProjectionToDay({
        subscription: subInSession,
        day,
      });
    } catch (err) {
      if (
        err.code === "PLANNING_INCOMPLETE"
        || err.code === "PREMIUM_OVERAGE_PAYMENT_REQUIRED"
        || err.code === "ONE_TIME_ADDON_PAYMENT_REQUIRED"
      ) {
        // Wrap for specialized controller 422 catch
        err.status = 422;
        throw err;
      }
      throw err;
    }

    await day.save({ session });
    await session.commitTransaction();
    session.endSession();

    return {
      subscription: subInSession,
      day,
    };
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    throw err;
  }
}

module.exports = {
  getLegacyDayPremiumSelections,
  performDaySelectionUpdate,
  performDayPlanningConfirmation,
  performConsumePremiumSelection,
  performRemovePremiumSelection,
  performConsumeAddonSelection,
  performRemoveAddonSelection,
};
