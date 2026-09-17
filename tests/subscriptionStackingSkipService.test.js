"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const {
  assertDateCanChange,
  assertDayCanBeSkipped,
  assertDayCanBeUnskipped,
  assertSkipPolicyAvailable,
  performStackingSkipDay,
  performStackingUnskipDay,
} = require("../src/services/subscription/subscriptionStackingSkipService");

function transactionalSession(events) {
  let active = false;
  return {
    supportsTransactions: true,
    startTransaction() {
      active = true;
      events.push("transaction:start");
    },
    inTransaction() {
      return active;
    },
    async commitTransaction() {
      events.push("transaction:commit");
      active = false;
    },
    async abortTransaction() {
      events.push("transaction:abort");
      active = false;
    },
    async endSession() {
      events.push("session:end");
    },
  };
}

function subscription(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    status: "active",
    startDate: new Date("2026-08-01T00:00:00+03:00"),
    endDate: new Date("2026-08-26T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-31T00:00:00+03:00"),
    skipDaysUsed: 0,
    planId: { _id: new mongoose.Types.ObjectId() },
    ...overrides,
  };
}

function openDay(sub, overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    subscriptionId: sub._id,
    date: "2026-08-10",
    status: "open",
    skipCompensated: false,
    ...overrides,
  };
}

function baseRuntime({ sub, day, events, policy = { enabled: true, maxDays: 5 } }) {
  const session = transactionalSession(events);
  return {
    startSession: async () => session,
    getTomorrow: async () => "2026-08-10",
    getBusinessDate: async () => "2026-08-09",
    assertCutoff: async () => events.push("cutoff:allowed"),
    findSubscription: async () => {
      events.push("subscription:loaded");
      return sub;
    },
    findDay: async () => {
      events.push("day:loaded");
      return day;
    },
    resolveSkipPolicy: () => policy,
    releaseDay: async () => {
      events.push("allocations:released");
      return { handled: true, changedCount: 5 };
    },
    reopenDay: async () => {
      events.push("allocations:reopened");
      return { handled: true, changedCount: 5 };
    },
    applyCompensation: async () => {
      events.push("compensation:applied");
      return {
        applied: true,
        idempotent: false,
        tokenResults: [{ sourceKey: "token-1" }],
        lifecycle: {
          container: { ...sub, validityEndDate: new Date("2026-09-01T00:00:00+03:00") },
        },
      };
    },
    revokeCompensation: async () => {
      events.push("compensation:revoked");
      return {
        revoked: true,
        idempotent: false,
        tokenResults: [{ sourceKey: "token-1" }],
        lifecycle: {
          container: { ...sub, validityEndDate: new Date("2026-08-31T00:00:00+03:00") },
        },
      };
    },
    incrementSkipUsage: async () => {
      events.push("usage:incremented");
      sub.skipDaysUsed += 1;
      return sub;
    },
    decrementSkipUsage: async () => {
      events.push("usage:decremented");
      if (sub.skipDaysUsed < 1) return null;
      sub.skipDaysUsed -= 1;
      return sub;
    },
    markDaySkipped: async () => {
      events.push("day:skipped");
      day.status = "skipped";
      day.skipCompensated = true;
      return day;
    },
    createSkippedDay: async () => {
      events.push("day:created-skipped");
      return openDay(sub, { status: "skipped", skipCompensated: true });
    },
    markDayOpen: async () => {
      events.push("day:opened");
      day.status = "open";
      day.skipCompensated = false;
      return day;
    },
  };
}

function testPureGuards() {
  assert.doesNotThrow(() => assertDateCanChange({
    date: "2026-08-10",
    tomorrow: "2026-08-10",
  }));
  assert.throws(
    () => assertDateCanChange({ date: "2026-08-09", tomorrow: "2026-08-10" }),
    (err) => Boolean(err && err.code === "INVALID_DATE")
  );
  assert.throws(
    () => assertSkipPolicyAvailable({ enabled: false, maxDays: 5 }, { skipDaysUsed: 0 }),
    (err) => Boolean(err && err.code === "SKIP_DISABLED")
  );
  assert.throws(
    () => assertSkipPolicyAvailable({ enabled: true, maxDays: 2 }, { skipDaysUsed: 2 }),
    (err) => Boolean(err && err.code === "PLAN_LIMIT_REACHED")
  );
  assert.throws(
    () => assertDayCanBeSkipped({ status: "frozen" }),
    (err) => Boolean(err && err.code === "DAY_FROZEN")
  );
  assert.throws(
    () => assertDayCanBeUnskipped({ status: "skipped", skipCompensated: false }),
    (err) => Boolean(err && err.code === "STACKING_SKIP_COMPENSATION_MISSING")
  );
}

async function testSkipRunsAllMutationsAtomicallyInOrder() {
  const events = [];
  const sub = subscription();
  const day = openDay(sub);
  const runtime = baseRuntime({ sub, day, events });

  const result = await performStackingSkipDay({
    userId: sub.userId,
    subscriptionId: sub._id,
    date: "2026-08-10",
    runtime,
  });

  assert.strictEqual(result.status, "skipped");
  assert.strictEqual(result.idempotent, false);
  assert.strictEqual(result.day.status, "skipped");
  assert.strictEqual(result.subscription.skipDaysUsed, 1);
  assert.deepStrictEqual(events, [
    "cutoff:allowed",
    "transaction:start",
    "subscription:loaded",
    "day:loaded",
    "allocations:released",
    "compensation:applied",
    "usage:incremented",
    "day:skipped",
    "transaction:commit",
    "session:end",
  ]);
}

async function testSkippingMissingDayCreatesItWithoutFakeAllocation() {
  const events = [];
  const sub = subscription();
  const runtime = baseRuntime({ sub, day: null, events });
  runtime.releaseDay = async ({ day }) => {
    events.push(`allocations:release:${day.date}`);
    return { handled: false, changedCount: 0 };
  };

  const result = await performStackingSkipDay({
    userId: sub.userId,
    subscriptionId: sub._id,
    date: "2026-08-10",
    runtime,
  });
  assert.strictEqual(result.day.status, "skipped");
  assert(events.includes("day:created-skipped"));
  assert(events.includes("allocations:release:2026-08-10"));
}

async function testRepeatedSkipRepairsIdempotentlyWithoutUsageIncrement() {
  const events = [];
  const sub = subscription({ skipDaysUsed: 1 });
  const day = openDay(sub, { status: "skipped", skipCompensated: true });
  const runtime = baseRuntime({ sub, day, events });
  runtime.applyCompensation = async () => {
    events.push("compensation:checked");
    return {
      applied: true,
      idempotent: true,
      tokenResults: [{ sourceKey: "token-1", changed: false }],
      lifecycle: { container: sub },
    };
  };

  const result = await performStackingSkipDay({
    userId: sub.userId,
    subscriptionId: sub._id,
    date: "2026-08-10",
    runtime,
  });
  assert.strictEqual(result.status, "already_skipped");
  assert.strictEqual(result.idempotent, true);
  assert.strictEqual(sub.skipDaysUsed, 1);
  assert.strictEqual(events.includes("usage:incremented"), false);
  assert.strictEqual(events.includes("day:skipped"), false);
}

async function testPlanLimitFailsBeforeAnyBalanceMutation() {
  const events = [];
  const sub = subscription({ skipDaysUsed: 2 });
  const day = openDay(sub);
  const runtime = baseRuntime({
    sub,
    day,
    events,
    policy: { enabled: true, maxDays: 2 },
  });

  await assert.rejects(
    () => performStackingSkipDay({
      userId: sub.userId,
      subscriptionId: sub._id,
      date: "2026-08-10",
      runtime,
    }),
    (err) => Boolean(err && err.code === "PLAN_LIMIT_REACHED")
  );
  assert.strictEqual(events.includes("allocations:released"), false);
  assert.strictEqual(events.includes("compensation:applied"), false);
  assert(events.includes("transaction:abort"));
  assert.strictEqual(events[events.length - 1], "session:end");
}

async function testUnskipReacquiresThenRevokesCompensationAtomically() {
  const events = [];
  const sub = subscription({ skipDaysUsed: 1 });
  const day = openDay(sub, { status: "skipped", skipCompensated: true });
  const runtime = baseRuntime({ sub, day, events });

  const result = await performStackingUnskipDay({
    userId: sub.userId,
    subscriptionId: sub._id,
    date: "2026-08-10",
    runtime,
  });
  assert.strictEqual(result.day.status, "open");
  assert.strictEqual(result.subscription.skipDaysUsed, 0);
  assert.deepStrictEqual(events, [
    "cutoff:allowed",
    "transaction:start",
    "subscription:loaded",
    "day:loaded",
    "allocations:reopened",
    "compensation:revoked",
    "usage:decremented",
    "day:opened",
    "transaction:commit",
    "session:end",
  ]);
}

async function testUnskipMissingTokenAbortsEverything() {
  const events = [];
  const sub = subscription({ skipDaysUsed: 1 });
  const day = openDay(sub, { status: "skipped", skipCompensated: true });
  const runtime = baseRuntime({ sub, day, events });
  runtime.revokeCompensation = async () => {
    events.push("compensation:missing");
    return { revoked: true, idempotent: true, tokenResults: [] };
  };

  await assert.rejects(
    () => performStackingUnskipDay({
      userId: sub.userId,
      subscriptionId: sub._id,
      date: "2026-08-10",
      runtime,
    }),
    (err) => Boolean(err && err.code === "STACKING_SKIP_COMPENSATION_MISSING")
  );
  assert(events.includes("allocations:reopened"));
  assert(events.includes("transaction:abort"));
  assert.strictEqual(events.includes("usage:decremented"), false);
  assert.strictEqual(events.includes("day:opened"), false);
}

async function testCutoffFailureStartsNoTransaction() {
  const events = [];
  const sub = subscription();
  const runtime = baseRuntime({ sub, day: openDay(sub), events });
  runtime.assertCutoff = async () => {
    const err = new Error("cutoff passed");
    err.code = "CUTOFF_PASSED";
    throw err;
  };

  await assert.rejects(
    () => performStackingSkipDay({
      userId: sub.userId,
      subscriptionId: sub._id,
      date: "2026-08-10",
      runtime,
    }),
    (err) => Boolean(err && err.code === "CUTOFF_PASSED")
  );
  assert.strictEqual(events.includes("transaction:start"), false);
}

async function run() {
  testPureGuards();
  await testSkipRunsAllMutationsAtomicallyInOrder();
  await testSkippingMissingDayCreatesItWithoutFakeAllocation();
  await testRepeatedSkipRepairsIdempotentlyWithoutUsageIncrement();
  await testPlanLimitFailsBeforeAnyBalanceMutation();
  await testUnskipReacquiresThenRevokesCompensationAtomically();
  await testUnskipMissingTokenAbortsEverything();
  await testCutoffFailureStartsNoTransaction();
  console.log("subscription stacking skip service tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
