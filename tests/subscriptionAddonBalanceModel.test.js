"use strict";

require("dotenv").config();
const assert = require("assert");
const mongoose = require("mongoose");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const { buildClientAddonBalance, resolveSubscriptionAddonBalanceWithAudit } = require("../src/services/subscription/subscriptionAddonBalanceService");
const adminController = require("../src/controllers/adminController");
const { performDaySelectionValidation } = require("../src/services/subscription/subscriptionSelectionService");

const TEST_TAG = `addon-balance-${Date.now()}`;
const TEST_USER_ID = new mongoose.Types.ObjectId();
const TEST_PLAN_ID = new mongoose.Types.ObjectId();
const TEST_SUBSCRIPTION_ID = new mongoose.Types.ObjectId();
const TEST_ADDON_ID_JUICE = new mongoose.Types.ObjectId();
const TEST_ADDON_ID_SNACK = new mongoose.Types.ObjectId();

const results = { passed: 0, failed: 0 };

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

async function connect() {
  if (mongoose.connection.readyState !== 0) return;
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test";
  await mongoose.connect(mongoUri);
}

async function cleanup() {
  const Addon = require("../src/models/Addon");
  await Promise.all([
    SubscriptionDay.deleteMany({ subscriptionId: TEST_SUBSCRIPTION_ID }),
    Subscription.deleteMany({ _id: TEST_SUBSCRIPTION_ID }),
    Addon.deleteMany({ _id: { $in: [TEST_ADDON_ID_JUICE, TEST_ADDON_ID_SNACK] } }),
  ]);
}

async function seedSubscription() {
  const Addon = require("../src/models/Addon");
  await Addon.insertMany([
    { _id: TEST_ADDON_ID_JUICE, name: { ar: "عصير", en: "Juice" }, category: "juice", priceHalala: 1000, active: true },
    { _id: TEST_ADDON_ID_SNACK, name: { ar: "وجبة خفيفة", en: "Snack" }, category: "snack", priceHalala: 1500, active: true }
  ]);
  
  await Subscription.create({
    _id: TEST_SUBSCRIPTION_ID,
    userId: TEST_USER_ID,
    planId: TEST_PLAN_ID,
    status: "active",
    contractMode: "canonical",
    startDate: new Date("2026-05-01T00:00:00Z"),
    endDate: new Date("2026-06-01T00:00:00Z"),
    validityEndDate: new Date("2026-06-01T00:00:00Z"),
    totalMeals: 2,
    remainingMeals: 2,
    duration: 2,
    selectedGrams: 200,
    selectedMealsPerDay: 1,
    deliveryMode: "pickup",
    pickupLocationId: "location1",
    addonSubscriptions: [
      {
        category: "juice",
        addonId: TEST_ADDON_ID_JUICE,
        maxPerDay: 1,
      },
      {
        category: "snack",
        addonId: TEST_ADDON_ID_SNACK,
        maxPerDay: 1,
      }
    ],
  });
}

(async function run() {
  try {
    await connect();
    await cleanup();
    
    // 1. Test Historical Corruption Flag
    await test("historical consumption corruption flags addonBalanceNeedsReview", async () => {
      await seedSubscription();
      // Total duration is 2 days. maxPerDay is 1. So total computed juice = 2.
      // Let's create a SubscriptionDay with 3 juices consumed to simulate corruption.
      await SubscriptionDay.create({
        subscriptionId: TEST_SUBSCRIPTION_ID,
        date: "2026-05-01",
        status: "open",
        addonSelections: [
          { category: "juice", addonId: TEST_ADDON_ID_JUICE, source: "subscription" },
          { category: "juice", addonId: TEST_ADDON_ID_JUICE, source: "subscription" },
          { category: "juice", addonId: TEST_ADDON_ID_JUICE, source: "subscription" },
        ]
      });

      const sub = await Subscription.findById(TEST_SUBSCRIPTION_ID).lean();
      await resolveSubscriptionAddonBalanceWithAudit(sub);
      
      const balances = buildClientAddonBalance(sub, "2026-05-01");
      assert(balances, "expected balances object");
      assert.strictEqual(balances.addonBalanceNeedsReview, true, "expected addonBalanceNeedsReview to be true");
      assert.strictEqual(balances.juice.totalUnits, 2, "expected 2 total juices from fallback");
      assert.strictEqual(balances.juice.consumedUnits, 3, "expected 3 consumed from audit");
      assert.strictEqual(balances.juice.canConsumeNow, false, "expected canConsumeNow to be false");
      await cleanup();
    });

    // 2. Test Admin 409 Conflict
    await test("admin controller returns 409 on concurrent addonBalance change", async () => {
      await seedSubscription();
      // Setup addonBalance directly
      await Subscription.updateOne({ _id: TEST_SUBSCRIPTION_ID }, {
        $set: {
          addonBalance: [{
            _id: new mongoose.Types.ObjectId(),
            category: "juice",
            addonId: TEST_ADDON_ID_JUICE,
            remainingQty: 5,
            consumedQty: 0
          }]
        }
      });
      
      const subBefore = await Subscription.findById(TEST_SUBSCRIPTION_ID).lean();
      
      // Simulate concurrent change
      await Subscription.updateOne({ _id: TEST_SUBSCRIPTION_ID, "addonBalance.category": "juice" }, {
        $inc: { "addonBalance.$.remainingQty": -1, "addonBalance.$.consumedQty": 1 }
      });
      
      const req = {
        method: 'PUT',
        params: { id: String(TEST_SUBSCRIPTION_ID) },
        headers: { "x-admin-reason": "test" },
        user: { _id: TEST_USER_ID, role: "admin" },
        body: {
          reason: "test",
          addonBalance: subBefore.addonBalance // submitting old state
        }
      };
      const res = {
        statusCode: 200,
        _jsonData: null,
        status: function(code) { this.statusCode = code; return this; },
        json: function(data) { this._jsonData = data; return this; },
        _getJSONData: function() { return this._jsonData; }
      };
      
      // Simulate passing the concurrent check
      req.body.addonSubscriptions = req.body.addonSubscriptions || []; // satisfy validation
      
      try {
        await adminController.updateSubscriptionBalancesAdmin(req, res);
      } catch (e) {
        console.error(e);
        // adminController catches internally and sends response
      }
      
      assert.strictEqual(res.statusCode, 409, "Expected 409 Conflict");
      await cleanup();
    });

  } finally {
    await cleanup().catch(() => {});
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }

  console.log(`\nResult: ${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
