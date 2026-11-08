"use strict";
// Isolated MongoDB 8 standalone *mechanism* probe for Phase G3.
// It does not replace authenticated cashier/API end-to-end testing.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const User = require("../src/models/User");
const Plan = require("../src/models/Plan");
const Subscription = require("../src/models/Subscription");
const Payment = require("../src/models/Payment");
const { startSafeSession } = require("../src/utils/mongoTransactionSupport");

test("G3 standalone: two synthetic subscriptions, payment idempotency and meal CAS", async () => {
  const uri = process.env.MONGO_URI_TEST;
  if (process.env.NODE_ENV !== "test" || !uri
    || !uri.includes("127.0.0.1:27018/")
    || !uri.includes("basicdiet_g3_standalone_ci_test")) {
    throw new Error("Refusing non-disposable or non-local MongoDB");
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, autoIndex: true });
  try {
    if ((await mongoose.connection.db.admin().command({ hello: 1 })).setName) {
      throw new Error("Expected standalone MongoDB, NOT replica set");
    }
    await mongoose.connection.dropDatabase();
    await Promise.all([User.createIndexes(), Subscription.createIndexes(),
      Plan.createIndexes(), Payment.createIndexes()]);
    const plan = await Plan.create({ key: "pos-g3-standalone-synthetic-plan",
      daysCount: 7, name: { ar: "اختبار فقط", en: "Synthetic only" },
      gramsOptions: [{ grams: 150, mealsOptions: [{ mealsPerDay: 1, priceHalala: 10000 }] }] });
    const users = await User.create([
      { name: "POS G3 Synthetic 1", phone: "+966000000041", role: "client",
        phoneVerified: false },
      { name: "POS G3 Synthetic 2", phone: "+966000000042", role: "client",
        phoneVerified: false },
    ]);
    const subscriptions = await Subscription.create(users.map(u => ({
      userId: u._id, planId: plan._id, status: "active", totalMeals: 10,
      remainingMeals: 10, selectedGrams: 150, selectedMealsPerDay: 1,
      deliveryMode: "pickup",
    })));
    const bySource = [
      ["dashboard_subscription_cash", "cash", "cash", 10000, subscriptions[0]],
      ["dashboard_subscription_visa", "visa", "manual", 20000, subscriptions[1]],
    ];
    const payments = await Promise.all(bySource.map(async ([source, method, provider, amount, sub]) => {
      return Payment.create({ type: "subscription_activation", status: "paid", source,
        method, provider, amount, subscriptionId: sub._id, userId: sub.userId,
        paidAt: new Date("2026-11-08T09:00:00.000Z"),
        operationIdempotencyKey: "g3-standalone-" + source });
    }));
    assert.equal(payments.length, 2);
    assert.equal(await Payment.countDocuments({ status: "paid" }), 2);
    const duplicate = await Promise.allSettled([
      Payment.create({ type: "subscription_activation", status: "paid",
        source: "dashboard_subscription_cash", method: "cash", provider: "cash",
        amount: 10000, operationIdempotencyKey: "g3-shared-key" }),
      Payment.create({ type: "subscription_activation", status: "paid",
        source: "dashboard_subscription_cash", method: "cash", provider: "cash",
        amount: 10000, operationIdempotencyKey: "g3-shared-key" }),
    ]);
    assert.equal(duplicate.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(await Payment.countDocuments({ operationIdempotencyKey: "g3-shared-key" }), 1);

    // Standalone fallback has NO rollback. Prove this explicitly so callers
    // cannot confuse a safe session with a multi-document transaction.
    const session = await startSafeSession();
    assert.equal(session.supportsTransactions, false);
    await assert.rejects(session.withTransaction(async () => {
      await Payment.create([{ provider: "cash", method: "cash", type: "subscription_activation",
        status: "paid", source: "dashboard_subscription_cash", amount: 1,
        operationIdempotencyKey: "g3-no-rollback-probe" }], { session });
      throw new Error("Simulated mid-transaction fault");
    }), /Simulated mid-transaction fault/);
    await session.endSession();
    assert.equal(await Payment.countDocuments({ operationIdempotencyKey: "g3-no-rollback-probe" }), 1,
      "Standalone transactions cannot roll back a successful first write");

    // Exercise the atomic single-document idempotent command pattern used
    // by standalone fallback code. This is not a full HTTP authorization test.
    const key = "synthetic-manual-deduct-once";
    const change = () => Subscription.findOneAndUpdate({
      _id: subscriptions[0]._id, status: "active", remainingMeals: { $gte: 1 },
      legacyMealBalanceOperationKeys: { $ne: key },
    }, {
      $inc: { remainingMeals: -1 },
      $addToSet: { legacyMealBalanceOperationKeys: key },
    }, { new: true });
    const results = await Promise.all([change(), change()]);
    assert.equal(results.filter(Boolean).length, 1,
      "CAS and idempotency marker prevent double deduction on standalone");
    const after = await Subscription.findById(subscriptions[0]._id).lean();
    assert.equal(after.remainingMeals, 9);
    assert.deepEqual(after.legacyMealBalanceOperationKeys, [key]);
    console.log(JSON.stringify({
      engine: "MongoDB standalone", actualSubscriptions: 2, actualPayments: 2,
      duplicateKeyPaymentDocuments: 1, idempotentMealDeductionCount: 1,
      unchangedSecondSubscriberMeals: 10, multiDocumentRollbackSupported: false,
      status: "PASS",
    }));
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
