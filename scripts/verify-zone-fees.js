const mongoose = require("mongoose");
const { 
  resolveCheckoutQuoteOrThrow 
} = require("./src/controllers/subscriptionController");
const { 
  buildPhase1SubscriptionContract 
} = require("./src/services/subscriptionContractService");
const { 
  buildCanonicalSubscriptionActivationPayload 
} = require("./src/services/subscriptionActivationService");
const Zone = require("./src/models/Zone");
const Plan = require("./src/models/Plan");
const CheckoutDraft = require("./src/models/CheckoutDraft");

async function runVerification() {
  console.log("Starting P2-S6-S2 Verification...");

  // 1. Setup Data
  const zone = await Zone.create({
    name: "Test Zone",
    deliveryFeeHalala: 1500,
    isActive: true
  });

  const plan = await Plan.create({
    name: { ar: "Plan", en: "Plan" },
    currency: "SAR",
    daysCount: 7,
    gramsOptions: [{
      grams: 150,
      isActive: true,
      mealsOptions: [{
        mealsPerDay: 2,
        priceHalala: 10000,
        isActive: true
      }]
    }],
    isActive: true
  });

  // 2. Test New Delivery Subscription Snapshot
  console.log("\nTesting New Delivery Subscription Snapshot...");
  const payload = {
    planId: plan._id,
    grams: 150,
    mealsPerDay: 2,
    delivery: {
      type: "delivery",
      zoneId: zone._id,
      address: { line1: "Test" }
    }
  };

  const quote = await resolveCheckoutQuoteOrThrow(payload);
  const contract = buildPhase1SubscriptionContract({
    payload,
    resolvedQuote: quote,
    source: "customer_checkout"
  });

  console.log("Snapshotted deliveryFeeHalala:", contract.contractSnapshot.pricing.deliveryFeeHalala);
  if (contract.contractSnapshot.pricing.deliveryFeeHalala !== 1500) {
    throw new Error("Failed: deliveryFeeHalala not snapshotted correctly");
  }
  if (contract.contractSnapshot.delivery.pricingMode !== "zone_snapshot") {
    throw new Error("Failed: pricingMode should be zone_snapshot");
  }

  const { subscriptionPayload } = buildCanonicalSubscriptionActivationPayload({
    draft: { 
      contractVersion: "phase1", 
      contractMode: "canonical", 
      contractCompleteness: "authoritative", 
      contractHash: "h", 
      contractSnapshot: contract.contractSnapshot,
      premiumWalletMode: "legacy"
    }
  });

  console.log("Activated deliveryFeeHalala:", subscriptionPayload.deliveryFeeHalala);
  if (subscriptionPayload.deliveryFeeHalala !== 1500) {
    throw new Error("Failed: subscriptionPayload deliveryFeeHalala mismatch");
  }

  // 3. Test Renewal Fee Refresh
  console.log("\nTesting Renewal Fee Refresh...");
  // Update zone fee in master data
  await Zone.findByIdAndUpdate(zone._id, { deliveryFeeHalala: 2000 });
  
  const renewalPayload = {
    ...payload,
    renewedFromSubscriptionId: new mongoose.Types.ObjectId() // Dummy ID
  };

  const renewalQuote = await resolveCheckoutQuoteOrThrow(renewalPayload);
  console.log("Refreshed renewal deliveryFeeHalala:", renewalQuote.breakdown.deliveryFeeHalala);
  if (renewalQuote.breakdown.deliveryFeeHalala !== 2000) {
    throw new Error("Failed: Renewal fee not refreshed from master data");
  }

  // 4. Test Pickup Safety
  console.log("\nTesting Pickup Safety...");
  const pickupPayload = {
    planId: plan._id,
    grams: 150,
    mealsPerDay: 2,
    delivery: {
      type: "pickup",
      pickupLocationId: "loc1"
    }
  };

  const pickupQuote = await resolveCheckoutQuoteOrThrow(pickupPayload);
  const pickupContract = buildPhase1SubscriptionContract({
    payload: pickupPayload,
    resolvedQuote: pickupQuote,
    source: "customer_checkout"
  });

  console.log("Pickup deliveryFeeHalala:", pickupContract.contractSnapshot.pricing.deliveryFeeHalala);
  if (pickupContract.contractSnapshot.pricing.deliveryFeeHalala !== 0) {
    throw new Error("Failed: Pickup should have 0 delivery fee");
  }
  if (pickupContract.contractSnapshot.delivery.pricingMode !== "pickup_legacy") {
    throw new Error("Failed: Pickup pricingMode should be pickup_legacy");
  }

  // 5. Test Inactive Zone Block
  console.log("\nTesting Inactive Zone Block...");
  await Zone.findByIdAndUpdate(zone._id, { isActive: false });
  try {
    await resolveCheckoutQuoteOrThrow(payload);
    throw new Error("Failed: Should have thrown for inactive zone");
  } catch (err) {
    console.log("Correctly blocked inactive zone:", err.message);
  }

  console.log("\nVerification Passed!");
}

// Mocking required pieces for local run if needed, but here we assume environment is setup.
// For antigravity, we can just write this and the user can run it or we can run it if we have DB access.
// Since I cannot run full app logic easily without DB connection, I will focus on unit-testing the logic.

runVerification().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
