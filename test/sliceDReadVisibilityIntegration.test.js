const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const subscriptionController = require("../src/controllers/subscriptionController");
const adminController = require("../src/controllers/adminController");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const User = require("../src/models/User");
const PremiumMeal = require("../src/models/PremiumMeal");
const Addon = require("../src/models/Addon");
const Plan = require("../src/models/Plan");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createReqRes({ params = {}, query = {}, userId = objectId() } = {}) {
  const req = {
    params,
    query,
    userId,
    headers: {},
    get() {
      return undefined;
    },
  };

  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };

  return { req, res };
}

function createQueryStub(result) {
  return {
    sort() {
      return this;
    },
    skip() {
      return this;
    },
    limit() {
      return this;
    },
    select() {
      return this;
    },
    populate() {
      return Promise.resolve(result);
    },
    lean() {
      return Promise.resolve(result);
    },
  };
}

function createCanonicalSubscriptionDoc(userId) {
  const planId = objectId();
  return {
    _id: objectId(),
    userId,
    planId,
    status: "active",
    selectedGrams: 150,
    selectedMealsPerDay: 3,
    totalMeals: 15,
    basePlanPriceHalala: 10000,
    startDate: new Date("2026-03-19T21:00:00.000Z"),
    deliveryMode: "delivery",
    deliveryWindow: "8 AM - 11 AM",
    deliveryAddress: { city: "Riyadh" },
    deliverySlot: { type: "delivery", window: "8 AM - 11 AM", slotId: "slot-1" },
    premiumBalance: [],
    addonBalance: [],
    premiumSelections: [],
    addonSelections: [],
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractCompleteness: "authoritative",
    contractSource: "customer_checkout",
    contractSnapshot: {
      plan: {
        planId: String(planId),
        planName: { ar: "الخطة الذهبية", en: "Gold Plan" },
        selectedGrams: 150,
        mealsPerDay: 3,
        totalMeals: 15,
      },
      start: { resolvedStartDate: "2026-03-19T21:00:00.000Z" },
      pricing: { basePlanPriceHalala: 10000 },
      delivery: {
        mode: "delivery",
        slot: { window: "8 AM - 11 AM", slotId: "slot-1" },
      },
      policySnapshot: {
        freezePolicy: { enabled: false, maxDays: 2, maxTimes: 1 },
      },
    },
  };
}

test("getSubscription exposes only minimal additive contract fields for user APIs", async (t) => {
  const originalFlag = process.env.PHASE1_SNAPSHOT_FIRST_READS;
  process.env.PHASE1_SNAPSHOT_FIRST_READS = "true";
  t.after(() => {
    process.env.PHASE1_SNAPSHOT_FIRST_READS = originalFlag;
  });

  const originalFindById = Subscription.findById;
  const originalPremiumFind = PremiumMeal.find;
  const originalAddonFind = Addon.find;
  t.after(() => {
    Subscription.findById = originalFindById;
    PremiumMeal.find = originalPremiumFind;
    Addon.find = originalAddonFind;
  });

  const userId = objectId();
  const subscription = createCanonicalSubscriptionDoc(userId);
  Subscription.findById = () => createQueryStub(subscription);
  PremiumMeal.find = () => createQueryStub([]);
  Addon.find = () => createQueryStub([]);

  const { req, res } = createReqRes({
    params: { id: String(subscription._id) },
    userId,
  });

  await subscriptionController.getSubscription(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.data.contract, {
    isCanonical: true,
    isGrandfathered: false,
    version: "subscription_contract.v1",
  });
  assert.equal("contractMeta" in res.payload.data, false);
});

test("getSubscriptionTimeline returns timeline payload and 200 status", async (t) => {
  const originalSubFindById = Subscription.findById;
  const originalDayFind = SubscriptionDay.find;
  t.after(() => {
    Subscription.findById = originalSubFindById;
    SubscriptionDay.find = originalDayFind;
  });

  const userId = objectId();
  const subscription = createCanonicalSubscriptionDoc(userId);
  subscription.endDate = new Date("2026-03-22T21:00:00.000Z");
  subscription.validityEndDate = new Date("2026-03-22T21:00:00.000Z");

  Subscription.findById = () => createQueryStub(subscription);
  SubscriptionDay.find = () =>
    createQueryStub([
      { date: "2026-03-21", status: "open" },
      { date: "2026-03-22", status: "fulfilled" },
    ]);

  const { req, res } = createReqRes({
    params: { id: String(subscription._id) },
    userId,
  });

  await subscriptionController.getSubscriptionTimeline(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data.subscriptionId, String(subscription._id));
  // Dates are normalized to KSA timezone (UTC+3)
  assert.equal(res.payload.data.validity.startDate, "2026-03-20");
  assert.equal(res.payload.data.validity.endDate, "2026-03-23");
  assert.equal(res.payload.data.days.length, 4);
  assert.equal(res.payload.data.days[0].status, "planned");
  assert.equal(res.payload.data.days[2].status, "delivered");
});

test("getSubscriptionTimeline returns 404 if subscription not found", async (t) => {
  const originalSubFindById = Subscription.findById;
  t.after(() => {
    Subscription.findById = originalSubFindById;
  });

  Subscription.findById = () => createQueryStub(null);

  const { req, res } = createReqRes({
    params: { id: String(objectId()) },
  });

  await subscriptionController.getSubscriptionTimeline(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.payload.ok, false);
  assert.equal(res.payload.error.code, "NOT_FOUND");
});

test("getSubscriptionTimeline forwards internal service errors via next", async (t) => {
  const originalSubFindById = Subscription.findById;
  const originalDayFind = SubscriptionDay.find;
  t.after(() => {
    Subscription.findById = originalSubFindById;
    SubscriptionDay.find = originalDayFind;
  });

  const userId = objectId();
  const subscription = createCanonicalSubscriptionDoc(userId);
  subscription.endDate = new Date("2026-03-22T21:00:00.000Z");
  subscription.validityEndDate = new Date("2026-03-22T21:00:00.000Z");

  Subscription.findById = () => createQueryStub(subscription);
  SubscriptionDay.find = () => {
    throw new Error("service failure");
  };

  const { req, res } = createReqRes({
    params: { id: String(subscription._id) },
    userId,
  });

  let capturedError;
  const next = (err) => {
    capturedError = err;
  };

  // Wrap with asyncHandler to mimic express error propagation
  await require("../src/middleware/asyncHandler")(subscriptionController.getSubscriptionTimeline)(req, res, next);

  assert.ok(capturedError instanceof Error);
  assert.equal(capturedError.message, "service failure");
});

test("admin detail and list reads expose contractMeta and snapshot-first plan name for canonical subscriptions", async (t) => {
  const originalFlag = process.env.PHASE1_SNAPSHOT_FIRST_READS;
  process.env.PHASE1_SNAPSHOT_FIRST_READS = "true";
  t.after(() => {
    process.env.PHASE1_SNAPSHOT_FIRST_READS = originalFlag;
  });

  const originalSubscriptionFindById = Subscription.findById;
  const originalSubscriptionFind = Subscription.find;
  const originalCountDocuments = Subscription.countDocuments;
  const originalUserFindById = User.findById;
  const originalUserFind = User.find;
  const originalPremiumFind = PremiumMeal.find;
  const originalAddonFind = Addon.find;
  const originalPlanFind = Plan.find;
  t.after(() => {
    Subscription.findById = originalSubscriptionFindById;
    Subscription.find = originalSubscriptionFind;
    Subscription.countDocuments = originalCountDocuments;
    User.findById = originalUserFindById;
    User.find = originalUserFind;
    PremiumMeal.find = originalPremiumFind;
    Addon.find = originalAddonFind;
    Plan.find = originalPlanFind;
  });

  const userId = objectId();
  const subscription = createCanonicalSubscriptionDoc(userId);
  const user = { _id: userId, name: "Test User", phone: "+966500000000", email: "user@example.com", isActive: true };

  Subscription.findById = () => createQueryStub(subscription);
  Subscription.find = () => createQueryStub([subscription]);
  Subscription.countDocuments = async () => 1;
  User.findById = () => createQueryStub(user);
  User.find = () => createQueryStub([user]);
  PremiumMeal.find = () => createQueryStub([]);
  Addon.find = () => createQueryStub([]);
  Plan.find = () => createQueryStub([]);

  const detail = createReqRes({
    params: { id: String(subscription._id) },
  });
  await adminController.getSubscriptionAdmin(detail.req, detail.res);

  assert.equal(detail.res.statusCode, 200);
  assert.equal(detail.res.payload.data.planName, "الخطة الذهبية");
  assert.equal(detail.res.payload.data.contractMeta.isCanonical, true);
  assert.equal(detail.res.payload.data.contractMeta.readMode, "snapshot_first");

  const list = createReqRes({
    query: { page: "1", limit: "20" },
  });
  await adminController.listSubscriptionsAdmin(list.req, list.res);

  assert.equal(list.res.statusCode, 200);
  assert.equal(Array.isArray(list.res.payload.data), true);
  assert.equal(list.res.payload.data[0].planName, "الخطة الذهبية");
  assert.equal(list.res.payload.data[0].contractMeta.isCanonical, true);
});

test("freezeSubscription uses snapshot freeze policy for canonical subscriptions when snapshot-first reads are enabled", async (t) => {
  const originalFlag = process.env.PHASE1_SNAPSHOT_FIRST_READS;
  process.env.PHASE1_SNAPSHOT_FIRST_READS = "true";
  t.after(() => {
    process.env.PHASE1_SNAPSHOT_FIRST_READS = originalFlag;
  });

  const originalFindById = Subscription.findById;
  t.after(() => {
    Subscription.findById = originalFindById;
  });

  const userId = objectId();
  const subscription = createCanonicalSubscriptionDoc(userId);
  subscription.endDate = new Date("2026-04-01T21:00:00.000Z");
  subscription.validityEndDate = new Date("2026-04-01T21:00:00.000Z");
  subscription.planId = {
    freezePolicy: { enabled: true, maxDays: 31, maxTimes: 1 },
  };

  Subscription.findById = () => createQueryStub(subscription);

  const { req, res } = createReqRes({
    params: { id: String(objectId()) },
    body: { startDate: "2026-03-20", days: 1 },
    userId,
  });

  await subscriptionController.freezeSubscription(req, res);

  assert.equal(res.statusCode, 422);
  assert.equal(res.payload.error.code, "FREEZE_DISABLED");
});
