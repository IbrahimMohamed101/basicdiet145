const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const sinon = require("sinon");
const fs = require("fs");

const { performDaySelectionValidation, performDaySelectionUpdate } = require("../src/services/subscription/subscriptionSelectionService");
const { resolveSubscriptionAddonBalanceWithAudit } = require("../src/services/subscription/subscriptionAddonBalanceService");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Addon = require("../src/models/Addon");
const Plan = require("../src/models/Plan");
const MenuProduct = require("../src/models/MenuProduct");

let mongoServer;

async function setup() {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
}

async function teardown() {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
}

async function runTests() {
  await setup();
  console.log("=== Running Addon Balance Cumulative Model E2E Tests ===\n");

  const userId = new mongoose.Types.ObjectId();
  const clientId = new mongoose.Types.ObjectId();

  const plan = new Plan({ name: { en: "Test Plan" }, priceHalala: 10000 });
  await plan.save({ validateBeforeSave: false });

  const juiceProduct = new MenuProduct({ name: { en: "Juice Product" }, category: { key: "juices" }, priceHalala: 1000, currency: "SAR" });
  await juiceProduct.save({ validateBeforeSave: false });
  const juiceProduct2 = new MenuProduct({ name: { en: "Juice Product 2" }, category: { key: "juices" }, priceHalala: 1000, currency: "SAR" });
  await juiceProduct2.save({ validateBeforeSave: false });

  const juiceAddon = new Addon({ name: { en: "Juice Addon" }, category: "juice", priceHalala: 1000, pricingMode: "fixed", menuProductIds: [juiceProduct._id] });
  await juiceAddon.save({ validateBeforeSave: false });

  const date = "2026-08-01";

  // Test 1: Exact Coverage (7 requested, 7 remaining)
  try {
    console.log("Test 1: Exact Coverage (7 requested, 7 remaining)");
    const sub1 = new Subscription({
      userId, clientId, planId: plan._id, status: "active", totalMeals: 30, duration: 30, contractMode: "canonical",
      addonBalance: [{
        addonId: juiceAddon._id, category: "juice", includedTotalQty: 30, remainingQty: 7, consumedQty: 23
      }],
      addonSubscriptions: [{
        addonId: juiceAddon._id, category: "juice", maxPerDay: 2
      }]
    });
    await sub1.save({ validateBeforeSave: false });

    const day1 = new SubscriptionDay({ subscriptionId: sub1._id, date, status: "open" });
    await day1.save({ validateBeforeSave: false });

    sinon.stub(require("../src/utils/subscription/subscriptionDaySelectionSync"), "resolveMealsPerDay").returns(1);

    const requestedIds = Array(7).fill(juiceAddon._id.toString());
    const result1 = await performDaySelectionValidation({
      userId: userId.toString(), subscriptionId: sub1._id.toString(), date, mealSlots: [], contractVersion: "canonical", requestedOneTimeAddonIds: requestedIds
    });

    if (result1.addonSummary.inclusiveCount !== 7 || result1.addonSummary.pendingPaymentCount !== 0) {
      throw new Error(`Expected 7 inclusive, 0 pending. Got ${result1.addonSummary.inclusiveCount} inclusive, ${result1.addonSummary.pendingPaymentCount} pending.`);
    }
    console.log(`✅ Test 1 Passed: 7 items requested, 7 remaining. Result -> ${result1.addonSummary.inclusiveCount} covered by subscription, ${result1.addonSummary.pendingPaymentCount} pending payment. Amount Due: ${result1.addonSummary.totalExtraHalala} Halala.`);
  } catch (err) {
    console.error("❌ Test 1 Failed:", err.message);
  }

  // Test 2: Overage Coverage (8 requested, 7 remaining)
  try {
    console.log("\nTest 2: Overage Coverage (8 requested, 7 remaining)");
    const sub2 = new Subscription({
      userId, clientId, planId: plan._id, status: "active", totalMeals: 30, duration: 30, contractMode: "canonical",
      addonBalance: [{
        addonId: juiceAddon._id, category: "juice", includedTotalQty: 30, remainingQty: 7, consumedQty: 23
      }],
      addonSubscriptions: [{
        addonId: juiceAddon._id, category: "juice", maxPerDay: 2
      }]
    });
    await sub2.save({ validateBeforeSave: false });

    const day2 = new SubscriptionDay({ subscriptionId: sub2._id, date, status: "open" });
    await day2.save({ validateBeforeSave: false });

    const requestedIds = Array(8).fill(juiceAddon._id.toString());
    const result2 = await performDaySelectionValidation({
      userId: userId.toString(), subscriptionId: sub2._id.toString(), date, mealSlots: [], contractVersion: "canonical", requestedOneTimeAddonIds: requestedIds
    });

    if (result2.addonSummary.inclusiveCount !== 7 || result2.addonSummary.pendingPaymentCount !== 1) {
      throw new Error(`Expected 7 inclusive, 1 pending. Got ${result2.addonSummary.inclusiveCount} inclusive, ${result2.addonSummary.pendingPaymentCount} pending.`);
    }
    const expectedDue = juiceProduct.priceHalala; // Price of 1 juice
    if (result2.addonSummary.totalExtraHalala !== expectedDue) {
      throw new Error(`Expected amount due ${expectedDue}, got ${result2.addonSummary.totalExtraHalala}.`);
    }

    console.log(`✅ Test 2 Passed: 8 items requested, 7 remaining. Result -> ${result2.addonSummary.inclusiveCount} covered by subscription, ${result2.addonSummary.pendingPaymentCount} pending payment. Amount Due: ${result2.addonSummary.totalExtraHalala} Halala.`);
  } catch (err) {
    console.error("❌ Test 2 Failed:", err.message);
  }

  // Test 3: Update consumes across multiple same-category addonBalance buckets
  try {
    console.log("\nTest 3: Atomic consumption across multiple juice buckets (20 total remaining)");
    const sub3 = new Subscription({
      userId,
      clientId,
      planId: plan._id,
      status: "active",
      totalMeals: 30,
      remainingMeals: 30,
      duration: 30,
      contractMode: "canonical",
      deliveryMode: "delivery",
      validityEndDate: new Date("2026-12-31T00:00:00Z"),
      addonBalance: [
        { addonId: juiceAddon._id, category: "juice", includedTotalQty: 30, remainingQty: 3, consumedQty: 27 },
        { addonId: juiceAddon._id, category: "juice", includedTotalQty: 30, remainingQty: 17, consumedQty: 13 },
      ],
      addonSubscriptions: [{ addonId: juiceAddon._id, category: "juice", maxPerDay: 10 }],
    });
    await sub3.save({ validateBeforeSave: false });

    const requestedIds = Array(5).fill(juiceAddon._id.toString());
    const result3 = await performDaySelectionUpdate({
      userId: userId.toString(),
      subscriptionId: sub3._id.toString(),
      date,
      mealSlots: [],
      contractVersion: "canonical",
      requestedOneTimeAddonIds: requestedIds,
    });

    const totalRemaining = (await Subscription.findById(sub3._id).lean()).addonBalance
      .reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);
    if (result3.addonSummary.inclusiveCount !== 5 || result3.addonSummary.pendingPaymentCount !== 0) {
      throw new Error(`Expected 5 inclusive, 0 pending after save. Got ${result3.addonSummary.inclusiveCount} inclusive, ${result3.addonSummary.pendingPaymentCount} pending.`);
    }
    if (result3.paymentRequirement && result3.paymentRequirement.requiresPayment) {
      throw new Error("Expected no payment required when total addon balance is sufficient");
    }
    if (totalRemaining !== 15) {
      throw new Error(`Expected 15 remainingQty total after consuming 5, got ${totalRemaining}`);
    }
    const sources = result3.day.addonSelections.map((item) => item.source);
    if (!sources.every((source) => source === "subscription")) {
      throw new Error("Expected all 5 addons to be covered by subscription balance");
    }

    console.log("✅ Test 3 Passed: update consumed across multiple addonBalance buckets and returned no payment requirement.");
  } catch (err) {
    console.error("❌ Test 3 Failed:", err.message);
  }

  // Test 4: Validate with multiple same-category addonBalance buckets
  try {
    console.log("\nTest 4: Validate covers 8 requested juice addons across two juice buckets");
    const subValidate = new Subscription({
      userId,
      clientId,
      planId: plan._id,
      status: "active",
      totalMeals: 30,
      remainingMeals: 30,
      duration: 30,
      contractMode: "canonical",
      deliveryMode: "delivery",
      validityEndDate: new Date("2026-12-31T00:00:00Z"),
      addonBalance: [
        { addonId: juiceAddon._id, category: "juice", includedTotalQty: 30, remainingQty: 3, consumedQty: 27 },
        { addonId: juiceAddon._id, category: "juice", includedTotalQty: 30, remainingQty: 17, consumedQty: 13 },
      ],
      addonSubscriptions: [{ addonId: juiceAddon._id, category: "juice", maxPerDay: 10 }],
    });
    await subValidate.save({ validateBeforeSave: false });

    const validationDay = new SubscriptionDay({ subscriptionId: subValidate._id, date, status: "open" });
    await validationDay.save({ validateBeforeSave: false });

    const validateRequestedIds = Array(8).fill(juiceAddon._id.toString());
    const validationResult = await performDaySelectionValidation({
      userId: userId.toString(),
      subscriptionId: subValidate._id.toString(),
      date,
      mealSlots: [],
      contractVersion: "canonical",
      requestedOneTimeAddonIds: validateRequestedIds,
    });

    if (validationResult.addonSummary.inclusiveCount !== 8 || validationResult.addonSummary.pendingPaymentCount !== 0) {
      throw new Error(`Expected 8 inclusive and 0 pending on validation, got ${validationResult.addonSummary.inclusiveCount} inclusive and ${validationResult.addonSummary.pendingPaymentCount} pending.`);
    }
    if (validationResult.addonSummary.totalExtraHalala !== 0) {
      throw new Error(`Expected amount due 0 on validation, got ${validationResult.addonSummary.totalExtraHalala}`);
    }

    console.log("✅ Test 4 Passed: validate covers all 8 juice addons from multiple same-category buckets.");
  } catch (err) {
    console.error("❌ Test 4 Failed:", err.message);
  }

  // Test 5: Missing Balance Fallback
  try {
    console.log("\nTest 5: Missing Balance Fallback (No addonBalance bucket but entitlement exists)");
    const sub4 = new Subscription({
      userId, clientId, planId: plan._id, status: "active", totalMeals: 30, duration: 30, contractMode: "canonical",
      addonBalance: [],
      addonSubscriptions: [{
        addonId: juiceAddon._id, category: "juice", maxPerDay: 2
      }]
    });
    await sub4.save({ validateBeforeSave: false });

    const day4 = new SubscriptionDay({ subscriptionId: sub4._id, date, status: "open" });
    await day4.save({ validateBeforeSave: false });

    const requestedIds = [juiceAddon._id.toString()];
    const result4 = await performDaySelectionValidation({
      userId: userId.toString(), subscriptionId: sub4._id.toString(), date, mealSlots: [], contractVersion: "canonical", requestedOneTimeAddonIds: requestedIds
    });

    if (result4.addonSummary.inclusiveCount !== 0 || result4.addonSummary.pendingPaymentCount !== 1) {
      throw new Error(`Expected 0 inclusive, 1 pending. Got ${result4.addonSummary.inclusiveCount} inclusive, ${result4.addonSummary.pendingPaymentCount} pending.`);
    }
    console.log("✅ Test 5 Passed: Validation gracefully degraded missing balance to pending_payment.");
  } catch (err) {
    console.error("❌ Test 5 Failed:", err.message);
  }

  // Test 6: menuProductIds allowlist bypass blocking
  try {
    console.log("\nTest 6: menuProductIds allowlist restriction");
    const sub4 = new Subscription({
      userId, clientId, planId: plan._id, status: "active", totalMeals: 30, duration: 30, contractMode: "canonical",
      addonBalance: [{
        addonId: juiceAddon._id, category: "juice", includedTotalQty: 30, remainingQty: 25, consumedQty: 5
      }],
      addonSubscriptions: [{
        addonId: juiceAddon._id, category: "juice", maxPerDay: 2, menuProductIds: [juiceProduct._id] // Does NOT include juiceProduct2
      }]
    });
    await sub4.save({ validateBeforeSave: false });

    const day4 = new SubscriptionDay({ subscriptionId: sub4._id, date, status: "open" });
    await day4.save({ validateBeforeSave: false });

    // Request the second juice which is NOT in the menuProductIds allowlist
    const juiceAddon2 = new Addon({ name: { en: "Juice Addon 2" }, category: "juice", priceHalala: 0, pricingMode: "fixed", menuProductIds: [juiceProduct2._id] });
    await juiceAddon2.save({ validateBeforeSave: false });

    const requestedIds = [juiceAddon2._id.toString()];
    const result4 = await performDaySelectionValidation({
      userId: userId.toString(), subscriptionId: sub4._id.toString(), date, mealSlots: [], contractVersion: "canonical", requestedOneTimeAddonIds: requestedIds
    });

    if (result4.addonSummary.inclusiveCount !== 0 || result4.addonSummary.pendingPaymentCount !== 1) {
      throw new Error(`Expected 0 inclusive, 1 pending (allowlist block). Got ${result4.addonSummary.inclusiveCount} inclusive, ${result4.addonSummary.pendingPaymentCount} pending.`);
    }
    console.log("✅ Test 6 Passed: menuProductIds restriction correctly prevented balance coverage for unlisted item.");
  } catch (err) {
    console.error("❌ Test 6 Failed:", err.message);
  }

  await teardown();
  console.log("\nTests Complete.");
}

runTests();
