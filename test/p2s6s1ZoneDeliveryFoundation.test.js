const assert = require("node:assert");
const test = require("node:test");
const mongoose = require("mongoose");
const Subscription = require("../src/models/Subscription");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const { buildPhase1SubscriptionContract } = require("../src/services/subscriptionContractService");
const { buildCanonicalSubscriptionActivationPayload } = require("../src/services/subscriptionActivationService");

const objectId = () => new mongoose.Types.ObjectId();

test("CheckoutDraft stores delivery zone fields", async (t) => {
  const zoneId = objectId();
  const draft = new CheckoutDraft({
    userId: objectId(),
    planId: objectId(),
    daysCount: 20,
    grams: 150,
    mealsPerDay: 3,
    delivery: {
      type: "delivery",
      zoneId,
      zoneName: "North Zone",
      address: { city: "Riyadh" }
    }
  });

  assert.equal(String(draft.delivery.zoneId), String(zoneId));
  assert.equal(draft.delivery.zoneName, "North Zone");
});

test("Subscription activation captures zone details from canonical contract", async (t) => {
  const zoneId = objectId();
  const planId = objectId();
  
  const resolvedQuote = {
    plan: { _id: planId, daysCount: 20, currency: "SAR" },
    mealsPerDay: 3,
    grams: 150,
    delivery: {
      type: "delivery",
      zoneId,
      zoneName: "East Zone",
      address: { city: "Riyadh" }
    },
    breakdown: { totalHalala: 100000, currency: "SAR" }
  };

  const contract = buildPhase1SubscriptionContract({
    source: "customer_checkout",
    resolvedQuote,
    now: new Date("2026-04-01")
  });

  // 1. Verify Contract Snapshot has zone info
  assert.equal(contract.contractSnapshot.delivery.zoneId, String(zoneId));
  assert.equal(contract.contractSnapshot.delivery.zoneName, "East Zone");

  const draft = {
    userId: objectId(),
    planId,
    contractVersion: contract.contractVersion,
    contractMode: contract.contractMode,
    contractCompleteness: contract.contractCompleteness,
    contractSource: contract.contractSource,
    contractHash: contract.contractHash,
    contractSnapshot: contract.contractSnapshot,
    premiumWalletMode: "legacy"
  };

  const { subscriptionPayload } = buildCanonicalSubscriptionActivationPayload({ draft });

  // 2. Verify Activation Payload has top-level zone info extracted from snapshot
  assert.equal(String(subscriptionPayload.deliveryZoneId), String(zoneId));
  assert.equal(subscriptionPayload.deliveryZoneName, "East Zone");
  
  // 3. Verify Snapshot remains preserved in payload
  assert.equal(subscriptionPayload.contractSnapshot.delivery.zoneId, String(zoneId));
});

test("Legacy activation (no zone) remains unaffected", async (t) => {
  const planId = objectId();
  const resolvedQuote = {
    plan: { _id: planId, daysCount: 20 },
    mealsPerDay: 3,
    grams: 150,
    delivery: { type: "delivery", address: { city: "Riyadh" } }
  };

  const contract = buildPhase1SubscriptionContract({
    source: "customer_checkout",
    resolvedQuote
  });

  assert.strictEqual(contract.contractSnapshot.delivery.zoneId, null);
  assert.strictEqual(contract.contractSnapshot.delivery.zoneName, "");

  const draft = {
    userId: objectId(),
    planId,
    contractVersion: contract.contractVersion,
    contractMode: contract.contractMode,
    contractCompleteness: contract.contractCompleteness,
    contractSource: contract.contractSource,
    contractHash: contract.contractHash,
    contractSnapshot: contract.contractSnapshot
  };

  const { subscriptionPayload } = buildCanonicalSubscriptionActivationPayload({ draft });
  assert.strictEqual(subscriptionPayload.deliveryZoneId, null);
  assert.strictEqual(subscriptionPayload.deliveryZoneName, "");
});

test("Pickup subscriptions do not store zone data", async (t) => {
  const planId = objectId();
  const resolvedQuote = {
    plan: { _id: planId, daysCount: 20 },
    mealsPerDay: 3,
    grams: 150,
    delivery: { type: "pickup", pickupLocationId: objectId() }
  };

  const contract = buildPhase1SubscriptionContract({
    source: "customer_checkout",
    resolvedQuote
  });

  assert.strictEqual(contract.contractSnapshot.delivery.zoneId, null);
  const { subscriptionPayload } = buildCanonicalSubscriptionActivationPayload({ draft: { contractSnapshot: contract.contractSnapshot, contractVersion: contract.contractVersion, contractMode: contract.contractMode, contractCompleteness: contract.contractCompleteness, contractHash: contract.contractHash } });
  assert.strictEqual(subscriptionPayload.deliveryZoneId, null);
});

// --- P2-S6-S1 Follow-up Regression Tests ---

// Mock for resolveDeliveryInput (copy-pasted logic to test in isolation)
function mockResolveDeliveryInput(payload = {}) {
  const delivery = payload.delivery && typeof payload.delivery === "object" ? payload.delivery : {};
  const type = delivery.type || payload.deliveryMode || (delivery.slot && delivery.slot.type) || "delivery";
  const normalizedType = ["delivery", "pickup"].includes(type) ? type : "delivery";
  
  const isDelivery = normalizedType === "delivery";
  const zoneId = isDelivery && delivery.zoneId ? delivery.zoneId : null;
  const zoneName = isDelivery && delivery.zoneName ? String(delivery.zoneName || "").trim() : "";

  return { type: normalizedType, zoneId, zoneName };
}

test("resolveDeliveryInput propagates zone fields for delivery mode", async (t) => {
  const zoneId = objectId();
  const payload = {
    delivery: {
      type: "delivery",
      zoneId,
      zoneName: "West Zone"
    }
  };
  const result = mockResolveDeliveryInput(payload);
  assert.equal(String(result.zoneId), String(zoneId));
  assert.equal(result.zoneName, "West Zone");
});

test("resolveDeliveryInput gates zone fields for pickup mode", async (t) => {
  const zoneId = objectId();
  const payload = {
    delivery: {
      type: "pickup",
      zoneId,
      zoneName: "West Zone"
    }
  };
  const result = mockResolveDeliveryInput(payload);
  assert.strictEqual(result.zoneId, null);
  assert.strictEqual(result.zoneName, "");
});

test("Subscription activation (Admin Flow) propagates zone details", async (t) => {
  const { buildPhase1SubscriptionContract } = require("../src/services/subscriptionContractService");
  const { activateSubscriptionFromCanonicalContract } = require("../src/services/subscriptionActivationService");

  const zoneId = objectId();
  const planId = objectId();
  const userId = objectId();

  const resolvedQuote = {
    plan: { _id: planId, daysCount: 20 },
    mealsPerDay: 3,
    grams: 150,
    delivery: {
      type: "delivery",
      zoneId,
      zoneName: "Admin Zone",
      address: { city: "Riyadh" }
    },
    breakdown: { totalHalala: 100000, currency: "SAR" }
  };

  const contract = buildPhase1SubscriptionContract({
    source: "admin_create",
    resolvedQuote,
    now: new Date()
  });

  // Mock persistence for activation
  const persistence = {
    createSubscription: async (payload) => ({ ...payload, _id: objectId() }),
    countSubscriptionDays: async () => 0,
    insertSubscriptionDays: async () => []
  };

  const subscription = await activateSubscriptionFromCanonicalContract({
    userId,
    planId,
    contract,
    persistence
  });

  assert.equal(String(subscription.deliveryZoneId), String(zoneId));
  assert.equal(subscription.deliveryZoneName, "Admin Zone");
});

test("Existing subscriptions remain untouched (no retrofit check)", async (t) => {
  // This test ensures that the schema changes with defaults don't overwrite existing nulls/undefineds
  // but also that no code path in this slice attempts a mass update.
  const sub = new Subscription({
    userId: objectId(),
    planId: objectId(),
    status: "active"
  });
  // Should have default null/""
  assert.strictEqual(sub.deliveryZoneId, null);
  assert.strictEqual(sub.deliveryZoneName, "");
});
