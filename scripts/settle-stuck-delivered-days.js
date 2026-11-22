#!/usr/bin/env node
"use strict";

/**
 * Settle delivery days that were really delivered but never closed in the system,
 * so their meals stay RESERVED instead of CONSUMED.
 *
 * It does NOT edit counters by hand. It moves the day to ready_for_delivery (when
 * needed) and then runs the same fulfillSubscriptionDay() the dashboard uses, in
 * one Mongo transaction. Right after, it re-reads allocations, batches and the
 * subscription and ABORTS (rolls back) unless the result is exactly:
 *   reserved -> consumed for the day's allocations, remainingMeals unchanged.
 * A settlement is recorded in ActivityLog (subscription_stuck_day_settlement).
 * No customer notification is sent.
 *
 * Default is a DRY RUN that only reads. Writing needs --apply and --reason.
 *
 *   MONGO_URI="<uri>" node scripts/settle-stuck-delivered-days.js \
 *     --subscription-id <id> --date 2026-11-17 [--date 2026-11-11 ...] \
 *     [--reason "تأكيد الموظف: تم التسليم"] [--apply]
 */

const { parseArgs } = require("node:util");
const mongoose = require("mongoose");
const dateUtils = require("../src/utils/date");
const ActivityLog = require("../src/models/ActivityLog");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionEntitlementAllocation = require("../src/models/SubscriptionEntitlementAllocation");
const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");

const SETTLEMENT_ACTION = "subscription_stuck_day_settlement";
const SETTLEABLE_STATUSES = Object.freeze([
  "open", "locked", "in_preparation", "ready_for_delivery", "out_for_delivery",
]);
const READY_STATUSES = Object.freeze(["ready_for_delivery", "out_for_delivery"]);
// Status path used to reach ready_for_delivery, mirroring the kitchen flow.
const PATH_TO_READY = Object.freeze({
  open: ["in_preparation", "ready_for_delivery"],
  locked: ["in_preparation", "ready_for_delivery"],
  in_preparation: ["ready_for_delivery"],
  ready_for_delivery: [],
  out_for_delivery: [],
});

function countByState(allocations) {
  const counts = { reserved: 0, consumed: 0, released: 0, forfeited: 0 };
  for (const row of allocations) {
    if (counts[row.state] !== undefined) counts[row.state] += Number(row.quantity) || 1;
  }
  return counts;
}

function perBatchReserved(allocations) {
  const map = {};
  for (const row of allocations) {
    if (row.state !== "reserved") continue;
    const key = String(row.entitlementBatchId);
    map[key] = (map[key] || 0) + (Number(row.quantity) || 1);
  }
  return map;
}

/**
 * Pure: every allocation that belongs to the day, from both ledgers.
 *  - legacy: subscription.baseMealAllocations (embedded array)
 *  - stacked: SubscriptionEntitlementAllocation collection
 * Matching mirrors the services: linked to the day id OR booked on the day's date.
 */
function dayAllocationRows({ subscription, day, stackedAllocations }) {
  const dayId = String(day._id);
  const keys = new Set(Array.isArray(day.baseAllocationKeys) ? day.baseAllocationKeys : []);
  const rows = [];
  for (const entry of (subscription && subscription.baseMealAllocations) || []) {
    const linked = String(entry.dayId || "") === dayId || keys.has(entry.allocationKey);
    if (linked || String(entry.date) === String(day.date)) {
      rows.push({ source: "legacy", state: entry.state, quantity: 1, linked, allocationKey: entry.allocationKey });
    }
  }
  for (const row of stackedAllocations || []) {
    if (String(row.subscriptionDayId) === dayId || String(row.date) === String(day.date)) {
      rows.push({
        source: "stacked", state: row.state, quantity: Number(row.quantity) || 1, linked: true,
        entitlementBatchId: String(row.entitlementBatchId), allocationKey: row.allocationKey,
      });
    }
  }
  return rows;
}

/** Pure: decide whether a day may be settled and what must happen. Throws if not. */
function planDaySettlement({ subscription, day, allocations, today }) {
  if (!subscription) throw new Error("subscription not found");
  if (!day) throw new Error("day not found");
  if (String(day.subscriptionId) !== String(subscription._id)) throw new Error("day belongs to another subscription");
  if (subscription.status !== "active") throw new Error(`subscription status is ${subscription.status}, expected active`);
  if (subscription.deliveryMode !== "delivery" || day.pickupRequested) {
    throw new Error("only delivery days are supported (this day is pickup)");
  }
  if (day.status === "fulfilled") throw new Error("day is already fulfilled");
  if (!SETTLEABLE_STATUSES.includes(day.status)) throw new Error(`day status ${day.status} cannot be settled`);
  if (!(String(day.date) < String(today))) throw new Error("day is not in the past");

  const forDay = dayAllocationRows({ subscription, day, stackedAllocations: allocations });
  const counts = countByState(forDay);
  if (counts.reserved <= 0) throw new Error("day has no reserved meals to settle");
  if (counts.consumed > 0) throw new Error("day already has consumed meals; manual review needed");
  if (forDay.some((row) => row.state === "reserved" && !row.linked)) {
    throw new Error("a reserved meal is booked on this date but not linked to the day; manual review needed");
  }

  return {
    date: day.date,
    fromStatus: day.status,
    statusPath: PATH_TO_READY[day.status] || [],
    expectedConsumed: counts.reserved,
    legacyReserved: forDay.filter((row) => row.source === "legacy" && row.state === "reserved").length,
    perBatchReserved: perBatchReserved(forDay.filter((row) => row.source === "stacked")),
  };
}

/** Pure: after-state must be exactly reserved -> consumed with nothing else moving. */
function verifySettlement({ plan, before, after }) {
  const problems = [];
  if (after.dayStatus !== "fulfilled") problems.push(`day status is ${after.dayStatus}, expected fulfilled`);
  if (after.allocations.reserved !== 0) problems.push(`${after.allocations.reserved} meals still reserved`);
  if (after.allocations.consumed !== before.allocations.consumed + plan.expectedConsumed) {
    problems.push(`consumed allocations ${before.allocations.consumed} -> ${after.allocations.consumed}, expected +${plan.expectedConsumed}`);
  }
  if (after.subscription.remainingMeals !== before.subscription.remainingMeals) {
    problems.push(`subscription remainingMeals changed ${before.subscription.remainingMeals} -> ${after.subscription.remainingMeals}`);
  }
  if (after.subscription.totalMeals !== before.subscription.totalMeals) {
    problems.push("subscription totalMeals changed");
  }
  if (plan.legacyReserved > 0) {
    const moved = plan.legacyReserved;
    if (after.subscription.reservedMeals !== before.subscription.reservedMeals - moved) {
      problems.push(`subscription reservedMeals ${before.subscription.reservedMeals} -> ${after.subscription.reservedMeals}, expected -${moved}`);
    }
    if (after.subscription.consumedMeals !== before.subscription.consumedMeals + moved) {
      problems.push(`subscription consumedMeals ${before.subscription.consumedMeals} -> ${after.subscription.consumedMeals}, expected +${moved}`);
    }
  }
  for (const [batchId, moved] of Object.entries(plan.perBatchReserved)) {
    const b = before.batches[batchId];
    const a = after.batches[batchId];
    if (!b || !a) { problems.push(`batch ${batchId} missing from snapshot`); continue; }
    if (a.remainingMeals !== b.remainingMeals) problems.push(`batch ${batchId} remainingMeals changed ${b.remainingMeals} -> ${a.remainingMeals}`);
    if (a.reservedMeals !== b.reservedMeals - moved) problems.push(`batch ${batchId} reservedMeals ${b.reservedMeals} -> ${a.reservedMeals}, expected -${moved}`);
    if (a.consumedMeals !== b.consumedMeals + moved) problems.push(`batch ${batchId} consumedMeals ${b.consumedMeals} -> ${a.consumedMeals}, expected +${moved}`);
  }
  return problems;
}

async function takeSnapshot({ subscriptionId, dayId, session }) {
  const opts = session ? { session } : {};
  const [sub, day] = await Promise.all([
    Subscription.findById(subscriptionId, null, opts).lean(),
    SubscriptionDay.findById(dayId, null, opts).lean(),
  ]);
  const clauses = [{ subscriptionDayId: dayId }];
  if (day && day.date) clauses.push({ date: day.date });
  const allocations = await SubscriptionEntitlementAllocation.find(
    { containerSubscriptionId: subscriptionId, $or: clauses }, null, opts
  ).lean();
  const batchIds = [...new Set(allocations.map((row) => String(row.entitlementBatchId)))];
  const batchRows = batchIds.length
    ? await SubscriptionEntitlementBatch.find({ _id: { $in: batchIds } }, null, opts).lean()
    : [];
  const batches = {};
  for (const row of batchRows) {
    batches[String(row._id)] = {
      status: row.status,
      remainingMeals: row.remainingMeals,
      reservedMeals: row.reservedMeals,
      consumedMeals: row.consumedMeals,
    };
  }
  return {
    dayStatus: day && day.status,
    allocations: countByState(day ? dayAllocationRows({ subscription: sub, day, stackedAllocations: allocations }) : []),
    allocationRows: allocations,
    subscription: sub && {
      totalMeals: sub.totalMeals,
      remainingMeals: sub.remainingMeals,
      reservedMeals: sub.reservedMeals,
      consumedMeals: sub.consumedMeals,
    },
    batches,
    sub,
    day,
  };
}

/**
 * The server routes stacked subscriptions to the batch ledger through wrappers
 * that are installed at startup and gated by environment flags. This script runs
 * in its own process, so it installs the same wrappers with the gate forced open.
 * The wrapper still falls back to the legacy path for subscriptions that have no
 * entitlement batch. Nothing outside this process is affected.
 */
function installStackingRouteForThisProcess() {
  const entitlementService = require("../src/services/subscription/subscriptionMealEntitlementService");
  const {
    createStackingEntitlementWrappers,
  } = require("../src/services/subscription/subscriptionStackingEntitlementRouterService");
  const names = [
    "reserveDayEntitlements", "transitionDayEntitlements", "reopenDayEntitlements",
    "transitionAllocation", "reacquireAllocation", "reservePickupEntitlements", "transitionPickupEntitlements",
  ];
  const originals = {};
  for (const name of names) originals[name] = entitlementService[name];
  const wrappers = createStackingEntitlementWrappers(originals, {
    globallyEnabled: () => true,
    writeEnabledForUser: () => true,
  });
  entitlementService.transitionDayEntitlements = wrappers.transitionDayEntitlements;
}

async function settleOne({ subscriptionId, date, reason, apply }) {
  const today = dateUtils.getTodayKSADate(new Date());
  const day = await SubscriptionDay.findOne({ subscriptionId, date }).lean();
  if (!day) throw new Error(`no day ${date} for subscription ${subscriptionId}`);

  const snap = await takeSnapshot({ subscriptionId, dayId: day._id });
  let plan;
  try {
    plan = planDaySettlement({
      subscription: snap.sub, day: snap.day, allocations: snap.allocationRows, today,
    });
  } catch (err) {
    // Show what the day holds so the refusal can be understood without guessing.
    err.detail = {
      dayStatus: snap.day.status,
      counts: snap.allocations,
      rows: dayAllocationRows({ subscription: snap.sub, day: snap.day, stackedAllocations: snap.allocationRows })
        .map((row) => ({ source: row.source, state: row.state, linked: row.linked, key: row.allocationKey })),
    };
    throw err;
  }
  const summary = {
    subscriptionId: String(subscriptionId),
    date,
    plan,
    before: { subscription: snap.subscription, allocations: snap.allocations, batches: snap.batches },
  };
  if (!apply) return { ...summary, applied: false };

  const { runMongoTransactionWithRetry } = require("../src/services/mongoTransactionRetryService");
  const { fulfillSubscriptionDay } = require("../src/services/fulfillmentService");
  installStackingRouteForThisProcess();

  const after = await runMongoTransactionWithRetry(async (session, { transactional }) => {
    if (!transactional) throw new Error("Refusing to write: this database has no transaction support (no rollback).");
    const inTxn = await takeSnapshot({ subscriptionId, dayId: day._id, session });
    // Re-plan inside the transaction so a concurrent change cannot slip through.
    const txnPlan = planDaySettlement({
      subscription: inTxn.sub, day: inTxn.day, allocations: inTxn.allocationRows, today,
    });

    if (!READY_STATUSES.includes(inTxn.day.status)) {
      const moved = await SubscriptionDay.updateOne(
        { _id: day._id, status: inTxn.day.status },
        {
          $set: { status: "ready_for_delivery" },
          $push: { operationAuditLog: { action: "settle_stuck_day_ready", by: "system:meal-ledger", at: new Date() } },
        },
        { session }
      );
      if (moved.modifiedCount !== 1) throw new Error("day changed concurrently; nothing was written");
    }

    const result = await fulfillSubscriptionDay({
      subscriptionId, date, dayId: day._id, session,
      actor: { id: null, role: "system", source: "meal-ledger-settlement" },
    });
    if (!result || result.ok !== true) {
      throw new Error(`fulfillSubscriptionDay failed: ${result && (result.code || result.message)}`);
    }

    const post = await takeSnapshot({ subscriptionId, dayId: day._id, session });
    const problems = verifySettlement({ plan: txnPlan, before: inTxn, after: post });
    if (problems.length) {
      const err = new Error(`Verification failed, rolled back: ${problems.join("; ")}`);
      err.problems = problems;
      throw err;
    }

    await ActivityLog.create([{
      entityType: "subscription",
      entityId: subscriptionId,
      action: SETTLEMENT_ACTION,
      byRole: "system",
      meta: {
        status: "applied",
        date,
        reason,
        fromStatus: inTxn.day.status,
        settledMeals: txnPlan.expectedConsumed,
        before: { subscription: inTxn.subscription, allocations: inTxn.allocations, batches: inTxn.batches },
        after: { subscription: post.subscription, allocations: post.allocations, batches: post.batches },
      },
    }], { session });

    return { subscription: post.subscription, allocations: post.allocations, batches: post.batches };
  }, { label: "settle_stuck_delivered_day", context: { subscriptionId: String(subscriptionId), date } });

  return { ...summary, applied: true, after };
}

async function main() {
  const { values } = parseArgs({
    options: {
      "subscription-id": { type: "string" },
      date: { type: "string", multiple: true },
      reason: { type: "string" },
      apply: { type: "boolean", default: false },
    },
  });
  if (!process.env.MONGO_URI) throw new Error("Set MONGO_URI to the intended environment's database.");
  const subscriptionId = values["subscription-id"];
  if (!subscriptionId || !mongoose.Types.ObjectId.isValid(subscriptionId)) throw new Error("--subscription-id is required and must be a valid ObjectId");
  const dates = values.date || [];
  if (!dates.length || dates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) throw new Error("pass one or more --date YYYY-MM-DD");
  if (values.apply && !String(values.reason || "").trim()) throw new Error("--apply needs --reason (who confirmed delivery and how)");

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const out = [];
    for (const date of dates) {
      try {
        out.push(await settleOne({ subscriptionId, date, reason: values.reason, apply: values.apply }));
      } catch (err) {
        out.push({ subscriptionId, date, error: err.message, detail: err.detail });
        // Stop at the first failure so nothing later is applied on top of it.
        break;
      }
    }
    console.log(JSON.stringify({ mode: values.apply ? "APPLY" : "DRY_RUN", results: out }, null, 2));
    if (out.some((row) => row.error)) process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }
}

module.exports = { SETTLEMENT_ACTION, planDaySettlement, verifySettlement, countByState, dayAllocationRows };

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
