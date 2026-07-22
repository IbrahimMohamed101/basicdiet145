"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

require("../src/services/installSubscriptionDayFullMealCompatibility");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const currentResolver = require("../src/services/subscription/subscriptionCurrentResolverService");
const boundary = require("../src/services/installSubscriptionAddonPaymentBoundaryGuard");
const oneTimePlanning = require("../src/services/subscription/oneTimeAddonDayPlanningPaymentService");
const unifiedDayPayment = require("../src/services/subscription/unifiedDayPaymentService");
const legacyAddonPayment = require("../src/services/subscription/legacyOneTimeAddonPaymentService");
const paymentApplication = require("../src/services/paymentApplicationService");

function oid() {
  return new mongoose.Types.ObjectId();
}

function subscriptionRow({ id, startDate, endDate, createdAt, status = "active" }) {
  return {
    _id: id,
    status,
    startDate: new Date(`${startDate}T00:00:00.000Z`),
    endDate: new Date(`${endDate}T23:59:59.999Z`),
    validityEndDate: new Date(`${endDate}T23:59:59.999Z`),
    createdAt: new Date(createdAt),
  };
}

function testCurrentSubscriptionWinsOverUpcoming() {
  const current = subscriptionRow({
    id: "507f191e810c19729de87001",
    startDate: "2026-07-20",
    endDate: "2026-08-20",
    createdAt: "2026-07-20T10:00:00.000Z",
  });
  const upcoming = subscriptionRow({
    id: "507f191e810c19729de87002",
    startDate: "2026-07-23",
    endDate: "2026-08-23",
    createdAt: "2026-07-22T18:00:00.000Z",
  });

  const resolution = currentResolver.selectCurrentSubscription([upcoming, current], {
    businessDate: "2026-07-22",
    includeUpcoming: true,
  });

  assert.strictEqual(String(resolution.subscription._id), String(current._id));
  assert.strictEqual(resolution.reason, "newest_active_in_current_date_window");
}

function testNearestUpcomingSubscriptionWins() {
  const fartherButNewer = subscriptionRow({
    id: "507f191e810c19729de87003",
    startDate: "2026-08-10",
    endDate: "2026-09-10",
    createdAt: "2026-07-22T20:00:00.000Z",
  });
  const nearestButOlder = subscriptionRow({
    id: "507f191e810c19729de87004",
    startDate: "2026-07-23",
    endDate: "2026-08-23",
    createdAt: "2026-07-21T08:00:00.000Z",
  });

  const resolution = currentResolver.selectCurrentSubscription(
    [fartherButNewer, nearestButOlder],
    { businessDate: "2026-07-22", includeUpcoming: true }
  );

  assert.strictEqual(String(resolution.subscription._id), String(nearestButOlder._id));
  assert.strictEqual(resolution.reason, "nearest_active_upcoming_subscription");
  assert.deepStrictEqual(
    resolution.upcoming.map((row) => String(row.subscription._id)),
    [String(nearestButOlder._id), String(fartherButNewer._id)]
  );
}

function testPendingAddonPricingInspection() {
  const covered = boundary.inspectPendingAddonSelections({
    addonSelections: [{
      addonId: "covered",
      source: "subscription",
      priceHalala: 0,
      unitPriceHalala: 1900,
      coveredQty: 1,
      paidQty: 0,
      currency: "SAR",
    }],
  });
  assert.strictEqual(covered.valid, true);
  assert.strictEqual(covered.pendingCount, 0);
  assert.strictEqual(covered.totalHalala, 0);

  const payable = boundary.inspectPendingAddonSelections({
    addonSelections: [{
      addonId: "payable",
      source: "pending_payment",
      payableTotalHalala: 1900,
      priceHalala: 1900,
      unitPriceHalala: 1900,
      paidQty: 1,
      currency: "SAR",
    }],
  });
  assert.strictEqual(payable.valid, true);
  assert.strictEqual(payable.pendingCount, 1);
  assert.strictEqual(payable.totalHalala, 1900);

  const recoverableStoredShape = boundary.inspectPendingAddonSelections({
    addonSelections: [{
      addonId: "recoverable",
      source: "pending_payment",
      payableTotalHalala: 0,
      priceHalala: 0,
      unitPriceHalala: 1900,
      paidQty: 1,
      currency: "SAR",
    }],
  });
  assert.strictEqual(recoverableStoredShape.valid, true);
  assert.strictEqual(recoverableStoredShape.totalHalala, 1900);

  const invalid = boundary.inspectPendingAddonSelections({
    addonSelections: [{
      addonId: "invalid",
      source: "pending_payment",
      payableTotalHalala: 0,
      priceHalala: 0,
      unitPriceHalala: 0,
      paidQty: 1,
      currency: "SAR",
    }],
  });
  assert.strictEqual(invalid.valid, false);
  assert.strictEqual(invalid.error.status, 422);
  assert.strictEqual(invalid.error.code, "INVALID_ADDON_PRICE");

  const invalidCurrency = boundary.inspectPendingAddonSelections({
    addonSelections: [{
      addonId: "wrong-currency",
      source: "pending_payment",
      priceHalala: 1900,
      paidQty: 1,
      currency: "USD",
    }],
  });
  assert.strictEqual(invalidCurrency.valid, false);
  assert.strictEqual(invalidCurrency.error.code, "INVALID_ADDON_PRICE");
}

async function testProviderInvoiceBoundary() {
  let called = 0;
  const runtime = boundary.guardedInvoiceRuntime({
    async createInvoice(payload) {
      called += 1;
      return { id: "invoice", url: "https://example.com/pay", currency: "SAR", ...payload };
    },
  });

  await assert.rejects(
    () => runtime.createInvoice({ amount: 0 }),
    (err) => err && err.code === "INVALID_ADDON_PRICE" && err.status === 422
  );
  assert.strictEqual(called, 0, "zero-valued invoices must never reach the provider");

  const invoice = await runtime.createInvoice({ amount: 1900 });
  assert.strictEqual(called, 1);
  assert.strictEqual(invoice.amount, 1900);
}

function testPaymentApplicationBoundary() {
  assert.deepStrictEqual(
    boundary.inspectPaymentApplicationPrice({ type: "one_time_addon", amount: 0 }),
    { valid: false, reason: "invalid_addon_price" }
  );
  assert.deepStrictEqual(
    boundary.inspectPaymentApplicationPrice({ type: "one_time_addon", amount: 1900 }),
    { valid: true }
  );

  const zeroAddonPayment = boundary.inspectPaymentApplicationPrice({
    type: "day_planning_payment",
    amount: 1900,
    metadata: {
      addonsAmountHalala: 0,
      oneTimeAddonSelections: [{
        addonId: "addon",
        priceHalala: 0,
        unitPriceHalala: 0,
        currency: "SAR",
      }],
    },
  });
  assert.strictEqual(zeroAddonPayment.valid, false);
  assert.strictEqual(zeroAddonPayment.reason, "invalid_addon_price");

  const validUnifiedPayment = boundary.inspectPaymentApplicationPrice({
    type: "day_planning_payment",
    amount: 2400,
    metadata: {
      addonsAmountHalala: 1900,
      premiumAmountHalala: 500,
      oneTimeAddonSelections: [{
        addonId: "addon",
        priceHalala: 1900,
        currency: "SAR",
      }],
    },
  });
  assert.strictEqual(validUnifiedPayment.valid, true);
  assert.strictEqual(validUnifiedPayment.addonAmountHalala, 1900);

  const mismatchedUnifiedPayment = boundary.inspectPaymentApplicationPrice({
    type: "day_planning_payment",
    amount: 2400,
    metadata: {
      addonsAmountHalala: 1800,
      oneTimeAddonSelections: [{
        addonId: "addon",
        priceHalala: 1900,
        currency: "SAR",
      }],
    },
  });
  assert.strictEqual(mismatchedUnifiedPayment.valid, false);
  assert.strictEqual(mismatchedUnifiedPayment.reason, "addon_payment_amount_mismatch");
}

function testRuntimeCompositionMarkers() {
  assert.strictEqual(
    oneTimePlanning.createOneTimeAddonDayPlanningPaymentFlow.__addonPaymentBoundaryGuard,
    true
  );
  assert.strictEqual(
    unifiedDayPayment.createUnifiedDayPaymentFlow.__addonPaymentBoundaryGuard,
    true
  );
  assert.strictEqual(
    legacyAddonPayment.createLegacyOneTimeAddonPaymentFlow.__addonPaymentBoundaryGuard,
    true
  );
  assert.strictEqual(
    paymentApplication.applyPaymentSideEffects.__addonPaymentBoundaryGuard,
    true
  );
}

async function testZeroPriceIsRejectedBeforePaymentProvider() {
  const userId = oid();
  const planId = oid();
  const subscription = await Subscription.create({
    userId,
    planId,
    status: "active",
    startDate: new Date("2026-07-23T00:00:00.000Z"),
    endDate: new Date("2026-08-23T23:59:59.999Z"),
    validityEndDate: new Date("2026-08-23T23:59:59.999Z"),
    totalMeals: 14,
    remainingMeals: 14,
    deliveryMode: "delivery",
    deliveryWindow: "18:00-20:00",
  });
  const productId = oid();
  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: "2026-07-23",
    status: "open",
    plannerState: "draft",
    plannerVersion: "v1",
    plannerRevisionHash: "zero-addon-price",
    mealSlots: [],
    addonSelections: [{
      addonId: productId,
      productId,
      menuProductId: productId,
      name: "Zero Add-on",
      category: "snack",
      source: "pending_payment",
      requestedQty: 1,
      paidQty: 1,
      coveredQty: 0,
      priceHalala: 0,
      unitPriceHalala: 0,
      payableTotalHalala: 0,
      currency: "SAR",
    }],
  });

  let providerCalls = 0;
  const runtime = {
    async createInvoice() {
      providerCalls += 1;
      throw new Error("provider must not be called");
    },
  };

  const oneTimeResult = await oneTimePlanning.createOneTimeAddonDayPlanningPaymentFlow({
    subscriptionId: subscription._id,
    date: day.date,
    userId,
    runtime,
  });
  assert.strictEqual(oneTimeResult.ok, false);
  assert.strictEqual(oneTimeResult.status, 422);
  assert.strictEqual(oneTimeResult.code, "INVALID_ADDON_PRICE");

  const unifiedResult = await unifiedDayPayment.createUnifiedDayPaymentFlow({
    subscriptionId: subscription._id,
    date: day.date,
    userId,
    runtime,
  });
  assert.strictEqual(unifiedResult.ok, false);
  assert.strictEqual(unifiedResult.status, 422);
  assert.strictEqual(unifiedResult.code, "INVALID_ADDON_PRICE");
  assert.strictEqual(providerCalls, 0);
}

async function run() {
  testCurrentSubscriptionWinsOverUpcoming();
  testNearestUpcomingSubscriptionWins();
  testPendingAddonPricingInspection();
  await testProviderInvoiceBoundary();
  testPaymentApplicationBoundary();
  testRuntimeCompositionMarkers();

  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: `addon-payment-boundary-${Date.now()}` });
    await testZeroPriceIsRejectedBeforePaymentProvider();
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }

  console.log("subscription add-on payment boundary lifecycle checks passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
