"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  createManualDeductionCommandService,
  isExtraBalanceUseConfirmed,
} = require("../src/services/dashboard/manualDeduction/manualDeductionCommandService");
const {
  SAME_DAY_EXTRA_ACTION,
  MANUAL_DEDUCTION_ACTION,
} = require("../src/services/dashboard/manualDeduction/constants");

const subscriptionId = new mongoose.Types.ObjectId();
const customerId = new mongoose.Types.ObjectId();

function legacySubscription(overrides = {}) {
  return {
    _id: subscriptionId,
    userId: customerId,
    status: "active",
    startDate: new Date("2026-08-01T00:00:00.000Z"),
    validityEndDate: new Date("2026-08-30T00:00:00.000Z"),
    deliveryMode: "delivery",
    entitlementVersion: 1,
    totalMeals: 30,
    remainingMeals: 20,
    reservedMeals: 0,
    consumedMeals: 10,
    forfeitedMeals: 0,
    premiumBalance: [],
    addonBalance: [],
    addonSubscriptions: [],
    ...overrides,
  };
}

function makeRepository({ delivered, logs, subscription = legacySubscription() }) {
  return {
    isValidObjectId: (value) => mongoose.isValidObjectId(value),
    findSubscriptionById: async () => subscription,
    customerExists: async () => true,
    findLastManualDeduction: async () => null,
    findFulfilledDeliveryDay: async () => (delivered ? { _id: "day1" } : null),
    deductAtomically: async () => ({ ...subscription, remainingMeals: subscription.remainingMeals - 2, consumedMeals: subscription.consumedMeals + 2 }),
    createDeductionLog: async (log, session) => { logs.push({ log, session }); },
  };
}

function makeService(repository, extra = {}) {
  return createManualDeductionCommandService({
    repository,
    getBusinessDate: async () => "2026-08-03",
    runTransactionWithRetry: async (callback) => callback({ id: "session" }),
    entitlementBatchDetector: async () => false,
    legacyBatchValidityRepair: async () => {},
    ...extra,
  });
}

const call = (service, body) => service.manualDeduction({
  subscriptionId: String(subscriptionId),
  body: { regularMeals: 2, premiumMeals: 0, reason: "cashier_walk_in", ...body },
  actorId: new mongoose.Types.ObjectId(),
  actorRole: "admin",
  idempotencyKey: "same-day-extra-test-0001",
});

async function main() {
  // The flag parser only accepts an explicit true.
  assert.equal(isExtraBalanceUseConfirmed({ confirmExtraBalanceUse: true }), true);
  assert.equal(isExtraBalanceUseConfirmed({ confirmExtraBalanceUse: "true" }), true);
  assert.equal(isExtraBalanceUseConfirmed({ confirmExtraBalanceUse: "yes" }), false);
  assert.equal(isExtraBalanceUseConfirmed({ confirmExtraBalanceUse: 1 }), false);
  assert.equal(isExtraBalanceUseConfirmed({}), false);
  assert.equal(isExtraBalanceUseConfirmed(null), false);

  // 1. Day already delivered, nothing confirmed: the deduction is NOT blocked,
  //    it only carries a warning and writes no marker.
  {
    const logs = [];
    const result = await call(makeService(makeRepository({ delivered: true, logs })), {});
    assert.deepEqual(result.warnings, ["DAY_ALREADY_DELIVERED_TODAY"]);
    assert.equal(result.deducted.total, 2);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].log.action, MANUAL_DEDUCTION_ACTION);
  }

  // 2. Day delivered and the cashier confirms the extra use: no warning and a
  //    marker is written after the deduction committed (never inside it).
  {
    const logs = [];
    const result = await call(makeService(makeRepository({ delivered: true, logs })), { confirmExtraBalanceUse: true });
    assert.equal(result.warnings, undefined);
    assert.equal(logs.length, 2);
    const marker = logs.find((entry) => entry.log.action === SAME_DAY_EXTRA_ACTION);
    assert.ok(marker, "marker log written");
    assert.equal(marker.session, null, "marker is written outside the deduction transaction");
    assert.ok(logs.indexOf(marker) > logs.findIndex((entry) => entry.log.action === MANUAL_DEDUCTION_ACTION),
      "marker comes after the deduction log");
    assert.equal(marker.log.meta.businessDate, "2026-08-03");
    assert.equal(marker.log.meta.confirmed, true);
    assert.equal(marker.log.meta.deductedTotalMeals, 2);
    assert.equal(String(marker.log.entityId), String(subscriptionId));
  }

  // 3. A normal walk-in on a day that was not delivered: no warning, no marker.
  {
    const logs = [];
    const result = await call(makeService(makeRepository({ delivered: false, logs })), {});
    assert.equal(result.warnings, undefined);
    assert.equal(logs.length, 1);
  }

  // 4. Pickup subscriptions never get the delivery warning.
  {
    const logs = [];
    const repo = makeRepository({ delivered: true, logs, subscription: legacySubscription({ deliveryMode: "pickup" }) });
    const result = await call(makeService(repo), {});
    assert.equal(result.warnings, undefined);
  }

  // 5. A repository without the lookup (older wiring) still works.
  {
    const logs = [];
    const repo = makeRepository({ delivered: true, logs });
    delete repo.findFulfilledDeliveryDay;
    const result = await call(makeService(repo), {});
    assert.equal(result.warnings, undefined);
    assert.equal(result.deducted.total, 2);
  }

  // 6. Stacked path: executor result is returned untouched plus the warning,
  //    and the confirmed marker is written after the executor succeeded.
  {
    const logs = [];
    const order = [];
    const repo = makeRepository({ delivered: true, logs });
    const baseCreate = repo.createDeductionLog;
    repo.createDeductionLog = async (log, session) => { order.push("marker"); return baseCreate(log, session); };
    const executed = { subscriptionId: String(subscriptionId), deducted: { total: 2 } };
    const service = makeService(repo, {
      entitlementBatchDetector: async () => true,
      stackedManualDeductionExecutor: async () => { order.push("executor"); return executed; },
    });
    const warned = await call(service, {});
    assert.deepEqual(warned, { ...executed, warnings: ["DAY_ALREADY_DELIVERED_TODAY"] });
    assert.deepEqual(order, ["executor"], "no marker without confirmation");

    const confirmed = await call(service, { confirmExtraBalanceUse: true });
    assert.deepEqual(confirmed, executed);
    assert.deepEqual(order, ["executor", "executor", "marker"], "marker only after a successful deduction");
    assert.equal(logs[0].log.action, SAME_DAY_EXTRA_ACTION);
  }

  // 7. Stacked path: a failing deduction writes no marker at all.
  {
    const logs = [];
    const service = makeService(makeRepository({ delivered: true, logs }), {
      entitlementBatchDetector: async () => true,
      stackedManualDeductionExecutor: async () => { throw new Error("INSUFFICIENT"); },
    });
    await assert.rejects(() => call(service, { confirmExtraBalanceUse: true }), /INSUFFICIENT/);
    assert.equal(logs.length, 0);
  }

  // 8. A marker write failure on the stacked path never undoes a successful deduction.
  {
    const logs = [];
    const repo = makeRepository({ delivered: false, logs });
    repo.createDeductionLog = async () => { throw new Error("db down"); };
    const executed = { deducted: { total: 2 } };
    const service = makeService(repo, {
      entitlementBatchDetector: async () => true,
      stackedManualDeductionExecutor: async () => executed,
    });
    assert.deepEqual(await call(service, { confirmExtraBalanceUse: true }), executed);
  }

  // 9. The deduction can never be blocked by the new code (legacy path).
  //    A failing warning lookup or a failing marker write leaves the deduction
  //    intact; the warning is simply missing.
  {
    const logs = [];
    const repo = makeRepository({ delivered: true, logs });
    repo.findFulfilledDeliveryDay = async () => { throw new Error("lookup failed"); };
    const result = await call(makeService(repo), {});
    assert.equal(result.warnings, undefined);
    assert.equal(result.deducted.total, 2);
    assert.equal(logs.length, 1);
  }
  {
    const logs = [];
    const repo = makeRepository({ delivered: true, logs });
    const base = repo.createDeductionLog;
    repo.createDeductionLog = async (log, session) => {
      if (log.action === SAME_DAY_EXTRA_ACTION) throw new Error("marker write failed");
      return base(log, session);
    };
    const result = await call(makeService(repo), { confirmExtraBalanceUse: true });
    assert.equal(result.deducted.total, 2);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].log.action, MANUAL_DEDUCTION_ACTION);
  }

  // 10. Stacked path: a failing warning lookup never turns a successful
  //     deduction into an error.
  {
    const logs = [];
    const repo = makeRepository({ delivered: true, logs });
    repo.findFulfilledDeliveryDay = async () => { throw new Error("lookup failed"); };
    const executed = { deducted: { total: 2 } };
    const service = makeService(repo, {
      entitlementBatchDetector: async () => true,
      stackedManualDeductionExecutor: async () => executed,
    });
    assert.deepEqual(await call(service, {}), executed);
  }

  // 11. A failed deduction (insufficient balance) still fails and writes no
  //     marker or warning.
  {
    const logs = [];
    const repo = makeRepository({ delivered: true, logs });
    repo.deductAtomically = async () => { throw new Error("INSUFFICIENT"); };
    await assert.rejects(() => call(makeService(repo), { confirmExtraBalanceUse: true }), /INSUFFICIENT/);
    assert.equal(logs.length, 0);
  }

  console.log("manualDeductionSameDayExtra tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
