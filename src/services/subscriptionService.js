const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const Setting = require("../models/Setting");
const { resolveMealsPerDay } = require("../utils/subscriptionDaySelectionSync");

function normalizeSkipAllowance(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function buildSkipLimitReachedError() {
  const error = new Error("You have reached your maximum allowed skip days");
  error.code = "SKIP_LIMIT_REACHED";
  error.status = 403;
  return error;
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
  const query = SubscriptionDay.countDocuments({
    subscriptionId,
    $or: [{ status: "skipped" }, { skippedByUser: true }],
  });
  if (session) query.session(session);
  return query;
}

async function enforceSkipAllowanceOrThrow({ subscriptionId, daysToSkip, session }) {
  const parsedDaysToSkip = Number(daysToSkip);
  if (!Number.isInteger(parsedDaysToSkip) || parsedDaysToSkip < 0) {
    const error = new Error("daysToSkip must be an integer >= 0");
    error.code = "INVALID_SKIP_DAYS";
    throw error;
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
      { $set: { status: "skipped", skippedByUser: !allowLocked, creditsDeducted: true } },
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
    await SubscriptionDay.updateOne(
      { _id: dayUpdateResult._id },
      {
        $set: {
          status: existingDay?.status || "open",
          skippedByUser: existingDay?.skippedByUser || false,
          creditsDeducted: false,
        },
      },
      { session }
    ).session(session);
    return { status: "insufficient_credits" };
  }

  // BUSINESS RULE: Skip does not add compensation days; it only marks the day skipped and deducts credits.
  sub.skippedCount = (sub.skippedCount || 0) + 1;
  await sub.save({ session });

  return { status: "skipped", day: dayUpdateResult };
}

module.exports = { applySkipForDate, enforceSkipAllowanceOrThrow };
