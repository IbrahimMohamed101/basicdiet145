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
  const query = {
    sort() {
      return query;
    },
    session() {
      return query;
    },
    lean() {
      return Promise.resolve(result);
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return query;
}

function createReqRes({ params = {}, body = {}, query = {}, userId = objectId(), headers = {} } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
  );

  const req = {
    params,
    body,
    query,
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
  const _id = objectId();
  return {
    _id,
    id: String(_id),
    status: "pending_payment",
    paymentUrl: "",
    ...payload,
    async save() {
      return this;
    },
  };
}

function createPaymentRecord(payload = {}) {
  const _id = objectId();
  return {
    _id,
    id: String(_id),
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
  const originalPaymentFindOne = Payment.findOne;
  t.after(() => {
    CheckoutDraft.findOne = originalFindOne;
    CheckoutDraft.create = originalCreateDraft;
    Payment.create = originalPaymentCreate;
    Payment.findById = originalPaymentFindById;
    Payment.findOne = originalPaymentFindOne;
  });

  let createdDraftPayload = null;
  CheckoutDraft.findOne = () => createQueryStub(null);
  CheckoutDraft.create = async (payload) => {
    createdDraftPayload = payload;
    return createDraftRecord(payload);
  };
  Payment.findById = () => createQueryStub(null);
  Payment.findOne = () => createQueryStub(null);
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
  const originalPaymentFindOne = Payment.findOne;
  t.after(() => {
    CheckoutDraft.findOne = originalFindOne;
    CheckoutDraft.create = originalCreateDraft;
    Payment.create = originalPaymentCreate;
    Payment.findById = originalPaymentFindById;
    Payment.findOne = originalPaymentFindOne;
  });

  let createdDraftPayload = null;
  CheckoutDraft.findOne = () => createQueryStub(null);
  CheckoutDraft.create = async (payload) => {
    createdDraftPayload = payload;
    return createDraftRecord(payload);
  };
  Payment.findById = () => createQueryStub(null);
  Payment.findOne = () => createQueryStub(null);
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

test("checkoutSubscription marks the draft failed when payment creation fails after invoice creation", async (t) => {
  const originalWriteFlag = process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;
  const originalFindOne = CheckoutDraft.findOne;
  const originalCreateDraft = CheckoutDraft.create;
  const originalPaymentCreate = Payment.create;
  const originalPaymentFindById = Payment.findById;
  const originalPaymentFindOne = Payment.findOne;

  delete process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;

  t.after(() => {
    process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE = originalWriteFlag;
    CheckoutDraft.findOne = originalFindOne;
    CheckoutDraft.create = originalCreateDraft;
    Payment.create = originalPaymentCreate;
    Payment.findById = originalPaymentFindById;
    Payment.findOne = originalPaymentFindOne;
  });

  const saveSnapshots = [];
  const trackedDraft = {
    _id: objectId(),
    id: String(objectId()),
    status: "pending_payment",
    paymentUrl: "",
    failureReason: "",
    async save() {
      saveSnapshots.push({
        status: this.status,
        paymentUrl: this.paymentUrl,
        providerInvoiceId: this.providerInvoiceId,
        paymentId: this.paymentId ? String(this.paymentId) : "",
        failureReason: this.failureReason,
      });
      return this;
    },
  };

  CheckoutDraft.findOne = () => createQueryStub(null);
  CheckoutDraft.create = async () => trackedDraft;
  Payment.findById = () => createQueryStub(null);
  Payment.findOne = () => createQueryStub(null);
  Payment.create = async () => {
    const err = new Error("E11000 duplicate key error collection: payments index: provider_1_providerInvoiceId_1 dup key");
    err.code = 11000;
    err.keyPattern = { providerInvoiceId: 1 };
    throw err;
  };

  const quote = createCheckoutQuote();
  const { req, res } = createReqRes({
    userId: objectId(),
    body: { idempotencyKey: "payment-create-failure-key" },
  });

  await controller.checkoutSubscription(req, res, {
    resolveCheckoutQuoteOrThrow: async () => quote,
    createInvoice: async () => ({
      id: "invoice-payment-create-failure",
      url: "https://pay.test/invoice-payment-create-failure",
      currency: "SAR",
      metadata: { type: "subscription_activation", draftId: String(trackedDraft._id) },
    }),
  });

  assert.equal(res.statusCode, 500);
  assert.equal(res.payload.error.code, "INTERNAL");
  assert.equal(trackedDraft.providerInvoiceId, "invoice-payment-create-failure");
  assert.equal(trackedDraft.paymentUrl, "https://pay.test/invoice-payment-create-failure");
  assert.equal(trackedDraft.status, "failed");
  assert.match(trackedDraft.failureReason, /^payment_create:/);
  assert.equal(saveSnapshots.length, 2);
  assert.deepEqual(saveSnapshots[0], {
    status: "pending_payment",
    paymentUrl: "https://pay.test/invoice-payment-create-failure",
    providerInvoiceId: "invoice-payment-create-failure",
    paymentId: "",
    failureReason: "",
  });
  assert.equal(saveSnapshots[1].status, "failed");
  assert.equal(saveSnapshots[1].paymentUrl, "https://pay.test/invoice-payment-create-failure");
});

test("checkoutSubscription fails the draft when invoice response is missing paymentUrl", async (t) => {
  const originalWriteFlag = process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;
  const originalFindOne = CheckoutDraft.findOne;
  const originalCreateDraft = CheckoutDraft.create;
  const originalPaymentCreate = Payment.create;
  const originalPaymentFindById = Payment.findById;
  const originalPaymentFindOne = Payment.findOne;

  delete process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;

  t.after(() => {
    process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE = originalWriteFlag;
    CheckoutDraft.findOne = originalFindOne;
    CheckoutDraft.create = originalCreateDraft;
    Payment.create = originalPaymentCreate;
    Payment.findById = originalPaymentFindById;
    Payment.findOne = originalPaymentFindOne;
  });

  const trackedDraft = {
    _id: objectId(),
    id: String(objectId()),
    status: "pending_payment",
    paymentUrl: "",
    failureReason: "",
    async save() {
      return this;
    },
  };

  let paymentCreateCalls = 0;
  CheckoutDraft.findOne = () => createQueryStub(null);
  CheckoutDraft.create = async () => trackedDraft;
  Payment.findById = () => createQueryStub(null);
  Payment.findOne = () => createQueryStub(null);
  Payment.create = async () => {
    paymentCreateCalls += 1;
    return createPaymentRecord();
  };

  const quote = createCheckoutQuote();
  const { req, res } = createReqRes({
    userId: objectId(),
    body: { idempotencyKey: "missing-payment-url-key" },
  });

  await controller.checkoutSubscription(req, res, {
    resolveCheckoutQuoteOrThrow: async () => quote,
    createInvoice: async () => ({
      id: "invoice-missing-payment-url",
      currency: "SAR",
      metadata: { type: "subscription_activation", draftId: String(trackedDraft._id) },
    }),
  });

  assert.equal(res.statusCode, 500);
  assert.equal(res.payload.error.code, "INTERNAL");
  assert.equal(paymentCreateCalls, 0);
  assert.equal(trackedDraft.status, "failed");
  assert.equal(trackedDraft.paymentUrl, "");
  assert.match(trackedDraft.failureReason, /^invoice_create:PAYMENT_PROVIDER_INVALID_RESPONSE$/);
});

test("checkoutSubscription recovers a reusable payment from persisted draft invoice data on retry", async (t) => {
  const originalWriteFlag = process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;
  const originalFindOne = CheckoutDraft.findOne;
  const originalFindById = CheckoutDraft.findById;
  const originalPaymentCreate = Payment.create;
  const originalPaymentFindById = Payment.findById;
  const originalPaymentFindOne = Payment.findOne;

  delete process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;

  t.after(() => {
    process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE = originalWriteFlag;
    CheckoutDraft.findOne = originalFindOne;
    CheckoutDraft.findById = originalFindById;
    Payment.create = originalPaymentCreate;
    Payment.findById = originalPaymentFindById;
    Payment.findOne = originalPaymentFindOne;
  });

  const userId = objectId();
  const existingDraft = createDraftRecord({
    userId,
    requestHash: "",
    providerInvoiceId: "invoice-recovered-retry",
    paymentUrl: "https://pay.test/recovered-retry",
    breakdown: {
      basePlanPriceHalala: 10000,
      premiumTotalHalala: 0,
      addonsTotalHalala: 0,
      deliveryFeeHalala: 2000,
      vatHalala: 1800,
      totalHalala: 13800,
      currency: "SAR",
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const recoveredPayment = createPaymentRecord({
    providerInvoiceId: "invoice-recovered-retry",
    metadata: { draftId: String(existingDraft._id), paymentUrl: existingDraft.paymentUrl },
  });

  let paymentCreateCalls = 0;
  CheckoutDraft.findOne = () => createQueryStub(existingDraft);
  CheckoutDraft.findById = () => createQueryStub(existingDraft);
  Payment.findById = () => createQueryStub(null);
  Payment.findOne = () => createQueryStub(null);
  Payment.create = async () => {
    paymentCreateCalls += 1;
    return recoveredPayment;
  };

  const quote = createCheckoutQuote();
  const { req, res } = createReqRes({
    userId,
    body: { idempotencyKey: "recover-existing-draft-key" },
  });

  await controller.checkoutSubscription(req, res, {
    resolveCheckoutQuoteOrThrow: async () => quote,
  });

  assert.equal(res.statusCode, 200);
  assert.equal(paymentCreateCalls, 1);
  assert.equal(res.payload.data.paymentId, recoveredPayment.id);
  assert.equal(res.payload.data.payment_url, "https://pay.test/recovered-retry");
  assert.equal(existingDraft.paymentId, recoveredPayment._id);
});

test("checkoutSubscription allows retrying a failed idempotency key by releasing the terminal draft key", async (t) => {
  const originalWriteFlag = process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;
  const originalFindOne = CheckoutDraft.findOne;
  const originalCreateDraft = CheckoutDraft.create;
  const originalUpdateOne = CheckoutDraft.updateOne;
  const originalPaymentCreate = Payment.create;
  const originalPaymentFindById = Payment.findById;
  const originalPaymentFindOne = Payment.findOne;

  delete process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;

  t.after(() => {
    process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE = originalWriteFlag;
    CheckoutDraft.findOne = originalFindOne;
    CheckoutDraft.create = originalCreateDraft;
    CheckoutDraft.updateOne = originalUpdateOne;
    Payment.create = originalPaymentCreate;
    Payment.findById = originalPaymentFindById;
    Payment.findOne = originalPaymentFindOne;
  });

  const userId = objectId();
  const failedDraft = createDraftRecord({
    userId,
    status: "failed",
    idempotencyKey: "retry-failed-key",
    requestHash: "",
    failureReason: "payment_create:11000",
  });
  const createdDraft = createDraftRecord({ userId, idempotencyKey: "retry-failed-key" });
  const createdPayment = createPaymentRecord({
    metadata: { draftId: String(createdDraft._id), paymentUrl: "https://pay.test/retry-failed-key" },
  });

  let createCalls = 0;
  CheckoutDraft.findOne = (query) => {
    if (query && query.idempotencyKey === "retry-failed-key") {
      return createQueryStub(failedDraft);
    }
    return createQueryStub(null);
  };
  CheckoutDraft.updateOne = async (_filter, update) => {
    if (update && update.$set) {
      Object.assign(failedDraft, update.$set);
    }
    return { acknowledged: true, modifiedCount: 1 };
  };
  CheckoutDraft.create = async (payload) => {
    createCalls += 1;
    return Object.assign(createdDraft, payload);
  };
  Payment.findById = () => createQueryStub(null);
  Payment.findOne = () => createQueryStub(null);
  Payment.create = async (payload) => createPaymentRecord({
    ...payload,
    metadata: { ...(payload.metadata || {}), paymentUrl: "https://pay.test/retry-failed-key" },
  });

  const quote = createCheckoutQuote();
  const { req, res } = createReqRes({
    userId,
    body: { idempotencyKey: "retry-failed-key" },
  });

  await controller.checkoutSubscription(req, res, {
    resolveCheckoutQuoteOrThrow: async () => quote,
    createInvoice: async () => ({
      id: "invoice-retry-failed-key",
      url: "https://pay.test/retry-failed-key",
      currency: "SAR",
      metadata: { type: "subscription_activation", draftId: String(createdDraft._id) },
    }),
  });

  assert.equal(res.statusCode, 201);
  assert.equal(createCalls, 1);
  assert.equal(failedDraft.idempotencyKey, "");
  assert.equal(res.payload.data.payment_url, "https://pay.test/retry-failed-key");
});

test("renewSubscription marks the draft failed when payment creation fails after invoice creation", async (t) => {
  const originalWriteFlag = process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;
  const originalSubscriptionFindById = Subscription.findById;
  const originalFindOne = CheckoutDraft.findOne;
  const originalCreateDraft = CheckoutDraft.create;
  const originalPaymentCreate = Payment.create;
  const originalPaymentFindById = Payment.findById;
  const originalPaymentFindOne = Payment.findOne;

  delete process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;

  t.after(() => {
    process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE = originalWriteFlag;
    Subscription.findById = originalSubscriptionFindById;
    CheckoutDraft.findOne = originalFindOne;
    CheckoutDraft.create = originalCreateDraft;
    Payment.create = originalPaymentCreate;
    Payment.findById = originalPaymentFindById;
    Payment.findOne = originalPaymentFindOne;
  });

  const userId = objectId();
  const previousSubscriptionId = objectId();
  const trackedDraft = {
    _id: objectId(),
    id: String(objectId()),
    status: "pending_payment",
    paymentUrl: "",
    failureReason: "",
    renewedFromSubscriptionId: previousSubscriptionId,
    async save() {
      return this;
    },
  };

  Subscription.findById = () => createQueryStub({
    _id: previousSubscriptionId,
    userId,
    planId: objectId(),
    selectedGrams: 150,
    selectedMealsPerDay: 3,
    deliveryMode: "delivery",
    deliveryAddress: { city: "Riyadh" },
    deliverySlot: { type: "delivery", window: "8 AM - 11 AM", slotId: "slot-1" },
    deliveryZoneId: objectId(),
    validityEndDate: new Date("2020-01-01T00:00:00.000Z"),
    endDate: new Date("2020-01-01T00:00:00.000Z"),
  });
  CheckoutDraft.findOne = () => createQueryStub(null);
  CheckoutDraft.create = async () => trackedDraft;
  Payment.findById = () => createQueryStub(null);
  Payment.findOne = () => createQueryStub(null);
  Payment.create = async () => {
    const err = new Error("E11000 duplicate key error collection: payments index: provider_1_providerInvoiceId_1 dup key");
    err.code = 11000;
    err.keyPattern = { providerInvoiceId: 1 };
    throw err;
  };

  const quote = createCheckoutQuote();
  const { req, res } = createReqRes({
    params: { id: String(previousSubscriptionId) },
    userId,
    body: { idempotencyKey: "renew-payment-create-failure" },
  });

  await controller.renewSubscription(req, res, {
    resolveCheckoutQuoteOrThrow: async () => quote,
    createInvoice: async () => ({
      id: "invoice-renew-payment-create-failure",
      url: "https://pay.test/renew-payment-create-failure",
      currency: "SAR",
      metadata: { type: "subscription_renewal", draftId: String(trackedDraft._id) },
    }),
  });

  assert.equal(res.statusCode, 500);
  assert.equal(res.payload.error.code, "INTERNAL");
  assert.equal(trackedDraft.providerInvoiceId, "invoice-renew-payment-create-failure");
  assert.equal(trackedDraft.paymentUrl, "https://pay.test/renew-payment-create-failure");
  assert.equal(trackedDraft.status, "failed");
  assert.match(trackedDraft.failureReason, /^payment_create:/);
});

test("renewSubscription recovers a reusable payment from persisted draft invoice data on retry", async (t) => {
  const originalWriteFlag = process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;
  const originalSubscriptionFindById = Subscription.findById;
  const originalFindOne = CheckoutDraft.findOne;
  const originalFindById = CheckoutDraft.findById;
  const originalPaymentCreate = Payment.create;
  const originalPaymentFindById = Payment.findById;
  const originalPaymentFindOne = Payment.findOne;

  delete process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;

  t.after(() => {
    process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE = originalWriteFlag;
    Subscription.findById = originalSubscriptionFindById;
    CheckoutDraft.findOne = originalFindOne;
    CheckoutDraft.findById = originalFindById;
    Payment.create = originalPaymentCreate;
    Payment.findById = originalPaymentFindById;
    Payment.findOne = originalPaymentFindOne;
  });

  const userId = objectId();
  const previousSubscriptionId = objectId();
  const existingDraft = createDraftRecord({
    userId,
    renewedFromSubscriptionId: previousSubscriptionId,
    providerInvoiceId: "invoice-renew-recovered-retry",
    paymentUrl: "https://pay.test/renew-recovered-retry",
    breakdown: {
      basePlanPriceHalala: 10000,
      premiumTotalHalala: 0,
      addonsTotalHalala: 0,
      deliveryFeeHalala: 2000,
      vatHalala: 1800,
      totalHalala: 13800,
      currency: "SAR",
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const recoveredPayment = createPaymentRecord({
    type: "subscription_renewal",
    providerInvoiceId: "invoice-renew-recovered-retry",
    metadata: { draftId: String(existingDraft._id), paymentUrl: existingDraft.paymentUrl },
  });

  let paymentCreateCalls = 0;
  Subscription.findById = () => createQueryStub({
    _id: previousSubscriptionId,
    userId,
    planId: objectId(),
    selectedGrams: 150,
    selectedMealsPerDay: 3,
    deliveryMode: "delivery",
    deliveryAddress: { city: "Riyadh" },
    deliverySlot: { type: "delivery", window: "8 AM - 11 AM", slotId: "slot-1" },
    deliveryZoneId: objectId(),
    validityEndDate: new Date("2020-01-01T00:00:00.000Z"),
    endDate: new Date("2020-01-01T00:00:00.000Z"),
  });
  CheckoutDraft.findOne = () => createQueryStub(existingDraft);
  CheckoutDraft.findById = () => createQueryStub(existingDraft);
  Payment.findById = () => createQueryStub(null);
  Payment.findOne = () => createQueryStub(null);
  Payment.create = async () => {
    paymentCreateCalls += 1;
    return recoveredPayment;
  };

  const quote = createCheckoutQuote();
  const { req, res } = createReqRes({
    params: { id: String(previousSubscriptionId) },
    userId,
    body: { idempotencyKey: "renew-recover-existing-draft-key" },
  });

  await controller.renewSubscription(req, res, {
    resolveCheckoutQuoteOrThrow: async () => quote,
  });

  assert.equal(res.statusCode, 200);
  assert.equal(paymentCreateCalls, 1);
  assert.equal(res.payload.data.paymentId, recoveredPayment.id);
  assert.equal(res.payload.data.payment_url, "https://pay.test/renew-recovered-retry");
  assert.equal(existingDraft.paymentId, recoveredPayment._id);
});

test("renewSubscription allows retrying a failed idempotency key by releasing the terminal draft key", async (t) => {
  const originalWriteFlag = process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;
  const originalSubscriptionFindById = Subscription.findById;
  const originalFindOne = CheckoutDraft.findOne;
  const originalCreateDraft = CheckoutDraft.create;
  const originalUpdateOne = CheckoutDraft.updateOne;
  const originalPaymentCreate = Payment.create;
  const originalPaymentFindById = Payment.findById;
  const originalPaymentFindOne = Payment.findOne;

  delete process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;

  t.after(() => {
    process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE = originalWriteFlag;
    Subscription.findById = originalSubscriptionFindById;
    CheckoutDraft.findOne = originalFindOne;
    CheckoutDraft.create = originalCreateDraft;
    CheckoutDraft.updateOne = originalUpdateOne;
    Payment.create = originalPaymentCreate;
    Payment.findById = originalPaymentFindById;
    Payment.findOne = originalPaymentFindOne;
  });

  const userId = objectId();
  const previousSubscriptionId = objectId();
  const failedDraft = createDraftRecord({
    userId,
    status: "failed",
    renewedFromSubscriptionId: previousSubscriptionId,
    idempotencyKey: "renew-retry-failed-key",
    requestHash: "",
    failureReason: "payment_create:11000",
  });
  const createdDraft = createDraftRecord({
    userId,
    renewedFromSubscriptionId: previousSubscriptionId,
    idempotencyKey: "renew-retry-failed-key",
  });

  let createCalls = 0;
  Subscription.findById = () => createQueryStub({
    _id: previousSubscriptionId,
    userId,
    planId: objectId(),
    selectedGrams: 150,
    selectedMealsPerDay: 3,
    deliveryMode: "delivery",
    deliveryAddress: { city: "Riyadh" },
    deliverySlot: { type: "delivery", window: "8 AM - 11 AM", slotId: "slot-1" },
    deliveryZoneId: objectId(),
    validityEndDate: new Date("2020-01-01T00:00:00.000Z"),
    endDate: new Date("2020-01-01T00:00:00.000Z"),
  });
  CheckoutDraft.findOne = (query) => {
    if (query && query.idempotencyKey === "renew-retry-failed-key") {
      return createQueryStub(failedDraft);
    }
    return createQueryStub(null);
  };
  CheckoutDraft.updateOne = async (_filter, update) => {
    if (update && update.$set) {
      Object.assign(failedDraft, update.$set);
    }
    return { acknowledged: true, modifiedCount: 1 };
  };
  CheckoutDraft.create = async (payload) => {
    createCalls += 1;
    return Object.assign(createdDraft, payload);
  };
  Payment.findById = () => createQueryStub(null);
  Payment.findOne = () => createQueryStub(null);
  Payment.create = async (payload) => createPaymentRecord({
    ...payload,
    metadata: { ...(payload.metadata || {}), paymentUrl: "https://pay.test/renew-retry-failed-key" },
  });

  const quote = createCheckoutQuote();
  const { req, res } = createReqRes({
    params: { id: String(previousSubscriptionId) },
    userId,
    body: { idempotencyKey: "renew-retry-failed-key" },
  });

  await controller.renewSubscription(req, res, {
    resolveCheckoutQuoteOrThrow: async () => quote,
    createInvoice: async () => ({
      id: "invoice-renew-retry-failed-key",
      url: "https://pay.test/renew-retry-failed-key",
      currency: "SAR",
      metadata: { type: "subscription_renewal", draftId: String(createdDraft._id) },
    }),
  });

  assert.equal(res.statusCode, 201);
  assert.equal(createCalls, 1);
  assert.equal(failedDraft.idempotencyKey, "");
  assert.equal(res.payload.data.payment_url, "https://pay.test/renew-retry-failed-key");
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
