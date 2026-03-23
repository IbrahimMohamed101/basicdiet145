const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const controller = require("../src/controllers/subscriptionController");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const Payment = require("../src/models/Payment");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createQueryStub(result) {
  return {
    sort() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
    },
  };
}

function createReqRes({ body = {}, userId = objectId(), headers = {} } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
  );

  const req = {
    body,
    userId,
    headers: normalizedHeaders,
    get(name) {
      return normalizedHeaders[String(name || "").toLowerCase()];
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

function createCheckoutQuote({ startDate = new Date("2026-03-20T00:00:00+03:00") } = {}) {
  return {
    plan: {
      _id: objectId(),
      daysCount: 10,
      currency: "SAR",
    },
    grams: 150,
    mealsPerDay: 3,
    startDate,
    delivery: {
      type: "delivery",
      address: { city: "Riyadh", district: "Olaya" },
      slot: { type: "delivery", window: "8 AM - 11 AM", slotId: "slot-1" },
    },
    premiumItems: [],
    addonItems: [],
    breakdown: {
      basePlanPriceHalala: 10000,
      premiumTotalHalala: 0,
      addonsTotalHalala: 0,
      deliveryFeeHalala: 2000,
      vatHalala: 1800,
      totalHalala: 13800,
      currency: "SAR",
    },
  };
}

function createDraftRecord(payload = {}) {
  return {
    _id: objectId(),
    id: String(objectId()),
    status: "pending_payment",
    paymentUrl: "",
    ...payload,
    async save() {
      return this;
    },
  };
}

function createPaymentRecord(payload = {}) {
  return {
    _id: objectId(),
    id: String(objectId()),
    status: "initiated",
    applied: false,
    ...payload,
    async save() {
      return this;
    },
  };
}

function createCanonicalDraftForFinalize(overrides = {}) {
  const userId = objectId();
  return {
    _id: objectId(),
    userId,
    planId: objectId(),
    status: "pending_payment",
    daysCount: 4,
    grams: 150,
    mealsPerDay: 3,
    startDate: new Date("2026-03-19T21:00:00.000Z"),
    delivery: {
      type: "delivery",
      address: { city: "Riyadh" },
      slot: { type: "delivery", window: "8 AM - 11 AM", slotId: "slot-1" },
    },
    premiumItems: [],
    addonItems: [],
    addonSubscriptions: [],
    breakdown: {
      basePlanPriceHalala: 10000,
      currency: "SAR",
    },
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractCompleteness: "authoritative",
    contractSource: "customer_checkout",
    contractHash: "contract-hash-1",
    contractSnapshot: {
      start: { resolvedStartDate: "2026-03-19T21:00:00.000Z" },
      plan: { daysCount: 4, selectedGrams: 150, mealsPerDay: 3, totalMeals: 12 },
      pricing: { basePlanPriceHalala: 10000, currency: "SAR" },
      delivery: { mode: "delivery", slot: { type: "delivery", window: "8 AM - 11 AM", slotId: "slot-1" }, address: { city: "Riyadh" } },
    },
    async save() {
      return this;
    },
    ...overrides,
  };
}

test("checkoutSubscription with both flags off keeps legacy draft creation behavior unchanged", async (t) => {
  const originalWriteFlag = process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;
  const originalActivationFlag = process.env.PHASE1_CANONICAL_DRAFT_ACTIVATION;
  delete process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;
  delete process.env.PHASE1_CANONICAL_DRAFT_ACTIVATION;
  t.after(() => {
    process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE = originalWriteFlag;
    process.env.PHASE1_CANONICAL_DRAFT_ACTIVATION = originalActivationFlag;
  });

  const originalFindOne = CheckoutDraft.findOne;
  const originalCreateDraft = CheckoutDraft.create;
  const originalPaymentCreate = Payment.create;
  const originalPaymentFindById = Payment.findById;
  t.after(() => {
    CheckoutDraft.findOne = originalFindOne;
    CheckoutDraft.create = originalCreateDraft;
    Payment.create = originalPaymentCreate;
    Payment.findById = originalPaymentFindById;
  });

  let createdDraftPayload = null;
  CheckoutDraft.findOne = () => createQueryStub(null);
  CheckoutDraft.create = async (payload) => {
    createdDraftPayload = payload;
    return createDraftRecord(payload);
  };
  Payment.findById = () => createQueryStub(null);
  Payment.create = async (payload) => createPaymentRecord(payload);

  const quote = createCheckoutQuote();
  const { req, res } = createReqRes({
    userId: objectId(),
    body: { idempotencyKey: "legacy-key" },
  });

  await controller.checkoutSubscription(req, res, {
    resolveCheckoutQuoteOrThrow: async () => quote,
    createInvoice: async () => ({
      id: "invoice-1",
      url: "https://pay.test/invoice-1",
      currency: "SAR",
      metadata: { type: "subscription_activation", draftId: "draft-1" },
    }),
  });

  assert.equal(res.statusCode, 201);
  assert.deepEqual(Object.keys(res.payload.data).sort(), ["draftId", "paymentId", "payment_url", "subscriptionId", "totals"].sort());
  assert.equal(createdDraftPayload.startDate.toISOString(), quote.startDate.toISOString());
  assert.equal("contractVersion" in createdDraftPayload, false);
  assert.equal("contractSnapshot" in createdDraftPayload, false);
});

test("checkoutSubscription with canonical draft-write flag stores canonical contract fields and keeps response shape", async (t) => {
  const originalWriteFlag = process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;
  const originalActivationFlag = process.env.PHASE1_CANONICAL_DRAFT_ACTIVATION;
  process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE = "true";
  delete process.env.PHASE1_CANONICAL_DRAFT_ACTIVATION;
  t.after(() => {
    process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE = originalWriteFlag;
    process.env.PHASE1_CANONICAL_DRAFT_ACTIVATION = originalActivationFlag;
  });

  const originalFindOne = CheckoutDraft.findOne;
  const originalCreateDraft = CheckoutDraft.create;
  const originalPaymentCreate = Payment.create;
  const originalPaymentFindById = Payment.findById;
  t.after(() => {
    CheckoutDraft.findOne = originalFindOne;
    CheckoutDraft.create = originalCreateDraft;
    Payment.create = originalPaymentCreate;
    Payment.findById = originalPaymentFindById;
  });

  let createdDraftPayload = null;
  CheckoutDraft.findOne = () => createQueryStub(null);
  CheckoutDraft.create = async (payload) => {
    createdDraftPayload = payload;
    return createDraftRecord(payload);
  };
  Payment.findById = () => createQueryStub(null);
  Payment.create = async (payload) => createPaymentRecord(payload);

  const canonicalResolvedStart = new Date("2026-03-19T21:00:00.000Z");
  const quote = createCheckoutQuote({ startDate: null });
  const contract = {
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractCompleteness: "authoritative",
    contractSource: "customer_checkout",
    contractHash: "contract-hash-1",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
    resolvedStart: { resolvedStartDate: canonicalResolvedStart },
  };
  const persistenceFields = {
    startDate: canonicalResolvedStart,
    contractVersion: contract.contractVersion,
    contractMode: contract.contractMode,
    contractCompleteness: contract.contractCompleteness,
    contractSource: contract.contractSource,
    contractHash: contract.contractHash,
    contractSnapshot: contract.contractSnapshot,
    renewedFromSubscriptionId: null,
  };

  const { req, res } = createReqRes({
    userId: objectId(),
    body: { idempotencyKey: "canonical-key" },
  });

  await controller.checkoutSubscription(req, res, {
    resolveCheckoutQuoteOrThrow: async () => quote,
    buildPhase1SubscriptionContract: () => contract,
    buildCanonicalDraftPersistenceFields: () => persistenceFields,
    createInvoice: async () => ({
      id: "invoice-2",
      url: "https://pay.test/invoice-2",
      currency: "SAR",
      metadata: { type: "subscription_activation", draftId: "draft-2" },
    }),
  });

  assert.equal(res.statusCode, 201);
  assert.deepEqual(Object.keys(res.payload.data).sort(), ["draftId", "paymentId", "payment_url", "subscriptionId", "totals"].sort());
  assert.equal(createdDraftPayload.startDate.toISOString(), canonicalResolvedStart.toISOString());
  assert.equal(createdDraftPayload.contractVersion, "subscription_contract.v1");
  assert.equal(createdDraftPayload.contractMode, "canonical");
  assert.equal(createdDraftPayload.contractHash, "contract-hash-1");
  assert.deepEqual(createdDraftPayload.contractSnapshot, contract.contractSnapshot);
});

test("finalizeSubscriptionDraftPayment uses canonical activation path only for canonical drafts when activation flag is on", async (t) => {
  const originalActivationFlag = process.env.PHASE1_CANONICAL_DRAFT_ACTIVATION;
  process.env.PHASE1_CANONICAL_DRAFT_ACTIVATION = "true";
  t.after(() => {
    process.env.PHASE1_CANONICAL_DRAFT_ACTIVATION = originalActivationFlag;
  });

  const draft = createCanonicalDraftForFinalize();
  const payment = { _id: objectId(), userId: draft.userId };
  let canonicalCalled = 0;

  const result = await controller.finalizeSubscriptionDraftPayment(
    { draft, payment, session: { id: "session-1" } },
    {
      isCanonicalCheckoutDraft: () => true,
      activateSubscriptionFromCanonicalDraft: async () => {
        canonicalCalled += 1;
        return { applied: true, subscriptionId: "canonical-subscription" };
      },
    }
  );

  assert.equal(canonicalCalled, 1);
  assert.deepEqual(result, { applied: true, subscriptionId: "canonical-subscription" });
});

test("finalizeSubscriptionDraftPayment falls back to legacy activation when activation flag is off even for canonical drafts", async (t) => {
  const originalActivationFlag = process.env.PHASE1_CANONICAL_DRAFT_ACTIVATION;
  delete process.env.PHASE1_CANONICAL_DRAFT_ACTIVATION;
  t.after(() => {
    process.env.PHASE1_CANONICAL_DRAFT_ACTIVATION = originalActivationFlag;
  });

  const originalSubscriptionCreate = Subscription.create;
  const originalDayCount = SubscriptionDay.countDocuments;
  const originalInsertMany = SubscriptionDay.insertMany;
  t.after(() => {
    Subscription.create = originalSubscriptionCreate;
    SubscriptionDay.countDocuments = originalDayCount;
    SubscriptionDay.insertMany = originalInsertMany;
  });

  let subscriptionCreatePayload = null;
  Subscription.create = async ([payload]) => {
    subscriptionCreatePayload = payload;
    return [{ _id: objectId(), ...payload }];
  };
  SubscriptionDay.countDocuments = () => ({ session: async () => 0 });
  SubscriptionDay.insertMany = async () => [];

  const draft = createCanonicalDraftForFinalize();
  const payment = {
    _id: objectId(),
    userId: draft.userId,
    async save() { return this; },
  };
  let canonicalCalled = 0;

  const result = await controller.finalizeSubscriptionDraftPayment(
    { draft, payment, session: { id: "session-2" } },
    {
      isCanonicalCheckoutDraft: () => true,
      activateSubscriptionFromCanonicalDraft: async () => {
        canonicalCalled += 1;
        return { applied: true, subscriptionId: "should-not-be-used" };
      },
    }
  );

  assert.equal(canonicalCalled, 0);
  assert.equal(result.applied, true);
  assert.ok(subscriptionCreatePayload);
  assert.equal("contractVersion" in subscriptionCreatePayload, false);
});

test("finalizeSubscriptionDraftPayment keeps legacy drafts on legacy activation even when activation flag is on", async (t) => {
  const originalActivationFlag = process.env.PHASE1_CANONICAL_DRAFT_ACTIVATION;
  process.env.PHASE1_CANONICAL_DRAFT_ACTIVATION = "true";
  t.after(() => {
    process.env.PHASE1_CANONICAL_DRAFT_ACTIVATION = originalActivationFlag;
  });

  const originalSubscriptionCreate = Subscription.create;
  const originalDayCount = SubscriptionDay.countDocuments;
  const originalInsertMany = SubscriptionDay.insertMany;
  t.after(() => {
    Subscription.create = originalSubscriptionCreate;
    SubscriptionDay.countDocuments = originalDayCount;
    SubscriptionDay.insertMany = originalInsertMany;
  });

  let subscriptionCreatePayload = null;
  Subscription.create = async ([payload]) => {
    subscriptionCreatePayload = payload;
    return [{ _id: objectId(), ...payload }];
  };
  SubscriptionDay.countDocuments = () => ({ session: async () => 0 });
  SubscriptionDay.insertMany = async () => [];

  const draft = createCanonicalDraftForFinalize({
    contractVersion: undefined,
    contractMode: undefined,
    contractCompleteness: undefined,
    contractHash: undefined,
    contractSnapshot: undefined,
  });
  const payment = {
    _id: objectId(),
    userId: draft.userId,
    async save() { return this; },
  };
  let canonicalCalled = 0;

  const result = await controller.finalizeSubscriptionDraftPayment(
    { draft, payment, session: { id: "session-3" } },
    {
      isCanonicalCheckoutDraft: () => false,
      activateSubscriptionFromCanonicalDraft: async () => {
        canonicalCalled += 1;
        return { applied: true, subscriptionId: "should-not-be-used" };
      },
    }
  );

  assert.equal(canonicalCalled, 0);
  assert.equal(result.applied, true);
  assert.ok(subscriptionCreatePayload);
  assert.equal(subscriptionCreatePayload.selectedMealsPerDay, 3);
});
