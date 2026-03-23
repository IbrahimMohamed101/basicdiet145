const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { processDailyCutoff } = require("../src/services/automationService");
const Subscription = require("../src/models/Subscription");
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

function createLegacySubscription(overrides = {}) {
  return {
    _id: objectId(),
    userId: objectId(),
    status: "active",
    selectedMealsPerDay: 3,
    ...overrides,
  };
}

test("automation fallback for canonical subscription assigns regular meals and confirms planning", async (t) => {
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
    addonSubscriptions: [
      { addonId: objectId(), name: "Recurring Addon", category: "starter", type: "subscription" }
    ]
  });

  const day = {
    _id: objectId(),
    date: "2026-03-18",
    status: "open",
    selections: [],
    premiumSelections: [],
    subscriptionId: sub,
    // Note: No one-time addons or pending counts here to allow fallback
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
  assert.equal(day.selections.length, 3);
  assert.equal(day.planningState, "confirmed");
  assert.equal(day.baseMealSlots.length, 3);
  assert.equal(day.baseMealSlots[0].assignmentSource, "system_auto_assign");
  
  // Verify premium/one-time are cleared
  assert.equal(day.premiumSelections.length, 0);
  assert.equal(day.premiumUpgradeSelections.length, 0);
  assert.equal(day.addonCreditSelections.length, 0);
  assert.equal(day.oneTimeAddonSelections.length, 0);
  assert.equal(day.oneTimeAddonPendingCount, 0);
  assert.equal(day.oneTimeAddonPaymentStatus, undefined);

  // Verify recurring addons are applied
  assert.equal(day.recurringAddons.length, 1);
  assert.equal(day.recurringAddons[0].name, "Recurring Addon");
  
  // Verify snapshot
  assert.ok(day.lockedSnapshot);
  assert.equal(day.lockedSnapshot.planning.state, "confirmed");
  assert.equal(day.lockedSnapshot.recurringAddons.length, 1);
});

test("automation fallback for canonical subscription does NOT run if selections already exist", async (t) => {
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
    date: "2026-03-18",
    status: "open",
    selections: [objectId(), objectId(), objectId()], // Fully planned
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

  Meal.find = () => createQueryStub([{ _id: objectId(), type: "regular" }]);

  await processDailyCutoff();

  assert.equal(day.status, "locked");
  assert.equal(day.selections.length, 3); // Untouched
  assert.equal(day.planningState, undefined); // No fallback run
});

test("automation fallback for canonical subscription does NOT run if premiumSelections already exist", async (t) => {
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
    date: "2026-03-18",
    status: "open",
    selections: [objectId(), objectId()],
    premiumSelections: [objectId()],
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

  Meal.find = () => createQueryStub([{ _id: objectId(), type: "regular" }]);

  await processDailyCutoff();

  assert.equal(day.status, "locked");
  assert.equal(day.selections.length, 2); // Untouched
  assert.equal(day.premiumSelections.length, 1); // Untouched
  assert.equal(day.planningState, undefined);
});

test("automation fallback for canonical subscription does NOT run if premiumUpgradeSelections exist", async (t) => {
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
    premiumSelections: [{ baseSlotKey: "base_slot_1", premiumMealId: objectId(), date: "2026-03-18" }]
  });

  const day = {
    _id: objectId(),
    date: "2026-03-18",
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

  Meal.find = () => createQueryStub([{ _id: objectId(), type: "regular" }]);

  await processDailyCutoff();

  assert.equal(day.status, "locked");
  assert.equal(day.selections.length, 0); // Fallback skipped
  assert.equal(day.planningState, undefined);
});

test("automation fallback for canonical subscription does NOT run if addonCreditSelections exist", async (t) => {
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
    addonSelections: [{ addonId: objectId(), qty: 1, date: "2026-03-18" }]
  });

  const day = {
    _id: objectId(),
    date: "2026-03-18",
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

  Meal.find = () => createQueryStub([{ _id: objectId(), type: "regular" }]);

  await processDailyCutoff();

  assert.equal(day.status, "locked");
  assert.equal(day.selections.length, 0); // Fallback skipped
  assert.equal(day.planningState, undefined);
});

test("automation fallback for canonical subscription does NOT run if one-time addons exist", async (t) => {
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
    date: "2026-03-18",
    status: "open",
    selections: [],
    premiumSelections: [],
    oneTimeAddonSelections: [{ addonId: objectId(), name: "One Time" }],
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

  Meal.find = () => createQueryStub([{ _id: objectId(), type: "regular" }]);

  await processDailyCutoff();

  assert.equal(day.status, "locked");
  // Selections should remain empty because fallback didn't run
  assert.equal(day.selections.length, 0);
  assert.equal(day.oneTimeAddonSelections.length, 1);
  assert.equal(day.planningState, undefined);
});

test("automation fallback for canonical subscription does NOT run if premium overage exists", async (t) => {
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
    date: "2026-03-18",
    status: "open",
    selections: [],
    premiumSelections: [],
    premiumOverageCount: 2,
    premiumOverageStatus: "pending",
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

  Meal.find = () => createQueryStub([{ _id: objectId(), type: "regular" }]);

  await processDailyCutoff();

  assert.equal(day.status, "locked");
  assert.equal(day.selections.length, 0);
  assert.equal(day.premiumOverageCount, 2);
  assert.equal(day.planningState, undefined);
});

test("automation fallback for legacy subscription remains unchanged (no planning state)", async (t) => {
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

  const sub = createLegacySubscription();

  const day = {
    _id: objectId(),
    date: "2026-03-18",
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
  assert.equal(day.selections.length, 3);
  // Planning state should NOT be set for legacy
  assert.equal(day.planningState, undefined);
  assert.equal(day.baseMealSlots, undefined);
});
