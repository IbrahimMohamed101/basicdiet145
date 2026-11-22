"use strict";

/**
 * Loads everything the meal-ledger reconciliation needs for the current
 * subscriptions and runs it. Read-only: only find queries.
 *
 * It is shared by scripts/reconcile-meal-balances.js and the daily alert scan,
 * so both always judge a subscription with exactly the same data and rules.
 */

const dateUtils = require("../../utils/date");
const ActivityLog = require("../../models/ActivityLog");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionEntitlementAllocation = require("../../models/SubscriptionEntitlementAllocation");
const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const User = require("../../models/User");
const {
  DAILY_DEDUCTION_ACTION,
  DELIVERY_BATCH_JOURNAL,
  HISTORICAL_DELIVERY_BATCH_JOURNAL,
  MANUAL_BATCH_JOURNAL,
  MANUAL_DEDUCTION_ACTION,
  MANUAL_DEDUCTION_REVERSAL_ACTION,
  SAME_DAY_EXTRA_ACTION,
} = require("../dashboard/manualDeduction/constants");
const {
  EXCESS_CORRECTION_ACTION,
  reconcileSubscriptionMealLedger,
} = require("./subscriptionMealLedgerReconciliationService");

function group(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = String(keyFn(row) || "");
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

/**
 * @param {object} options
 * @param {string} [options.subscriptionId]  check just this subscription (ended ones included)
 * @param {boolean} [options.allStatuses]    include non-active statuses
 * @param {boolean} [options.includeEnded]   include subscriptions whose validity already ended
 * @param {Date} [options.now]
 */
async function loadReconciliationReports({
  subscriptionId = null,
  allStatuses = false,
  includeEnded = false,
  now = new Date(),
} = {}) {
  const query = {};
  if (subscriptionId) query._id = subscriptionId;
  if (!allStatuses) query.status = "active";
  const allMatching = await Subscription.find(query).lean();
  // Current subscriptions only: a subscription whose validity already ended is
  // history even if its status was never moved off "active".
  const today = dateUtils.getTodayKSADate(now);
  const hasEnded = (row) => {
    const end = row.validityEndDate || row.endDate;
    return Boolean(end) && dateUtils.toKSADateString(end) < today;
  };
  const keepEnded = includeEnded || Boolean(subscriptionId);
  const skippedEnded = keepEnded ? 0 : allMatching.filter(hasEnded).length;
  const subscriptions = keepEnded ? allMatching : allMatching.filter((row) => !hasEnded(row));
  const ids = subscriptions.map((row) => row._id);

  const [days, stacked, batches, logs, users] = await Promise.all([
    SubscriptionDay.find({ subscriptionId: { $in: ids } })
      .select("subscriptionId date status creditsDeducted fulfilledSnapshot plannerMeta planningMeta lockedSnapshot")
      .lean(),
    SubscriptionEntitlementAllocation.find({ containerSubscriptionId: { $in: ids } })
      .select("containerSubscriptionId date allocationKey state quantity")
      .lean(),
    SubscriptionEntitlementBatch.find({ containerSubscriptionId: { $in: ids }, applicationState: "applied" })
      .select([
        "containerSubscriptionId",
        `metadata.${MANUAL_BATCH_JOURNAL}`,
        `metadata.${DELIVERY_BATCH_JOURNAL}`,
        `metadata.${HISTORICAL_DELIVERY_BATCH_JOURNAL}`,
        "status applicationState totalMeals remainingMeals reservedMeals consumedMeals forfeitedMeals",
        "effectiveStartDate validityEndDate activatedAt exhaustedAt expiredAt",
      ].join(" "))
      .lean(),
    ActivityLog.find({
      entityType: "subscription",
      entityId: { $in: ids },
      action: {
        $in: [
          MANUAL_DEDUCTION_ACTION,
          DAILY_DEDUCTION_ACTION,
          MANUAL_DEDUCTION_REVERSAL_ACTION,
          EXCESS_CORRECTION_ACTION,
          SAME_DAY_EXTRA_ACTION,
        ],
      },
    }).sort({ createdAt: 1 }).lean(),
    User.find({ _id: { $in: subscriptions.map((row) => row.userId).filter(Boolean) } })
      .select("name phone phoneE164").lean(),
  ]);

  // Meals given back by legacy pickup releases leave the consumed counter, so
  // they must leave the evidence too. Keys look like "pickup_release:<requestId>".
  const releaseKeyIds = subscriptions.flatMap((row) => (row.legacyMealBalanceOperationKeys || [])
    .map((key) => /^pickup_release:([0-9a-f]{24})$/i.exec(String(key)))
    .filter(Boolean).map((match) => match[1]));
  const pickupRequests = releaseKeyIds.length
    ? await SubscriptionPickupRequest.find({ _id: { $in: releaseKeyIds } }).select("mealCount status").lean()
    : [];
  const pickupRequestById = new Map(pickupRequests.map((row) => [String(row._id), row]));
  const releasesFor = (subscription) => (subscription.legacyMealBalanceOperationKeys || [])
    .map((key) => /^pickup_release:([0-9a-f]{24})$/i.exec(String(key)))
    .filter(Boolean)
    .map((match) => ({ id: match[1], request: pickupRequestById.get(match[1]) || null }));

  const daysBySub = group(days, (row) => row.subscriptionId);
  const stackedBySub = group(stacked, (row) => row.containerSubscriptionId);
  const batchesBySub = group(batches, (row) => row.containerSubscriptionId);
  const logsBySub = group(logs, (row) => row.entityId);
  const usersById = new Map(users.map((row) => [String(row._id), row]));

  const reports = subscriptions.map((subscription) => {
    const key = String(subscription._id);
    const report = reconcileSubscriptionMealLedger({
      subscription,
      days: daysBySub.get(key) || [],
      stackedAllocations: stackedBySub.get(key) || [],
      batches: batchesBySub.get(key) || [],
      deductionLogs: logsBySub.get(key) || [],
      releasedMeals: releasesFor(subscription)
        .reduce((sum, release) => sum + Number(release.request && release.request.mealCount || 0), 0),
      now,
    });
    const user = usersById.get(String(subscription.userId)) || {};
    return {
      ...report,
      userId: subscription.userId ? String(subscription.userId) : "",
      customer: user.name || "",
      phone: user.phoneE164 || user.phone || "",
    };
  });

  return { subscriptions, skippedEnded, reports, stackedBySub, batchesBySub, logsBySub, releasesFor };
}

module.exports = { group, loadReconciliationReports };
