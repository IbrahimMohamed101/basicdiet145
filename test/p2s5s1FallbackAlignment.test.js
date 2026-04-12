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
    async save() {
      return this;
    },
    ...overrides,
  };
}

function createLegacySubscription(overrides = {}) {
  return {
    _id: objectId(),
    userId: objectId(),
    status: "active",
    selectedMealsPerDay: 3,
    async save() {
      return this;
    },
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

  let capturedMealQuery = null;
  Meal.find = (query) => {
    capturedMealQuery = query;
    return createQueryStub([]);
  };

  await assert.rejects(
    () => processDailyCutoff(),
    (err) => err && err.code === "PLANNING_INCOMPLETE"
  );

  assert.equal(day.status, "open");
  assert.equal(day.selections.length, 0);
  assert.equal(day.planningState, undefined);
  assert.equal(day.baseMealSlots, undefined);
  assert.equal(capturedMealQuery, null);
  assert.equal(day.premiumSelections.length, 0);
  assert.equal(day.premiumUpgradeSelections.length, 0);
  assert.equal(day.addonCreditSelections.length, 0);
  assert.equal(day.oneTimeAddonSelections, undefined);
  assert.equal(day.oneTimeAddonPendingCount, undefined);
  assert.equal(day.oneTimeAddonPaymentStatus, undefined);
  assert.equal(day.recurringAddons, undefined);
  assert.equal(day.lockedSnapshot, undefined);
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
  assert.equal(day.planningState, "confirmed");
  assert.equal(day.lockedSnapshot.planningSource, "user");
  assert.equal(day.lockedSnapshot.assignmentSource, undefined);
});

test("automation cutoff keeps valid canonical premium selections and confirms the plan", async (t) => {
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
  assert.equal(day.planningState, "confirmed");
  assert.equal(day.lockedSnapshot.planningSource, "user");
});

test("automation cutoff fallback refunds premium wallet intent and replaces it with regular meals", async (t) => {
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

  const premiumWalletRowId = objectId();
  const sub = createCanonicalSubscription({
    premiumWalletMode: "generic_v1",
    genericPremiumBalance: [{
      _id: premiumWalletRowId,
      purchasedQty: 1,
      remainingQty: 0,
      unitCreditPriceHalala: 500,
      currency: "SAR",
      purchasedAt: new Date("2026-03-01T00:00:00.000Z"),
    }],
    premiumSelections: [{
      baseSlotKey: "base_slot_1",
      premiumMealId: objectId(),
      date: "2026-03-18",
      premiumWalletRowId,
      unitExtraFeeHalala: 500,
      currency: "SAR",
    }],
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

  Meal.find = () => createQueryStub([]);

  await assert.rejects(
    () => processDailyCutoff(),
    (err) => err && err.code === "PLANNING_INCOMPLETE"
  );

  assert.equal(day.status, "open");
  assert.equal(day.selections.length, 0);
  assert.equal(day.premiumSelections.length, 0);
  assert.equal(day.premiumUpgradeSelections.length, 1);
  assert.equal(day.planningState, undefined);
  assert.equal(sub.premiumSelections.length, 1);
  assert.equal(sub.genericPremiumBalance[0].remainingQty, 0);
  assert.equal(day.lockedSnapshot, undefined);
});

test("automation cutoff fallback refunds addon wallet intent and replaces it with regular meals", async (t) => {
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
    addonBalance: [{
      addonId: objectId(),
      purchasedQty: 1,
      remainingQty: 0,
      unitPriceHalala: 250,
      currency: "SAR",
      purchasedAt: new Date("2026-03-01T00:00:00.000Z"),
    }],
  });
  sub.addonSelections = [{
    addonId: sub.addonBalance[0].addonId,
    qty: 1,
    date: "2026-03-18",
    unitPriceHalala: 250,
    currency: "SAR",
  }];

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

  Meal.find = () => createQueryStub([]);

  await assert.rejects(
    () => processDailyCutoff(),
    (err) => err && err.code === "PLANNING_INCOMPLETE"
  );

  assert.equal(day.status, "open");
  assert.equal(day.selections.length, 0);
  assert.equal(day.addonCreditSelections.length, 1);
  assert.equal(day.planningState, undefined);
  assert.equal(sub.addonSelections.length, 1);
  assert.equal(sub.addonBalance[0].remainingQty, 0);
  assert.equal(day.lockedSnapshot, undefined);
});

test("automation cutoff fallback clears unpaid one-time add-ons and locks a safe regular plan", async (t) => {
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

  Meal.find = () => createQueryStub([]);

  await assert.rejects(
    () => processDailyCutoff(),
    (err) => err && err.code === "PLANNING_INCOMPLETE"
  );

  assert.equal(day.status, "open");
  assert.equal(day.selections.length, 0);
  assert.equal(day.oneTimeAddonSelections.length, 1);
  assert.equal(day.oneTimeAddonPendingCount, undefined);
  assert.equal(day.oneTimeAddonPaymentStatus, undefined);
  assert.equal(day.planningState, undefined);
  assert.equal(day.lockedSnapshot, undefined);
});

test("automation cutoff fallback clears unpaid premium overage and locks a safe regular plan", async (t) => {
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

  Meal.find = () => createQueryStub([]);

  await assert.rejects(
    () => processDailyCutoff(),
    (err) => err && err.code === "PLANNING_INCOMPLETE"
  );

  assert.equal(day.status, "open");
  assert.equal(day.selections.length, 0);
  assert.equal(day.premiumOverageCount, 2);
  assert.equal(day.premiumOverageStatus, "pending");
  assert.equal(day.planningState, undefined);
  assert.equal(day.lockedSnapshot, undefined);
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

  Meal.find = () => createQueryStub([]);

  await processDailyCutoff();

  assert.equal(day.status, "locked");
  assert.equal(day.selections.length, 0);
  // Planning state should NOT be set for legacy
  assert.equal(day.planningState, undefined);
  assert.equal(day.baseMealSlots, undefined);
  assert.equal(day.lockedSnapshot.planningSource, "user");
});

test("automation cutoff fallback rejects catalog shortage instead of locking an invalid day", async (t) => {
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

  Meal.find = () => createQueryStub([
    { _id: objectId(), type: "regular" },
    { _id: objectId(), type: "regular" },
  ]);

  await assert.rejects(
    () => processDailyCutoff(),
    (err) => err && err.code === "PLANNING_INCOMPLETE"
  );

  assert.equal(day.status, "open");
  assert.equal(day.lockedSnapshot, undefined);
});
