const { addDays } = require("date-fns");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const Setting = require("../models/Setting");
const { createLocalizedError } = require("../utils/errorLocalization");
const { toKSADateString, addDaysToKSADateString } = require("../utils/date");
const { resolveMealsPerDay } = require("../utils/subscriptionDaySelectionSync");
const { buildProjectedDayEntry } = require("./recurringAddonService");

/**
 * @typedef {import("../types/subscriptionTimeline").TimelineDay} TimelineDay
 * @typedef {import("../types/subscriptionTimeline").SubscriptionTimeline} SubscriptionTimeline
 */

function normalizeSkipAllowance(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function buildSkipLimitReachedError() {
  return createLocalizedError({
    code: "SKIP_LIMIT_REACHED",
    status: 403,
    key: "errors.subscription.skipLimitReached",
    fallbackMessage: "You have reached your maximum allowed skip days",
  });
}

async function getGlobalSkipAllowance(session) {
  // BUSINESS RULE: Missing skip allowance config is treated as 0 so users cannot skip by default.
  const query = Setting.findOne({ key: "skipAllowance" });
  if (session) query.session(session);
  const primarySetting = await query.lean();
  if (primarySetting) {
    if (primarySetting.skipAllowance !== undefined) {
      return normalizeSkipAllowance(primarySetting.skipAllowance);
    }
    if (primarySetting.value !== undefined) {
      return normalizeSkipAllowance(primarySetting.value);
    }
  }

  // BUSINESS RULE: Support legacy snake_case key if it exists, while defaulting to 0 otherwise.
  const legacyQuery = Setting.findOne({ key: "skip_allowance" });
  if (session) legacyQuery.session(session);
  const legacySetting = await legacyQuery.lean();
  if (legacySetting && legacySetting.value !== undefined) {
    return normalizeSkipAllowance(legacySetting.value);
  }
  return 0;
}

async function countAlreadySkippedDays(subscriptionId, session) {
  // P2-S7-S1 canonical narrowing: skip counting relies on status: "skipped" only.
  // The previous $or with skippedByUser: true is intentionally removed.
  // Malformed legacy-only rows (skippedByUser:true but status !== "skipped") will no longer
  // be counted — that is acceptable in this slice as we tighten canonical correctness
  // without migration or backfill.
  const query = SubscriptionDay.countDocuments({
    subscriptionId,
    status: "skipped",
  });
  if (session) query.session(session);
  return query;
}

async function enforceSkipAllowanceOrThrow({ subscriptionId, daysToSkip, session }) {
  const parsedDaysToSkip = Number(daysToSkip);
  if (!Number.isInteger(parsedDaysToSkip) || parsedDaysToSkip < 0) {
    throw createLocalizedError({
      code: "INVALID_SKIP_DAYS",
      key: "errors.subscription.invalidSkipDays",
      fallbackMessage: "daysToSkip must be an integer >= 0",
    });
  }

  const [alreadySkipped, skipAllowance] = await Promise.all([
    countAlreadySkippedDays(subscriptionId, session),
    getGlobalSkipAllowance(session),
  ]);

  // BUSINESS RULE: Skip requests over the global allowance are blocked with no compensation/refund.
  if (alreadySkipped + parsedDaysToSkip > skipAllowance) {
    throw buildSkipLimitReachedError();
  }
}

async function applySkipForDate({ sub, date, session, allowLocked = false }) {
  const existingDay = await SubscriptionDay.findOne({ subscriptionId: sub._id, date }).session(session);

  if (existingDay && existingDay.status === "skipped") {
    return { status: "already_skipped", day: existingDay };
  }

  if (existingDay && existingDay.status === "fulfilled") {
    return { status: "fulfilled", day: existingDay };
  }

  // Regular users can't skip locked days. Couriers can "skip" (cancel) them.
  if (existingDay && !allowLocked && !["open", "skipped"].includes(existingDay.status)) {
    return { status: "locked", day: existingDay };
  }

  if (!allowLocked) {
    await enforceSkipAllowanceOrThrow({ subscriptionId: sub._id, daysToSkip: 1, session });
  }

  const mealsToDeduct = resolveMealsPerDay(sub);

  // CR-01 FIX: Use atomic conditional update to prevent race condition
  // Only deduct if day was successfully marked as skipped
  let dayUpdateResult;
  if (!existingDay) {
    // Create new skipped day
    const created = await SubscriptionDay.create(
      [{
        subscriptionId: sub._id,
        date,
        status: "skipped",
        skippedByUser: !allowLocked,
        creditsDeducted: true,
        canonicalDayActionType: "skip", // P2-S7-S1: canonical skip action marker
      }],
      { session }
    );
    dayUpdateResult = created[0];
  } else {
    const query = { _id: existingDay._id };
    if (!allowLocked) {
      query.status = "open";
    } else {
      query.status = { $ne: "fulfilled" };
    }

    dayUpdateResult = await SubscriptionDay.findOneAndUpdate(
      query,
      { $set: { status: "skipped", skippedByUser: !allowLocked, creditsDeducted: true, canonicalDayActionType: "skip" } }, // P2-S7-S1
      { new: true, session }
    );
    if (!dayUpdateResult) {
      return { status: allowLocked ? "fulfilled" : "locked" };
    }
  }

  // CR-01 FIX: Atomic credit deduction with conditional update
  const subUpdate = await Subscription.updateOne(
    { _id: sub._id, remainingMeals: { $gte: mealsToDeduct } },
    { $inc: { remainingMeals: -mealsToDeduct, skippedCount: 1 } },
    { session }
  );

  if (!subUpdate.modifiedCount) {
    // MEDIUM AUDIT FIX: Never abort here; this helper is called inside caller-owned transactions.
    // Revert local writes and return a status so the controller can abort once in its own boundary.
    const rollbackUpdate = {
      $set: {
        status: existingDay?.status || "open",
        skippedByUser: existingDay?.skippedByUser || false,
        creditsDeducted: existingDay?.creditsDeducted || false,
      },
    };
    if (existingDay?.canonicalDayActionType !== undefined && existingDay?.canonicalDayActionType !== null) {
      rollbackUpdate.$set.canonicalDayActionType = existingDay.canonicalDayActionType;
    } else {
      rollbackUpdate.$unset = { canonicalDayActionType: 1 };
    }
    await SubscriptionDay.updateOne(
      { _id: dayUpdateResult._id },
      rollbackUpdate,
      { session }
    ).session(session);
    return { status: "insufficient_credits" };
  }

  // BUSINESS RULE: Skip does not add compensation days; it only marks the day skipped and deducts credits.
  sub.skippedCount = (sub.skippedCount || 0) + 1;
  await sub.save({ session });

  return { status: "skipped", day: dayUpdateResult };
}

/**
 * P2-S7-S2 — Authoritative recomputation of validity based on frozen days.
 * Rule: validityEndDate = endDate + currentFrozenDayCount.
 */
async function syncSubscriptionValidity(subscription, session) {
  const baseEndDate = subscription.endDate;
  if (!baseEndDate) {
    throw createLocalizedError({
      code: "INVALID_SUB_DATA",
      key: "errors.subscription.baseEndDateMissing",
      fallbackMessage: "Subscription has no base end date",
    });
  }

  const frozenCount = await countFrozenDays(subscription._id, session);
  const newValidityEndDate = addDays(baseEndDate, frozenCount);
  const currentValidityEndDate = subscription.validityEndDate || baseEndDate;

  const newValidityEndStr = toKSADateString(newValidityEndDate);
  const currentValidityEndStr = toKSADateString(currentValidityEndDate);
  const baseEndStr = toKSADateString(baseEndDate);

  // 1. EXTENSION: Create missing days if the new validity is further out
  if (newValidityEndStr > currentValidityEndStr) {
    const existingDays = await SubscriptionDay.find({
      subscriptionId: subscription._id,
      date: { $gt: currentValidityEndStr, $lte: newValidityEndStr },
    })
      .select("date")
      .session(session)
      .lean();

    const existingDates = new Set(existingDays.map((d) => d.date));
    const daysToAdd = [];

    for (
      let dStr = addDaysToKSADateString(currentValidityEndStr, 1);
      dStr <= newValidityEndStr;
      dStr = addDaysToKSADateString(dStr, 1)
    ) {
      if (!existingDates.has(dStr)) {
        daysToAdd.push(
          buildProjectedDayEntry({
            subscription,
            date: dStr,
            status: "open",
          })
        );
      }
    }

    if (daysToAdd.length > 0) {
      await SubscriptionDay.insertMany(daysToAdd, { session });
    }
  }

  // 2. SHRINK SAFETY: Remove only extension-generated removable tail days
  if (newValidityEndStr < currentValidityEndStr) {
    const extraDays = await SubscriptionDay.find({
      subscriptionId: subscription._id,
      date: { $gt: newValidityEndStr },
    }).session(session);

    // Filter to ensure we never delete within the base contract window
    // and only remove "removable" extension days.
    const daysToDelete = extraDays.filter((day) => {
      const isBeyondBase = day.date > baseEndStr;
      const isRemovable = isRemovableExtensionDay(day);
      return isBeyondBase && isRemovable;
    });

    // If any day beyond newValidityEndDate is NOT removable, we have a conflict
    const conflictDay = extraDays.find((day) => !isRemovableExtensionDay(day));
    if (conflictDay) {
      throw createLocalizedError({
        code: "VALIDITY_SHRINK_CONFLICT",
        key: "errors.subscription.validityShrinkConflict",
        params: { validityDate: newValidityEndStr, dayDate: conflictDay.date },
        fallbackMessage: `Cannot shrink validity to ${newValidityEndStr} because day ${conflictDay.date} has active data`,
      });
    }

    if (daysToDelete.length > 0) {
      await SubscriptionDay.deleteMany({
        _id: { $in: daysToDelete.map((d) => d._id) },
      }).session(session);
    }
  }

  // 3. PERSIST: Update the subscription record
  subscription.validityEndDate = newValidityEndDate;
  await subscription.save({ session });

  return { validityEndDate: newValidityEndDate, frozenCount };
}

async function countFrozenDays(subscriptionId, session) {
  return SubscriptionDay.countDocuments({
    subscriptionId,
    status: "frozen",
  }).session(session);
}

function isRemovableExtensionDay(day) {
  if (Array.isArray(day.selections) && day.selections.length > 0) return false;
  if (Array.isArray(day.premiumSelections) && day.premiumSelections.length > 0) return false;
  if (Array.isArray(day.premiumUpgradeSelections) && day.premiumUpgradeSelections.length > 0) return false;
  if (Array.isArray(day.addonCreditSelections) && day.addonCreditSelections.length > 0) return false;
  
  // CR-11/LEGACY: check skippedByUser
  if (day.assignedByKitchen || day.pickupRequested || day.creditsDeducted || day.skippedByUser) return false;

  // If locked or fulfilled, it's definitely not removable
  if (day.lockedSnapshot || day.fulfilledSnapshot || day.lockedAt || day.fulfilledAt) return false;
  if (["locked", "fulfilled"].includes(day.status)) return false;

  return true;
}

/**
 * Phase 3 — Feature 1: Canonical Subscription Timeline
 * Build a read-only, deterministic projection layer.
 */
async function buildSubscriptionTimeline(subscriptionId) {
  const subscription = await Subscription.findById(subscriptionId).lean();
  if (!subscription) {
    const err = new Error("Subscription not found");
    err.code = "SUBSCRIPTION_NOT_FOUND";
    err.status = 404;
    throw err;
  }

  const startDateStr = toKSADateString(subscription.startDate);
  const endDateStr = toKSADateString(subscription.endDate);
  const validityEndDateStr = toKSADateString(subscription.validityEndDate || subscription.endDate);

  const days = await SubscriptionDay.find({ subscriptionId }).lean();
  const dayMap = new Map(days.map((d) => [d.date, d]));

  const normalizeStatus = (rawStatus) => {
    // Map legacy status values into the canonical timeline status set.
    switch (rawStatus) {
      case "open":
        return "planned";
      case "fulfilled":
        return "delivered";
      case "locked":
        return "locked";
      default:
        return rawStatus; // Keep unknown statuses as-is for forward-compat.
    }
  };

  const timelineDays = [];
  let frozenCount = 0;

  for (
    let dStr = startDateStr;
    dStr <= validityEndDateStr;
    dStr = addDaysToKSADateString(dStr, 1)
  ) {
    const dbDay = dayMap.get(dStr);
    const isExtension = dStr > endDateStr;

    let status;
    if (isExtension) {
      status = "extension";
    } else if (!dbDay) {
      status = "planned";
    } else if (dbDay.canonicalDayActionType === "freeze") {
      status = "frozen";
    } else if (dbDay.canonicalDayActionType === "skip") {
      status = "skipped";
    } else {
      status = normalizeStatus(dbDay.status);
    }

    if (status === "frozen") {
      frozenCount++;
    }

    timelineDays.push({
      date: dStr,
      status,
      source: isExtension ? "freeze_compensation" : "base",
      locked: !!(dbDay && dbDay.lockedSnapshot),
      isExtension,
    });
  }

  return {
    subscriptionId: String(subscription._id),
    validity: {
      startDate: startDateStr,
      endDate: endDateStr,
      validityEndDate: validityEndDateStr,
      compensationDays: frozenCount,
    },
    days: timelineDays,
  };
}

module.exports = {
  applySkipForDate,
  enforceSkipAllowanceOrThrow,
  syncSubscriptionValidity,
  countFrozenDays,
  buildSubscriptionTimeline,
};
