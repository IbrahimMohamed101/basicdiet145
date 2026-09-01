"use strict";

require("./helpers/installMongoTestSafetyGuard");

const { setTemporaryEnvironment } = require("./helpers/temporaryEnvironment");
setTemporaryEnvironment({ SUBSCRIPTION_WEEKLY_PLANNING_WINDOW_ENABLED: "false" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.SUBSCRIPTION_AUTO_SETTLEMENT_ENABLED = "false";

require("dotenv").config();

const assert = require("assert");
const mongoose = require("mongoose");

const User = require("../src/models/User");
const Plan = require("../src/models/Plan");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const BuilderProtein = require("../src/models/BuilderProtein");
const BuilderCarb = require("../src/models/BuilderCarb");
const MealCategory = require("../src/models/MealCategory");
const Meal = require("../src/models/Meal");
const SaladIngredient = require("../src/models/SaladIngredient");
const Sandwich = require("../src/models/Sandwich");
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");
const {
  performDaySelectionUpdate,
  performDaySelectionValidation,
} = require("../src/services/subscription/subscriptionSelectionService");
const {
  updateBulkDaySelectionsForClient,
} = require("../src/services/subscription/subscriptionSelectionClientService");
const {
  getFutureBusinessDate,
  getTestBusinessDate,
} = require("./helpers/businessDateHelper");

const TEST_TAG = `planner-global-balance-${Date.now()}`;
const SUBSCRIPTION_START_DATE = getTestBusinessDate();
const SUBSCRIPTION_END_DATE = getFutureBusinessDate(45);
const PLANNER_DATE_A = getFutureBusinessDate(1);
const PLANNER_DATE_B = getFutureBusinessDate(2);
const PLANNER_DATE_C = getFutureBusinessDate(3);
const PLANNER_IDS = {
  regularProtein: "507f191e810c19729de870a1",
  premiumProtein: "507f191e810c19729de870a2",
  carbOne: "507f191e810c19729de870b1",
};

function mockQuery(result) {
  return {
    session() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
    },
  };
}

async function withMockedPlannerCatalog(fn) {
  const originalProteinFind = BuilderProtein.find;
  const originalCarbFind = BuilderCarb.find;
  const originalMealCategoryFindOne = MealCategory.findOne;
  const originalMealFind = Meal.find;
  const originalSaladIngredientFind = SaladIngredient.find;
  const originalSandwichFind = Sandwich.find;

  BuilderProtein.find = () => mockQuery([
    {
      _id: PLANNER_IDS.regularProtein,
      isPremium: false,
      premiumKey: null,
      displayCategoryKey: "chicken",
      proteinFamilyKey: "chicken",
      ruleTags: [],
      extraFeeHalala: 0,
    },
    {
      _id: PLANNER_IDS.premiumProtein,
      isPremium: true,
      premiumKey: "shrimp",
      displayCategoryKey: "premium",
      proteinFamilyKey: "fish",
      ruleTags: ["premium"],
      extraFeeHalala: 1500,
    },
  ]);
  BuilderCarb.find = () => mockQuery([
    { _id: PLANNER_IDS.carbOne, isActive: true, availableForSubscription: true, displayCategoryKey: "standard_carbs" },
  ]);
  MealCategory.findOne = () => mockQuery(null);
  Meal.find = () => mockQuery([]);
  SaladIngredient.find = () => mockQuery([]);
  Sandwich.find = () => mockQuery([]);

  try {
    return await fn();
  } finally {
    BuilderProtein.find = originalProteinFind;
    BuilderCarb.find = originalCarbFind;
    MealCategory.findOne = originalMealCategoryFindOne;
    Meal.find = originalMealFind;
    SaladIngredient.find = originalSaladIngredientFind;
    Sandwich.find = originalSandwichFind;
  }
}

function buildSlots(count, { premium = false } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    slotIndex: index + 1,
    selectionType: premium ? "premium_meal" : "standard_meal",
    proteinId: premium ? PLANNER_IDS.premiumProtein : PLANNER_IDS.regularProtein,
    carbs: [{ carbId: PLANNER_IDS.carbOne, grams: 150 }],
  }));
}

async function connect() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test");
  }
  await Promise.all([
    User.createCollection(),
    Plan.createCollection(),
    Subscription.createCollection(),
    SubscriptionDay.createCollection(),
    PremiumUpgradeConfig.createCollection(),
  ]);
  await Promise.all([
    Subscription.init(),
    SubscriptionDay.init(),
    PremiumUpgradeConfig.init(),
  ]);
}

async function cleanup() {
  const users = await User.find({ phone: { $regex: TEST_TAG } }).select("_id").lean();
  const userIds = users.map((user) => user._id);
  const subscriptions = await Subscription.find({ userId: { $in: userIds } }).select("_id planId").lean();
  const subscriptionIds = subscriptions.map((sub) => sub._id);
  const planIds = subscriptions.map((sub) => sub.planId).filter(Boolean);

  await Promise.all([
    SubscriptionDay.deleteMany({ subscriptionId: { $in: subscriptionIds } }),
    Subscription.deleteMany({ _id: { $in: subscriptionIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    PremiumUpgradeConfig.deleteMany({ "metadata.testTag": TEST_TAG }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
}

async function seedPremiumUpgradeConfig() {
  await PremiumUpgradeConfig.updateOne(
    { premiumKey: "shrimp" },
    {
      $set: {
        sourceType: "menu_option",
        sourceId: new mongoose.Types.ObjectId(),
        sourceProductId: null,
        sourceGroupId: null,
        selectionType: "premium_meal",
        premiumKey: "shrimp",
        displayGroupKey: "premium",
        upgradeDeltaHalala: 1500,
        currency: "SAR",
        isEnabled: true,
        isVisible: true,
        status: "active",
        sortOrder: 1,
        metadata: { testTag: TEST_TAG },
        sourceSnapshot: {
          key: "shrimp",
          name: { en: "Shrimp", ar: "Shrimp" },
          context: { fixture: "subscriptionPlannerGlobalMealBalance" },
        },
      },
    },
    { upsert: true }
  );
}

async function seedSubscription({ totalMeals = 10, selectedMealsPerDay = 1, suffix = "000" } = {}) {
  const user = await User.create({
    phone: `+1555${Date.now()}${suffix}${TEST_TAG}`,
    name: `${TEST_TAG} User`,
    role: "client",
    isActive: true,
  });
  const plan = await Plan.create({
    name: { ar: "", en: `${TEST_TAG} Plan ${suffix}` },
    daysCount: 14,
    currency: "SAR",
    isActive: true,
    gramsOptions: [{
      grams: 200,
      isActive: true,
      mealsOptions: [{ mealsPerDay: selectedMealsPerDay, priceHalala: 70000, compareAtHalala: 80000, isActive: true }],
    }],
  });
  const subscription = await Subscription.create({
    userId: user._id,
    planId: plan._id,
    status: "active",
    startDate: new Date(`${SUBSCRIPTION_START_DATE}T00:00:00+03:00`),
    endDate: new Date(`${SUBSCRIPTION_END_DATE}T00:00:00+03:00`),
    validityEndDate: new Date(`${SUBSCRIPTION_END_DATE}T00:00:00+03:00`),
    totalMeals,
    remainingMeals: totalMeals,
    selectedGrams: 200,
    selectedMealsPerDay,
    contractMode: "canonical",
    deliveryMode: "pickup",
    pickupLocationId: "branch-test",
  });
  return { user, plan, subscription };
}

async function save(subscription, date, mealSlots) {
  return performDaySelectionUpdate({
    userId: subscription.userId,
    subscriptionId: subscription._id,
    date,
    mealSlots,
  });
}

async function assertLimitExceeded(fn, message) {
  try {
    await fn();
    assert.fail(message);
  } catch (err) {
    assert.strictEqual(err.code, "MEAL_PLANNING_LIMIT_EXCEEDED", message);
    assert.strictEqual(err.status, 422, "limit errors should be unprocessable entity");
    assert(err.details && err.details.totalAfterSave > err.details.totalAllowedMeals, "limit error includes useful totals");
  }
}

async function countCompleteSlots(subscriptionId) {
  const days = await SubscriptionDay.find({ subscriptionId }).lean();
  return days.reduce(
    (sum, day) => sum + (Array.isArray(day.mealSlots) ? day.mealSlots.filter((slot) => slot && slot.status === "complete").length : 0),
    0
  );
}

async function runTests() {
  try {
    await connect();
    await cleanup();
    await seedPremiumUpgradeConfig();

    await withMockedPlannerCatalog(async () => {
      const { subscription: sub } = await seedSubscription({ suffix: "001" });
      await save(sub, PLANNER_DATE_A, buildSlots(5));
      assert.strictEqual(await countCompleteSlots(sub._id), 5, "Day 9 saves 5 meals");

      await save(sub, PLANNER_DATE_B, buildSlots(5));
      assert.strictEqual(await countCompleteSlots(sub._id), 10, "Day 10 can fill the remaining 5 meals");

      await assertLimitExceeded(
        () => save(sub, PLANNER_DATE_B, buildSlots(6)),
        "Editing Day 10 to 6 meals should exceed the 10-meal allowance"
      );
      await assertLimitExceeded(
        () => save(sub, PLANNER_DATE_B, buildSlots(10)),
        "Editing Day 10 to 10 meals should exceed the 10-meal allowance"
      );

      await save(sub, PLANNER_DATE_A, buildSlots(3));
      await save(sub, PLANNER_DATE_B, buildSlots(7));
      assert.strictEqual(await countCompleteSlots(sub._id), 10, "Editing Day 9 down frees planning capacity elsewhere");

      const { subscription: validationSub } = await seedSubscription({ suffix: "002" });
      await save(validationSub, PLANNER_DATE_A, buildSlots(5));
      await performDaySelectionValidation({
        userId: validationSub.userId,
        subscriptionId: validationSub._id,
        date: PLANNER_DATE_B,
        mealSlots: buildSlots(5),
      });
      await assertLimitExceeded(
        () => performDaySelectionValidation({
          userId: validationSub.userId,
          subscriptionId: validationSub._id,
          date: PLANNER_DATE_B,
          mealSlots: buildSlots(6),
        }),
        "Validate-only should reject plans that exceed the global allowance"
      );

      const { subscription: idempotentSub } = await seedSubscription({ suffix: "003" });
      await save(idempotentSub, PLANNER_DATE_A, buildSlots(5));
      const secondSave = await save(idempotentSub, PLANNER_DATE_A, buildSlots(5));
      assert.strictEqual(secondSave.idempotent, true, "Sending the same day payload again is idempotent");
      await save(idempotentSub, PLANNER_DATE_B, buildSlots(5));
      assert.strictEqual(await countCompleteSlots(idempotentSub._id), 10, "Idempotent retry does not double-count Day 9");

      const { subscription: bulkRejectSub } = await seedSubscription({ suffix: "004" });
      const bulkReject = await updateBulkDaySelectionsForClient({
        subscriptionId: bulkRejectSub._id,
        userId: bulkRejectSub.userId,
        lang: "en",
        requests: [
          { date: PLANNER_DATE_A, mealSlots: buildSlots(6) },
          { date: PLANNER_DATE_B, mealSlots: buildSlots(5) },
        ],
        writeLogSafelyFn: async () => {},
        loadWalletCatalogMapsSafelyFn: async () => ({ addonNames: new Map() }),
      });
      assert.strictEqual(bulkReject.ok, false, "Bulk save exceeding totalMeals is rejected as one operation");
      assert.strictEqual(bulkReject.code, "MEAL_PLANNING_LIMIT_EXCEEDED");
      assert.strictEqual(await countCompleteSlots(bulkRejectSub._id), 0, "Rejected bulk preflight does not persist partial days");

      const { subscription: bulkExactSub } = await seedSubscription({ suffix: "005" });
      const bulkExact = await updateBulkDaySelectionsForClient({
        subscriptionId: bulkExactSub._id,
        userId: bulkExactSub.userId,
        lang: "en",
        requests: [
          { date: PLANNER_DATE_A, mealSlots: buildSlots(5) },
          { date: PLANNER_DATE_B, mealSlots: buildSlots(5) },
        ],
        writeLogSafelyFn: async () => {},
        loadWalletCatalogMapsSafelyFn: async () => ({ addonNames: new Map() }),
      });
      assert.strictEqual(bulkExact.ok, true, "Bulk save equal to totalMeals succeeds");
      assert.strictEqual(await countCompleteSlots(bulkExactSub._id), 10);

      const { subscription: premiumSub } = await seedSubscription({ suffix: "006" });
      await save(premiumSub, PLANNER_DATE_A, buildSlots(5, { premium: true }));
      await save(premiumSub, PLANNER_DATE_B, buildSlots(5));
      assert.strictEqual(await countCompleteSlots(premiumSub._id), 10, "Premium slots count as one planned meal each");

      const { subscription: outsideSub } = await seedSubscription({ suffix: "007" });
      await save(outsideSub, PLANNER_DATE_A, buildSlots(4));
      const outsideReject = await updateBulkDaySelectionsForClient({
        subscriptionId: outsideSub._id,
        userId: outsideSub.userId,
        lang: "en",
        requests: [
          { date: PLANNER_DATE_B, mealSlots: buildSlots(3) },
          { date: PLANNER_DATE_C, mealSlots: buildSlots(4) },
        ],
        writeLogSafelyFn: async () => {},
        loadWalletCatalogMapsSafelyFn: async () => ({ addonNames: new Map() }),
      });
      assert.strictEqual(outsideReject.ok, false, "Bulk calculation preserves existing selections outside affected dates");
      assert.strictEqual(outsideReject.code, "MEAL_PLANNING_LIMIT_EXCEEDED");
    });

    console.log("All subscription planner global meal balance tests passed.");
    await cleanup();
    await mongoose.disconnect();
  } catch (err) {
    console.error("Test failed:", err);
    await cleanup();
    await mongoose.disconnect();
    process.exit(1);
  }
}

runTests();
