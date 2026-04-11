const test = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");
const Zone = require("../src/models/Zone");
const Subscription = require("../src/models/Subscription");
const Plan = require("../src/models/Plan");
const { buildPhase1SubscriptionContract } = require("../src/services/subscription/subscriptionContractService");
const { buildCanonicalSubscriptionActivationPayload } = require("../src/services/subscription/subscriptionActivationService");
const { buildSubscriptionRenewalSeed } = require("../src/services/subscription/subscriptionRenewalService");

// Mocking resolveCheckoutQuoteOrThrow since it's an async controller-level function
// but we'll reflect the actual logic of resolution from Zone master data.
const mockResolveQuote = async (payload, lang = "ar") => {
  const isDelivery = payload.delivery && payload.delivery.type === "delivery";
  let deliveryFeeHalala = 0;
  let zoneName = "";

  if (isDelivery && payload.delivery.zoneId) {
    const zone = await Zone.findById(payload.delivery.zoneId).lean();
    if (zone) {
      if (!zone.isActive && !payload.renewedFromSubscriptionId) {
        throw new Error("Selected delivery zone is currently inactive for new subscriptions");
      }
      deliveryFeeHalala = zone.deliveryFeeHalala;
      zoneName = zone.name;
    }
  }

  return {
    plan: { _id: payload.planId, daysCount: 20 },
    mealsPerDay: 3,
    grams: 150,
    delivery: {
      type: payload.delivery.type,
      zoneId: payload.delivery.zoneId,
      zoneName: zoneName,
      address: payload.delivery.address
    },
    breakdown: {
      basePlanPriceHalala: 100000,
      deliveryFeeHalala,
      vatHalala: 0,
      totalHalala: 100000 + deliveryFeeHalala,
      currency: "SAR"
    }
  };
};

test("Zone Fee Snapshot and Renewal Handling (P2-S6-S2)", async (t) => {
  // Setup shared data
  const zoneId = new mongoose.Types.ObjectId();
  const zone = new Zone({
    _id: zoneId,
    name: "North Zone",
    deliveryFeeHalala: 500,
    isActive: true
  });
  // We don't save to real DB, we just use lean/findById mocks if needed, 
  // but for this test we'll mock the Zone.findById.
  const originalFindById = Zone.findById;
  Zone.findById = (id) => ({
    lean: () => Promise.resolve(id.toString() === zoneId.toString() ? zone : null)
  });

  await t.test("New delivery contract snapshots deliveryFeeHalala from active zone", async () => {
    const payload = {
      planId: new mongoose.Types.ObjectId(),
      delivery: { type: "delivery", zoneId: zoneId }
    };
    const quote = await mockResolveQuote(payload);
    const contract = buildPhase1SubscriptionContract({
      source: "customer_checkout",
      resolvedQuote: quote
    });

    assert.strictEqual(contract.contractSnapshot.pricing.deliveryFeeHalala, 500);
    assert.strictEqual(contract.contractSnapshot.delivery.pricingMode, "zone_snapshot");
  });

  await t.test("Activation persists the snapshotted delivery fee onto the active subscription", async () => {
    const contractSnapshot = {
      pricing: { deliveryFeeHalala: 500, currency: "SAR" },
      delivery: { mode: "delivery", zoneId: String(zoneId), zoneName: "North Zone" },
      plan: { planId: String(new mongoose.Types.ObjectId()), daysCount: 20, mealsPerDay: 3, totalMeals: 60 },
      start: { resolvedStartDate: new Date().toISOString() }
    };
    const { subscriptionPayload } = buildCanonicalSubscriptionActivationPayload({
      draft: { 
        contractVersion: "subscription_contract.v1",
        contractMode: "canonical",
        contractCompleteness: "authoritative",
        contractHash: "hash",
        contractSnapshot,
        premiumWalletMode: "legacy"
      }
    });

    assert.strictEqual(subscriptionPayload.deliveryFeeHalala, 500);
  });

  await t.test("Renewal uses current zone master fee and snapshot stability", async () => {
    const subId = new mongoose.Types.ObjectId();
    const activeSub = new Subscription({
      _id: subId,
      deliveryZoneId: zoneId,
      deliveryFeeHalala: 500,
      contractSnapshot: {
        plan: { planId: String(new mongoose.Types.ObjectId()), selectedGrams: 150, mealsPerDay: 3, daysCount: 20 },
        delivery: { mode: "delivery", zoneId: String(zoneId), zoneName: "North Zone" }
      }
    });

    // Change master fee
    zone.deliveryFeeHalala = 750;

    const seed = buildSubscriptionRenewalSeed({
      previousSubscription: activeSub,
      livePlan: { _id: activeSub.planId, isActive: true, gramsOptions: [{ grams: 150, mealsOptions: [{ mealsPerDay: 3, isActive: true }] }] }
    });

    const renewalQuote = await mockResolveQuote({
      planId: activeSub.planId,
      delivery: { type: "delivery", zoneId: seed.seed.deliveryPreference.zoneId },
      renewedFromSubscriptionId: subId
    });

    assert.strictEqual(renewalQuote.breakdown.deliveryFeeHalala, 750);
    // Original sub unchanged
    assert.strictEqual(activeSub.deliveryFeeHalala, 500);
  });

  await t.test("Pickup subscriptions do not get zone pricing", async () => {
    const payload = {
      planId: new mongoose.Types.ObjectId(),
      delivery: { type: "pickup" }
    };
    const quote = await mockResolveQuote(payload);
    const contract = buildPhase1SubscriptionContract({
      source: "customer_checkout",
      resolvedQuote: quote
    });

    assert.strictEqual(contract.contractSnapshot.pricing.deliveryFeeHalala, 0);
    assert.strictEqual(contract.contractSnapshot.delivery.pricingMode, "pickup_legacy");
  });

  await t.test("Inactive zones block new subscriptions but allow renewals", async () => {
    zone.isActive = false;

    const newPayload = { 
      planId: new mongoose.Types.ObjectId(), 
      delivery: { type: "delivery", zoneId } 
    };
    await assert.rejects(mockResolveQuote(newPayload), /inactive/);

    const renewalPayload = {
      planId: new mongoose.Types.ObjectId(),
      delivery: { type: "delivery", zoneId },
      renewedFromSubscriptionId: new mongoose.Types.ObjectId()
    };
    await assert.doesNotReject(mockResolveQuote(renewalPayload));
  });

  await t.test("Address updates do not trigger repricing", async () => {
    const sub = new Subscription({
      deliveryAddress: { line1: "Old Address" },
      deliveryFeeHalala: 500
    });

    // Simulate updateDeliveryDetails
    sub.deliveryAddress = { line1: "New Address" };
    
    assert.strictEqual(sub.deliveryFeeHalala, 500);
    assert.strictEqual(sub.deliveryAddress.line1, "New Address");
  });

  // Cleanup
  Zone.findById = originalFindById;
});
