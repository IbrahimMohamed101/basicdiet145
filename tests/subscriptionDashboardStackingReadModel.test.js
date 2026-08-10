"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert");
const mongoose = require("mongoose");
const {
  projectDashboardStackingReadModel,
} = require("../src/services/dashboard/subscriptionDashboardStackingReadService");
const {
  createDashboardSubscriptionStackingReadModel,
  isEligibleDashboardSubscriptionStackingRead,
} = require("../src/middleware/dashboardSubscriptionStackingReadModel");

function subscription(id, overrides = {}) {
  return {
    _id: id,
    id: String(id),
    totalMeals: 130,
    remainingMeals: 72,
    reservedMeals: 3,
    consumedMeals: 55,
    forfeitedMeals: 0,
    ...overrides,
  };
}

async function testProjectsPackagesAndTransactionsWithoutChangingParentIdentity() {
  const parentId = new mongoose.Types.ObjectId();
  const legacyPlanId = new mongoose.Types.ObjectId();
  const purchasePlanId = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId();
  const payload = {
    status: true,
    data: [
      subscription(parentId, {
        planName: "Legacy parent label",
        selectedGrams: 200,
      }),
    ],
  };
  const projected = await projectDashboardStackingReadModel(payload, {
    lang: "ar",
    runtime: {
      findBatches: async () => [
        {
          _id: new mongoose.Types.ObjectId(),
          containerSubscriptionId: parentId,
          planId: legacyPlanId,
          paymentId: null,
          sourceType: "legacy_seed",
          status: "active",
          applicationState: "applied",
          requestedStartDate: new Date("2026-08-01T00:00:00+03:00"),
          effectiveStartDate: new Date("2026-08-01T00:00:00+03:00"),
          endDate: new Date("2026-08-26T00:00:00+03:00"),
          validityEndDate: new Date("2026-08-26T00:00:00+03:00"),
          daysCount: 26,
          mealsPerDay: 3,
          proteinGrams: 200,
          totalMeals: 78,
          remainingMeals: 20,
          consumedMeals: 58,
        },
        {
          _id: new mongoose.Types.ObjectId(),
          containerSubscriptionId: parentId,
          planId: purchasePlanId,
          paymentId,
          sourceType: "checkout",
          status: "active",
          applicationState: "applied",
          requestedStartDate: new Date("2026-08-06T00:00:00+03:00"),
          effectiveStartDate: new Date("2026-08-06T00:00:00+03:00"),
          endDate: new Date("2026-08-31T00:00:00+03:00"),
          validityEndDate: new Date("2026-08-31T00:00:00+03:00"),
          daysCount: 26,
          mealsPerDay: 2,
          proteinGrams: 150,
          totalMeals: 52,
          remainingMeals: 52,
          pricingSnapshot: { totalPriceHalala: 10000, currency: "SAR" },
        },
      ],
      findPlans: async () => [
        { _id: legacyPlanId, name: { ar: "القديمة", en: "Legacy" } },
        { _id: purchasePlanId, name: { ar: "الإضافية", en: "Added" } },
      ],
      findPayments: async () => [{
        _id: paymentId,
        status: "paid",
        type: "subscription_activation",
        provider: "moyasar",
        amount: 10000,
        currency: "SAR",
        providerInvoiceId: "inv-safe-read",
        paidAt: new Date("2026-08-06T12:00:00Z"),
      }],
    },
  });

  const row = projected.data[0];
  assert.strictEqual(String(row._id), String(parentId));
  assert.strictEqual(row.planName, "Legacy parent label");
  assert.strictEqual(row.selectedGrams, 200);
  assert.strictEqual(row.stacking.parentRole, "operational_container");
  assert.strictEqual(row.stacking.hasEntitlementBatches, true);
  assert.strictEqual(row.stacking.isCombinedPackage, true);
  assert.strictEqual(row.stacking.manualDeductionAllowed, false);
  assert.strictEqual(row.stacking.packageCount, 2);
  assert.deepStrictEqual(
    row.stacking.packages.map((item) => [
      item.planName,
      item.proteinGrams,
      item.mealsPerDay,
      item.totalMeals,
    ]),
    [["القديمة", 200, 3, 78], ["الإضافية", 150, 2, 52]]
  );
  assert.strictEqual(row.stacking.transactions.length, 1);
  assert.strictEqual(row.stacking.transactions[0].providerReference, "inv-safe-read");
  assert.strictEqual(row.stacking.transactions[0].amountHalala, 10000);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      row.stacking.transactions[0],
      "metadata"
    ),
    false
  );
}

async function testSearchNestingAndLegacySubscriptionRemainExplicit() {
  const id = new mongoose.Types.ObjectId();
  const payload = {
    status: true,
    data: {
      customer: { id: "customer-a" },
      subscription: subscription(id),
      subscriptions: [subscription(id)],
    },
  };
  const projected = await projectDashboardStackingReadModel(payload, {
    runtime: {
      findBatches: async () => [],
      findPlans: async () => {
        throw new Error("plans must not load without batches");
      },
      findPayments: async () => {
        throw new Error("payments must not load without batches");
      },
    },
  });
  assert.strictEqual(projected.data.customer.id, "customer-a");
  assert.strictEqual(
    projected.data.subscription.stacking.manualDeductionAllowed,
    true
  );
  assert.strictEqual(
    projected.data.subscriptions[0].stacking.hasEntitlementBatches,
    false
  );
}

async function testMiddlewareRoutesAndProjection() {
  assert.strictEqual(isEligibleDashboardSubscriptionStackingRead({
    method: "GET",
    originalUrl: "/api/dashboard/subscriptions/search?phone=1",
  }), true);
  assert.strictEqual(isEligibleDashboardSubscriptionStackingRead({
    method: "POST",
    originalUrl: "/api/dashboard/subscriptions/quote",
  }), false);

  let nextCalls = 0;
  let sent = null;
  const middleware = createDashboardSubscriptionStackingReadModel({
    projectResponse: async (payload) => ({ ...payload, projected: true }),
  });
  const res = {
    json(payload) {
      sent = payload;
      return payload;
    },
  };
  middleware({
    method: "GET",
    originalUrl: "/api/dashboard/subscriptions",
    headers: {},
  }, res, () => {
    nextCalls += 1;
  });
  await res.json({ status: true, data: [] });
  assert.strictEqual(nextCalls, 1);
  assert.strictEqual(sent.projected, true);
}

async function run() {
  await testProjectsPackagesAndTransactionsWithoutChangingParentIdentity();
  await testSearchNestingAndLegacySubscriptionRemainExplicit();
  await testMiddlewareRoutesAndProjection();
  console.log("subscription dashboard stacking read model tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
