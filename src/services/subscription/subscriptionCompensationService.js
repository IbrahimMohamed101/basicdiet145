const { addDays } = require("date-fns");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const { toKSADateString, addDaysToKSADateString } = require("../../utils/date");
const { createLocalizedError } = require("../../utils/errorLocalization");
const { buildProjectedDayEntry } = require("../recurringAddonService");

async function countCompensatedSkipDays(subscriptionId, session) {
  const query = SubscriptionDay.countDocuments({
    subscriptionId,
    status: "skipped",
    skipCompensated: true,
  });
  if (session) query.session(session);
  return query;
}

async function countAlreadySkippedDays(subscriptionId, session) {
  return countCompensatedSkipDays(subscriptionId, session);
}

async function countFrozenDays(subscriptionId, session) {
  const query = SubscriptionDay.countDocuments({
    subscriptionId,
    status: "frozen",
  });
  if (session) query.session(session);
  return query;
}

async function listCompensationSourceDays(subscriptionId, session) {
  const query = SubscriptionDay.find({
    subscriptionId,
    $or: [
      { status: "frozen" },
      { status: "skipped", skipCompensated: true },
    ],
  }).select("date status canonicalDayActionType skipCompensated");
  if (session) query.session(session);
  return query.lean();
}

function resolveCompensationTokenType(day) {
  if (!day || typeof day !== "object") return null;
  if (day.canonicalDayActionType === "freeze" || day.status === "frozen") {
    return "freeze";
  }
  if (
    day.skipCompensated
    && (day.canonicalDayActionType === "skip" || day.status === "skipped")
  ) {
    return "skip";
  }
  return null;
}

function sortCompensationTokens(tokens = []) {
  return [...tokens].sort((left, right) => {
    if (left.sourceDate !== right.sourceDate) {
      return left.sourceDate.localeCompare(right.sourceDate);
    }
    if (left.type === right.type) {
      return 0;
    }
    return left.type === "freeze" ? -1 : 1;
  });
}

async function getCompensationSnapshot(subscriptionId, session) {
  const sourceDays = await listCompensationSourceDays(subscriptionId, session);
  const tokens = sortCompensationTokens(
    sourceDays
      .map((day) => {
        const type = resolveCompensationTokenType(day);
        if (!type || typeof day.date !== "string") {
          return null;
        }
        return { type, sourceDate: day.date };
      })
      .filter(Boolean)
  );

  const freezeCount = tokens.filter((token) => token.type === "freeze").length;
  const skipCount = tokens.filter((token) => token.type === "skip").length;

  return {
    tokens,
    freezeCount,
    skipCount,
    totalCount: tokens.length,
  };
}

function buildExtensionSourceMap(tokens = [], endDateStr) {
  const extensionSourceMap = new Map();
  tokens.forEach((token, index) => {
    const extensionDate = addDaysToKSADateString(endDateStr, index + 1);
    extensionSourceMap.set(
      extensionDate,
      token.type === "freeze" ? "freeze_compensation" : "skip_compensation"
    );
  });
  return extensionSourceMap;
}

function buildRollbackUpdate(existingDay) {
  const rollbackUpdate = {
    $set: {
      status: existingDay?.status || "open",
      skippedByUser: existingDay?.skippedByUser || false,
      skipCompensated: existingDay?.skipCompensated || false,
      creditsDeducted: existingDay?.creditsDeducted || false,
    },
  };

  if (existingDay?.canonicalDayActionType !== undefined && existingDay?.canonicalDayActionType !== null) {
    rollbackUpdate.$set.canonicalDayActionType = existingDay.canonicalDayActionType;
  } else {
    rollbackUpdate.$unset = { canonicalDayActionType: 1 };
  }

  return rollbackUpdate;
}

async function rollbackDaySkipMutation({ dayId, existingDay, session }) {
  await SubscriptionDay.updateOne(
    { _id: dayId },
    buildRollbackUpdate(existingDay),
    { session }
  ).session(session);
}

function buildValidityShrinkConflictError(newValidityEndStr, conflictDay) {
  return createLocalizedError({
    code: "VALIDITY_SHRINK_CONFLICT",
    key: "errors.subscription.validityShrinkConflict",
    params: { validityDate: newValidityEndStr, dayDate: conflictDay.date },
    fallbackMessage: `Cannot shrink validity to ${newValidityEndStr} because day ${conflictDay.date} has active data`,
  });
}

/**
 * P2-S7-S2 — authoritative recomputation of validity based on all compensated days.
 * Rule: validityEndDate = endDate + frozenDays + compensatedSkipDays.
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

  const compensation = await getCompensationSnapshot(subscription._id, session);
  const newValidityEndDate = addDays(baseEndDate, compensation.totalCount);
  const currentValidityEndDate = subscription.validityEndDate || baseEndDate;

  const newValidityEndStr = toKSADateString(newValidityEndDate);
  const currentValidityEndStr = toKSADateString(currentValidityEndDate);
  const baseEndStr = toKSADateString(baseEndDate);

  if (newValidityEndStr > currentValidityEndStr) {
    const existingDays = await SubscriptionDay.find({
      subscriptionId: subscription._id,
      date: { $gt: currentValidityEndStr, $lte: newValidityEndStr },
    })
      .select("date")
      .session(session)
      .lean();

    const existingDates = new Set(existingDays.map((day) => day.date));
    const daysToAdd = [];

    for (
      let currentDate = addDaysToKSADateString(currentValidityEndStr, 1);
      currentDate <= newValidityEndStr;
      currentDate = addDaysToKSADateString(currentDate, 1)
    ) {
      if (!existingDates.has(currentDate)) {
        daysToAdd.push(
          buildProjectedDayEntry({
            subscription,
            date: currentDate,
            status: "open",
          })
        );
      }
    }

    if (daysToAdd.length > 0) {
      await SubscriptionDay.insertMany(daysToAdd, { session });
    }
  }

  if (newValidityEndStr < currentValidityEndStr) {
    const extraDays = await SubscriptionDay.find({
      subscriptionId: subscription._id,
      date: { $gt: newValidityEndStr },
    }).session(session);

    const daysToDelete = extraDays.filter((day) => {
      const isBeyondBase = day.date > baseEndStr;
      return isBeyondBase && isRemovableExtensionDay(day);
    });

    const conflictDay = extraDays.find((day) => !isRemovableExtensionDay(day));
    if (conflictDay) {
      throw buildValidityShrinkConflictError(newValidityEndStr, conflictDay);
    }

    if (daysToDelete.length > 0) {
      await SubscriptionDay.deleteMany({
        _id: { $in: daysToDelete.map((day) => day._id) },
      }).session(session);
    }
  }

  subscription.validityEndDate = newValidityEndDate;
  await subscription.save({ session });

  return {
    validityEndDate: newValidityEndDate,
    frozenCount: compensation.freezeCount,
    compensatedSkipCount: compensation.skipCount,
    totalCompensationCount: compensation.totalCount,
    compensationTokens: compensation.tokens,
  };
}

function isRemovableExtensionDay(day) {
  if (Array.isArray(day.selections) && day.selections.length > 0) return false;
  if (Array.isArray(day.premiumSelections) && day.premiumSelections.length > 0) return false;
  if (Array.isArray(day.premiumUpgradeSelections) && day.premiumUpgradeSelections.length > 0) return false;
  if (Array.isArray(day.addonCreditSelections) && day.addonCreditSelections.length > 0) return false;
  if (day.assignedByKitchen || day.pickupRequested || day.creditsDeducted || day.skippedByUser) return false;
  if (day.lockedSnapshot || day.fulfilledSnapshot || day.lockedAt || day.fulfilledAt) return false;
  if (["locked", "fulfilled", "delivery_canceled"].includes(day.status)) return false;
  return true;
}

module.exports = {
  countAlreadySkippedDays,
  countCompensatedSkipDays,
  countFrozenDays,
  getCompensationSnapshot,
  syncSubscriptionValidity,
  rollbackDaySkipMutation,
};