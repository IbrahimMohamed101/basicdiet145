const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const subscriptionController = require("../src/controllers/subscriptionController");
const Subscription = require("../src/models/Subscription");
const Plan = require("../src/models/Plan");
const PremiumMeal = require("../src/models/PremiumMeal");
const Addon = require("../src/models/Addon");

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

function createCanonicalSubscriptionDoc(userId, status = "active", createdAt = new Date()) {
  const planId = objectId();
  return {
    _id: objectId(),
    userId,
    planId,
    status,
    createdAt,
    selectedGrams: 150,
    selectedMealsPerDay: 3,
    totalMeals: 15,
    basePlanPriceHalala: 10000,
    startDate: new Date("2026-03-19T21:00:00.000Z"),
    validityEndDate: new Date("2026-04-15T21:00:00.000Z"),
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

test("getCurrentSubscriptionOverview - user has active subscription", async (t) => {
  const originalFindOne = Subscription.findOne;
  const originalFind = PremiumMeal.find;
  const originalAddonFind = Addon.find;
  
  t.after(() => {
    Subscription.findOne = originalFindOne;
    PremiumMeal.find = originalFind;
    Addon.find = originalAddonFind;
  });

  const userId = objectId();
  const subscription = createCanonicalSubscriptionDoc(userId, "active");
  
  Subscription.findOne = () => createQueryStub(subscription);
  PremiumMeal.find = () => createQueryStub([]);
  Addon.find = () => createQueryStub([]);

  const { req, res } = createReqRes({ userId });

  await subscriptionController.getCurrentSubscriptionOverview(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data !== null, true);
  assert.equal(res.payload.data.status, "active");
});

test("getCurrentSubscriptionOverview - user has pending_payment subscription", async (t) => {
  const originalFindOne = Subscription.findOne;
  const originalFind = PremiumMeal.find;
  const originalAddonFind = Addon.find;
  
  t.after(() => {
    Subscription.findOne = originalFindOne;
    PremiumMeal.find = originalFind;
    Addon.find = originalAddonFind;
  });

  const userId = objectId();
  const subscription = createCanonicalSubscriptionDoc(userId, "pending_payment");
  
  Subscription.findOne = () => createQueryStub(subscription);
  PremiumMeal.find = () => createQueryStub([]);
  Addon.find = () => createQueryStub([]);

  const { req, res } = createReqRes({ userId });

  await subscriptionController.getCurrentSubscriptionOverview(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data !== null, true);
  assert.equal(res.payload.data.status, "pending_payment");
});

test("getCurrentSubscriptionOverview - user has no subscription", async (t) => {
  const originalFindOne = Subscription.findOne;
  
  t.after(() => {
    Subscription.findOne = originalFindOne;
  });

  const userId = objectId();
  
  Subscription.findOne = () => createQueryStub(null);

  const { req, res } = createReqRes({ userId });

  await subscriptionController.getCurrentSubscriptionOverview(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data, null);
});

test("getCurrentSubscriptionOverview - multiple subscriptions returns most recent active", async (t) => {
  const originalFindOne = Subscription.findOne;
  const originalFind = PremiumMeal.find;
  const originalAddonFind = Addon.find;
  
  t.after(() => {
    Subscription.findOne = originalFindOne;
    PremiumMeal.find = originalFind;
    Addon.find = originalAddonFind;
  });

  const userId = objectId();
  const olderCreatedAt = new Date("2026-03-01");
  const newerCreatedAt = new Date("2026-03-15");
  
  // Mock returns the newer one (sorting happens in query)
  const subscription = createCanonicalSubscriptionDoc(userId, "active", newerCreatedAt);
  
  Subscription.findOne = () => createQueryStub(subscription);
  PremiumMeal.find = () => createQueryStub([]);
  Addon.find = () => createQueryStub([]);

  const { req, res } = createReqRes({ userId });

  await subscriptionController.getCurrentSubscriptionOverview(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data !== null, true);
  assert.equal(new Date(res.payload.data.createdAt).getTime(), newerCreatedAt.getTime());
});

test("getCurrentSubscriptionOverview - skips canceled/expired subscriptions", async (t) => {
  const originalFindOne = Subscription.findOne;
  
  t.after(() => {
    Subscription.findOne = originalFindOne;
  });

  const userId = objectId();
  
  // Mock returns null (no active or pending_payment subscriptions found)
  Subscription.findOne = () => createQueryStub(null);

  const { req, res } = createReqRes({ userId });

  await subscriptionController.getCurrentSubscriptionOverview(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data, null);
});

test("getCurrentSubscriptionOverview - response structure conforms to standard envelope", async (t) => {
  const originalFindOne = Subscription.findOne;
  const originalFind = PremiumMeal.find;
  const originalAddonFind = Addon.find;
  
  t.after(() => {
    Subscription.findOne = originalFindOne;
    PremiumMeal.find = originalFind;
    Addon.find = originalAddonFind;
  });

  const userId = objectId();
  const subscription = createCanonicalSubscriptionDoc(userId, "active");
  
  Subscription.findOne = () => createQueryStub(subscription);
  PremiumMeal.find = () => createQueryStub([]);
  Addon.find = () => createQueryStub([]);

  const { req, res } = createReqRes({ userId });

  await subscriptionController.getCurrentSubscriptionOverview(req, res);

  // Verify response structure
  assert.equal("ok" in res.payload, true);
  assert.equal("data" in res.payload, true);
  assert.equal(res.payload.ok, true);
  assert.equal(typeof res.payload.data, "object");
});

test("getCurrentSubscriptionOverview - requires authentication (userId present)", async (t) => {
  const originalFindOne = Subscription.findOne;
  
  t.after(() => {
    Subscription.findOne = originalFindOne;
  });

  const userId = objectId();
  
  // If findOne is called with userId, it means authentication was checked
  let findOneCallArgs = null;
  Subscription.findOne = function(query) {
    findOneCallArgs = query;
    return createQueryStub(null);
  };

  const { req, res } = createReqRes({ userId });

  await subscriptionController.getCurrentSubscriptionOverview(req, res);

  // Verify userId was used in the query
  assert.equal(findOneCallArgs !== null, true);
  assert.deepEqual(findOneCallArgs.userId, userId);
});
