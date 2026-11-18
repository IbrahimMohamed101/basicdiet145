"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

require("../src/services/installSubscriptionDailyAddonPolicy");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionDailyAddonOperation = require("../src/models/SubscriptionDailyAddonOperation");
const dailyAddonService = require("../src/services/subscription/subscriptionDailyAddonService");
const closure = require("../src/services/installSubscriptionAddonReservationClosure");
const {
  buildAddonPlanSummaries, prepareDeliveryAddon,
} = require("../src/services/dashboard/deliveryAddonPreparationService");
const { getTodayKSADate } = require("../src/utils/date");

const oid = () => new mongoose.Types.ObjectId();
const today = getTodayKSADate();

async function fixture({ status = "locked", remaining = 7, products = 1, date = today, quantityPerDay = 1, customerSelected = false } = {}) {
  const planId = oid(), bucketId = oid(), productIds = Array.from({ length: products }, oid);
  const selections = customerSelected ? [{
    addonId: productIds[0], productId: productIds[0],
    addonPlanId: planId, category: "snack", entitlementCategory: "snack",
    entitlementKey: "snack:" + id(planId), balanceBucketId: bucketId,
    name: "بار سناك", source: "subscription", addonSettlementState: "reserved",
    dailyAllocationKey: "customer-reservation", qty: 1, quantity: 1,
  }] : [];
  const sub = await Subscription.create({
    userId: oid(), planId: oid(), status: "active",
    startDate: new Date("2026-01-01T00:00:00Z"),
    endDate: new Date("2027-01-01T00:00:00Z"),
    validityEndDate: new Date("2027-01-01T00:00:00Z"),
    selectedMealsPerDay: 1, totalMeals: 7, remainingMeals: 7,
    deliveryMode: "delivery", deliveryWindow: "18:00-20:00",
    addonSubscriptions: [{
      addonId: planId, addonPlanId: planId,
      addonPlanName: "سناك", addonPlanNameI18n: { ar: "سناك", en: "Snack" },
      category: "snack", allowanceCategory: "snack",
      entitlementKey: "snack:" + id(planId),
      quantityPerDay, purchasedDailyQty: quantityPerDay,
      maxPerDay: quantityPerDay, includedTotalQty: 7,
      menuProductIds: productIds,
      menuProductsSnapshot: productIds.map((p, i) => ({
        id: p, key: "snack_" + i,
        nameI18n: { ar: i ? "بار شوكولاتة" : "بار سناك", en: i ? "Chocolate Bar" : "Snack Bar" },
        priceHalala: 1000,
      })),
    }],
    addonBalance: [{
      _id: bucketId, addonId: planId, addonPlanId: planId,
      entitlementKey: "snack:" + id(planId),
      category: "snack", allowanceCategory: "snack",
      includedTotalQty: 7, purchasedQty: 7, remainingQty: remaining,
      reservedQty: customerSelected ? 1 : 0, consumedQty: 7 - remaining - (customerSelected ? 1 : 0),
      reservationKeys: customerSelected ? ["customer-reservation"] : [],
      unitPriceHalala: 1000,
    }],
  });
  const day = await SubscriptionDay.create({
    subscriptionId: sub._id, date, status,
    plannerState: "confirmed", planningState: "confirmed",
    plannerVersion: "v1", plannerRevisionHash: "staff-selection-fixture",
    mealSlots: [], addonSelections: selections,
  });
  return { sub, day, bucketId, planId, productIds };
}

function id(value) { return String(value || ""); }
async function balance(subId, bucketId) {
  const s = await Subscription.findById(subId).lean();
  return s.addonBalance.find((x) => id(x._id) === id(bucketId));
}
async function expectRejection(fn, code) {
  await assert.rejects(fn, (e) => e && e.code === code, "Expected " + code);
}
function args(f, product = f.productIds[0]) {
  return { dayId: id(f.day._id), balanceBucketId: id(f.bucketId), productId: id(product), role: "kitchen", today };
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: "staff-addons-" + Date.now() });
    await Promise.all([Subscription.init(), SubscriptionDay.init(), SubscriptionDailyAddonOperation.init()]);

    const normal = await fixture();
    let summary = buildAddonPlanSummaries(normal.sub.toObject(), normal.day.toObject(), { today, role: "kitchen" });
    assert.equal(summary[0].canPrepare, true);
    assert.equal(summary[0].remainingQty, 7);
    assert.equal(summary[0].products[0].name, "بار سناك");

    const outcome = await Promise.all(Array.from({ length: 5 }, () => prepareDeliveryAddon(args(normal))));
    assert(outcome.every((r) => r.prepared || r.alreadyPrepared));
    let day = await SubscriptionDay.findById(normal.day._id).lean();
    assert.equal(day.addonSelections.length, 1, "concurrent staff clicks must yield only one selection");
    assert.equal(day.addonSelections[0].name, "بار سناك");
    assert.equal(day.addonSelections[0].source, "subscription");
    assert.equal(day.addonSelections[0].autoDailyAddon, false);
    let b = await balance(normal.sub._id, normal.bucketId);
    assert.deepEqual([b.remainingQty, b.reservedQty, b.consumedQty], [6, 1, 0]);
    assert.equal((await SubscriptionDailyAddonOperation.countDocuments({ subscriptionDayId: normal.day._id })), 1);
    const replay = await prepareDeliveryAddon(args(normal));
    assert.equal(replay.alreadyPrepared, true);
    b = await balance(normal.sub._id, normal.bucketId);
    assert.deepEqual([b.remainingQty, b.reservedQty, b.consumedQty], [6, 1, 0]);

    await closure.consumeSubscriptionAddonReservationsForDay({ dayId: normal.day._id });
    await closure.consumeSubscriptionAddonReservationsForDay({ dayId: normal.day._id });
    b = await balance(normal.sub._id, normal.bucketId);
    assert.deepEqual([b.remainingQty, b.reservedQty, b.consumedQty], [6, 0, 1], "fulfill consumes exactly once");

    const canceled = await fixture();
    await prepareDeliveryAddon(args(canceled));
    await closure.releaseReservedSubscriptionAddonSelectionsForDay({ dayId: canceled.day._id, reason: "delivery_canceled" });
    await closure.releaseReservedSubscriptionAddonSelectionsForDay({ dayId: canceled.day._id, reason: "delivery_canceled" });
    b = await balance(canceled.sub._id, canceled.bucketId);
    assert.deepEqual([b.remainingQty, b.reservedQty, b.consumedQty], [7, 0, 0], "cancel returns the reservation exactly once");

    const open = await fixture({ status: "open" });
    await expectRejection(() => prepareDeliveryAddon(args(open)), "DAY_NOT_PREPARABLE");
    const dispatched = await fixture({ status: "out_for_delivery" });
    await expectRejection(() => prepareDeliveryAddon(args(dispatched)), "DAY_NOT_PREPARABLE");
    const skipped = await fixture({ status: "skipped" });
    await expectRejection(() => prepareDeliveryAddon(args(skipped)), "DAY_NOT_PREPARABLE");
    b = await balance(skipped.sub._id, skipped.bucketId);
    assert.deepEqual([b.remainingQty, b.reservedQty, b.consumedQty], [7, 0, 0]);

    const exhausted = await fixture({ remaining: 0 });
    await expectRejection(() => prepareDeliveryAddon(args(exhausted)), "NO_ADDON_BALANCE");
    b = await balance(exhausted.sub._id, exhausted.bucketId);
    assert.deepEqual([b.remainingQty, b.reservedQty, b.consumedQty], [0, 0, 7]);

    const selected = await fixture({ remaining: 6, customerSelected: true });
    summary = buildAddonPlanSummaries(selected.sub.toObject(), selected.day.toObject(), { today, role: "kitchen" });
    assert.equal(summary[0].canPrepare, false, "client choice disables staff preparation");
    const noOp = await prepareDeliveryAddon(args(selected));
    assert.equal(noOp.alreadyPrepared, true);
    b = await balance(selected.sub._id, selected.bucketId);
    assert.deepEqual([b.remainingQty, b.reservedQty, b.consumedQty], [6, 1, 0]);

    const multiple = await fixture({ products: 2 });
    await expectRejection(() => prepareDeliveryAddon({ ...args(multiple), productId: null }), "PRODUCT_CHOICE_REQUIRED");
    await expectRejection(() => prepareDeliveryAddon(args(multiple, oid())), "PRODUCT_CHOICE_REQUIRED");
    await prepareDeliveryAddon(args(multiple, multiple.productIds[1]));
    day = await SubscriptionDay.findById(multiple.day._id).lean();
    assert.equal(day.addonSelections[0].name, "بار شوكولاتة");

    await expectRejection(() => prepareDeliveryAddon({ ...args(multiple), role: "cashier" }), "FORBIDDEN");
    await expectRejection(() => prepareDeliveryAddon({ ...args(multiple), balanceBucketId: id(oid()) }), "ADDON_PLAN_AMBIGUOUS");
    const stacked = await fixture();
    await SubscriptionDay.updateOne(
      { _id: stacked.day._id },
      { $set: { stackingExtraSelectionState: { version: "subscription_stacking.extra_selection.v1", lifecycleStatus: "reserved", entries: [] } } }
    );
    await expectRejection(() => prepareDeliveryAddon(args(stacked)), "STACKING_EXTRA_MANAGED_SEPARATELY");
    const stackedBalance = await balance(stacked.sub._id, stacked.bucketId);
    assert.deepEqual([stackedBalance.remainingQty, stackedBalance.reservedQty, stackedBalance.consumedQty], [7, 0, 0]);

    const expired = await fixture();
    await Subscription.updateOne(
      { _id: expired.sub._id },
      { $set: { validityEndDate: new Date("2026-02-01"), endDate: new Date("2026-02-01") } }
    );
    await expectRejection(() => prepareDeliveryAddon(args(expired)), "SUBSCRIPTION_NOT_ELIGIBLE");

    const future = await fixture({ date: "2027-01-02" });
    await expectRejection(() => prepareDeliveryAddon(args(future)), "DAY_NOT_PREPARABLE");

    console.log("PASS: staff add-on preparation concurrency, lifecycle, skip, choice and balance invariants");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}
run().catch((e) => {
  console.error(e.stack || e.message);
  process.exitCode = 1;
});
