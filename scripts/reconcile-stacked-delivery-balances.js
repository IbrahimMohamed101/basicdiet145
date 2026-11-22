#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const { parseArgs } = require("node:util");
const mongoose = require("mongoose");
const Delivery = require("../src/models/Delivery");
const Subscription = require("../src/models/Subscription");
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Batch = require("../src/models/SubscriptionEntitlementBatch");
const Allocation = require("../src/models/SubscriptionEntitlementAllocation");
const {
  isBatchProjectableOnDate,
  normalizeDateString,
} = require("../src/services/subscription/subscriptionEntitlementProjectionService");

const {
  HISTORICAL_DELIVERY_BATCH_JOURNAL: JOURNAL,
  DELIVERY_BATCH_JOURNAL,
} = require("../src/services/dashboard/manualDeduction/constants");
const COUNTERS = ["totalMeals", "remainingMeals", "reservedMeals", "consumedMeals", "forfeitedMeals"];

function counters(row) {
  return Object.fromEntries(COUNTERS.map((key) => [key, row[key] ?? 0]));
}

function balanced(balance) {
  const { totalMeals, remainingMeals, reservedMeals, consumedMeals, forfeitedMeals } = balance;
  return COUNTERS.every((key) => Number.isSafeInteger(balance[key]) && balance[key] >= 0)
    && totalMeals === remainingMeals + reservedMeals + consumedMeals + forfeitedMeals;
}

function belongsToBatch(batch, date) {
  return batch.applicationState === "applied"
    && isBatchProjectableOnDate(batch, date, { historicalLifecycle: true });
}

function findDrift(subscription, batches) {
  const validity = normalizeDateString(subscription.validityEndDate || subscription.endDate);
  const parentBalance = counters(subscription);
  if (!validity || !balanced(parentBalance) || !["active", "expired"].includes(subscription.status)) return null;

  // The parent may mirror several overlapping batches. Only a single, applied
  // batch with matching validity and accounting can be repaired automatically.
  const current = batches.filter((batch) => belongsToBatch(batch, validity));
  if (current.length !== 1) return null;
  const [batch] = current;
  const batchBalance = counters(batch);
  const missingMeals = parentBalance.consumedMeals - batchBalance.consumedMeals;
  if (
    batch.sourceType === "legacy_seed"
    || String(batch.userId) !== String(subscription.userId)
    || String(batch.deliverySnapshot?.mode || batch.deliverySnapshot?.type) !== "delivery"
    || normalizeDateString(batch.validityEndDate || batch.endDate) !== validity
    || !balanced(batchBalance)
    || parentBalance.totalMeals !== batchBalance.totalMeals
    || parentBalance.reservedMeals !== batchBalance.reservedMeals
    || parentBalance.forfeitedMeals !== batchBalance.forfeitedMeals
    || missingMeals <= 0
    || batchBalance.remainingMeals - parentBalance.remainingMeals !== missingMeals
  ) return null;

  return { batch, batchBalance, parentBalance, missingMeals };
}

function historicalDeliveries({ subscription, batches, drift, deliveries, days, allocations, audits }) {
  const { batch } = drift;
  const daysById = new Map(days.map((day) => [String(day._id), day]));
  const confirmed = new Set(audits.map((audit) => String(audit.entityId)));
  const allocatedDays = new Set(allocations.map((row) => String(row.subscriptionDayId)));
  const allocatedDates = new Set(allocations.map((row) => row.date));
  const baseDays = new Set((subscription.baseMealAllocations || []).map((row) => String(row.dayId)));
  const journaledDays = new Set(batches.flatMap((row) => [
    ...(row.metadata?.[DELIVERY_BATCH_JOURNAL] || []).map((entry) => String(entry.idempotencyKey)),
    ...(row.metadata?.[JOURNAL] || []).flatMap((entry) => entry.deliveries.map(({ dayId }) => dayId)),
  ]));

  const seenDays = new Set();
  const movements = [];
  for (const delivery of deliveries) {
    const dayId = String(delivery.dayId);
    const day = daysById.get(dayId);
    if (
      !day || day.date !== delivery.date || !delivery.deliveredAt || !day.fulfilledAt
      || !confirmed.has(dayId) || journaledDays.has(dayId)
      || allocatedDays.has(dayId) || allocatedDates.has(day.date)
      || baseDays.has(dayId) || day.baseAllocationKeys?.length
    ) continue;

    const owners = batches.filter((row) => belongsToBatch(row, day.date));
    const quantity = day.fulfilledSnapshot?.deductedCredits;
    if (
      owners.length !== 1 || String(owners[0]._id) !== String(batch._id)
      || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > batch.mealsPerDay
    ) continue;

    if (seenDays.has(dayId)) return [];
    seenDays.add(dayId);
    movements.push({ dayId, deliveryId: String(delivery._id), date: day.date, quantity });
  }
  return movements.sort((left, right) => left.date.localeCompare(right.date));
}

async function inspectSubscription(subscription, batches) {
  const drift = findDrift(subscription, batches);
  if (!drift) return { outcome: "no-reconcilable-drift" };

  const date = {
    $gte: normalizeDateString(drift.batch.effectiveStartDate),
    $lte: normalizeDateString(drift.batch.validityEndDate || drift.batch.endDate),
  };
  const deliveries = await Delivery.find({
    subscriptionId: subscription._id, status: "delivered", date, dayId: { $ne: null },
  }).select("_id dayId date deliveredAt").lean();
  const dayIds = deliveries.map((delivery) => delivery.dayId);
  const [days, allocations, audits] = await Promise.all([
    SubscriptionDay.find({
      _id: { $in: dayIds }, subscriptionId: subscription._id, status: "fulfilled", creditsDeducted: true,
    }).select("_id date fulfilledAt fulfilledSnapshot.deductedCredits baseAllocationKeys").lean(),
    Allocation.find({
      containerSubscriptionId: subscription._id,
      $or: [{ date }, { subscriptionDayId: { $in: dayIds } }],
    }).select("date subscriptionDayId").lean(),
    SubscriptionAuditLog.find({
      entityType: "subscription_day", entityId: { $in: dayIds },
      toStatus: "fulfilled", fromStatus: { $in: ["ready_for_delivery", "out_for_delivery"] },
    }).select("entityId").lean(),
  ]);
  const movements = historicalDeliveries({ subscription, batches, drift, deliveries, days, allocations, audits });
  const quantity = movements.reduce((sum, row) => sum + row.quantity, 0);

  if (quantity !== drift.missingMeals) {
    return {
      outcome: "evidence-does-not-close-gap",
      batchId: String(drift.batch._id),
      expected: drift.missingMeals,
      evidenced: quantity,
    };
  }

  return {
    outcome: "reconcilable",
    batch: drift.batch,
    quantity,
    before: drift.batchBalance,
    after: drift.parentBalance,
    deliveries: movements,
  };
}

async function applyCorrection(subscription, plan) {
  const { batch, before, after, deliveries, quantity } = plan;
  const key = crypto.createHash("sha256").update(JSON.stringify(deliveries.map(({ dayId }) => dayId))).digest("hex");
  const journal = { key, before, after, deliveries, quantity, reconciledAt: new Date() };
  const metadata = batch.metadata || {};
  const changed = await Batch.updateOne({
    _id: batch._id,
    containerSubscriptionId: subscription._id,
    userId: subscription.userId,
    applicationState: "applied",
    status: batch.status,
    stackVersion: batch.stackVersion,
    updatedAt: batch.updatedAt,
    remainingMeals: before.remainingMeals,
    consumedMeals: before.consumedMeals,
    [`metadata.${JOURNAL}.key`]: { $ne: key },
  }, {
    $set: {
      remainingMeals: after.remainingMeals,
      consumedMeals: after.consumedMeals,
      metadata: { ...metadata, [JOURNAL]: [...(metadata[JOURNAL] || []), journal] },
      ...(after.remainingMeals === 0 && after.reservedMeals === 0 && batch.status === "active"
        ? { status: "exhausted", exhaustedAt: journal.reconciledAt }
        : {}),
    },
    $inc: { stackVersion: 1 },
  });

  if (changed.modifiedCount !== 1) {
    throw new Error("Package changed during reconciliation. Review a fresh dry run.");
  }

  const saved = await Batch.findById(batch._id).select(`remainingMeals consumedMeals metadata.${JOURNAL}`).lean();
  if (!saved?.metadata?.[JOURNAL]?.some((entry) => entry.key === key)) {
    throw new Error("The reconciliation could not be verified after writing.");
  }
  return { applied: true, journalKey: key, remainingMeals: saved.remainingMeals, consumedMeals: saved.consumedMeals };
}

async function main() {
  const { values } = parseArgs({
    options: {
      "subscription-id": { type: "string" },
      "expected-meals": { type: "string" },
      apply: { type: "boolean" },
    },
  });
  const subscriptionId = values["subscription-id"];
  const expected = Number(values["expected-meals"]);
  if (subscriptionId && !/^[a-f0-9]{24}$/i.test(subscriptionId)) throw new Error("Invalid subscription ID.");
  if (values.apply && (!subscriptionId || !Number.isSafeInteger(expected) || expected <= 0)) {
    throw new Error("--apply requires --subscription-id and the reviewed --expected-meals.");
  }
  if (!process.env.MONGO_URI) throw new Error("Set MONGO_URI to the intended environment's database.");
  await mongoose.connect(process.env.MONGO_URI, {
    autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 10000,
  });
  const ids = subscriptionId
    ? [subscriptionId]
    : await Batch.distinct("containerSubscriptionId", { applicationState: "applied" });
  const subscriptions = Subscription.find({ _id: { $in: ids } })
    .select("_id userId status endDate validityEndDate totalMeals remainingMeals reservedMeals consumedMeals forfeitedMeals baseMealAllocations.dayId")
    .lean().cursor();
  let scanned = 0;
  for await (const subscription of subscriptions) {
    scanned += 1;
    const batches = await Batch.find({ containerSubscriptionId: subscription._id, applicationState: "applied" }).lean();
    const plan = await inspectSubscription(subscription, batches);
    const { batch, ...report } = plan;
    const result = { subscriptionId: String(subscription._id), batchId: batch ? String(batch._id) : undefined, ...report };
    if (values.apply) {
      if (plan.outcome !== "reconcilable" || plan.quantity !== expected) {
        if (plan.outcome === "no-reconcilable-drift" && batches.some((row) =>
          row.metadata?.[JOURNAL]?.some((entry) => entry.quantity === expected))) {
          console.log(JSON.stringify({ ...result, outcome: "already-reconciled" }));
          return;
        }
        throw new Error(`Live evidence does not match requested reconciliation: ${JSON.stringify(result)}`);
      }
      Object.assign(result, await applyCorrection(subscription, plan));
    }
    if (subscriptionId || plan.outcome !== "no-reconcilable-drift") console.log(JSON.stringify(result));
  }
  if (subscriptionId && scanned === 0) throw new Error("Subscription was not found.");
  if (!subscriptionId) console.log(JSON.stringify({ scannedSubscriptions: scanned }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  }).finally(() => mongoose.disconnect());
}

module.exports = { inspectSubscription, applyCorrection };
