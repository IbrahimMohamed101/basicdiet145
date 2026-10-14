"use strict";
const assert = require("node:assert/strict");
const User = require("../src/models/User");
const Subscription = require("../src/models/Subscription");
const Batch = require("../src/models/SubscriptionEntitlementBatch");
const { acquisitionChannel } = require("../src/services/subscriptionAcquisitionReadService");
const {
  normalizePhone,
  selectVerifiedSubscription,
  attachVerifiedSubscriptionsToLeads,
} = require("../src/services/landingLeadConversionReadService");

const id1 = "507f1f77bcf86cd799439011";
const id2 = "507f1f77bcf86cd799439012";
const lead = {
  phone: "+966501234567",
  createdAt: new Date("2026-10-01T10:00:00.000Z"),
};
const sub = (overrides = {}) => ({
  _id: id2,
  userId: id1,
  createdAt: new Date("2026-10-03T10:00:00.000Z"),
  status: "active",
  contractSource: "customer_checkout",
  ...overrides,
});

async function run() {
  assert.equal(normalizePhone("0501234567"), lead.phone);
  assert.equal(normalizePhone("966501234567"), lead.phone);
  assert.equal(normalizePhone("+966 50 123 4567"), lead.phone);
  assert.equal(normalizePhone("0112345678"), null);

  assert.equal(acquisitionChannel({ contractSource: "admin_create" }), "cashier");
  assert.equal(acquisitionChannel({ contractSource: "customer_checkout" }), "app");
  assert.equal(acquisitionChannel({ contractSource: "renewal" }), "app");
  assert.equal(acquisitionChannel({ contractSource: "unknown" }), "unknown");
  assert.equal(acquisitionChannel({ contractSource: "admin_create" }, [
    { sourceType: "checkout", applicationState: "applied" },
  ]), "mixed");
  assert.equal(acquisitionChannel({ contractSource: "admin_create" }, [
    { sourceType: "checkout", applicationState: "failed" },
    { sourceType: "legacy_seed" },
  ]), "cashier");

  assert.equal(selectVerifiedSubscription({
    lead, subscriptions: [sub({ status: "pending_payment" })], batchesByContainer: new Map(),
  }), null);
  assert.equal(selectVerifiedSubscription({
    lead, subscriptions: [sub({ createdAt: new Date("2026-09-25") })], batchesByContainer: new Map(),
  }), null);
  assert.equal(selectVerifiedSubscription({
    lead, subscriptions: [sub({ status: "canceled", cancellationReason: "activation_failed" })],
    batchesByContainer: new Map(),
  }), null);
  const verified = selectVerifiedSubscription({
    lead, subscriptions: [sub()], batchesByContainer: new Map(),
  });
  assert.equal(verified.source, "app");
  assert.equal(verified.subscriptionId, id2);
  assert.equal(verified.matchBasis, "same_phone_after_lead");

  const stacked = selectVerifiedSubscription({
    lead,
    subscriptions: [sub({ contractSource: "admin_create", createdAt: new Date("2026-09-01") })],
    batchesByContainer: new Map([[id2, [{
      sourceType: "checkout", applicationState: "applied", createdAt: new Date("2026-10-04"),
    }]]]),
  });
  assert.equal(stacked.source, "app");
  assert.equal(stacked.subscriptionOrigin, "mixed");
  assert.equal(selectVerifiedSubscription({
    lead,
    subscriptions: [sub({ createdAt: new Date("2026-09-01") })],
    batchesByContainer: new Map([[id2, [{
      sourceType: "checkout", applicationState: "pending", createdAt: new Date("2026-10-04"),
    }]]]),
  }), null);

  const original = { userFind: User.find, subscriptionFind: Subscription.find, batchFind: Batch.find };
  try {
    User.find = () => ({
      select: () => ({ lean: async () => [{ _id: id1, phone: "0501234567" }] }),
    });
    Subscription.find = () => ({
      select: () => ({
        sort: () => ({
          limit: () => ({ lean: async () => [sub()] }),
        }),
      }),
    });
    Batch.find = () => ({ select: () => ({ lean: async () => [] }) });
    const matches = await attachVerifiedSubscriptionsToLeads([
      lead,
      { phone: "+966599999999", createdAt: lead.createdAt },
      { phone: "+966501234567", createdAt: new Date("2026-10-07") },
    ]);
    assert.equal(matches[0].verifiedSubscription.source, "app");
    assert.equal(matches[1].verifiedSubscription, null);
    assert.equal(matches[2].verifiedSubscription, null);
  } finally {
    User.find = original.userFind;
    Subscription.find = original.subscriptionFind;
    Batch.find = original.batchFind;
  }
  console.log("Landing lead paid-activation matching and acquisition channel: PASS");
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
