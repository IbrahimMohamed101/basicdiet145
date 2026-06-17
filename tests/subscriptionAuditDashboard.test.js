require('dotenv').config();

process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const ActivityLog = require("../src/models/ActivityLog");
const Payment = require("../src/models/Payment");
const User = require("../src/models/User");
const DashboardUser = require("../src/models/DashboardUser");
const Delivery = require("../src/models/Delivery");
const { DASHBOARD_JWT_SECRET } = require("../src/services/dashboardTokenService");
const { resolveMongoUri } = require("../src/utils/mongoUriResolver");
const dateUtils = require("../src/utils/date");
const {
  assertSelectedSlotsAvailableForPickup,
  assertSelectedPickupItemsAvailable,
} = require("../src/services/subscription/subscriptionPickupSlotService");

const TEST_TAG = `sub-audit-dash-${Date.now()}`;
const results = { passed: 0, failed: 0 };
const dashboardUsers = new Map();

async function test(name, fn) {
  try {
    await fn();
    results.passed += 1;
    console.log(`✅ ${name}`);
  } catch (err) {
    results.failed += 1;
    console.error(`❌ ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

function dashboardToken(role = "admin") {
  const dashboardUser = dashboardUsers.get(role);
  assert(dashboardUser, `missing dashboard user for role ${role}`);
  return jwt.sign(
    { userId: String(dashboardUser._id), role, tokenType: "dashboard_access" },
    DASHBOARD_JWT_SECRET,
    { expiresIn: "1h" }
  );
}

function auth(role = "admin") {
  return { Authorization: `Bearer ${dashboardToken(role)}`, "Accept-Language": "en" };
}

async function connectDatabase() {
  if (mongoose.connection.readyState === 0) {
    const mongoUri = resolveMongoUri();
    await mongoose.connect(mongoUri);
  }
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

async function cleanup() {
  const users = await User.find({ phone: { $regex: TEST_TAG } }).select("_id").lean();
  const userIds = users.map((user) => user._id);
  
  await Promise.all([
    Subscription.deleteMany({ userId: { $in: userIds } }),
    SubscriptionDay.deleteMany({ subscriptionId: { $in: userIds } }),
    SubscriptionPickupRequest.deleteMany({ subscriptionId: { $in: userIds } }),
    Delivery.deleteMany({ subscriptionId: { $in: userIds } }),
    ActivityLog.deleteMany({ $or: [{ entityId: { $in: userIds } }, { byUserId: { $in: userIds } }] }),
    Payment.deleteMany({ userId: { $in: userIds } }),
    DashboardUser.deleteMany({ email: { $regex: TEST_TAG } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
}

async function runTests() {
  await connectDatabase();
  await cleanup();

  // Create dashboard users
  const adminUser = await DashboardUser.create({
    name: "Dashboard Admin",
    email: `${TEST_TAG}-admin@example.test`,
    role: "admin",
    passwordHash: "dummy",
  });
  dashboardUsers.set("admin", adminUser);

  const cashierUser = await DashboardUser.create({
    name: "Dashboard Cashier",
    email: `${TEST_TAG}-cashier@example.test`,
    role: "cashier",
    passwordHash: "dummy",
  });
  dashboardUsers.set("cashier", cashierUser);

  // Create a customer
  const customer = await User.create({
    phone: `${TEST_TAG}-+966501111111`,
    name: "Audit User",
    status: "active",
  });

  const app = createApp();

  await test("GET /api/dashboard/subscriptions/:id/audit returns 404 for non-existent subscription", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${fakeId}/audit`)
      .set(auth("admin"));
    expectStatus(res, 404, "non-existent subscription");
  });

  await test("GET /api/dashboard/subscriptions/:id/audit returns 403 for forbidden roles", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${fakeId}/audit`)
      .set(auth("cashier"));
    expectStatus(res, 403, "forbidden role access");
  });

  await test("GET /api/dashboard/subscriptions/:id/audit compiles clean audit state for active pickup sub", async () => {
    const sub = await Subscription.create({
      userId: customer._id,
      planId: new mongoose.Types.ObjectId(),
      status: "active",
      totalMeals: 10,
      remainingMeals: 9,
      deliveryMode: "pickup",
    });

    await SubscriptionPickupRequest.create({
      subscriptionId: sub._id,
      userId: customer._id,
      date: "2026-06-17",
      mealCount: 1,
      status: "ready_for_pickup",
      idempotencyKey: `${TEST_TAG}-pk-1`,
    });

    await ActivityLog.create({
      entityType: "subscription",
      entityId: sub._id,
      action: "manual_subscription_meal_deduction",
      byUserId: adminUser._id,
      byRole: "admin",
      meta: {
        subscriptionId: String(sub._id),
        deductedTotalMeals: 0,
      },
    });

    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${sub._id}/audit`)
      .set(auth("admin"));

    expectStatus(res, 200, "successful audit retrieval");
    assert.strictEqual(res.body.status, true);
    assert.strictEqual(res.body.data.baseMealSlots.totalAllowed, 10);
    assert.strictEqual(res.body.data.baseMealSlots.remainingMeals, 9);
    assert.strictEqual(res.body.data.baseMealSlots.hasMismatch, false);
    assert.strictEqual(res.body.data.pickupFulfillment.totalPickupRequests, 1);
  });

  await test("GET /api/dashboard/subscriptions/:id/lifecycle compiles chronological timeline of events", async () => {
    const sub = await Subscription.create({
      userId: customer._id,
      planId: new mongoose.Types.ObjectId(),
      status: "active",
      totalMeals: 10,
      remainingMeals: 10,
      deliveryMode: "delivery",
    });

    await Payment.create({
      provider: "moyasar",
      type: "subscription_activation",
      status: "paid",
      amount: 15000,
      userId: customer._id,
      subscriptionId: sub._id,
    });

    await ActivityLog.create({
      entityType: "subscription",
      entityId: sub._id,
      action: "manual_subscription_meal_deduction",
      byUserId: adminUser._id,
      byRole: "admin",
      meta: {
        subscriptionId: String(sub._id),
        deductedTotalMeals: 2,
        reason: "Test manual deduction",
      },
    });

    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${sub._id}/lifecycle`)
      .set(auth("admin"));

    expectStatus(res, 200, "successful lifecycle retrieval");
    assert.strictEqual(res.body.status, true);
    const events = res.body.data.events;
    assert(events.length >= 3, `Expected at least 3 events, got: ${events.length}`);
    
    const times = events.map((e) => new Date(e.timestamp).getTime());
    for (let i = 1; i < times.length; i++) {
      assert(times[i] >= times[i - 1], "Events must be sorted chronologically");
    }
  });

  // NEW DOMAIN INVARIANT TESTS

  await test("Test: premium upgrades cannot exceed meal slots", async () => {
    const sub = await Subscription.create({
      userId: customer._id,
      planId: new mongoose.Types.ObjectId(),
      status: "active",
      totalMeals: 2,
      remainingMeals: 2,
      deliveryMode: "delivery",
      premiumSelections: [
        { baseSlotKey: "slot_1", premiumKey: "premium_large_salad" },
        { baseSlotKey: "slot_2", premiumKey: "premium_large_salad" },
        { baseSlotKey: "slot_3", premiumKey: "premium_large_salad" },
      ],
    });

    await SubscriptionDay.create({
      subscriptionId: sub._id,
      date: "2026-06-18",
      status: "open",
      mealSlots: [
        { slotIndex: 1, slotKey: "slot_1", selectionType: "standard_meal", status: "complete" },
        { slotIndex: 2, slotKey: "slot_2", selectionType: "standard_meal", status: "complete" },
      ],
    });

    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${sub._id}/audit`)
      .set(auth("admin"));

    expectStatus(res, 200, "audit retrieve");
    assert.strictEqual(res.body.data.premiumUpgrades.exceedsPlannedSlots, true);
    assert.strictEqual(res.body.data.invariants.premiumUpgradeLimitValid, false);
    assert(res.body.data.warnings.some(w => w.includes("exceeds planned meal slots")));
  });

  await test("Test: premium does not create extra meals", async () => {
    const sub = await Subscription.create({
      userId: customer._id,
      planId: new mongoose.Types.ObjectId(),
      status: "active",
      totalMeals: 2,
      remainingMeals: 2,
      deliveryMode: "delivery",
    });

    await SubscriptionDay.create({
      subscriptionId: sub._id,
      date: "2026-06-19",
      status: "open",
      mealSlots: [{ slotIndex: 1, slotKey: "slot_1", selectionType: "standard_meal", status: "complete" }],
      premiumUpgradeSelections: [
        { baseSlotKey: "slot_2", proteinId: new mongoose.Types.ObjectId(), premiumKey: "premium_large_salad", premiumSource: "balance" }
      ],
    });

    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${sub._id}/audit`)
      .set(auth("admin"));

    expectStatus(res, 200, "audit retrieve");
    assert.strictEqual(res.body.data.premiumUpgrades.createsExtraMeals, true);
    assert.strictEqual(res.body.data.invariants.premiumNoExtraMeals, false);
    assert(res.body.data.warnings.some(w => w.includes("has no matching base meal slot")));
  });

  await test("Test: add-ons are not counted as meal slots", async () => {
    const sub = await Subscription.create({
      userId: customer._id,
      planId: new mongoose.Types.ObjectId(),
      status: "active",
      totalMeals: 5,
      remainingMeals: 5,
      deliveryMode: "delivery",
      addonBalance: [
        { addonId: new mongoose.Types.ObjectId(), purchasedQty: 2, remainingQty: 2 },
      ]
    });

    await SubscriptionDay.create({
      subscriptionId: sub._id,
      date: "2026-06-20",
      status: "open",
      mealSlots: [
        { slotIndex: 1, slotKey: "slot_1", selectionType: "standard_meal", status: "complete" },
        { slotIndex: 2, slotKey: "slot_2", selectionType: "standard_meal", status: "complete" },
      ],
      addonSelections: [
        { addonId: new mongoose.Types.ObjectId(), category: "juice", source: "wallet", qty: 1 }
      ]
    });

    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${sub._id}/audit`)
      .set(auth("admin"));

    expectStatus(res, 200, "audit retrieve");
    assert.strictEqual(res.body.data.baseMealSlots.totalAllowed, 5);
    assert.strictEqual(res.body.data.baseMealSlots.totalPlanned, 2);
    assert.strictEqual(res.body.data.addonEntitlements.itemAddons.length, 1);
  });

  await test("Test: partially picked add-ons reduce future availability", async () => {
    const addonId = new mongoose.Types.ObjectId();
    const sub = await Subscription.create({
      userId: customer._id,
      planId: new mongoose.Types.ObjectId(),
      status: "active",
      totalMeals: 5,
      remainingMeals: 5,
      deliveryMode: "pickup",
      addonBalance: [
        { addonId, purchasedQty: 5, remainingQty: 4 }
      ]
    });

    await SubscriptionDay.create({
      subscriptionId: sub._id,
      date: "2026-06-21",
      status: "fulfilled",
      mealSlots: [],
      addonSelections: [
        { addonId, category: "juice", source: "wallet", qty: 1 }
      ]
    });

    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${sub._id}/audit`)
      .set(auth("admin"));

    expectStatus(res, 200, "audit retrieve");
    assert.strictEqual(res.body.data.addonEntitlements.itemAddons[0].pickedQty, 1);
    assert.strictEqual(res.body.data.addonEntitlements.reappearedAfterFulfillment, false);

    sub.addonBalance[0].remainingQty = 5;
    await sub.save();

    const resErr = await request(app)
      .get(`/api/dashboard/subscriptions/${sub._id}/audit`)
      .set(auth("admin"));
    assert.strictEqual(resErr.body.data.addonEntitlements.reappearedAfterFulfillment, true);
    assert.strictEqual(resErr.body.data.invariants.noAddonDoubleConsumption, false);
  });

  await test("Test: delivered add-ons reduce future availability", async () => {
    const addonId = new mongoose.Types.ObjectId();
    const sub = await Subscription.create({
      userId: customer._id,
      planId: new mongoose.Types.ObjectId(),
      status: "active",
      totalMeals: 5,
      remainingMeals: 5,
      deliveryMode: "delivery",
      addonBalance: [
        { addonId, purchasedQty: 5, remainingQty: 4 }
      ]
    });

    const day = await SubscriptionDay.create({
      subscriptionId: sub._id,
      date: "2026-06-22",
      status: "fulfilled",
      mealSlots: [],
      addonSelections: [
        { addonId, category: "juice", source: "wallet", qty: 1 }
      ]
    });

    await Delivery.create({
      subscriptionId: sub._id,
      dayId: day._id,
      date: "2026-06-22",
      status: "delivered",
    });

    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${sub._id}/audit`)
      .set(auth("admin"));

    expectStatus(res, 200, "audit retrieve");
    assert.strictEqual(res.body.data.addonEntitlements.itemAddons[0].deliveredQty, 1);
    assert.strictEqual(res.body.data.addonEntitlements.reappearedAfterFulfillment, false);
  });

  await test("Test: selectedMealSlotIds rejects add-ons", async () => {
    const sub = await Subscription.create({
      userId: customer._id,
      planId: new mongoose.Types.ObjectId(),
      status: "active",
      totalMeals: 5,
      remainingMeals: 5,
      deliveryMode: "pickup",
    });

    const day = await SubscriptionDay.create({
      subscriptionId: sub._id,
      date: "2026-06-23",
      status: "open",
      mealSlots: [{ slotIndex: 1, slotKey: "slot_1", selectionType: "standard_meal", status: "complete", _id: new mongoose.Types.ObjectId() }],
      addonSelections: [{ addonId: new mongoose.Types.ObjectId(), category: "juice", source: "wallet", _id: new mongoose.Types.ObjectId() }]
    });

    const badSlotId = String(day.addonSelections[0]._id);
    
    try {
      await assertSelectedSlotsAvailableForPickup({
        subscriptionId: sub._id,
        day,
        selectedMealSlotIds: [badSlotId],
      });
      assert.fail("Should have thrown error");
    } catch (err) {
      assert.strictEqual(err.code, "MEAL_SLOT_NOT_FOUND");
    }
  });

  await test("Test: selectedPickupItemIds supports meal slot items and add-on items", async () => {
    const sub = await Subscription.create({
      userId: customer._id,
      planId: new mongoose.Types.ObjectId(),
      status: "active",
      totalMeals: 5,
      remainingMeals: 5,
      deliveryMode: "pickup",
    });

    const mealSlotId = new mongoose.Types.ObjectId();
    const addonId = new mongoose.Types.ObjectId();

    const day = await SubscriptionDay.create({
      subscriptionId: sub._id,
      date: "2026-06-24",
      status: "open",
      mealSlots: [{ _id: mealSlotId, slotIndex: 1, slotKey: "slot_1", selectionType: "standard_meal", status: "complete" }],
      addonSelections: [{ _id: addonId, addonId, category: "juice", source: "wallet", qty: 1 }]
    });

    const mealSlotIdStr = "slot_1";
    const addonUnitIdStr = `addon_${addonId}_1`;

    const result = await assertSelectedPickupItemsAvailable({
      subscriptionId: sub._id,
      day,
      selectedPickupItemIds: [mealSlotIdStr, addonUnitIdStr],
      subscription: sub,
    });

    assert.deepStrictEqual(result.selectedPickupItemIds, [mealSlotIdStr, addonUnitIdStr]);
    assert.strictEqual(result.selectedMealSlotIds.length, 1);
    assert.strictEqual(result.selectedMealSlotIds[0], mealSlotIdStr);
  });

  await test("Test: kitchen queue contains exact selected fulfillment items", async () => {
    const sub = await Subscription.create({
      userId: customer._id,
      planId: new mongoose.Types.ObjectId(),
      status: "active",
      totalMeals: 5,
      remainingMeals: 5,
      deliveryMode: "pickup",
    });

    const day = await SubscriptionDay.create({
      subscriptionId: sub._id,
      date: "2026-06-25",
      status: "in_preparation",
      mealSlots: [
        { slotIndex: 1, slotKey: "slot_1", selectionType: "standard_meal", status: "complete" },
        { slotIndex: 2, slotKey: "slot_2", selectionType: "standard_meal", status: "complete" },
      ]
    });

    await SubscriptionPickupRequest.create({
      subscriptionId: sub._id,
      userId: customer._id,
      date: "2026-06-25",
      mealCount: 1,
      status: "in_preparation",
      idempotencyKey: `${TEST_TAG}-pk-mismatch`,
    });

    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${sub._id}/audit`)
      .set(auth("admin"));

    expectStatus(res, 200, "audit retrieve");
    assert.strictEqual(res.body.data.invariants.kitchenQueueLinkedCorrectly, false);
    assert(res.body.data.warnings.some(w => w.includes("Kitchen queue mismatch")));
  });

  await test("Test: 4 add-ons available -> pickup 2 add-ons -> future availability must return only 2 add-ons", async () => {
    const Setting = require("../src/models/Setting");
    await Setting.deleteMany({ key: { $in: ["pickup_locations", "restaurant_is_open"] } });
    await Setting.create([
      {
        key: "pickup_locations",
        value: [{
          id: "main",
          key: "main",
          code: "main",
          slug: "main",
          branchId: "main",
          pickupLocationId: "main",
          name: { ar: "الفرع الرئيسي", en: "Main Branch" },
          isActive: true,
          active: true,
          enabled: true,
          isAvailable: true,
          available: true,
          pickupEnabled: true,
          isPickupEnabled: true,
          supportsPickup: true,
        }]
      },
      {
        key: "restaurant_is_open",
        value: true
      }
    ]);

    const today = dateUtils.getTodayKSADate();
    const nextMonth = dateUtils.addDaysToKSADateString(today, 30);
    const addonId = new mongoose.Types.ObjectId();
    const sub = await Subscription.create({
      userId: customer._id,
      planId: new mongoose.Types.ObjectId(),
      status: "active",
      totalMeals: 10,
      remainingMeals: 10,
      deliveryMode: "pickup",
      addonBalance: [
        { addonId, purchasedQty: 4, remainingQty: 0 }
      ],
      startDate: today,
      endDate: nextMonth,
    });

    const mealSlotId = new mongoose.Types.ObjectId();
    const day = await SubscriptionDay.create({
      subscriptionId: sub._id,
      date: today,
      status: "open",
      mealSlots: [
        { _id: mealSlotId, slotIndex: 1, slotKey: "slot_1", selectionType: "standard_meal", status: "complete" }
      ],
      addonSelections: [
        { _id: new mongoose.Types.ObjectId(), addonId, category: "juice", source: "wallet", priceHalala: 0 },
        { _id: new mongoose.Types.ObjectId(), addonId, category: "juice", source: "wallet", priceHalala: 0 },
        { _id: new mongoose.Types.ObjectId(), addonId, category: "juice", source: "wallet", priceHalala: 0 },
        { _id: new mongoose.Types.ObjectId(), addonId, category: "juice", source: "wallet", priceHalala: 0 },
      ]
    });

    const { getPickupAvailabilityForClient, createSubscriptionPickupRequestForClient } = require("../src/services/subscription/subscriptionPickupRequestClientService");
    let avail = await getPickupAvailabilityForClient({
      userId: customer._id,
      subscriptionId: sub._id,
      date: today,
    });

    assert.strictEqual(avail.pickupItems.filter(i => i.itemType === "addon").length, 4);

    const mealSlotItemId = "slot_1";
    const addonItemIds = avail.pickupItems.filter(i => i.itemType === "addon").slice(0, 2).map(i => i.itemId);

    const pickupRes = await createSubscriptionPickupRequestForClient({
      userId: customer._id,
      subscriptionId: sub._id,
      date: today,
      mealCount: 0,
      selectedPickupItemIds: [mealSlotItemId, ...addonItemIds],
    });

    avail = await getPickupAvailabilityForClient({
      userId: customer._id,
      subscriptionId: sub._id,
      date: today,
    });
    const remainingAddonItems = avail.pickupItems.filter(i => i.itemType === "addon");
    assert.strictEqual(remainingAddonItems.length, 2);
    assert(!remainingAddonItems.map(i => i.itemId).includes(addonItemIds[0]));
    assert(!remainingAddonItems.map(i => i.itemId).includes(addonItemIds[1]));

    const subBeforeFulfill = await Subscription.findById(sub._id);
    assert.strictEqual(subBeforeFulfill.addonBalance[0].remainingQty, 0);

    // Transition request to ready_for_pickup to allow fulfillment
    const pr = await SubscriptionPickupRequest.findById(pickupRes.pickupRequest._id);
    pr.status = "ready_for_pickup";
    await pr.save();

    const { fulfillSubscriptionPickupRequest } = require("../src/services/fulfillmentService");
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const fulfillRes = await fulfillSubscriptionPickupRequest({
        requestId: pickupRes.pickupRequest._id,
        session,
        actorId: customer._id
      });
      if (!fulfillRes.ok) {
        throw new Error(`Fulfillment failed: ${fulfillRes.message}`);
      }
      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }

    // After fulfillment:
    // 1. Wallet balance must still be 0 (they are NOT refunded to wallet)
    const updatedSub = await Subscription.findById(sub._id);
    assert.strictEqual(updatedSub.addonBalance[0].remainingQty, 0);

    // 2. Call pickup availability again for the same day
    const availAfter = await getPickupAvailabilityForClient({
      userId: customer._id,
      subscriptionId: sub._id,
      date: today,
    });

    const remainingAddonItemsAfter = availAfter.pickupItems.filter(i => i.itemType === "addon");
    // Expected 2 unpicked add-ons still show as available
    assert.strictEqual(remainingAddonItemsAfter.length, 2);
    // The 2 picked add-ons must not appear in the available list
    assert(!remainingAddonItemsAfter.map(i => i.itemId).includes(addonItemIds[0]));
    assert(!remainingAddonItemsAfter.map(i => i.itemId).includes(addonItemIds[1]));

    // Check no duplicate pickup item ids
    const allItemIds = availAfter.pickupItems.map(i => i.itemId);
    const uniqueItemIds = new Set(allItemIds);
    assert.strictEqual(allItemIds.length, uniqueItemIds.size);

    // 3. Check audit results
    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${sub._id}/audit`)
      .set(auth("admin"));

    expectStatus(res, 200, "audit retrieve");
    
    const auditAddon = res.body.data.addonEntitlements.itemAddons[0];
    assert.strictEqual(auditAddon.remainingQty, 0); // wallet balance
    assert.strictEqual(auditAddon.usedQty, 4);      // total planned
    assert.strictEqual(auditAddon.pickedQty, 2);    // picked count
    assert.strictEqual(auditAddon.remainingPlannedQty, 2); // remaining planned count
    assert.strictEqual(res.body.data.invariants.addonsBalanceValid, true);

    await Subscription.deleteOne({ _id: sub._id });
    await SubscriptionDay.deleteOne({ _id: day._id });
    await SubscriptionPickupRequest.deleteMany({ subscriptionId: sub._id });
  });

  console.log(`\n==========================================`);
  console.log(`RESULTS: ${results.passed} passed, ${results.failed} failed`);
  console.log(`==========================================\n`);

  await cleanup();
  await mongoose.disconnect();

  if (results.failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
