process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionDailyAddonOperation = require("../src/models/SubscriptionDailyAddonOperation");
const {
  ensureDailyAddonDefaultsForDay,
  reconcileDayDailyAddonState,
} = require("../src/services/subscription/subscriptionDailyAddonService");
const {
  buildKitchenDetailsPayload,
} = require("../src/services/dashboard/opsPayloadService");

const failures = [];

function objectId() {
  return new mongoose.Types.ObjectId();
}

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

async function seedSubscriptionDay({ deliveryMode }) {
  const addonPlanId = objectId();
  const productId = objectId();
  const entitlementKey = `juice:${addonPlanId}`;
  const startDate = new Date("2026-08-01T00:00:00.000Z");

  const subscription = await Subscription.create({
    userId: objectId(),
    planId: objectId(),
    status: "active",
    startDate,
    endDate: new Date("2026-08-30T23:59:59.999Z"),
    validityEndDate: new Date("2026-08-30T23:59:59.999Z"),
    totalMeals: 30,
    remainingMeals: 30,
    selectedMealsPerDay: 1,
    deliveryMode,
    addonSubscriptions: [
      {
        addonId: addonPlanId,
        addonPlanId,
        addonPlanName: "Juice Subscription",
        addonPlanNameI18n: {
          ar: "اشتراك عصير",
          en: "Juice Subscription",
        },
        category: "juice",
        allowanceCategory: "juice",
        displayCategory: "juice",
        entitlementKey,
        quantityPerDay: 1,
        purchasedDailyQty: 1,
        includedTotalQty: 30,
        maxPerDay: 30,
        menuProductIds: [productId],
        menuProductsSnapshot: [
          {
            id: productId,
            key: "orange_juice",
            name: { ar: "عصير برتقال", en: "Orange Juice" },
            nameI18n: { ar: "عصير برتقال", en: "Orange Juice" },
            category: "juice",
            categoryKey: "juice",
            itemType: "juice",
            priceHalala: 0,
            currency: "SAR",
          },
        ],
      },
    ],
    addonBalance: [
      {
        addonId: addonPlanId,
        addonPlanId,
        entitlementKey,
        name: { ar: "اشتراك عصير", en: "Juice Subscription" },
        category: "juice",
        allowanceCategory: "juice",
        displayCategory: "juice",
        purchasedDailyQty: 1,
        includedTotalQty: 30,
        purchasedQty: 30,
        remainingQty: 30,
        reservedQty: 0,
        consumedQty: 0,
        currency: "SAR",
      },
    ],
  });

  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: "2026-08-01",
    status: "open",
    plannerVersion: "v1",
    plannerState: "confirmed",
    planningVersion: "v1",
    planningState: "confirmed",
    addonSelections: [],
  });

  return { subscription, day, addonPlanId, productId };
}

async function readWallet(subscriptionId) {
  const stored = await Subscription.findById(subscriptionId).lean();
  assert(stored, "subscription must exist");
  assert.strictEqual(stored.addonBalance.length, 1);
  return stored.addonBalance[0];
}

function assertUntouchedWallet(bucket, messagePrefix) {
  assert.strictEqual(Number(bucket.remainingQty || 0), 30, `${messagePrefix}: remainingQty must stay 30`);
  assert.strictEqual(Number(bucket.reservedQty || 0), 0, `${messagePrefix}: reservedQty must stay 0`);
  assert.strictEqual(Number(bucket.consumedQty || 0), 0, `${messagePrefix}: consumedQty must stay 0`);
}

function explicitKitchenAddon({ addonPlanId = objectId(), productId = objectId() } = {}) {
  return {
    addonId: productId,
    productId,
    menuProductId: productId,
    addonPlanId,
    addonKey: "orange_juice",
    productKey: "orange_juice",
    name: "عصير برتقال",
    nameI18n: { ar: "عصير برتقال", en: "Orange Juice" },
    category: "juice",
    entitlementCategory: "juice",
    entitlementKey: `juice:${addonPlanId}`,
    balanceBucketId: objectId(),
    source: "subscription",
    qty: 1,
    quantity: 1,
    coveredQty: 1,
    paidQty: 0,
    pricingMode: "allowance_covered",
    autoDailyAddon: false,
    dailyEntitlement: false,
    selectionOrigin: "customer_selected",
    addonSettlementState: "consumed",
  };
}

async function main() {
  const mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const uri = mongo.getUri(`addon_explicit_selection_policy_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  try {
    await runCase("delivery day without an explicit add-on does not reserve or create one", async () => {
      const { subscription, day } = await seedSubscriptionDay({ deliveryMode: "delivery" });

      const result = await ensureDailyAddonDefaultsForDay({ dayId: day._id });
      const storedDay = await SubscriptionDay.findById(day._id).lean();
      const wallet = await readWallet(subscription._id);

      assert.strictEqual(result.appliedCount, 0, "no implicit daily add-on may be applied");
      assert.deepStrictEqual(storedDay.addonSelections || [], [], "day must remain without add-ons");
      assertUntouchedWallet(wallet, "delivery no-selection");
      assert.strictEqual(
        await SubscriptionDailyAddonOperation.countDocuments({ subscriptionDayId: day._id }),
        0,
        "no automatic allocation operation may be recorded"
      );
    });

    await runCase("pickup day without an explicit add-on does not reserve or create one", async () => {
      const { subscription, day } = await seedSubscriptionDay({ deliveryMode: "pickup" });

      const result = await ensureDailyAddonDefaultsForDay({ dayId: day._id });
      const storedDay = await SubscriptionDay.findById(day._id).lean();
      const wallet = await readWallet(subscription._id);

      assert.strictEqual(result.appliedCount, 0, "no implicit pickup add-on may be applied");
      assert.deepStrictEqual(storedDay.addonSelections || [], [], "pickup day must remain without add-ons");
      assertUntouchedWallet(wallet, "pickup no-selection");
    });

    await runCase("read reconciliation is side-effect free when the customer selected no add-on", async () => {
      const { subscription, day } = await seedSubscriptionDay({ deliveryMode: "delivery" });

      await reconcileDayDailyAddonState({ dayId: day._id });
      const storedDay = await SubscriptionDay.findById(day._id).lean();
      const wallet = await readWallet(subscription._id);

      assert.deepStrictEqual(storedDay.addonSelections || [], [], "read reconciliation must not invent selections");
      assertUntouchedWallet(wallet, "read reconciliation");
    });

    await runCase("legacy automatic daily add-ons are not exposed to the kitchen", async () => {
      const automatic = {
        ...explicitKitchenAddon(),
        autoDailyAddon: true,
        dailyEntitlement: true,
        selectionOrigin: "subscription_daily_default",
        addonSettlementState: "reserved",
        requiresKitchenChoice: false,
      };

      const payload = buildKitchenDetailsPayload(
        { addonSelections: [automatic], mealSlots: [] },
        { addonBalance: [] },
        "ar",
        {}
      );

      assert.deepStrictEqual(payload.addons, [], "kitchen payload must exclude implicit legacy add-ons");
    });

    await runCase("an explicitly selected subscription add-on remains visible to the kitchen", async () => {
      const selected = explicitKitchenAddon();
      const payload = buildKitchenDetailsPayload(
        { addonSelections: [selected], mealSlots: [] },
        { addonBalance: [] },
        "ar",
        {}
      );

      assert.strictEqual(payload.addons.length, 1, "explicit add-on must remain visible");
      assert.strictEqual(payload.addons[0].quantity, 1);
      assert(
        String(payload.addons[0].name || "").includes("عصير برتقال"),
        `expected selected product name, received ${JSON.stringify(payload.addons[0])}`
      );
    });

    if (failures.length > 0) {
      const summary = failures.map(({ name }) => `- ${name}`).join("\n");
      const error = new Error(
        `Explicit add-on selection policy regression suite failed (${failures.length} case(s)):\n${summary}`
      );
      error.code = "EXPLICIT_ADDON_SELECTION_POLICY_REGRESSION";
      throw error;
    }

    console.log("Explicit add-on selection policy regression suite passed");
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
