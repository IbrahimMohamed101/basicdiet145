require("dotenv").config();
const mongoose = require("mongoose");
const { performDaySelectionValidation } = require("../src/services/subscription/subscriptionSelectionService");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Addon = require("../src/models/Addon");
const Plan = require("../src/models/Plan");
const MenuProduct = require("../src/models/MenuProduct");

async function runRealDatabaseVerification() {
  // Connect to the real test database instance
  await mongoose.connect(process.env.MONGO_URI_TEST);
  console.log("Connected to Real Database:", process.env.MONGO_URI_TEST.split("@")[1]);

  const userId = new mongoose.Types.ObjectId();
  const clientId = new mongoose.Types.ObjectId();
  const date = "2026-08-01";

  // 1. Setup Real Database Records
  const planId = new mongoose.Types.ObjectId();
  const juiceProductId = new mongoose.Types.ObjectId();
  const juiceAddonId = new mongoose.Types.ObjectId();

  await Plan.collection.insertOne({ _id: planId, name: { en: "Real Test Plan" }, priceHalala: 10000, daysCount: 30 });
  await MenuProduct.collection.insertOne({ _id: juiceProductId, key: "test_juice_" + Date.now(), categoryId: new mongoose.Types.ObjectId(), name: { en: "Real Juice" }, category: { key: "juices" }, priceHalala: 1500, currency: "SAR", isActive: true, isAvailable: true, publishedAt: new Date() });
  await Addon.collection.insertOne({ _id: juiceAddonId, name: { en: "Real Juice Addon" }, category: "juice", priceHalala: 1500, pricingMode: "fixed", isActive: true, kind: "item", menuProductIds: [juiceProductId] });

  // Create Real Subscription with exactly 7 remaining Juice credits
  const subscriptionId = new mongoose.Types.ObjectId();
  await Subscription.collection.insertOne({
    _id: subscriptionId,
    userId, 
    clientId, 
    planId: planId, 
    status: "active", 
    totalMeals: 30, 
    duration: 30, 
    contractMode: "canonical",
    addonBalance: [{
      _id: new mongoose.Types.ObjectId(),
      addonId: juiceAddonId, 
      category: "juice", 
      includedTotalQty: 30, 
      remainingQty: 7, 
      consumedQty: 23
    }],
    addonSubscriptions: [{
      _id: new mongoose.Types.ObjectId(),
      addonId: juiceAddonId, 
      category: "juice", 
      maxPerDay: 2
    }]
  });

  await SubscriptionDay.collection.insertOne({ subscriptionId: subscriptionId, date, status: "open" });

  console.log("\n===========================================");
  console.log("SCENARIO 1: Request 7 Juices (Remaining: 7)");
  console.log("===========================================");
  
  const requestedIds7 = Array(7).fill(juiceAddonId.toString());
  const result7 = await performDaySelectionValidation({
    userId: userId.toString(), 
    subscriptionId: subscriptionId.toString(), 
    date, 
    mealSlots: [], 
    contractVersion: "canonical", 
    requestedOneTimeAddonIds: requestedIds7
  });

  console.log(JSON.stringify({
    expectedInclusive: 7,
    actualInclusive: result7.addonSummary.inclusiveCount,
    expectedPending: 0,
    actualPending: result7.addonSummary.pendingPaymentCount,
    expectedAmountDue: 0,
    actualAmountDue: result7.addonSummary.totalExtraHalala
  }, null, 2));


  console.log("\n===========================================");
  console.log("SCENARIO 2: Request 8 Juices (Remaining: 7)");
  console.log("===========================================");
  
  const requestedIds8 = Array(8).fill(juiceAddonId.toString());
  const result8 = await performDaySelectionValidation({
    userId: userId.toString(), 
    subscriptionId: subscriptionId.toString(), 
    date, 
    mealSlots: [], 
    contractVersion: "canonical", 
    requestedOneTimeAddonIds: requestedIds8
  });

  console.log(JSON.stringify({
    expectedInclusive: 7,
    actualInclusive: result8.addonSummary.inclusiveCount,
    expectedPending: 1,
    actualPending: result8.addonSummary.pendingPaymentCount,
    expectedAmountDue: 1500,
    actualAmountDue: result8.addonSummary.totalExtraHalala
  }, null, 2));

  // Cleanup
  await Subscription.collection.deleteMany({ userId });
  await SubscriptionDay.collection.deleteMany({ subscriptionId: subscriptionId });
  await Plan.collection.deleteOne({ _id: planId });
  await MenuProduct.collection.deleteOne({ _id: juiceProductId });
  await Addon.collection.deleteOne({ _id: juiceAddonId });
  
  await mongoose.disconnect();
}

runRealDatabaseVerification().catch(console.error);
