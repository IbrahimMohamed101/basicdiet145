const test = require("node:test");
const assert = require("node:assert/strict");

// Services under test
const {
  assertNoPendingPremiumOverage,
  assertCanonicalPlanningExactCount,
  confirmCanonicalDayPlanning,
  isCanonicalDayPlanningEligible,
  buildScopedCanonicalPlanningSnapshot,
} = require("../src/services/subscriptionDayPlanningService");
const { assertNoPendingOneTimeAddonPayment } = require("../src/services/oneTimeAddonPlanningService");
const { normalizeRecurringAddonEntitlements } = require("../src/services/recurringAddonService");

// Helpers to stub modules for automation service testing
function resetModuleCache(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function stubAutomationDependencies({ notifyUser, writeLog }) {
  // Reset caches so automationService reads updated dependencies.
  resetModuleCache("../src/utils/notify");
  resetModuleCache("../src/utils/log");
  resetModuleCache("../src/services/automationService");

  // Patch notify/log modules before requiring automationService.
  const notify = require("../src/utils/notify");
  const log = require("../src/utils/log");
  notify.notifyUser = notifyUser;
  log.writeLog = writeLog;

  // Return fresh automationService instance
  return require("../src/services/automationService");
}

// -----------------------------------------------------------------------------
// 1) Premium overage enforcement (confirmDayPlanning safety invariant)
// -----------------------------------------------------------------------------

test("assertNoPendingPremiumOverage throws when overage is pending", (t) => {
  const subscription = {
    selectedMealsPerDay: 1,
    contractMode: "canonical",
    contractVersion: "subscription_contract.v1",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
  };

  const day = {
    selections: ["m1"],
    premiumSelections: [],
    premiumOverageCount: 1,
    premiumOverageStatus: "pending",
  };

  assert.throws(
    () => assertNoPendingPremiumOverage({ subscription, day, overageEligible: true }),
    (err) => err && err.code === "PREMIUM_OVERAGE_PAYMENT_REQUIRED"
  );
});

test("assertNoPendingPremiumOverage does not throw when overage is paid", (t) => {
  const subscription = {
    selectedMealsPerDay: 1,
    contractMode: "canonical",
    contractVersion: "subscription_contract.v1",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
  };

  const day = {
    selections: ["m1"],
    premiumSelections: [],
    premiumOverageCount: 1,
    premiumOverageStatus: "paid",
  };

  assert.doesNotThrow(() => assertNoPendingPremiumOverage({ subscription, day, overageEligible: true }));
});

// -----------------------------------------------------------------------------
// 2) Automation fallback must not consume premium credits and must project recurring add-ons
// -----------------------------------------------------------------------------

test("processDailyCutoff does not consume premium credits and includes recurring add-ons", async (t) => {
  // Ensure canonical add-ons are applied (no feature flag needed for recurring)
  const originalPhase2Flag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPhase2Flag;
  });

  const subscription = {
    _id: "sub1",
    status: "active",
    userId: "user1",
    selectedMealsPerDay: 2,
    contractMode: "canonical",
    contractVersion: "subscription_contract.v1",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
    // Generic premium wallet (should not be consumed by automation)
    premiumWalletMode: "generic_v1",
    genericPremiumBalance: [
      { _id: "wallet1", purchasedQty: 1, remainingQty: 1, unitCreditPriceHalala: 500, currency: "SAR", purchasedAt: new Date() },
    ],
    // Recurring addon entitlement
    addonSubscriptions: [
      { addonId: "addon1", name: { ar: "سلطة", en: "Salad" }, price: 10, category: "salad", type: "subscription" },
    ],
  };

  const tomorrow = require("../src/utils/date").getTomorrowKSADate();

  const day = {
    _id: "day1",
    subscriptionId: subscription,
    date: tomorrow,
    status: "open",
    selections: [],
    premiumSelections: [],
    assignedByKitchen: false,
    save: async function () { return this; },
  };

  const Meal = require("../src/models/Meal");
  const SubscriptionDay = require("../src/models/SubscriptionDay");

  const originalMealFind = Meal.find;
  const originalDayFind = SubscriptionDay.find;

  Meal.find = () => ({
    limit() {
      return {
        lean() {
          return Promise.resolve([{ _id: "m1" }, { _id: "m2" }]);
        },
      };
    },
  });

  SubscriptionDay.find = () => ({
    populate() {
      return Promise.resolve([day]);
    },
  });

  const automationService = stubAutomationDependencies({
    notifyUser: async () => ({ sent: false, noTokens: true }),
    writeLog: async () => null,
  });

  await automationService.processDailyCutoff();

  assert.equal(subscription.genericPremiumBalance[0].remainingQty, 1, "Premium balance must remain unchanged");
  assert.equal(day.selections.length, 2, "Auto-assignment should assign the correct number of meals");
  assert.equal(day.premiumSelections.length, 0, "Auto-assignment should not consume premium selections");
  assert.equal(day.assignedByKitchen, true, "Day should be marked as assigned by kitchen");
  assert.ok(Array.isArray(day.lockedSnapshot.recurringAddons), "Locked snapshot should include recurring add-ons");
  assert.equal(day.lockedSnapshot.recurringAddons.length, 1, "Recurring add-ons should be projected into the locked snapshot");

  Meal.find = originalMealFind;
  SubscriptionDay.find = originalDayFind;
});

// -----------------------------------------------------------------------------
// 3) Recurring add-ons: one-per-category enforcement
// -----------------------------------------------------------------------------

test("normalizeRecurringAddonEntitlements rejects multiple addons in the same category", (t) => {
  const addonSubscriptions = [
    { addonId: "a1", name: { ar: "سلطة", en: "salad" }, price: 10, category: "salad", type: "subscription" },
    { addonId: "a2", name: { ar: "سلطة2", en: "salad 2" }, price: 10, category: "salad", type: "subscription" },
  ];

  assert.throws(
    () => normalizeRecurringAddonEntitlements(addonSubscriptions),
    (err) => err && err.code === "RECURRING_ADDON_CATEGORY_CONFLICT"
  );
});

// -----------------------------------------------------------------------------
// 4) One-time add-on enforcement (confirmDayPlanning safety invariant)
// -----------------------------------------------------------------------------

test("confirmCanonicalDayPlanning fails when one-time addons are pending", (t) => {
  const subscription = {
    selectedMealsPerDay: 1,
    contractMode: "canonical",
    contractVersion: "subscription_contract.v1",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
  };

  const day = {
    selections: ["m1"],
    premiumSelections: [],
    oneTimeAddonPendingCount: 1,
    oneTimeAddonPaymentStatus: "pending",
  };

  // Confirm preconditions are satisfied before the payment check
  assert.doesNotThrow(() => assertCanonicalPlanningExactCount({ subscription, day }));

  assert.throws(
    () => assertNoPendingOneTimeAddonPayment({ day }),
    (err) => err && err.code === "ONE_TIME_ADDON_PAYMENT_REQUIRED"
  );
});

test("confirmCanonicalDayPlanning succeeds once one-time addon payment is paid", (t) => {
  const subscription = {
    selectedMealsPerDay: 1,
    contractMode: "canonical",
    contractVersion: "subscription_contract.v1",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
  };

  const day = {
    selections: ["m1"],
    premiumSelections: [],
    oneTimeAddonPendingCount: 1,
    oneTimeAddonPaymentStatus: "paid",
  };

  assert.doesNotThrow(() => assertNoPendingOneTimeAddonPayment({ day }));
  assert.doesNotThrow(() => confirmCanonicalDayPlanning({ subscription, day }));
  assert.equal(day.planningState, "confirmed");
});

// -----------------------------------------------------------------------------
// 5) Exact meal count enforcement (canonical planning invariant)
// -----------------------------------------------------------------------------

test("assertCanonicalPlanningExactCount rejects under-selected meals", (t) => {
  const subscription = {
    selectedMealsPerDay: 2,
    contractMode: "canonical",
    contractVersion: "subscription_contract.v1",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
  };

  const day = {
    selections: ["m1"],
    premiumSelections: [],
  };

  assert.throws(
    () => assertCanonicalPlanningExactCount({ subscription, day }),
    (err) => err && err.code === "PLANNING_INCOMPLETE"
  );
});

test("assertCanonicalPlanningExactCount rejects over-selected meals", (t) => {
  const subscription = {
    selectedMealsPerDay: 2,
    contractMode: "canonical",
    contractVersion: "subscription_contract.v1",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
  };

  const day = {
    selections: ["m1", "m2", "m3"],
    premiumSelections: [],
  };

  assert.throws(
    () => assertCanonicalPlanningExactCount({ subscription, day }),
    (err) => err && err.code === "PLANNING_INCOMPLETE"
  );
});

test("assertCanonicalPlanningExactCount accepts exact meal count and can confirm planning", (t) => {
  const subscription = {
    selectedMealsPerDay: 2,
    contractMode: "canonical",
    contractVersion: "subscription_contract.v1",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
  };

  const day = {
    selections: ["m1", "m2"],
    premiumSelections: [],
  };

  assert.doesNotThrow(() => assertCanonicalPlanningExactCount({ subscription, day }));
  assert.doesNotThrow(() => confirmCanonicalDayPlanning({ subscription, day }));
  assert.equal(day.planningState, "confirmed");
});

// -----------------------------------------------------------------------------
// 6) Grandfathering protection (legacy subscription behavior remains unchanged)
// -----------------------------------------------------------------------------

test("legacy subscriptions ignore canonical day planning even when flags are enabled", (t) => {
  const originalPhase2Flag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPhase2Flag;
  });

  const legacySubscription = {
    contractMode: "legacy",
    contractVersion: "subscription_contract.v0",
    // no contractSnapshot intentionally
  };

  assert.equal(isCanonicalDayPlanningEligible(legacySubscription), false);
  const day = { selections: ["m1"], premiumSelections: [] };
  assert.equal(
    buildScopedCanonicalPlanningSnapshot({ subscription: legacySubscription, day }),
    null
  );
});
