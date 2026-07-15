const assert = require("assert");

const {
  PREMIUM_MEAL_PROTEIN_KEYS,
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS,
} = require("../src/config/mealPlannerContract");
const legacyPremiumSaladPolicy = require("../src/services/subscription/premiumLargeSaladEligibilityService");
const menuPolicy = require("../src/services/subscription/subscriptionMenuEligibilityPolicyService");
const addonPolicy = require("../src/services/subscription/subscriptionAddonPolicyService");
const addonAllocationService = require("../src/services/subscription/subscriptionAddonAllocationService");
const subscriptionSelectionService = require("../src/services/subscription/subscriptionSelectionService");
const {
  buildAddonBalanceRowsFromEntitlements,
} = require("../src/services/subscription/subscriptionAddonBalanceService");

function run() {
  assert.deepStrictEqual(menuPolicy.availableForChannelQuery("subscription"), {
    $or: [
      { availableFor: { $exists: false } },
      { availableFor: [] },
      { availableFor: "subscription" },
    ],
  });

  assert.strictEqual(menuPolicy.isMenuItemEnabledForSubscription(null), false);
  assert.strictEqual(menuPolicy.isMenuItemEnabledForSubscription({}), true);
  assert.strictEqual(menuPolicy.isMenuItemEnabledForSubscription({ availableFor: [] }), true);
  assert.strictEqual(menuPolicy.isMenuItemEnabledForSubscription({ availableFor: ["subscription"] }), true);
  assert.strictEqual(menuPolicy.isMenuItemEnabledForSubscription({ availableFor: ["one_time"] }), false);
  assert.strictEqual(menuPolicy.isMenuItemEnabledForSubscription({ availableForSubscription: false }), false);

  const premiumMealKey = PREMIUM_MEAL_PROTEIN_KEYS[0];
  assert.strictEqual(menuPolicy.isSubscriptionPremiumMealProtein({ key: premiumMealKey }), true);
  assert.strictEqual(menuPolicy.isSubscriptionPremiumMealProtein({ premiumKey: premiumMealKey }), true);
  assert.strictEqual(menuPolicy.isSubscriptionPremiumMealProtein({ key: "regular_chicken" }), false);

  const premiumSaladKey = SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS[0];
  const allowedSaladProtein = { key: premiumSaladKey, isPremium: false };
  assert.strictEqual(menuPolicy.isSubscriptionPremiumLargeSaladProtein(allowedSaladProtein), true);
  assert.strictEqual(menuPolicy.isConfiguredPremiumLargeSaladProtein(allowedSaladProtein, [premiumSaladKey]), true);
  assert.strictEqual(menuPolicy.isConfiguredPremiumLargeSaladProtein(allowedSaladProtein, ["another_allowed_key"]), false);
  assert.strictEqual(menuPolicy.isConfiguredPremiumLargeSaladProtein({ key: "dashboard_only_protein" }, ["dashboard_only_protein"]), false);

  assert.strictEqual(
    legacyPremiumSaladPolicy.isSubscriptionPremiumLargeSaladProtein,
    menuPolicy.isSubscriptionPremiumLargeSaladProtein
  );

  assert.deepStrictEqual(addonPolicy.SUBSCRIPTION_ADDON_CATEGORIES, ["juice", "snack", "small_salad"]);
  assert.strictEqual(
    addonPolicy.resolveAddonCategoryForMenuProduct({ key: "orange_juice" }, "juices"),
    "juice"
  );
  assert.strictEqual(
    addonPolicy.resolveAddonCategoryForMenuProduct({ key: "green_salad" }, "light_options"),
    "small_salad"
  );
  assert.strictEqual(
    addonPolicy.resolveAddonCategoryForMenuProduct({ key: "unmapped_salad" }, "light_options"),
    null
  );

  const modernSubscription = {
    addonSubscriptions: [{ addonPlanId: "plan-juice", category: "juice", menuProductIds: ["juice-1"] }],
  };
  const modernEligibility = addonPolicy.buildAddonEntitlementEligibility(modernSubscription);
  assert.strictEqual(addonPolicy.isAddonChoiceEligibleForAllowance(modernEligibility, "juice", "juice-1"), true);
  assert.strictEqual(addonPolicy.isAddonChoiceEligibleForAllowance(modernEligibility, "juice", "juice-2"), false);
  assert.strictEqual(addonPolicy.isAddonChoiceEligibleForAllowance(modernEligibility, "snack", "juice-1"), false);
  assert.strictEqual(
    addonPolicy.findAddonEntitlementForChoice(modernSubscription, "juice", "juice-1"),
    modernSubscription.addonSubscriptions[0]
  );
  assert.strictEqual(addonPolicy.findAddonEntitlementForChoice(modernSubscription, "juice", "juice-2"), null);

  const legacySubscription = {
    addonSubscriptions: [{ addonPlanId: "legacy-plan", category: "juice" }],
  };
  const legacyEligibility = addonPolicy.buildAddonEntitlementEligibility(legacySubscription);
  assert.strictEqual(addonPolicy.isAddonChoiceEligibleForAllowance(legacyEligibility, "juice", "juice-1"), true);
  assert.strictEqual(addonPolicy.isAddonChoiceEligibleForAllowance(legacyEligibility, "juice", "juice-2"), true);
  assert.strictEqual(
    addonPolicy.findAddonEntitlementForChoice(legacySubscription, "juice", "juice-2"),
    legacySubscription.addonSubscriptions[0]
  );

  const balanceSubscription = {
    addonBalance: [{ category: "juice", remainingQty: 5, includedTotalQty: 10, consumedQty: 3, reservedQty: 2 }],
  };
  const existingDay = {
    addonSelections: [
      { category: "juice", source: "subscription" },
      { category: "juice", source: "subscription" },
      { category: "juice", source: "pending_payment" },
    ],
  };
  const before = JSON.stringify({ balanceSubscription, existingDay });
  const simulatedRemaining = addonPolicy.buildSimulatedAddonRemainingByCategory(balanceSubscription, existingDay);
  assert.strictEqual(simulatedRemaining.get("juice"), 7);
  assert.strictEqual(JSON.stringify({ balanceSubscription, existingDay }), before);

  const initializedRows = buildAddonBalanceRowsFromEntitlements([{
    addonPlanId: "plan-juice",
    addonPlanName: "Juice plan",
    category: "juice",
    purchasedDailyQty: 3,
    includedTotalQty: 20,
    extraPurchasedQty: 2,
    unitPlanPriceHalala: 1100,
    currency: "SAR",
  }], { daysCount: 10 });
  assert.strictEqual(initializedRows.length, 1);
  assert.deepStrictEqual({
    purchasedDailyQty: initializedRows[0].purchasedDailyQty,
    includedTotalQty: initializedRows[0].includedTotalQty,
    purchasedQty: initializedRows[0].purchasedQty,
    remainingQty: initializedRows[0].remainingQty,
    consumedQty: initializedRows[0].consumedQty,
    reservedQty: initializedRows[0].reservedQty,
  }, {
    purchasedDailyQty: 3,
    includedTotalQty: 20,
    purchasedQty: 22,
    remainingQty: 22,
    consumedQty: 0,
    reservedQty: 0,
  });

  assert.strictEqual(
    subscriptionSelectionService.reconcileAddonInclusions,
    addonAllocationService.reconcileAddonInclusions
  );

  const persistedSlotUpdatedAt = new Date("2026-10-02T08:30:00.000Z");
  const persistedPlannerLastEditedAt = new Date("2026-10-02T08:31:00.000Z");
  const validationDraft = {
    processedSlots: [
      { slotIndex: 1, slotKey: "slot_1", updatedAt: new Date("2026-10-03T09:00:00.000Z") },
      { slotIndex: 2, slotKey: "slot_2", updatedAt: new Date("2026-10-03T09:00:00.000Z") },
    ],
    plannerMeta: { lastEditedAt: new Date("2026-10-03T09:00:00.000Z") },
  };
  const persistedDay = {
    mealSlots: [{ slotIndex: 1, slotKey: "slot_1", updatedAt: persistedSlotUpdatedAt }],
    plannerMeta: { lastEditedAt: persistedPlannerLastEditedAt },
  };
  const persistedDayBefore = JSON.stringify(persistedDay);
  subscriptionSelectionService.preservePersistedValidationTimestamps(validationDraft, persistedDay);
  assert.strictEqual(validationDraft.processedSlots[0].updatedAt, persistedSlotUpdatedAt);
  assert.strictEqual(validationDraft.processedSlots[1].updatedAt, null);
  assert.strictEqual(validationDraft.plannerMeta.lastEditedAt, persistedPlannerLastEditedAt);
  assert.strictEqual(JSON.stringify(persistedDay), persistedDayBefore, "timestamp projection does not mutate persisted state");

  console.log("subscription selection policy characterization tests passed");
}

run();
