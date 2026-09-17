"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const { startSafeSession } = require("../../utils/mongoTransactionSupport");
const {
  checkEntitlementInvariants,
  transitionAllocation,
} = require("./subscriptionMealEntitlementService");

function serviceError(code, message, status = 409, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function clean(value) {
  if (value === undefined || value === null) return "";
  try {
    if (value && typeof value === "object" && typeof value.toHexString === "function") {
      return String(value.toHexString()).trim();
    }
    return String(value).trim();
  } catch (_error) {
    return "";
  }
}

function rowTime(row) {
  const value = row && (row.reservedAt || row.createdAt || row._id);
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function groupReservedDayRows(subscription, day) {
  const groups = new Map();
  for (const row of Array.isArray(subscription && subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : []) {
    if (clean(row && row.dayId) !== clean(day && day._id)) continue;
    if (clean(row && row.state) !== "reserved") continue;
    const slotKey = clean(row && row.slotKey);
    if (!slotKey) continue;
    const rows = groups.get(slotKey) || [];
    rows.push(row);
    groups.set(slotKey, rows);
  }
  return groups;
}

function chooseKeeper(rows, day) {
  const currentKeys = new Set(
    (Array.isArray(day && day.baseAllocationKeys) ? day.baseAllocationKeys : [])
      .map(clean)
      .filter(Boolean)
  );
  const referenced = rows.filter((row) => currentKeys.has(clean(row && row.allocationKey)));
  if (referenced.length === 1) return referenced[0];

  const revision = clean(day && day.plannerRevisionHash);
  if (revision) {
    const revisionMatches = rows.filter((row) => clean(row && row.plannerRevisionHash) === revision);
    if (revisionMatches.length === 1) return revisionMatches[0];
  }

  return [...rows].sort((left, right) => {
    const timeDelta = rowTime(right) - rowTime(left);
    if (timeDelta !== 0) return timeDelta;
    return clean(right && right.allocationKey).localeCompare(clean(left && left.allocationKey));
  })[0];
}

function buildDuplicateMealAllocationRepairPlan({ subscription, day } = {}) {
  if (!subscription || !day) {
    throw serviceError("INVALID_ARGUMENTS", "Subscription and subscription day are required", 400);
  }

  const groups = groupReservedDayRows(subscription, day);
  const duplicateGroups = [];
  const keeperKeys = [];
  const releaseKeys = [];

  for (const [slotKey, rows] of groups.entries()) {
    const keeper = chooseKeeper(rows, day);
    if (!keeper || !clean(keeper.allocationKey)) {
      throw serviceError("UNSAFE_DUPLICATE_REPAIR", "Could not choose a keeper allocation", 409, { slotKey });
    }
    keeperKeys.push(clean(keeper.allocationKey));
    if (rows.length <= 1) continue;

    const duplicates = rows.filter((row) => clean(row.allocationKey) !== clean(keeper.allocationKey));
    duplicateGroups.push({
      slotKey,
      keeperAllocationKey: clean(keeper.allocationKey),
      keeperPlannerRevisionHash: clean(keeper.plannerRevisionHash),
      duplicateAllocationKeys: duplicates.map((row) => clean(row.allocationKey)),
      duplicatePlannerRevisionHashes: duplicates.map((row) => clean(row.plannerRevisionHash)),
    });
    releaseKeys.push(...duplicates.map((row) => clean(row.allocationKey)));
  }

  const allDayRows = (Array.isArray(subscription.baseMealAllocations) ? subscription.baseMealAllocations : [])
    .filter((row) => clean(row && row.dayId) === clean(day._id));
  const unsafeRows = allDayRows.filter((row) => (
    clean(row.state) !== "reserved"
      && duplicateGroups.some((group) => group.slotKey === clean(row.slotKey))
  ));
  if (unsafeRows.length) {
    throw serviceError(
      "UNSAFE_DUPLICATE_REPAIR",
      "Duplicate slot history contains non-reserved allocations and cannot be repaired automatically",
      409,
      {
        rows: unsafeRows.map((row) => ({
          allocationKey: clean(row.allocationKey),
          slotKey: clean(row.slotKey),
          state: clean(row.state),
        })),
      }
    );
  }

  return {
    subscriptionId: clean(subscription._id),
    dayId: clean(day._id),
    date: clean(day.date),
    before: {
      totalMeals: Number(subscription.totalMeals || 0),
      remainingMeals: Number(subscription.remainingMeals || 0),
      reservedMeals: Number(subscription.reservedMeals || 0),
      consumedMeals: Number(subscription.consumedMeals || 0),
      forfeitedMeals: Number(subscription.forfeitedMeals || 0),
      invariant: checkEntitlementInvariants(subscription),
    },
    duplicateGroupCount: duplicateGroups.length,
    duplicateReservationCount: releaseKeys.length,
    duplicateGroups,
    keeperAllocationKeys: [...new Set(keeperKeys.filter(Boolean))],
    releaseAllocationKeys: [...new Set(releaseKeys.filter(Boolean))],
    expectedAfter: {
      remainingMeals: Number(subscription.remainingMeals || 0) + releaseKeys.length,
      reservedMeals: Number(subscription.reservedMeals || 0) - releaseKeys.length,
      consumedMeals: Number(subscription.consumedMeals || 0),
    },
  };
}

function assertExpected(plan, expected = {}) {
  const checks = [
    ["totalMeals", plan.before.totalMeals, expected.totalMeals],
    ["remainingMeals", plan.before.remainingMeals, expected.remainingMeals],
    ["reservedMeals", plan.before.reservedMeals, expected.reservedMeals],
    ["duplicateReservationCount", plan.duplicateReservationCount, expected.duplicateReservationCount],
  ];
  for (const [field, actual, wanted] of checks) {
    if (wanted === undefined || wanted === null) continue;
    if (Number(actual) !== Number(wanted)) {
      throw serviceError("REPAIR_PRECONDITION_FAILED", `Unexpected ${field}`, 409, {
        field,
        expected: Number(wanted),
        actual: Number(actual),
      });
    }
  }
}

async function loadTarget({ subscriptionId, dayId = null, date = null, session = null } = {}) {
  let subscriptionQuery = Subscription.findById(subscriptionId);
  if (session) subscriptionQuery = subscriptionQuery.session(session);
  const subscription = await subscriptionQuery;
  if (!subscription) throw serviceError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);

  const dayFilter = dayId
    ? { _id: dayId, subscriptionId }
    : { subscriptionId, date };
  let dayQuery = SubscriptionDay.findOne(dayFilter);
  if (session) dayQuery = dayQuery.session(session);
  const day = await dayQuery;
  if (!day) throw serviceError("DAY_NOT_FOUND", "Subscription day not found", 404);
  if (date && clean(day.date) !== clean(date)) {
    throw serviceError("DAY_DATE_MISMATCH", "Subscription day date does not match", 409);
  }
  return { subscription, day };
}

async function repairDuplicateBaseMealAllocations({
  subscriptionId,
  dayId = null,
  date = null,
  apply = false,
  expected = {},
} = {}) {
  if (!subscriptionId || (!dayId && !date)) {
    throw serviceError("INVALID_ARGUMENTS", "subscriptionId and dayId/date are required", 400);
  }

  if (!apply) {
    const { subscription, day } = await loadTarget({ subscriptionId, dayId, date });
    const plan = buildDuplicateMealAllocationRepairPlan({ subscription, day });
    assertExpected(plan, expected);
    return { applied: false, mode: "dry_run", plan };
  }

  const session = await startSafeSession();
  session.startTransaction();
  try {
    const { subscription, day } = await loadTarget({ subscriptionId, dayId, date, session });
    const plan = buildDuplicateMealAllocationRepairPlan({ subscription, day });
    assertExpected(plan, expected);
    if (plan.duplicateReservationCount <= 0) {
      await session.abortTransaction();
      session.endSession();
      return { applied: false, mode: "apply", reason: "no_duplicates", plan };
    }

    for (const allocationKey of plan.releaseAllocationKeys) {
      const result = await transitionAllocation({
        subscriptionId,
        allocationKey,
        toState: "released",
        session,
      });
      if (!result || (!result.changed && !result.alreadyApplied)) {
        throw serviceError("REPAIR_TRANSITION_FAILED", "Duplicate allocation could not be released", 409, {
          allocationKey,
        });
      }
    }

    await SubscriptionDay.updateOne(
      { _id: day._id, subscriptionId },
      {
        $set: {
          baseAllocationKeys: plan.keeperAllocationKeys,
          entitlementTransitionState: "reserved",
        },
      },
      { session }
    );

    const repaired = await Subscription.findById(subscriptionId).session(session).lean();
    const repairedDay = await SubscriptionDay.findById(day._id).session(session).lean();
    const invariant = checkEntitlementInvariants(repaired);
    if (!invariant.valid) {
      throw serviceError("REPAIR_INVARIANT_FAILED", "Meal balance invariant failed after duplicate repair", 409, {
        invariant,
      });
    }
    if (
      Number(repaired.remainingMeals || 0) !== Number(plan.expectedAfter.remainingMeals)
      || Number(repaired.reservedMeals || 0) !== Number(plan.expectedAfter.reservedMeals)
      || Number(repaired.consumedMeals || 0) !== Number(plan.expectedAfter.consumedMeals)
    ) {
      throw serviceError("REPAIR_COUNTER_MISMATCH", "Meal counters did not match the guarded repair plan", 409, {
        expectedAfter: plan.expectedAfter,
        actualAfter: {
          remainingMeals: Number(repaired.remainingMeals || 0),
          reservedMeals: Number(repaired.reservedMeals || 0),
          consumedMeals: Number(repaired.consumedMeals || 0),
        },
      });
    }

    await session.commitTransaction();
    session.endSession();
    return {
      applied: true,
      mode: "apply",
      plan,
      after: {
        totalMeals: Number(repaired.totalMeals || 0),
        remainingMeals: Number(repaired.remainingMeals || 0),
        reservedMeals: Number(repaired.reservedMeals || 0),
        consumedMeals: Number(repaired.consumedMeals || 0),
        forfeitedMeals: Number(repaired.forfeitedMeals || 0),
        baseAllocationKeys: (repairedDay.baseAllocationKeys || []).map(clean),
        invariant,
      },
    };
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    throw error;
  }
}

module.exports = {
  assertExpected,
  buildDuplicateMealAllocationRepairPlan,
  chooseKeeper,
  groupReservedDayRows,
  repairDuplicateBaseMealAllocations,
};
