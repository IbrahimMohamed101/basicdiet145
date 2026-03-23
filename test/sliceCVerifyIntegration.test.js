const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const subscriptionController = require("../src/controllers/subscriptionController");
const adminController = require("../src/controllers/adminController");
const { handleMoyasarWebhook } = require("../src/controllers/webhookController");
const Payment = require("../src/models/Payment");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const User = require("../src/models/User");
const Order = require("../src/models/Order");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createReqRes({ params = {}, body = {}, userId = objectId(), dashboardUserId = "admin-1", dashboardUserRole = "admin" } = {}) {
  const req = {
    params,
    body,
    userId,
    dashboardUserId,
    dashboardUserRole,
    headers: {},
    query: {},
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

function createSession() {
  return {
    active: false,
    startTransaction() {
      this.active = true;
    },
    async commitTransaction() {
      this.active = false;
    },
    async abortTransaction() {
      this.active = false;
    },
    endSession() {},
    inTransaction() {
      return this.active;
    },
  };
}

function createQuery({ leanResult, sessionResult }) {
  return {
    sort() {
      return this;
    },
    lean() {
      return Promise.resolve(leanResult);
    },
    session() {
      return Promise.resolve(sessionResult);
    },
  };
}

test("admin verify with dispatcher flag on falls back to legacy logic for unsupported payment types like one_time_order", async (t) => {
  const originalFlag = process.env.PHASE1_SHARED_PAYMENT_DISPATCHER;
  process.env.PHASE1_SHARED_PAYMENT_DISPATCHER = "true";
  t.after(() => {
    process.env.PHASE1_SHARED_PAYMENT_DISPATCHER = originalFlag;
  });

  const originalFindById = Payment.findById;
  const originalFindOneAndUpdate = Payment.findOneAndUpdate;
  const originalUpdateOne = Payment.updateOne;
  t.after(() => {
    Payment.findById = originalFindById;
    Payment.findOneAndUpdate = originalFindOneAndUpdate;
    Payment.updateOne = originalUpdateOne;
  });

  const paymentId = objectId();
  const paymentDoc = {
    _id: paymentId,
    provider: "moyasar",
    providerInvoiceId: "invoice-admin-unsupported",
    providerPaymentId: null,
    amount: 4500,
    currency: "SAR",
    type: "one_time_order",
    status: "initiated",
    applied: false,
    userId: null,
    metadata: { orderId: String(objectId()) },
    paidAt: null,
    async save() {
      return this;
    },
  };

  Payment.findById = () => createQuery({
    leanResult: paymentDoc,
    sessionResult: paymentDoc,
  });
  Payment.findOneAndUpdate = async () => ({
    ...paymentDoc,
    applied: true,
    status: "paid",
  });
  Payment.updateOne = async () => ({ acknowledged: true, modifiedCount: 1 });

  let dispatcherCalls = 0;
  let legacyCalls = 0;

  const { req, res } = createReqRes({
    params: { id: String(paymentId) },
  });

  await adminController.verifyPaymentAdmin(req, res, {
    getInvoice: async () => ({
      id: "invoice-admin-unsupported",
      status: "paid",
      amount: 4500,
      currency: "SAR",
      payments: [{ id: "provider-payment-1", status: "paid", amount: 4500, currency: "SAR" }],
    }),
    startSession: async () => createSession(),
    applyPaymentSideEffects: async () => {
      dispatcherCalls += 1;
      return { applied: true };
    },
    applyAdminPaymentSideEffects: async () => {
      legacyCalls += 1;
      return { applied: true, orderId: "order-1" };
    },
    writeActivityLogSafely: async () => {},
  });

  assert.equal(dispatcherCalls, 0);
  assert.equal(legacyCalls, 1);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
});

test("admin verify with dispatcher flag on uses shared dispatcher for supported payment types", async (t) => {
  const originalFlag = process.env.PHASE1_SHARED_PAYMENT_DISPATCHER;
  process.env.PHASE1_SHARED_PAYMENT_DISPATCHER = "true";
  t.after(() => {
    process.env.PHASE1_SHARED_PAYMENT_DISPATCHER = originalFlag;
  });

  const originalFindById = Payment.findById;
  const originalFindOneAndUpdate = Payment.findOneAndUpdate;
  t.after(() => {
    Payment.findById = originalFindById;
    Payment.findOneAndUpdate = originalFindOneAndUpdate;
  });

  const paymentId = objectId();
  const paymentDoc = {
    _id: paymentId,
    provider: "moyasar",
    providerInvoiceId: "invoice-admin-supported",
    providerPaymentId: null,
    amount: 2200,
    currency: "SAR",
    type: "premium_topup",
    status: "initiated",
    applied: false,
    userId: null,
    metadata: { subscriptionId: String(objectId()), count: 2 },
    paidAt: null,
    async save() {
      return this;
    },
  };

  Payment.findById = () => createQuery({
    leanResult: paymentDoc,
    sessionResult: paymentDoc,
  });
  Payment.findOneAndUpdate = async () => ({
    ...paymentDoc,
    applied: true,
    status: "paid",
  });

  let dispatcherCalls = 0;
  let legacyCalls = 0;

  const { req, res } = createReqRes({
    params: { id: String(paymentId) },
  });

  await adminController.verifyPaymentAdmin(req, res, {
    getInvoice: async () => ({
      id: "invoice-admin-supported",
      status: "paid",
      amount: 2200,
      currency: "SAR",
      payments: [{ id: "provider-payment-2", status: "paid", amount: 2200, currency: "SAR" }],
    }),
    startSession: async () => createSession(),
    applyPaymentSideEffects: async () => {
      dispatcherCalls += 1;
      return { applied: true, addedCount: 2 };
    },
    applyAdminPaymentSideEffects: async () => {
      legacyCalls += 1;
      return { applied: true };
    },
    writeActivityLogSafely: async () => {},
  });

  assert.equal(dispatcherCalls, 1);
  assert.equal(legacyCalls, 0);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
});

test("webhook with dispatcher flag on uses shared dispatcher for supported payment types", async (t) => {
  const originalFlag = process.env.PHASE1_SHARED_PAYMENT_DISPATCHER;
  const originalSecret = process.env.MOYASAR_WEBHOOK_SECRET;
  process.env.PHASE1_SHARED_PAYMENT_DISPATCHER = "true";
  process.env.MOYASAR_WEBHOOK_SECRET = "slice-c-secret";
  t.after(() => {
    process.env.PHASE1_SHARED_PAYMENT_DISPATCHER = originalFlag;
    process.env.MOYASAR_WEBHOOK_SECRET = originalSecret;
  });

  const originalFindOne = Payment.findOne;
  const originalFindOneAndUpdate = Payment.findOneAndUpdate;
  t.after(() => {
    Payment.findOne = originalFindOne;
    Payment.findOneAndUpdate = originalFindOneAndUpdate;
  });

  const paymentDoc = {
    _id: objectId(),
    provider: "moyasar",
    providerPaymentId: "provider-payment-webhook-supported",
    providerInvoiceId: "invoice-webhook-supported",
    type: "premium_topup",
    status: "initiated",
    applied: false,
    amount: 1500,
    currency: "SAR",
    metadata: { subscriptionId: String(objectId()), count: 1 },
    async save() {
      return this;
    },
  };

  Payment.findOne = () => createQuery({ sessionResult: paymentDoc });
  Payment.findOneAndUpdate = async () => ({
    ...paymentDoc,
    applied: true,
    status: "paid",
  });

  let dispatcherCalls = 0;

  const { req, res } = createReqRes({
    body: {
      secret_token: "slice-c-secret",
      type: "payment_paid",
      data: {
        id: "provider-payment-webhook-supported",
        invoice_id: "invoice-webhook-supported",
        status: "paid",
        amount: 1500,
        currency: "SAR",
      },
    },
  });

  await handleMoyasarWebhook(req, res, {
    startSession: async () => createSession(),
    applyPaymentSideEffects: async () => {
      dispatcherCalls += 1;
      return { applied: true, addedCount: 1 };
    },
    writeLog: async () => {},
  });

  assert.equal(dispatcherCalls, 1);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
});

test("webhook with dispatcher flag on falls back to legacy logic for unsupported payment types", async (t) => {
  const originalFlag = process.env.PHASE1_SHARED_PAYMENT_DISPATCHER;
  const originalSecret = process.env.MOYASAR_WEBHOOK_SECRET;
  process.env.PHASE1_SHARED_PAYMENT_DISPATCHER = "true";
  process.env.MOYASAR_WEBHOOK_SECRET = "slice-c-secret";
  t.after(() => {
    process.env.PHASE1_SHARED_PAYMENT_DISPATCHER = originalFlag;
    process.env.MOYASAR_WEBHOOK_SECRET = originalSecret;
  });

  const originalFindOne = Payment.findOne;
  const originalFindOneAndUpdate = Payment.findOneAndUpdate;
  const originalUpdateOne = Payment.updateOne;
  t.after(() => {
    Payment.findOne = originalFindOne;
    Payment.findOneAndUpdate = originalFindOneAndUpdate;
    Payment.updateOne = originalUpdateOne;
  });

  const paymentDoc = {
    _id: objectId(),
    provider: "moyasar",
    providerPaymentId: "provider-payment-webhook-unsupported",
    providerInvoiceId: "invoice-webhook-unsupported",
    type: "unsupported_type",
    status: "initiated",
    applied: false,
    amount: 1900,
    currency: "SAR",
    metadata: {},
    async save() {
      return this;
    },
  };

  Payment.findOne = () => createQuery({ sessionResult: paymentDoc });
  Payment.findOneAndUpdate = async () => ({
    ...paymentDoc,
    applied: true,
    status: "paid",
  });
  let updateOneCalls = 0;
  Payment.updateOne = async () => {
    updateOneCalls += 1;
    return { acknowledged: true, modifiedCount: 1 };
  };

  let dispatcherCalls = 0;
  let writeLogCalls = 0;

  const { req, res } = createReqRes({
    body: {
      secret_token: "slice-c-secret",
      type: "payment_paid",
      data: {
        id: "provider-payment-webhook-unsupported",
        invoice_id: "invoice-webhook-unsupported",
        status: "paid",
        amount: 1900,
        currency: "SAR",
      },
    },
  });

  await handleMoyasarWebhook(req, res, {
    startSession: async () => createSession(),
    applyPaymentSideEffects: async () => {
      dispatcherCalls += 1;
      return { applied: true };
    },
    writeLog: async () => {
      writeLogCalls += 1;
    },
  });

  assert.equal(dispatcherCalls, 0);
  assert.equal(updateOneCalls, 1);
  assert.equal(writeLogCalls, 1);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
});

test("manual verify keeps supported subscription_activation on dispatcher path only when the dispatcher flag is enabled", async (t) => {
  const originalFlag = process.env.PHASE1_SHARED_PAYMENT_DISPATCHER;
  t.after(() => {
    process.env.PHASE1_SHARED_PAYMENT_DISPATCHER = originalFlag;
  });

  const originalDraftFindOne = CheckoutDraft.findOne;
  const originalDraftFindById = CheckoutDraft.findById;
  const originalPaymentFindOne = Payment.findOne;
  const originalPaymentFindById = Payment.findById;
  const originalPaymentFindOneAndUpdate = Payment.findOneAndUpdate;
  const originalPaymentUpdateOne = Payment.updateOne;
  t.after(() => {
    CheckoutDraft.findOne = originalDraftFindOne;
    CheckoutDraft.findById = originalDraftFindById;
    Payment.findOne = originalPaymentFindOne;
    Payment.findById = originalPaymentFindById;
    Payment.findOneAndUpdate = originalPaymentFindOneAndUpdate;
    Payment.updateOne = originalPaymentUpdateOne;
  });

  const userId = objectId();
  const draftId = objectId();
  const paymentId = objectId();
  const draftDoc = {
    _id: draftId,
    userId,
    status: "pending_payment",
    paymentId,
    paymentUrl: "https://pay.test/manual",
    providerInvoiceId: "invoice-manual",
    breakdown: { totalHalala: 1000, currency: "SAR" },
    subscriptionId: null,
    failureReason: "",
    completedAt: null,
    failedAt: null,
    createdAt: null,
    updatedAt: null,
    async save() {
      return this;
    },
  };
  const paymentDoc = {
    _id: paymentId,
    userId,
    provider: "moyasar",
    providerInvoiceId: "invoice-manual",
    providerPaymentId: null,
    type: "subscription_activation",
    status: "initiated",
    applied: false,
    amount: 1000,
    currency: "SAR",
    paidAt: null,
    metadata: { draftId: String(draftId) },
    async save() {
      return this;
    },
  };

  CheckoutDraft.findOne = () => createQuery({
    leanResult: draftDoc,
    sessionResult: draftDoc,
  });
  CheckoutDraft.findById = () => createQuery({
    leanResult: draftDoc,
    sessionResult: draftDoc,
  });
  Payment.findOne = () => createQuery({
    leanResult: paymentDoc,
    sessionResult: paymentDoc,
  });
  Payment.findById = () => createQuery({
    leanResult: paymentDoc,
    sessionResult: paymentDoc,
  });
  Payment.findOneAndUpdate = async () => ({
    ...paymentDoc,
    applied: true,
    status: "paid",
  });
  Payment.updateOne = async () => ({ acknowledged: true, modifiedCount: 1 });

  const { req, res } = createReqRes({
    params: { draftId: String(draftId) },
    userId,
  });

  let dispatcherCalls = 0;
  let legacyCalls = 0;

  process.env.PHASE1_SHARED_PAYMENT_DISPATCHER = "true";
  await subscriptionController.verifyCheckoutDraftPayment(req, res, {
    getInvoice: async () => ({
      id: "invoice-manual",
      status: "paid",
      amount: 1000,
      currency: "SAR",
      payments: [{ id: "provider-payment-manual", status: "paid", amount: 1000, currency: "SAR" }],
    }),
    startSession: async () => createSession(),
    applyPaymentSideEffects: async () => {
      dispatcherCalls += 1;
      return { applied: true, subscriptionId: "sub-dispatcher" };
    },
    finalizeSubscriptionDraftPayment: async () => {
      legacyCalls += 1;
      return { applied: true, subscriptionId: "sub-legacy" };
    },
  });

  assert.equal(dispatcherCalls, 1);
  assert.equal(legacyCalls, 0);
  assert.equal(res.statusCode, 200);

  process.env.PHASE1_SHARED_PAYMENT_DISPATCHER = "";
  await subscriptionController.verifyCheckoutDraftPayment(req, res, {
    getInvoice: async () => ({
      id: "invoice-manual",
      status: "paid",
      amount: 1000,
      currency: "SAR",
      payments: [{ id: "provider-payment-manual", status: "paid", amount: 1000, currency: "SAR" }],
    }),
    startSession: async () => createSession(),
    applyPaymentSideEffects: async () => {
      dispatcherCalls += 1;
      return { applied: true, subscriptionId: "sub-dispatcher" };
    },
    finalizeSubscriptionDraftPayment: async () => {
      legacyCalls += 1;
      return { applied: true, subscriptionId: "sub-legacy" };
    },
  });

  assert.equal(dispatcherCalls, 1);
  assert.equal(legacyCalls, 1);
});
