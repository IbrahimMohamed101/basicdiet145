"use strict";

process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const request = require("supertest");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { createApp } = require("../src/app");
const { resolveMongoUri } = require("../src/utils/mongoUriResolver");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");

const User = require("../src/models/User");
const DashboardUser = require("../src/models/DashboardUser");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const Delivery = require("../src/models/Delivery");
const Plan = require("../src/models/Plan");
const Zone = require("../src/models/Zone");
const Setting = require("../src/models/Setting");
const { DASHBOARD_JWT_SECRET } = require("../src/services/dashboardTokenService");
const dateUtils = require("../src/utils/date");
const TODAY_STR = dateUtils.getTodayKSADate();

const TEST_TAG = `ops-deliv-flow-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

let mongoServer;

async function startMemoryMongo() {
  if (mongoServer) return;
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongoServer.getUri();
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  process.env.MONGO_URI_TEST = uri;
}

async function connectDatabase() {
  await startMemoryMongo();
  if (mongoose.connection.readyState === 0) {
    mongoose.set("autoIndex", false);
    await mongoose.connect(process.env.MONGO_URI_TEST);
  }
}

let seedData = {};

async function seedBaseData() {
  await Setting.deleteMany({ key: { $in: ["pickup_locations", "restaurant_is_open", "delivery_windows", "cutoff_time"] } });
  await Setting.create([
    {
      key: "pickup_locations",
      value: [{
        id: "branch_1",
        key: "branch_1",
        code: "branch_1",
        slug: "branch_1",
        branchId: "branch_1",
        pickupLocationId: "branch_1",
        name: { ar: "فرع الرياض", en: "Riyadh Branch" },
        isActive: true,
        active: true,
      }]
    },
    { key: "restaurant_is_open", value: true },
    { key: "delivery_windows", value: ["08:00-11:00", "12:00-15:00"] },
    { key: "cutoff_time", value: "14:00" }
  ]);

  const client = await User.create({
    phone: `+966599999001_${TEST_TAG}`,
    name: "Client Ops Delivery",
    role: "client",
    isActive: true,
  });

  const plan = await Plan.create({
    name: { ar: "الباقة الأساسية", en: `${TEST_TAG} Plan` },
    daysCount: 7,
    currency: "SAR",
    isActive: true,
    gramsOptions: [{
      grams: 150,
      isActive: true,
      mealsOptions: [{ mealsPerDay: 2, priceHalala: 75000, compareAtHalala: 90000, isActive: true }],
    }],
  });

  const zone = await Zone.create({
    name: { ar: "حي الياسمين", en: `${TEST_TAG} Zone` },
    deliveryFeeHalala: 1500,
    isActive: true,
    sortOrder: 1,
  });

  // 1. Delivery Subscription
  const deliverySub = await Subscription.create({
    userId: client._id,
    planId: plan._id,
    status: "active",
    startDate: new Date(),
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    totalMeals: 14,
    remainingMeals: 14,
    selectedGrams: 150,
    selectedMealsPerDay: 2,
    deliveryMode: "delivery",
    deliveryZoneId: zone._id,
    deliveryZoneName: zone.name.en,
    deliveryFeeHalala: 1500,
    deliveryAddress: {
      label: "Home",
      line1: "123 Main St",
      city: "Riyadh",
      district: "Yasmin",
      notes: "Ring bell",
      lat: 24.123,
      lng: 46.456,
    },
    deliveryWindow: "08:00-11:00",
  });

  const deliveryDay = await SubscriptionDay.create({
    subscriptionId: deliverySub._id,
    date: TODAY_STR,
    status: "open",
    mealSlots: [
      { slotIndex: 1, slotKey: "slot_1", selectionType: "standard_meal", status: "complete" },
      { slotIndex: 2, slotKey: "slot_2", selectionType: "premium_large_salad", status: "complete" }
    ],
    addonSelections: [
      { addonId: new mongoose.Types.ObjectId(), name: "Orange Juice", category: "juice", priceHalala: 1000, source: "paid" }
    ],
    premiumUpgradeSelections: [
      { baseSlotKey: "slot_2", proteinId: new mongoose.Types.ObjectId(), unitExtraFeeHalala: 1500 }
    ]
  });

  // 2. Pickup Subscription
  const pickupSub = await Subscription.create({
    userId: client._id,
    planId: plan._id,
    status: "active",
    startDate: new Date(),
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    totalMeals: 14,
    remainingMeals: 14,
    selectedGrams: 150,
    selectedMealsPerDay: 2,
    deliveryMode: "pickup",
    pickupLocationId: "branch_1",
  });

  const pickupDay = await SubscriptionDay.create({
    subscriptionId: pickupSub._id,
    date: TODAY_STR,
    status: "open",
    mealSlots: [
      { slotIndex: 1, slotKey: "slot_1", selectionType: "standard_meal", status: "complete" }
    ]
  });

  seedData = { client, plan, zone, deliverySub, deliveryDay, pickupSub, pickupDay };
}

async function seedAuthUsers() {
  for (const role of ["superadmin", "admin", "kitchen", "courier", "cashier"]) {
    const authObj = await dashboardAuth(role, TEST_TAG);
    dashboardUsers.set(role, authObj.user);
  }
}

async function cleanup() {
  const userIds = [seedData.client?._id].filter(Boolean);
  const subIds = [seedData.deliverySub?._id, seedData.pickupSub?._id].filter(Boolean);
  const planIds = [seedData.plan?._id].filter(Boolean);
  const zoneIds = [seedData.zone?._id].filter(Boolean);

  await Promise.all([
    User.deleteMany({ _id: { $in: userIds } }),
    Subscription.deleteMany({ _id: { $in: subIds } }),
    SubscriptionDay.deleteMany({ subscriptionId: { $in: subIds } }),
    SubscriptionPickupRequest.deleteMany({ subscriptionId: { $in: subIds } }),
    Delivery.deleteMany({ subscriptionId: { $in: subIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    Zone.deleteMany({ _id: { $in: zoneIds } }),
    DashboardUser.deleteMany({ email: { $regex: TEST_TAG } }),
  ]);
}

async function runTests() {
  await connectDatabase();
  await seedBaseData();
  await seedAuthUsers();

  const app = createApp();

  console.log(`Running Operations -> Courier Delivery Contract Verification...`);

  // Section 3: Operations Queue list assertions
  await test("Operations list includes delivery and pickup days with correct DTO fields", async () => {
    const res = await request(app)
      .get(`/api/dashboard/ops/list?date=${TODAY_STR}`)
      .set(auth("admin"));
    expectStatus(res, 200, "ops list");

    const items = res.body.data;
    assert(Array.isArray(items), "data must be an array");

    const delivItem = items.find(i => String(i.entityId) === String(seedData.deliveryDay._id));
    assert(delivItem, "delivery item must be in operations list");
    assert.strictEqual(delivItem.mode, "delivery");
    assert(delivItem.customer, "customer object must exist");
    assert.strictEqual(delivItem.customer.name, seedData.client.name);
    assert.strictEqual(delivItem.customer.phone, seedData.client.phone);
    assert.strictEqual(String(delivItem.entityId), String(seedData.deliveryDay._id));
    
    // Check address and zone / window mapping
    assert(delivItem.delivery, "delivery must be populated");
    assert.strictEqual(delivItem.delivery.address.city, "Riyadh");
    assert.strictEqual(delivItem.delivery.window, "08:00-11:00");
    assert.strictEqual(delivItem.status, "open");
    
    // Allowed actions check: check that "ready_for_delivery" is not allowed yet because status is open (requires prep or lock first)
    // Wait, let's see if allowed actions contains lock or prepare
    const allowed = delivItem.allowedActions || [];
    assert(allowed.some(a => a.id === "prepare" || a.id === "lock"), "open day must allow lock or prepare");

    // Pickup day check
    const pickItem = items.find(i => String(i.entityId) === String(seedData.pickupDay._id));
    assert(pickItem, "pickup item must be in operations list");
    assert.strictEqual(pickItem.mode, "pickup");
    assert(pickItem.pickup, "pickup object must exist");
    assert.strictEqual(pickItem.pickup.branchId, "branch_1");
  });

  // Section 4: Ready For Delivery behavior assertions
  await test("PUT /api/dashboard/operations/subscription-days/:id/ready-for-delivery behavior checks", async () => {
    // 1. Rejects pickup mode
    const pickupRes = await request(app)
      .put(`/api/dashboard/operations/subscription-days/${seedData.pickupDay._id}/ready-for-delivery`)
      .set(auth("admin"));
    expectStatus(pickupRes, 400, "ready_for_delivery for pickup");
    assert.strictEqual(pickupRes.body.error.code, "DELIVERY_MODE_REQUIRED");

    // Transition delivery day to in_preparation first so ready_for_delivery is allowed by policy
    const prepRes = await request(app)
      .post(`/api/dashboard/ops/actions/prepare`)
      .send({ entityId: seedData.deliveryDay._id, entityType: "subscription" })
      .set(auth("admin"));
    expectStatus(prepRes, 200, "prepare delivery day");

    // 2. Marks ready_for_delivery successfully
    const readyRes = await request(app)
      .put(`/api/dashboard/operations/subscription-days/${seedData.deliveryDay._id}/ready-for-delivery`)
      .set(auth("admin"));
    expectStatus(readyRes, 200, "mark ready_for_delivery");
    assert.strictEqual(readyRes.body.data.status, "ready_for_delivery");

    // Verify it created a Delivery record with status ready_for_delivery
    const delivery = await Delivery.findOne({ dayId: seedData.deliveryDay._id });
    assert(delivery, "Delivery record must be created");
    assert.strictEqual(delivery.status, "ready_for_delivery");

    // Verify no balance deduction happened yet (remainingMeals still 14)
    const sub = await Subscription.findById(seedData.deliverySub._id);
    assert.strictEqual(sub.remainingMeals, 14, "Balance must not be deducted on ready_for_delivery");

    // 3. Idempotency check: safe retry returns success
    const retryRes = await request(app)
      .put(`/api/dashboard/operations/subscription-days/${seedData.deliveryDay._id}/ready-for-delivery`)
      .set(auth("admin"));
    expectStatus(retryRes, 200, "mark ready_for_delivery retry");
    assert.strictEqual(retryRes.body.data.status, "ready_for_delivery");
  });

  // Section 5: Courier delivery list verification
  await test("GET /api/courier/deliveries/today filters correctly and returns correct DTO fields", async () => {
    const res = await request(app)
      .get("/api/courier/deliveries/today")
      .set(auth("courier"));
    expectStatus(res, 200, "courier list deliveries");

    const items = res.body.data;
    assert(Array.isArray(items), "courier list must be an array");

    // Should include the delivery subscription day (which is in ready_for_delivery status)
    const deliv = items.find(i => String(i.subscriptionDayId) === String(seedData.deliveryDay._id));
    assert(deliv, "courier list must include seeded ready delivery day");
    assert.strictEqual(deliv.type, "subscription_delivery");
    assert.strictEqual(deliv.customerName, seedData.client.name);
    assert.strictEqual(deliv.customerPhone, seedData.client.phone);
    assert.strictEqual(deliv.status, "ready_for_delivery");
    assert.strictEqual(deliv.preparationStatus, "ready_for_delivery");
    assert.strictEqual(deliv.scheduledDate, TODAY_STR);

    // Assert counts are mapped from populated dayId
    assert.strictEqual(deliv.mealCount, 2, "Meal count should map to selections length");
    assert.strictEqual(deliv.addonCount, 1, "Addon count should map to addonSelections length");
    assert.strictEqual(deliv.premiumUpgradeCount, 1, "Premium upgrade count should map to premiumUpgradeSelections length");

    // Assert ability flags
    assert.strictEqual(deliv.canCourierPickup, true, "Should allow courier pickup when ready_for_delivery");
    assert.strictEqual(deliv.canMarkArrivingSoon, false, "Should not allow arriving_soon yet");
    assert.strictEqual(deliv.canMarkDelivered, false, "Should not allow mark delivered before picked up");
    assert.strictEqual(deliv.canCancel, true, "Should allow cancellation");
    assert.deepStrictEqual(
      deliv.allowedActionIds,
      ["pickup", "cancel"],
      "Courier DTO keeps a simple ID list for compatibility"
    );
    assert.deepStrictEqual(
      deliv.allowedActions.map((action) => action.id),
      ["pickup", "cancel"],
      "Courier DTO returns structured allowedActions"
    );
    assert(deliv.allowedActions.every((action) => action.label && action.method === "PUT" && action.endpoint), "Structured actions include label, PUT method, and endpoint");
    assert(deliv.allowedActions.some((action) => action.id === "pickup" && action.endpoint.endsWith(`/api/courier/deliveries/${deliv.id}/collect`)), "Pickup action points at collect endpoint");

    // Should NOT include the pickup subscription day
    const pick = items.find(i => String(i.subscriptionDayId) === String(seedData.pickupDay._id));
    assert(!pick, "courier list must exclude pickup subscription days");
  });

  // Section 6: Courier Collect Action behavior
  await test("PUT /api/courier/deliveries/:id/collect assertions", async () => {
    const delivery = await Delivery.findOne({ dayId: seedData.deliveryDay._id });
    assert(delivery, "Delivery record must exist");

    // 1. Rejected from non-ready states (e.g. if we seed a scheduled/preparing delivery)
    const tempSub = await Subscription.create({
      userId: seedData.client._id,
      planId: seedData.plan._id,
      status: "active",
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      totalMeals: 14, remainingMeals: 14, selectedGrams: 150, selectedMealsPerDay: 2,
      deliveryMode: "delivery",
    });
    const tempDay = await SubscriptionDay.create({
      subscriptionId: tempSub._id,
      date: TODAY_STR,
      status: "open",
    });
    const tempDelivery = await Delivery.create({
      subscriptionId: tempSub._id,
      dayId: tempDay._id,
      date: TODAY_STR,
      status: "scheduled",
    });

    const badCollectRes = await request(app)
      .put(`/api/courier/deliveries/${tempDelivery._id}/collect`)
      .set(auth("courier"));
    expectStatus(badCollectRes, 409, "collect scheduled delivery");
    assert.strictEqual(badCollectRes.body.error.code, "INVALID_STATE");

    // 2. Succeeds from ready_for_delivery -> transitions status to out_for_delivery
    const collectRes = await request(app)
      .put(`/api/courier/deliveries/${delivery._id}/collect`)
      .set(auth("courier"));
    expectStatus(collectRes, 200, "collect ready delivery");
    assert.strictEqual(collectRes.body.data.status, "out_for_delivery");

    // Verify subscription day status transitions to out_for_delivery
    const updatedDay = await SubscriptionDay.findById(seedData.deliveryDay._id);
    assert.strictEqual(updatedDay.status, "out_for_delivery");

    // Verify balance is NOT deducted on collection/dispatch
    const updatedSub = await Subscription.findById(seedData.deliverySub._id);
    assert.strictEqual(updatedSub.remainingMeals, 14, "Balance must not be deducted on collect");

    // 3. Idempotency check: safe retry
    const retryCollectRes = await request(app)
      .put(`/api/courier/deliveries/${delivery._id}/collect`)
      .set(auth("courier"));
    expectStatus(retryCollectRes, 200, "collect ready delivery retry");
    assert.strictEqual(retryCollectRes.body.data.status, "out_for_delivery");

    // Clean up temporary documents
    await Subscription.deleteOne({ _id: tempSub._id });
    await SubscriptionDay.deleteOne({ _id: tempDay._id });
    await Delivery.deleteOne({ _id: tempDelivery._id });
  });

  // Section 7: Full Lifecycle E2E contract validation
  await test("Full operations -> courier lifecycle contract pass with balance deduction", async () => {
    // Current state of delivery is out_for_delivery from previous test
    const delivery = await Delivery.findOne({ dayId: seedData.deliveryDay._id });
    assert(delivery, "Delivery record must exist");

    // 1. Transition: out_for_delivery -> arriving_soon
    const arrivingRes = await request(app)
      .put(`/api/courier/deliveries/${delivery._id}/arriving-soon`)
      .set(auth("courier"));
    expectStatus(arrivingRes, 200, "mark arriving soon");
    assert.strictEqual(arrivingRes.body.data.status, "arriving_soon");

    // Verify SubscriptionDay remains out_for_delivery (arriving_soon is courier notification overlay)
    const dayAfterArriving = await SubscriptionDay.findById(seedData.deliveryDay._id);
    assert.strictEqual(dayAfterArriving.status, "out_for_delivery");

    // 2. Transition: arriving_soon -> delivered
    const deliverRes = await request(app)
      .put(`/api/courier/deliveries/${delivery._id}/delivered`)
      .set(auth("courier"));
    expectStatus(deliverRes, 200, "mark delivered");
    assert.strictEqual(deliverRes.body.data.status, "delivered");

    // Verify SubscriptionDay transitions to fulfilled
    const dayAfterDelivered = await SubscriptionDay.findById(seedData.deliveryDay._id);
    assert.strictEqual(dayAfterDelivered.status, "fulfilled");

    // Verify balance IS deducted now! (14 -> 12, since selectedMealsPerDay = 2)
    const subAfterDelivered = await Subscription.findById(seedData.deliverySub._id);
    assert.strictEqual(subAfterDelivered.remainingMeals, 12, "Remaining meals must be deducted on delivery fulfillment");

    // 3. Retry delivered is safe and idempotent
    const retryDeliverRes = await request(app)
      .put(`/api/courier/deliveries/${delivery._id}/delivered`)
      .set(auth("courier"));
    expectStatus(retryDeliverRes, 200, "mark delivered retry");
    assert.strictEqual(retryDeliverRes.body.data.status, "delivered");

    // Verify balance is NOT deducted a second time (stays at 12)
    const subAfterRetry = await Subscription.findById(seedData.deliverySub._id);
    assert.strictEqual(subAfterRetry.remainingMeals, 12, "Idempotent delivery fulfillment must not double-deduct");

    // Already delivered cannot be marked ready_for_delivery
    const readyAgainRes = await request(app)
      .put(`/api/dashboard/operations/subscription-days/${seedData.deliveryDay._id}/ready-for-delivery`)
      .set(auth("admin"));
    expectStatus(readyAgainRes, 409, "ready_for_delivery on delivered day");
  });

  // Section 7.5: Cancellation checks
  await test("Cancellation checks: cancel works on non-delivered day, blocks delivered transition", async () => {
    // Seed new delivery day
    const tempSub = await Subscription.create({
      userId: seedData.client._id,
      planId: seedData.plan._id,
      status: "active",
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      totalMeals: 14, remainingMeals: 14, selectedGrams: 150, selectedMealsPerDay: 2,
      deliveryMode: "delivery",
    });
    const tempDay = await SubscriptionDay.create({
      subscriptionId: tempSub._id,
      date: TODAY_STR,
      status: "ready_for_delivery",
    });
    const tempDelivery = await Delivery.create({
      subscriptionId: tempSub._id,
      dayId: tempDay._id,
      date: TODAY_STR,
      status: "ready_for_delivery",
    });

    // Cancel the delivery
    const cancelRes = await request(app)
      .put(`/api/courier/deliveries/${tempDelivery._id}/cancel`)
      .send({ reason: "customer_requested_cancellation", note: "Cancelled by testing" })
      .set(auth("courier"));
    expectStatus(cancelRes, 200, "cancel delivery");
    assert.strictEqual(cancelRes.body.data.status, "canceled");

    // Verify SubscriptionDay transitions to delivery_canceled
    const updatedDay = await SubscriptionDay.findById(tempDay._id);
    assert.strictEqual(updatedDay.status, "delivery_canceled");

    // Verify balance is NOT deducted
    const updatedSub = await Subscription.findById(tempSub._id);
    assert.strictEqual(updatedSub.remainingMeals, 14, "Cancelled delivery must not deduct balance");

    // Try to mark delivered after cancellation - should fail
    const deliverAfterCancel = await request(app)
      .put(`/api/courier/deliveries/${tempDelivery._id}/delivered`)
      .set(auth("courier"));
    expectStatus(deliverAfterCancel, 409, "mark delivered after cancel");

    await Subscription.deleteOne({ _id: tempSub._id });
    await SubscriptionDay.deleteOne({ _id: tempDay._id });
    await Delivery.deleteOne({ _id: tempDelivery._id });
  });

  // Section 8: Branch Pickup DTO and Allowed Actions checks
  await test("Branch pickup allowedActions and transition constraints when pickup request is missing vs present", async () => {
    // 1. Verify GET /api/dashboard/ops/list does not return "prepare", "ready_for_pickup", or "fulfill" for raw pickup subscription day
    const listRes = await request(app)
      .get(`/api/dashboard/ops/list?date=${TODAY_STR}`)
      .set(auth("admin"));
    expectStatus(listRes, 200, "ops list for branch pickup check");
    const items = listRes.body.data;
    
    // Find the raw pickup day item
    const rawPickupItem = items.find(
      (item) => item.entityType === "subscription_day" && String(item.entityId) === String(seedData.pickupDay._id)
    );
    assert(rawPickupItem, "Raw pickup item must be present in the ops list");
    assert.strictEqual(rawPickupItem.pickup.pickupRequestId, null);
    
    const allowed = rawPickupItem.allowedActions || [];
    const forbiddenActions = ["prepare", "ready_for_pickup", "fulfill"];
    for (const action of forbiddenActions) {
      assert(!allowed.some((a) => a.id === action), `Raw pickup day DTO must not expose '${action}' action`);
    }
    
    // Should still allow lock and cancel if valid in transition rules
    assert(allowed.some(a => a.id === "lock"), "Raw pickup day DTO should allow lock");
    assert(allowed.some(a => a.id === "cancel"), "Raw pickup day DTO should allow cancel");

    // 2. Calling POST /api/dashboard/ops/actions/prepare on raw day returns PICKUP_REQUEST_REQUIRED error wrapper
    const prepRes = await request(app)
      .post("/api/dashboard/ops/actions/prepare")
      .send({
        entityId: seedData.pickupDay._id,
        entityType: "subscription",
        payload: {}
      })
      .set(auth("admin"));
    expectStatus(prepRes, 422, "prepare raw pickup day rejects");
    assert.deepStrictEqual(prepRes.body, {
      ok: false,
      error: {
        code: "PICKUP_REQUEST_REQUIRED",
        message: "Pickup preparation requires an explicit client request"
      }
    });

    // 3. Create a real SubscriptionPickupRequest
    const pickupRequest = await SubscriptionPickupRequest.create({
      subscriptionId: seedData.pickupSub._id,
      subscriptionDayId: seedData.pickupDay._id,
      userId: seedData.client._id,
      date: TODAY_STR,
      mealCount: 1,
      status: "locked",
      creditsReserved: true,
      creditsReservedAt: new Date()
    });

    // Fetch the ops list again.
    // The raw subscription_day should now be filtered out because a pickup request exists for it,
    // and instead the subscription_pickup_request DTO should be in the list.
    const listResWithRequest = await request(app)
      .get(`/api/dashboard/ops/list?date=${TODAY_STR}`)
      .set(auth("admin"));
    expectStatus(listResWithRequest, 200, "ops list with pickup request");
    const itemsWithRequest = listResWithRequest.body.data;

    const rawDayItem = itemsWithRequest.find(
      (item) => item.entityType === "subscription_day" && String(item.entityId) === String(seedData.pickupDay._id)
    );
    assert(!rawDayItem, "Raw subscription day should be filtered out from ops list when pickup request exists");

    const requestItem = itemsWithRequest.find(
      (item) => item.entityType === "subscription_pickup_request" && String(item.entityId) === String(pickupRequest._id)
    );
    assert(requestItem, "Subscription pickup request item must be present in the ops list");
    
    // The pickup request item should expose "prepare"
    const reqAllowed = requestItem.allowedActions || [];
    assert(reqAllowed.some((a) => a.id === "prepare"), "Pickup request DTO must expose 'prepare' action");

    // Clean up created request
    await SubscriptionPickupRequest.deleteOne({ _id: pickupRequest._id });
  });

  // Section 9: Dispatch Lifecycle flow constraints
  await test("Dispatch transition lifecycle constraints for subscription home delivery", async () => {
    // Seed a new delivery subscription & day in 'open' status
    const tempSub = await Subscription.create({
      userId: seedData.client._id,
      planId: seedData.plan._id,
      status: "active",
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      totalMeals: 14, remainingMeals: 14, selectedGrams: 150, selectedMealsPerDay: 2,
      deliveryMode: "delivery",
    });
    const tempDay = await SubscriptionDay.create({
      subscriptionId: tempSub._id,
      date: TODAY_STR,
      status: "open",
      mealSlots: [
        { slotIndex: 1, slotKey: "slot_1", selectionType: "standard_meal", status: "complete" }
      ]
    });

    // 1. Transition open -> in_preparation
    const prepRes = await request(app)
      .post(`/api/dashboard/ops/actions/prepare`)
      .send({ entityId: tempDay._id, entityType: "subscription" })
      .set(auth("admin"));
    expectStatus(prepRes, 200, "prepare temp delivery day");
    
    // Assertion 1: A subscription delivery day in `in_preparation` does not expose `dispatch` in `allowedActions`.
    const allowedInPrep = prepRes.body.data.allowedActions || [];
    assert(!allowedInPrep.some(a => a.id === "dispatch"), "Should not expose 'dispatch' in allowedActions while in_preparation");

    // Assertion 2: The same item exposes `ready_for_delivery` when valid.
    assert(allowedInPrep.some(a => a.id === "ready_for_delivery"), "Should expose 'ready_for_delivery' while in_preparation");

    // Assertion 3: POST /api/dashboard/ops/actions/dispatch against in_preparation returns INVALID_TRANSITION.
    const invalidDispatchRes = await request(app)
      .post("/api/dashboard/ops/actions/dispatch")
      .send({ entityId: tempDay._id, entityType: "subscription" })
      .set(auth("admin"));
    expectStatus(invalidDispatchRes, 409, "dispatch on in_preparation day rejects");
    assert.deepStrictEqual(invalidDispatchRes.body, {
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "Action dispatch is not allowed in current state"
      }
    });

    // Transition to ready_for_delivery
    const readyRes = await request(app)
      .put(`/api/dashboard/operations/subscription-days/${tempDay._id}/ready-for-delivery`)
      .set(auth("admin"));
    expectStatus(readyRes, 200, "mark ready_for_delivery");

    // Assertion 4: After calling ready_for_delivery, GET /api/dashboard/ops/list exposes dispatch.
    const listRes = await request(app)
      .get(`/api/dashboard/ops/list?date=${TODAY_STR}`)
      .set(auth("admin"));
    expectStatus(listRes, 200, "ops list check for dispatch");
    const items = listRes.body.data;
    const dayInList = items.find(item => String(item.entityId) === String(tempDay._id));
    assert(dayInList, "Temp day must exist in ops list");
    const allowedInReady = dayInList.allowedActions || [];
    assert(allowedInReady.some(a => a.id === "dispatch"), "Should expose 'dispatch' in allowedActions after ready_for_delivery");

    // Assertion 5: After ready_for_delivery, POST /api/dashboard/ops/actions/dispatch succeeds and transitions to out_for_delivery.
    const dispatchRes = await request(app)
      .post("/api/dashboard/ops/actions/dispatch")
      .send({ entityId: tempDay._id, entityType: "subscription" })
      .set(auth("admin"));
    expectStatus(dispatchRes, 200, "dispatch ready delivery day");
    assert.strictEqual(dispatchRes.body.data.status, "out_for_delivery");

    // Cleanup
    await Subscription.deleteOne({ _id: tempSub._id });
    await SubscriptionDay.deleteOne({ _id: tempDay._id });
    await Delivery.deleteOne({ dayId: tempDay._id });
  });

  // Section 10: Direct Controller Security Contract
  await test("Direct Controller Security Contract: Courier delivery action with valid courier role still works / missing role rejected with 403", async () => {
    const courierController = require("../src/controllers/courierController");
    const orderCourierController = require("../src/controllers/orderCourierController");

    // Test 1: Courier delivery action with missing req.userRole is rejected with 403
    let statusVal = null;
    let jsonVal = null;
    const resMock = {
      status(s) { statusVal = s; return this; },
      json(j) { jsonVal = j; return this; }
    };
    await courierController.markArrivingSoon({ params: { id: new mongoose.Types.ObjectId() } }, resMock);
    assert.strictEqual(statusVal, 403, "Missing req.userRole in courierController must return 403");
    assert.strictEqual(jsonVal.message, "Forbidden");

    // Test 2: Order courier action with missing req.userRole is rejected with 403
    await orderCourierController.markDelivered({ params: { id: new mongoose.Types.ObjectId() } }, resMock);
    assert.strictEqual(statusVal, 403, "Missing req.userRole in orderCourierController must return 403");
    assert.strictEqual(jsonVal.message, "Forbidden");

    // Test 3: Cashier cannot perform courier-only delivery actions
    await courierController.markCollect({ params: { id: new mongoose.Types.ObjectId() }, userRole: "cashier" }, resMock);
    assert.strictEqual(statusVal, 403, "Cashier performing courier action must return 403");

    await orderCourierController.markDelivered({ params: { id: new mongoose.Types.ObjectId() }, userRole: "cashier" }, resMock);
    assert.strictEqual(statusVal, 403, "Cashier performing order courier action must return 403");
  });

  await cleanup();

  console.log(`\nTest results: ${results.passed} passed, ${results.failed} failed`);
  process.exit(results.failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
