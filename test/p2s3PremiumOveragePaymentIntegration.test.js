const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const controller = require("../src/controllers/subscriptionController");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Payment = require("../src/models/Payment");
const Setting = require("../src/models/Setting");
const { getTomorrowKSADate, toKSADateString } = require("../src/utils/date");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createReqRes({ params = {}, body = {}, userId = objectId(), headers = {} } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
  );

  const req = {
    params,
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
    set() {},
    append() {},
  };

  return { req, res };
}

function createQueryStub(result) {
  return {
    populate() {
      return Promise.resolve(result);
    },
    session() {
      return Promise.resolve(result);
    },
    sort() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
    },
    select() {
      return this;
    },
  };
}

function createSessionStub() {
  return {
    startTransaction() {},
    async commitTransaction() {},
    async abortTransaction() {},
    endSession() {},
    inTransaction() {
      return true;
    },
  };
}

function getFutureDate(daysAhead = 2) {
  const base = new Date(`${getTomorrowKSADate()}T00:00:00+03:00`);
  base.setDate(base.getDate() + (daysAhead - 1));
  return toKSADateString(base);
}

function createCanonicalGenericSubscription(userId, overrides = {}) {
  return {
    _id: objectId(),
    id: null,
    userId,
    status: "active",
    startDate: new Date("2026-03-10T21:00:00.000Z"),
    endDate: new Date("2026-04-10T21:00:00.000Z"),
    validityEndDate: new Date("2026-04-10T21:00:00.000Z"),
    selectedMealsPerDay: 3,
    premiumWalletMode: "generic_v1",
    genericPremiumBalance: [],
    premiumRemaining: 0,
    premiumSelections: [],
    addonSelections: [],
    addonBalance: [],
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
    async save() {
      return this;
    },
    ...overrides,
  };
}

test("createPremiumOverageDayPayment creates a day-scoped overage payment from authoritative day state", async (t) => {
  const originalPlanningFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  const originalGenericFlag = process.env.PHASE2_GENERIC_PREMIUM_WALLET;
  const originalIdempotencyFlag = process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  process.env.PHASE2_GENERIC_PREMIUM_WALLET = "true";
  process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPlanningFlag;
    process.env.PHASE2_GENERIC_PREMIUM_WALLET = originalGenericFlag;
    process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY = originalIdempotencyFlag;
  });

  const originalFindById = Subscription.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  const originalSettingFindOne = Setting.findOne;
  t.after(() => {
    Subscription.findById = originalFindById;
    SubscriptionDay.findOne = originalDayFindOne;
    Setting.findOne = originalSettingFindOne;
  });

  const userId = objectId();
  const subscription = createCanonicalGenericSubscription(userId);
  subscription.id = String(subscription._id);
  const targetDate = getFutureDate(2);
  const day = {
    _id: objectId(),
    subscriptionId: subscription._id,
    date: targetDate,
    status: "open",
    premiumOverageCount: 2,
    premiumOverageStatus: "pending",
  };

  Subscription.findById = () => createQueryStub(subscription);
  SubscriptionDay.findOne = async () => day;
  Setting.findOne = ({ key }) => createQueryStub(key === "premium_price" ? { value: 5 } : null);

  let createdInvoicePayload = null;
  let createdPaymentPayload = null;
  const { req, res } = createReqRes({
    params: { id: String(subscription._id), date: targetDate },
    userId,
    headers: { "idempotency-key": "overage-key-1" },
  });

  await controller.createPremiumOverageDayPayment(req, res, {
    async createInvoice(payload) {
      createdInvoicePayload = payload;
      return {
        id: "invoice-overage-1",
        url: "https://pay.test/premium-overage-1",
        currency: "SAR",
        metadata: payload.metadata,
      };
    },
    async createPayment(payload) {
      createdPaymentPayload = payload;
      return { id: "payment-overage-1" };
    },
    async findPaymentByOperationKey() {
      return null;
    },
    async findReusableInitiatedPaymentByHash() {
      return null;
    },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.data, {
    payment_url: "https://pay.test/premium-overage-1",
    invoice_id: "invoice-overage-1",
    payment_id: "payment-overage-1",
    totalHalala: 1000,
  });
  assert.equal(createdInvoicePayload.amount, 1000);
  assert.equal(createdInvoicePayload.metadata.type, "premium_overage_day");
  assert.equal(createdInvoicePayload.metadata.subscriptionId, String(subscription._id));
  assert.equal(createdInvoicePayload.metadata.dayId, String(day._id));
  assert.equal(createdInvoicePayload.metadata.date, targetDate);
  assert.equal(createdInvoicePayload.metadata.premiumOverageCount, 2);
  assert.equal(createdInvoicePayload.metadata.unitOveragePriceHalala, 500);
  assert.equal(createdPaymentPayload.type, "premium_overage_day");
  assert.equal(createdPaymentPayload.operationScope, "premium_overage_day");
  assert.equal(createdPaymentPayload.metadata.totalHalala, 1000);
});

test("createPremiumOverageDayPayment returns idempotency conflict when the same key is reused with a different overage snapshot", async (t) => {
  const originalPlanningFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  const originalGenericFlag = process.env.PHASE2_GENERIC_PREMIUM_WALLET;
  const originalIdempotencyFlag = process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  process.env.PHASE2_GENERIC_PREMIUM_WALLET = "true";
  process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPlanningFlag;
    process.env.PHASE2_GENERIC_PREMIUM_WALLET = originalGenericFlag;
    process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY = originalIdempotencyFlag;
  });

  const originalFindById = Subscription.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  const originalSettingFindOne = Setting.findOne;
  t.after(() => {
    Subscription.findById = originalFindById;
    SubscriptionDay.findOne = originalDayFindOne;
    Setting.findOne = originalSettingFindOne;
  });

  const userId = objectId();
  const subscription = createCanonicalGenericSubscription(userId);
  const targetDate = getFutureDate(2);
  const day = {
    _id: objectId(),
    subscriptionId: subscription._id,
    date: targetDate,
    status: "open",
    premiumOverageCount: 2,
    premiumOverageStatus: "pending",
  };

  Subscription.findById = () => createQueryStub(subscription);
  SubscriptionDay.findOne = async () => day;
  Setting.findOne = ({ key }) => createQueryStub(key === "premium_price" ? { value: 5 } : null);

  const { req, res } = createReqRes({
    params: { id: String(subscription._id), date: targetDate },
    userId,
    headers: { "idempotency-key": "overage-key-conflict" },
  });

  await controller.createPremiumOverageDayPayment(req, res, {
    async findPaymentByOperationKey() {
      return {
        _id: objectId(),
        operationRequestHash: "existing-hash",
        status: "initiated",
        applied: false,
        providerInvoiceId: "invoice-existing",
        metadata: {
          paymentUrl: "https://pay.test/existing",
          initiationResponseShape: "premium_overage_day",
        },
      };
    },
    compareIdempotentRequest() {
      return "conflict";
    },
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.error.code, "IDEMPOTENCY_CONFLICT");
});

test("verifyPremiumOverageDayPayment applies paid overage settlement and confirmDayPlanning succeeds afterward", async (t) => {
  const originalPlanningFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  const originalGenericFlag = process.env.PHASE2_GENERIC_PREMIUM_WALLET;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  process.env.PHASE2_GENERIC_PREMIUM_WALLET = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPlanningFlag;
    process.env.PHASE2_GENERIC_PREMIUM_WALLET = originalGenericFlag;
  });

  const originalStartSession = mongoose.startSession;
  const originalSubFindById = Subscription.findById;
  const originalSubFindOne = Subscription.findOne;
  const originalPaymentFindOne = Payment.findOne;
  const originalPaymentFindById = Payment.findById;
  const originalPaymentFindOneAndUpdate = Payment.findOneAndUpdate;
  const originalPaymentUpdateOne = Payment.updateOne;
  const originalDayFindById = SubscriptionDay.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  const originalSettingFindOne = Setting.findOne;
  t.after(() => {
    mongoose.startSession = originalStartSession;
    Subscription.findById = originalSubFindById;
    Subscription.findOne = originalSubFindOne;
    Payment.findOne = originalPaymentFindOne;
    Payment.findById = originalPaymentFindById;
    Payment.findOneAndUpdate = originalPaymentFindOneAndUpdate;
    Payment.updateOne = originalPaymentUpdateOne;
    SubscriptionDay.findById = originalDayFindById;
    SubscriptionDay.findOne = originalDayFindOne;
    Setting.findOne = originalSettingFindOne;
  });

  mongoose.startSession = async () => createSessionStub();

  const userId = objectId();
  const subscription = createCanonicalGenericSubscription(userId);
  subscription.id = String(subscription._id);
  const targetDate = getFutureDate(2);
  const day = {
    _id: objectId(),
    subscriptionId: subscription._id,
    date: targetDate,
    status: "open",
    selections: [objectId()],
    premiumSelections: [objectId(), objectId()],
    premiumOverageCount: 1,
    premiumOverageStatus: "pending",
    async save() {
      return this;
    },
    toObject() {
      return { ...this };
    },
  };
  const paymentDoc = {
    _id: objectId(),
    id: "payment-overage-verify",
    provider: "moyasar",
    providerInvoiceId: "invoice-overage-verify",
    providerPaymentId: null,
    amount: 500,
    currency: "SAR",
    type: "premium_overage_day",
    status: "initiated",
    applied: false,
    userId,
    subscriptionId: subscription._id,
    metadata: {
      type: "premium_overage_day",
      subscriptionId: String(subscription._id),
      dayId: String(day._id),
      date: targetDate,
      premiumOverageCount: 1,
      unitOveragePriceHalala: 500,
      paymentUrl: "https://pay.test/overage-verify",
      initiationResponseShape: "premium_overage_day",
      totalHalala: 500,
    },
    paidAt: null,
    async save() {
      return this;
    },
  };

  Subscription.findById = () => createQueryStub(subscription);
  Subscription.findOne = () => createQueryStub(subscription);
  Payment.findOne = () => createQueryStub(paymentDoc);
  Payment.findById = () => createQueryStub(paymentDoc);
  Payment.findOneAndUpdate = async () => {
    paymentDoc.applied = true;
    paymentDoc.status = "paid";
    return paymentDoc;
  };
  Payment.updateOne = async () => ({ acknowledged: true, modifiedCount: 1 });
  SubscriptionDay.findById = () => createQueryStub(day);
  SubscriptionDay.findOne = () => createQueryStub(day);
  Setting.findOne = () => createQueryStub(null);

  const { req, res } = createReqRes({
    params: {
      id: String(subscription._id),
      date: targetDate,
      paymentId: String(paymentDoc._id),
    },
    userId,
  });

  await controller.verifyPremiumOverageDayPayment(req, res, {
    getInvoice: async () => ({
      id: "invoice-overage-verify",
      status: "paid",
      amount: 500,
      currency: "SAR",
      url: "https://pay.test/overage-verify",
      payments: [{ id: "provider-overage-1", status: "paid", amount: 500, currency: "SAR" }],
    }),
    applyPaymentSideEffects: async ({ payment }) => {
      assert.equal(payment.type, "premium_overage_day");
      day.premiumOverageStatus = "paid";
      return { applied: true, dayId: String(day._id) };
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.premiumOverageCount, 1);
  assert.equal(res.payload.data.premiumOverageStatus, "paid");
  assert.equal(res.payload.data.synchronized, true);

  const confirm = createReqRes({
    params: { id: String(subscription._id), date: targetDate },
    userId,
  });

  await controller.confirmDayPlanning(confirm.req, confirm.res);

  assert.equal(confirm.res.statusCode, 200);
  assert.equal(confirm.res.payload.data.planning.state, "confirmed");
});
