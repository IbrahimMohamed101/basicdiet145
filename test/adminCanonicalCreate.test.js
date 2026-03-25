const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { createSubscriptionAdmin } = require("../src/controllers/adminController");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createReqRes({ body = {}, dashboardUserId = "admin-1", dashboardUserRole = "admin" } = {}) {
  const req = {
    body,
    dashboardUserId,
    dashboardUserRole,
    query: {},
    headers: {},
    get() {
      return undefined;
    },
  };

  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };

  return { req, res };
}

test("createSubscriptionAdmin uses canonical contract activation when admin canonical flag is enabled", async (t) => {
  const originalFlag = process.env.PHASE1_CANONICAL_ADMIN_CREATE;
  process.env.PHASE1_CANONICAL_ADMIN_CREATE = "true";
  t.after(() => {
    process.env.PHASE1_CANONICAL_ADMIN_CREATE = originalFlag;
  });

  const userId = String(objectId());
  const quote = {
    plan: { _id: objectId(), daysCount: 5, currency: "SAR" },
    grams: 150,
    mealsPerDay: 3,
    startDate: null,
    delivery: {
      type: "delivery",
      address: { city: "Riyadh" },
      slot: { type: "delivery", window: "8 AM - 11 AM", slotId: "slot-1" },
    },
    premiumItems: [],
    addonItems: [],
    breakdown: {
      basePlanPriceHalala: 10000,
      currency: "SAR",
    },
  };

  const contract = {
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractCompleteness: "authoritative",
    contractSource: "admin_create",
    contractHash: "contract-hash-admin",
    contractSnapshot: {
      meta: { version: "subscription_contract.v1" },
      origin: { adminOverrideMeta: { createdByAdmin: true } },
    },
  };

  const activatedSubscriptionId = objectId();
  let buildContractCalls = 0;
  let activateCalls = 0;
  let activityLogCalls = 0;

  const fakeSession = {
    active: false,
    startTransaction() { this.active = true; },
    async commitTransaction() { this.active = false; },
    async abortTransaction() { this.active = false; },
    endSession() {},
    inTransaction() { return this.active; },
  };

  const { req, res } = createReqRes({
    body: { userId },
    dashboardUserId: "dashboard-admin-1",
    dashboardUserRole: "admin",
  });

  await createSubscriptionAdmin(req, res, {
    async findClientUserById(id) {
      assert.equal(String(id), userId);
      return { _id: userId, role: "client", isActive: true };
    },
    async resolveCheckoutQuoteOrThrow() {
      return quote;
    },
    startSession() {
      return fakeSession;
    },
    buildPhase1SubscriptionContract(input) {
      buildContractCalls += 1;
      assert.equal(input.source, "admin_create");
      assert.equal(input.actorContext.actorRole, "admin");
      assert.equal(input.actorContext.actorUserId, "dashboard-admin-1");
      return contract;
    },
    async activateSubscriptionFromCanonicalContract({ userId: activationUserId, planId, contract: receivedContract, legacyRuntimeData }) {
      activateCalls += 1;
      assert.equal(String(activationUserId), userId);
      assert.equal(String(planId), String(quote.plan._id));
      assert.equal(receivedContract, contract);
      assert.deepEqual(legacyRuntimeData.premiumBalance, []);
      assert.deepEqual(legacyRuntimeData.addonBalance, []);
      return {
        _id: activatedSubscriptionId,
        toObject() {
          return { _id: activatedSubscriptionId, userId, contractVersion: "subscription_contract.v1" };
        },
      };
    },
    async serializeSubscriptionAdmin(subscription) {
      return subscription;
    },
    async writeActivityLogSafely() {
      activityLogCalls += 1;
    },
  });

  assert.equal(buildContractCalls, 1);
  assert.equal(activateCalls, 1);
  assert.equal(activityLogCalls, 1);
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.meta.createdByAdmin, true);
  assert.equal(String(res.payload.data._id), String(activatedSubscriptionId));
});

test("createSubscriptionAdmin forwards generic premium wallet data only for newly created canonical subscriptions when Phase 2 flag is enabled", async (t) => {
  const originalAdminFlag = process.env.PHASE1_CANONICAL_ADMIN_CREATE;
  const originalGenericFlag = process.env.PHASE2_GENERIC_PREMIUM_WALLET;
  process.env.PHASE1_CANONICAL_ADMIN_CREATE = "true";
  process.env.PHASE2_GENERIC_PREMIUM_WALLET = "true";
  t.after(() => {
    process.env.PHASE1_CANONICAL_ADMIN_CREATE = originalAdminFlag;
    process.env.PHASE2_GENERIC_PREMIUM_WALLET = originalGenericFlag;
  });

  const userId = String(objectId());
  const quote = {
    plan: { _id: objectId(), daysCount: 5, currency: "SAR" },
    grams: 150,
    mealsPerDay: 3,
    startDate: null,
    delivery: {
      type: "delivery",
      address: { city: "Riyadh" },
      slot: { type: "delivery", window: "8 AM - 11 AM", slotId: "slot-1" },
    },
    premiumWalletMode: "generic_v1",
    premiumCount: 2,
    premiumUnitPriceHalala: 500,
    premiumItems: [],
    addonItems: [],
    breakdown: {
      basePlanPriceHalala: 10000,
      premiumTotalHalala: 1000,
      currency: "SAR",
    },
  };

  const contract = {
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractCompleteness: "authoritative",
    contractSource: "admin_create",
    contractHash: "contract-hash-admin-generic",
    contractSnapshot: {
      meta: { version: "subscription_contract.v1" },
      entitlementContract: {
        premiumWalletMode: "generic_v1",
        premiumCount: 2,
        premiumUnitPriceHalala: 500,
      },
    },
  };

  const fakeSession = {
    active: false,
    startTransaction() { this.active = true; },
    async commitTransaction() { this.active = false; },
    async abortTransaction() { this.active = false; },
    endSession() {},
    inTransaction() { return this.active; },
  };

  const { req, res } = createReqRes({
    body: { userId, premiumCount: 2 },
  });

  await createSubscriptionAdmin(req, res, {
    async findClientUserById() {
      return { _id: userId, role: "client", isActive: true };
    },
    async resolveCheckoutQuoteOrThrow(_body, options) {
      assert.equal(options.useGenericPremiumWallet, true);
      return quote;
    },
    startSession() {
      return fakeSession;
    },
    buildPhase1SubscriptionContract() {
      return contract;
    },
    async activateSubscriptionFromCanonicalContract({ legacyRuntimeData }) {
      assert.equal(legacyRuntimeData.premiumWalletMode, "generic_v1");
      assert.deepEqual(legacyRuntimeData.premiumBalance, []);
      assert.equal(legacyRuntimeData.genericPremiumBalance.length, 1);
      assert.equal(legacyRuntimeData.genericPremiumBalance[0].remainingQty, 2);
      assert.equal(legacyRuntimeData.premiumPrice, 5);
      return {
        _id: objectId(),
        toObject() {
          return { _id: objectId(), userId, premiumWalletMode: "generic_v1" };
        },
      };
    },
    async serializeSubscriptionAdmin(subscription) {
      return subscription;
    },
    async writeActivityLogSafely() {},
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.ok, true);
});

test("createSubscriptionAdmin ignores express next function and still uses explicit runtime overrides", async (t) => {
  const originalFlag = process.env.PHASE1_CANONICAL_ADMIN_CREATE;
  process.env.PHASE1_CANONICAL_ADMIN_CREATE = "true";
  t.after(() => {
    process.env.PHASE1_CANONICAL_ADMIN_CREATE = originalFlag;
  });

  const userId = String(objectId());
  const activatedSubscriptionId = objectId();
  const quote = {
    plan: { _id: objectId(), daysCount: 7, currency: "SAR" },
    grams: 100,
    mealsPerDay: 2,
    startDate: null,
    delivery: {
      type: "delivery",
      address: { city: "Riyadh" },
      slot: { type: "delivery", window: "09:00-12:00", slotId: "" },
    },
    premiumItems: [],
    addonItems: [],
    breakdown: {
      basePlanPriceHalala: 15000,
      currency: "SAR",
    },
  };

  const fakeSession = {
    active: false,
    startTransaction() { this.active = true; },
    async commitTransaction() { this.active = false; },
    async abortTransaction() { this.active = false; },
    endSession() {},
    inTransaction() { return this.active; },
  };

  const { req, res } = createReqRes({
    body: { userId },
  });

  let findClientCalls = 0;
  const next = () => {};

  await createSubscriptionAdmin(req, res, next, {
    async findClientUserById(id) {
      findClientCalls += 1;
      assert.equal(String(id), userId);
      return { _id: userId, role: "client", isActive: true };
    },
    async resolveCheckoutQuoteOrThrow() {
      return quote;
    },
    startSession() {
      return fakeSession;
    },
    buildPhase1SubscriptionContract() {
      return {
        contractVersion: "subscription_contract.v1",
        contractMode: "canonical",
        contractCompleteness: "authoritative",
        contractSource: "admin_create",
        contractHash: "admin-runtime-test",
        contractSnapshot: {
          meta: { version: "subscription_contract.v1" },
        },
      };
    },
    async activateSubscriptionFromCanonicalContract() {
      return {
        _id: activatedSubscriptionId,
        toObject() {
          return { _id: activatedSubscriptionId, userId };
        },
      };
    },
    async serializeSubscriptionAdmin(subscription) {
      return subscription;
    },
    async writeActivityLogSafely() {},
  });

  assert.equal(findClientCalls, 1);
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.ok, true);
  assert.equal(String(res.payload.data._id), String(activatedSubscriptionId));
});
