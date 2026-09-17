"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  applyStackingExtraReadProjection,
  buildStackingExtraReadProjection,
  projectSubscriptionStackingExtrasForRead,
} = require("../src/services/subscription/subscriptionStackingExtraReadProjectionService");
const {
  buildAddonChoicePricingPreview,
} = require("../src/services/subscription/subscriptionAddonPricingService");

const IDS = Object.freeze({
  user: new mongoose.Types.ObjectId(),
  subscription: new mongoose.Types.ObjectId(),
  saladPlan: new mongoose.Types.ObjectId(),
  saladProduct: new mongoose.Types.ObjectId(),
  snackPlan: new mongoose.Types.ObjectId(),
  snackProduct: new mongoose.Types.ObjectId(),
  juicePlan: new mongoose.Types.ObjectId(),
  protein: new mongoose.Types.ObjectId(),
});

function bucket({
  kind = "addon",
  key,
  qty,
  addonPlanId = null,
  productId = null,
  category = "",
  batch = "a",
} = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    kind,
    applicationState: "applied",
    walletKey: `${kind}:${key}:${batch}`,
    entitlementKey: kind === "addon" ? key : "",
    premiumKey: kind === "premium" ? key : "",
    addonId: addonPlanId,
    addonPlanId,
    category,
    allowanceCategory: category,
    purchasedDailyQty: 1,
    purchasedQty: qty,
    includedTotalQty: qty,
    remainingQty: qty,
    reservedQty: 0,
    consumedQty: 0,
    forfeitedQty: 0,
    unitPriceHalala: 8000,
    overageUnitPriceHalala: 8000,
    currency: "SAR",
    effectiveStartDate: new Date("2026-08-01T00:00:00.000Z"),
    validityEndDate: new Date("2026-09-30T23:59:59.999Z"),
    proteinId: kind === "premium" ? IDS.protein : null,
    metadata: kind === "addon"
      ? { menuProductIds: productId ? [productId] : [], displayKey: category }
      : { name: "Premium Protein" },
  };
}

function fixture() {
  const subscription = {
    _id: IDS.subscription,
    userId: IDS.user,
    addonSubscriptions: [{
      addonId: IDS.saladPlan,
      addonPlanId: IDS.saladPlan,
      entitlementKey: "small_salad",
      category: "small_salad",
      allowanceCategory: "small_salad",
      includedTotalQty: 7,
      menuProductIds: [IDS.saladProduct],
      maxPerDay: 1,
    }, {
      addonId: IDS.snackPlan,
      addonPlanId: IDS.snackPlan,
      entitlementKey: "snack",
      category: "snack",
      allowanceCategory: "snack",
      includedTotalQty: 7,
      menuProductIds: [IDS.snackProduct],
      maxPerDay: 1,
    }, {
      addonId: IDS.juicePlan,
      addonPlanId: IDS.juicePlan,
      entitlementKey: "juice",
      category: "juice",
      allowanceCategory: "juice",
      includedTotalQty: 99,
    }],
    addonBalance: [{ entitlementKey: "small_salad", purchasedQty: 7, remainingQty: 7 }],
    premiumBalance: [{ premiumKey: "premium_protein", purchasedQty: 1, remainingQty: 1 }],
  };
  const buckets = [
    bucket({ key: "small_salad", qty: 7, addonPlanId: IDS.saladPlan, productId: IDS.saladProduct, category: "small_salad", batch: "first" }),
    bucket({ key: "small_salad", qty: 26, addonPlanId: IDS.saladPlan, productId: IDS.saladProduct, category: "small_salad", batch: "second" }),
    bucket({ key: "snack", qty: 7, addonPlanId: IDS.snackPlan, productId: IDS.snackProduct, category: "snack", batch: "first" }),
    bucket({ key: "snack", qty: 26, addonPlanId: IDS.snackPlan, productId: IDS.snackProduct, category: "snack", batch: "second" }),
    bucket({ key: "juice", qty: 0, addonPlanId: IDS.juicePlan, category: "juice", batch: "zero" }),
    bucket({ kind: "premium", key: "premium_protein", qty: 1, batch: "first" }),
    bucket({ kind: "premium", key: "premium_protein", qty: 1, batch: "second" }),
  ];
  return { subscription, buckets };
}

function rowByKey(rows, entitlementKey) {
  return rows.find((row) => row.entitlementKey === entitlementKey);
}

function testCanonicalProjectionAggregatesRepeatedFunding() {
  const { subscription, buckets } = fixture();
  const sourceBefore = JSON.stringify({ subscription, buckets });
  const projection = buildStackingExtraReadProjection({
    subscription,
    buckets,
    businessDate: "2026-08-23",
  });
  const projected = applyStackingExtraReadProjection(subscription, projection);

  assert.equal(projected.addonBalance.length, 2);
  assert.equal(projected.addonSubscriptions.length, 2);
  assert.equal(projected.addonSubscriptionAllowances.length, 2);
  assert.equal(projected.premiumBalance.length, 1);
  assert.equal(projected.premiumSummary.length, 1);

  for (const entitlementKey of ["small_salad", "snack"]) {
    const balance = rowByKey(projected.addonBalance, entitlementKey);
    assert.ok(balance);
    assert.equal(balance.purchasedQty, 33);
    assert.equal(balance.includedTotalQty, 33);
    assert.equal(balance.remainingQty, 33);
    assert.equal(balance.reservedQty, 0);
    assert.equal(balance.consumedQty, 0);
    assert.equal(balance.forfeitedQty, 0);
    assert.equal(balance._id, undefined);
    assert.equal(balance.balanceBucketId, null);
  }
  assert.equal(rowByKey(projected.addonBalance, "juice"), undefined);
  assert.equal(projected.addonSubscriptions.some((row) => row.entitlementKey === "juice"), false);
  assert.equal(projected.addonBalanceSummary.small_salad.totalUnits, 33);
  assert.equal(projected.addonBalanceSummary.snack.remainingUnits, 33);
  assert.equal(projected.premiumBalance[0].purchasedQty, 2);
  assert.equal(projected.premiumBalance[0].remainingQty, 2);
  assert.equal(projected.premiumBalance[0]._id, undefined);

  const saladEntitlement = projected.addonSubscriptions.find((row) => row.entitlementKey === "small_salad");
  const pricing = buildAddonChoicePricingPreview({
    subscription: projected,
    entitlement: saladEntitlement,
    product: { _id: IDS.saladProduct, priceHalala: 8000, currency: "SAR" },
    addonPlanId: IDS.saladPlan,
    category: "small_salad",
    quantity: 1,
  });
  assert.equal(pricing.remainingBefore, 33);
  assert.equal(pricing.coveredQty, 1);
  assert.equal(pricing.paidQty, 0);
  assert.equal(pricing.pricingMode, "allowance_covered");
  assert.equal(pricing.payableTotalHalala, 0);

  assert.equal(JSON.stringify({ subscription, buckets }), sourceBefore, "projection must not mutate sources");
  const reapplied = applyStackingExtraReadProjection(
    projected,
    buildStackingExtraReadProjection({ subscription: projected, buckets, businessDate: "2026-08-23" })
  );
  assert.deepEqual(reapplied, projected, "reapplying the projection must be idempotent");
}

async function testProjectionLoaderFailsClosedOnlyForWrites() {
  const { subscription } = fixture();
  const failingRuntime = {
    readEnabledForUser: () => true,
    findBuckets: async () => { throw new Error("open: Operation not permitted"); },
    info: () => undefined,
    error: () => undefined,
  };
  await assert.rejects(
    () => projectSubscriptionStackingExtrasForRead(subscription, "2026-08-23", {
      ...failingRuntime,
      writeEnabledForUser: () => true,
    }),
    (err) => err && err.code === "STACKING_EXTRA_READ_UNAVAILABLE" && err.status === 503
  );
  const fallback = await projectSubscriptionStackingExtrasForRead(subscription, "2026-08-23", {
    ...failingRuntime,
    writeEnabledForUser: () => false,
  });
  assert.equal(fallback, subscription);
}

async function run() {
  testCanonicalProjectionAggregatesRepeatedFunding();
  await testProjectionLoaderFailsClosedOnlyForWrites();
  console.log("subscription stacking repeated extras read projection tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
