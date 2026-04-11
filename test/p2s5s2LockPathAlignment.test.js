const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { processDailyCutoff } = require("../src/services/automationService");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Meal = require("../src/models/Meal");
const User = require("../src/models/User");
const ActivityLog = require("../src/models/ActivityLog");
const NotificationLog = require("../src/models/NotificationLog");

process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
process.env.PHASE2_GENERIC_PREMIUM_WALLET = "true";

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createQueryStub(result) {
  return {
    populate() {
      return this;
    },
    select() {
      return this;
    },
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    session() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
}

function createCanonicalSubscription(overrides = {}) {
  return {
    _id: objectId(),
    userId: objectId(),
    status: "active",
    selectedMealsPerDay: 3,
    addonSubscriptions: [],
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
    premiumSelections: [],
    addonSelections: [],
    ...overrides,
  };
}

test("automation lock for canonical subscription captures exhaustive state and read-path uses snapshot", async (t) => {
  const originalDayFind = SubscriptionDay.find;
  const originalMealFind = Meal.find;
  const originalLogCreate = ActivityLog.create;
  const originalUserFindById = User.findById;
  const originalNotificationLogCreate = NotificationLog.create;
  
  t.after(() => {
    SubscriptionDay.find = originalDayFind;
    Meal.find = originalMealFind;
    ActivityLog.create = originalLogCreate;
    User.findById = originalUserFindById;
    NotificationLog.create = originalNotificationLogCreate;
  });

  ActivityLog.create = async () => ({});
  NotificationLog.create = async () => ({});
  User.findById = () => createQueryStub({ _id: objectId(), fcmTokens: [] });

  const sub = createCanonicalSubscription({
    addonSubscriptions: [{ addonId: objectId(), name: "Water", category: "drink", price: 5, type: "subscription" }]
  });

  const day = {
    _id: objectId(),
    date: "2026-03-20",
    status: "open",
    selections: [objectId(), objectId(), objectId()],
    premiumSelections: [],
    premiumOverageCount: 1,
    premiumOverageStatus: "paid",
    oneTimeAddonSelections: [{ addonId: objectId(), name: "Drink", category: "bev" }],
    oneTimeAddonPendingCount: 1,
    oneTimeAddonPaymentStatus: "paid",
    recurringAddons: [], // Will be populated by automation flow
    subscriptionId: sub,
    planningState: "confirmed",
    async save() {
      return this;
    },
  };

  SubscriptionDay.find = () => ({
    populate() {
      return Promise.resolve([day]);
    },
  });

  await processDailyCutoff();

  assert.equal(day.status, "locked");
  assert.ok(day.lockedSnapshot);
  
  // 1. Recurring Addons preserved
  assert.ok(Array.isArray(day.lockedSnapshot.recurringAddons));
  assert.equal(day.lockedSnapshot.recurringAddons.length, 1);
  assert.equal(day.lockedSnapshot.recurringAddons[0].name, "Water");

  // 2. Base meal slots preserved
  assert.ok(day.lockedSnapshot.planning);
  assert.equal(day.lockedSnapshot.planning.baseMealSlots.length, 3);

  // 3. One-time addon planning fields preserved completely
  assert.equal(day.lockedSnapshot.oneTimeAddonSelections.length, 1);
  assert.equal(day.lockedSnapshot.oneTimeAddonSelections[0].name, "Drink");
  assert.equal(day.lockedSnapshot.oneTimeAddonPendingCount, 1);
  assert.equal(day.lockedSnapshot.oneTimeAddonPaymentStatus, "paid");

  // 4. Premium overage fields preserved
  assert.equal(day.lockedSnapshot.planning.meta.premiumOverageCount, 1);
  assert.equal(day.lockedSnapshot.planning.meta.premiumOverageStatus, "paid");

  // 5. READ-PATH STABILITY: View must rely on snapshot
  // Mutate live fields to prove the view uses the snapshot instead
  day.selections = []; 
  day.premiumOverageCount = 99;

  const { buildCanonicalPlanningView } = require("../src/services/subscription/subscriptionDayPlanningService");
  const view = buildCanonicalPlanningView({ subscription: sub, day });

  assert.equal(view.selectedBaseMealCount, 3, "Should still report 3 base meals from snapshot");
  assert.equal(view.premiumOverageCount, 1, "Should still report 1 overage from snapshot");
});

test("automation lock for canonical subscription captures paid one-time addons status", async (t) => {
  const originalDayFind = SubscriptionDay.find;
  const originalMealFind = Meal.find;
  const originalLogCreate = ActivityLog.create;
  const originalUserFindById = User.findById;
  const originalNotificationLogCreate = NotificationLog.create;
  
  t.after(() => {
    SubscriptionDay.find = originalDayFind;
    Meal.find = originalMealFind;
    ActivityLog.create = originalLogCreate;
    User.findById = originalUserFindById;
    NotificationLog.create = originalNotificationLogCreate;
  });

  ActivityLog.create = async () => ({});
  NotificationLog.create = async () => ({});
  User.findById = () => createQueryStub({ _id: objectId(), fcmTokens: [] });

  const sub = createCanonicalSubscription();
  const day = {
    _id: objectId(),
    date: "2026-03-20",
    status: "open",
    selections: [objectId(), objectId(), objectId()],
    oneTimeAddonSelections: [{ addonId: objectId(), name: "Drink" }],
    oneTimeAddonPendingCount: 1,
    oneTimeAddonPaymentStatus: "paid",
    subscriptionId: sub,
    async save() {
      return this;
    },
  };

  SubscriptionDay.find = () => ({
    populate() {
      return Promise.resolve([day]);
    },
  });

  await processDailyCutoff();

  assert.equal(day.status, "locked");
  assert.ok(day.lockedSnapshot);
  assert.equal(day.lockedSnapshot.oneTimeAddonPaymentStatus, "paid");
  assert.equal(day.lockedSnapshot.oneTimeAddonPendingCount, 1);
});

test("automation lock for fallback canonical day has confirmed planning snapshot", async (t) => {
  const originalDayFind = SubscriptionDay.find;
  const originalMealFind = Meal.find;
  const originalLogCreate = ActivityLog.create;
  const originalUserFindById = User.findById;
  const originalNotificationLogCreate = NotificationLog.create;
  
  t.after(() => {
    SubscriptionDay.find = originalDayFind;
    Meal.find = originalMealFind;
    ActivityLog.create = originalLogCreate;
    User.findById = originalUserFindById;
    NotificationLog.create = originalNotificationLogCreate;
  });

  ActivityLog.create = async () => ({});
  NotificationLog.create = async () => ({});
  User.findById = () => createQueryStub({ _id: objectId(), fcmTokens: [] });

  const sub = createCanonicalSubscription();
  const day = {
    _id: objectId(),
    date: "2026-03-20",
    status: "open",
    selections: [],
    premiumSelections: [],
    subscriptionId: sub,
    async save() {
      return this;
    },
  };

  SubscriptionDay.find = () => ({
    populate() {
      return Promise.resolve([day]);
    },
  });

  const regularMeals = [
    { _id: objectId(), type: "regular" },
    { _id: objectId(), type: "regular" },
    { _id: objectId(), type: "regular" },
  ];
  Meal.find = () => createQueryStub(regularMeals);

  await processDailyCutoff();

  assert.equal(day.status, "locked");
  assert.equal(day.planningState, "confirmed");
  assert.ok(day.lockedSnapshot);
  assert.ok(day.lockedSnapshot.planning);
  assert.equal(day.lockedSnapshot.planning.state, "confirmed");
});

test("automation lock for legacy subscription does not include canonical fields", async (t) => {
  const originalDayFind = SubscriptionDay.find;
  const originalMealFind = Meal.find;
  const originalLogCreate = ActivityLog.create;
  const originalUserFindById = User.findById;
  const originalNotificationLogCreate = NotificationLog.create;
  
  t.after(() => {
    SubscriptionDay.find = originalDayFind;
    Meal.find = originalMealFind;
    ActivityLog.create = originalLogCreate;
    User.findById = originalUserFindById;
    NotificationLog.create = originalNotificationLogCreate;
  });

  ActivityLog.create = async () => ({});
  NotificationLog.create = async () => ({});
  User.findById = () => createQueryStub({ _id: objectId(), fcmTokens: [] });

  const sub = { _id: objectId(), userId: objectId(), status: "active", selectedMealsPerDay: 3 };
  const day = {
    _id: objectId(),
    date: "2026-03-20",
    status: "open",
    selections: [objectId(), objectId(), objectId()],
    subscriptionId: sub,
    async save() {
      return this;
    },
  };

  SubscriptionDay.find = () => ({
    populate() {
      return Promise.resolve([day]);
    },
  });

  await processDailyCutoff();

  assert.equal(day.status, "locked");
  assert.ok(day.lockedSnapshot);
  assert.equal(day.lockedSnapshot.planning, undefined);
  assert.equal(day.lockedSnapshot.recurringAddons, undefined);
});
