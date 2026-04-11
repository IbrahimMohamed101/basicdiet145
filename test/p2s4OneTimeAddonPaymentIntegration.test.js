const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const controller = require("../src/controllers/subscriptionController");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Payment = require("../src/models/Payment");
const Addon = require("../src/models/Addon");
const Setting = require("../src/models/Setting");
const ActivityLog = require("../src/models/ActivityLog");
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
  const query = {
    populate() {
      return query;
    },
    session() {
      return query;
    },
    sort() {
      return query;
    },
    lean() {
      return Promise.resolve(result);
    },
    select() {
      return query;
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return query;
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

function buildActiveSubscriptionWindow() {
  const tomorrow = new Date(`${getTomorrowKSADate()}T00:00:00+03:00`);
  const startDate = new Date(tomorrow);
  startDate.setDate(startDate.getDate() - 31);
  const endDate = new Date(tomorrow);
  endDate.setDate(endDate.getDate() + 29);
  return { startDate, endDate, validityEndDate: endDate };
}

function createCanonicalSubscription(userId, overrides = {}) {
  const { startDate, endDate, validityEndDate } = buildActiveSubscriptionWindow();
  return {
    _id: objectId(),
    id: null,
    userId,
    status: "active",
    startDate,
    endDate,
    validityEndDate,
    selectedMealsPerDay: 2,
    addonBalance: [],
    addonSubscriptions: [],
    premiumSelections: [],
    premiumBalance: [],
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
    async save() {
      return this;
    },
    ...overrides,
  };
}

test("createOneTimeAddonDayPlanningPayment creates a day-scoped one-time add-on payment from authoritative day selections", async (t) => {
  const originalPlanningFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  const originalIdempotencyFlag = process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPlanningFlag;
    process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY = originalIdempotencyFlag;
  });

  const originalSubFindById = Subscription.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  const originalAddonFind = Addon.find;
  const originalSettingFindOne = Setting.findOne;
  t.after(() => {
    Subscription.findById = originalSubFindById;
    SubscriptionDay.findOne = originalDayFindOne;
    Addon.find = originalAddonFind;
    Setting.findOne = originalSettingFindOne;
  });

  const userId = objectId();
  const subscription = createCanonicalSubscription(userId);
  subscription.id = String(subscription._id);
  const targetDate = getFutureDate(2);
  const starterId = objectId();
  const dessertId = objectId();
  const day = {
    _id: objectId(),
    subscriptionId: subscription._id,
    date: targetDate,
    status: "open",
    oneTimeAddonSelections: [
      { addonId: starterId, name: "Soup", category: "starter" },
      { addonId: dessertId, name: "Cake", category: "dessert" },
    ],
    oneTimeAddonPendingCount: 2,
    oneTimeAddonPaymentStatus: "pending",
  };

  Subscription.findById = () => createQueryStub(subscription);
  SubscriptionDay.findOne = async () => day;
  Addon.find = () => createQueryStub([
    { _id: starterId, priceHalala: 250, currency: "SAR" },
    { _id: dessertId, priceHalala: 350, currency: "SAR" },
  ]);
  Setting.findOne = () => createQueryStub(null);

  let createdInvoicePayload = null;
  let createdPaymentPayload = null;
  const { req, res } = createReqRes({
    params: { id: String(subscription._id), date: targetDate },
    userId,
    headers: { "idempotency-key": "addon-day-key-1" },
  });

  await controller.createOneTimeAddonDayPlanningPayment(req, res, {
    async createInvoice(payload) {
      createdInvoicePayload = payload;
      return {
        id: "invoice-addon-day-1",
        url: "https://pay.test/addon-day-1",
        currency: "SAR",
        metadata: payload.metadata,
      };
    },
    async createPayment(payload) {
      createdPaymentPayload = payload;
      return { id: "payment-addon-day-1" };
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
    payment_url: "https://pay.test/addon-day-1",
    invoice_id: "invoice-addon-day-1",
    payment_id: "payment-addon-day-1",
    totalHalala: 600,
  });
  assert.equal(createdInvoicePayload.amount, 600);
  assert.equal(createdInvoicePayload.metadata.type, "one_time_addon_day_planning");
  assert.equal(createdInvoicePayload.metadata.subscriptionId, String(subscription._id));
  assert.equal(createdInvoicePayload.metadata.dayId, String(day._id));
  assert.equal(createdInvoicePayload.metadata.date, targetDate);
  assert.equal(createdInvoicePayload.metadata.oneTimeAddonCount, 2);
  assert.deepEqual(createdInvoicePayload.metadata.oneTimeAddonSelections, [
    { addonId: String(dessertId), name: "Cake", category: "dessert" },
    { addonId: String(starterId), name: "Soup", category: "starter" },
  ]);
  assert.deepEqual(createdInvoicePayload.metadata.pricedItems, [
    { addonId: String(dessertId), name: "Cake", category: "dessert", unitPriceHalala: 350, currency: "SAR" },
    { addonId: String(starterId), name: "Soup", category: "starter", unitPriceHalala: 250, currency: "SAR" },
  ]);
  assert.equal(createdPaymentPayload.type, "one_time_addon_day_planning");
  assert.equal(createdPaymentPayload.operationScope, "one_time_addon_day_planning");
  assert.equal(createdPaymentPayload.metadata.totalHalala, 600);
});

test("createOneTimeAddonDayPlanningPayment returns idempotency conflict when the same key is reused with a changed day snapshot", async (t) => {
  const originalPlanningFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  const originalIdempotencyFlag = process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPlanningFlag;
    process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY = originalIdempotencyFlag;
  });

  const originalSubFindById = Subscription.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  const originalAddonFind = Addon.find;
  const originalSettingFindOne = Setting.findOne;
  t.after(() => {
    Subscription.findById = originalSubFindById;
    SubscriptionDay.findOne = originalDayFindOne;
    Addon.find = originalAddonFind;
    Setting.findOne = originalSettingFindOne;
  });

  const userId = objectId();
  const subscription = createCanonicalSubscription(userId);
  const targetDate = getFutureDate(2);
  const day = {
    _id: objectId(),
    subscriptionId: subscription._id,
    date: targetDate,
    status: "open",
    oneTimeAddonSelections: [
      { addonId: objectId(), name: "Soup", category: "starter" },
    ],
    oneTimeAddonPendingCount: 1,
    oneTimeAddonPaymentStatus: "pending",
  };

  Subscription.findById = () => createQueryStub(subscription);
  SubscriptionDay.findOne = async () => day;
  Addon.find = () => createQueryStub([
    { _id: day.oneTimeAddonSelections[0].addonId, priceHalala: 250, currency: "SAR" },
  ]);
  Setting.findOne = () => createQueryStub(null);

  const { req, res } = createReqRes({
    params: { id: String(subscription._id), date: targetDate },
    userId,
    headers: { "idempotency-key": "addon-day-conflict" },
  });

  await controller.createOneTimeAddonDayPlanningPayment(req, res, {
    async findPaymentByOperationKey() {
      return {
        _id: objectId(),
        operationRequestHash: "existing-hash",
        status: "initiated",
        applied: false,
        providerInvoiceId: "invoice-existing",
        metadata: {
          paymentUrl: "https://pay.test/existing-addon-day",
          initiationResponseShape: "one_time_addon_day_planning",
          totalHalala: 250,
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

test("verifyOneTimeAddonDayPlanningPayment applies paid day settlement and confirmDayPlanning succeeds afterward", async (t) => {
  const originalPlanningFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  const originalStartSession = mongoose.startSession;
  const originalSubFindById = Subscription.findById;
  const originalSubFindOne = Subscription.findOne;
  const originalPaymentFindOne = Payment.findOne;
  const originalPaymentFindById = Payment.findById;
  const originalPaymentFindOneAndUpdate = Payment.findOneAndUpdate;
  const originalPaymentUpdateOne = Payment.updateOne;
  const originalDayFindById = SubscriptionDay.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  const originalLogCreate = ActivityLog.create;
  const originalSettingFindOne = Setting.findOne;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPlanningFlag;
    mongoose.startSession = originalStartSession;
    Subscription.findById = originalSubFindById;
    Subscription.findOne = originalSubFindOne;
    Payment.findOne = originalPaymentFindOne;
    Payment.findById = originalPaymentFindById;
    Payment.findOneAndUpdate = originalPaymentFindOneAndUpdate;
    Payment.updateOne = originalPaymentUpdateOne;
    SubscriptionDay.findById = originalDayFindById;
    SubscriptionDay.findOne = originalDayFindOne;
    ActivityLog.create = originalLogCreate;
    Setting.findOne = originalSettingFindOne;
  });

  mongoose.startSession = async () => createSessionStub();
  ActivityLog.create = async () => ({});

  const userId = objectId();
  const subscription = createCanonicalSubscription(userId);
  subscription.id = String(subscription._id);
  const targetDate = getFutureDate(2);
  const starterId = objectId();
  const dessertId = objectId();
  const day = {
    _id: objectId(),
    subscriptionId: subscription._id,
    date: targetDate,
    status: "open",
    selections: [objectId(), objectId()],
    premiumSelections: [],
    oneTimeAddonSelections: [
      { addonId: starterId, name: "Soup", category: "starter" },
      { addonId: dessertId, name: "Cake", category: "dessert" },
    ],
    oneTimeAddonPendingCount: 2,
    oneTimeAddonPaymentStatus: "pending",
    addonsOneTime: [],
    async save() {
      return this;
    },
    toObject() {
      return { ...this };
    },
  };
  const paymentDoc = {
    _id: objectId(),
    id: "payment-addon-day-verify",
    provider: "moyasar",
    providerInvoiceId: "invoice-addon-day-verify",
    providerPaymentId: null,
    amount: 600,
    currency: "SAR",
    type: "one_time_addon_day_planning",
    status: "initiated",
    applied: false,
    userId,
    subscriptionId: subscription._id,
    metadata: {
      type: "one_time_addon_day_planning",
      subscriptionId: String(subscription._id),
      dayId: String(day._id),
      date: targetDate,
      oneTimeAddonSelections: [
        { addonId: String(dessertId), name: "Cake", category: "dessert" },
        { addonId: String(starterId), name: "Soup", category: "starter" },
      ],
      oneTimeAddonCount: 2,
      pricedItems: [
        { addonId: String(dessertId), name: "Cake", category: "dessert", unitPriceHalala: 350, currency: "SAR" },
        { addonId: String(starterId), name: "Soup", category: "starter", unitPriceHalala: 250, currency: "SAR" },
      ],
      paymentUrl: "https://pay.test/addon-day-verify",
      initiationResponseShape: "one_time_addon_day_planning",
      totalHalala: 600,
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

  await controller.verifyOneTimeAddonDayPlanningPayment(req, res, {
    getInvoice: async () => ({
      id: "invoice-addon-day-verify",
      status: "paid",
      amount: 600,
      currency: "SAR",
      url: "https://pay.test/addon-day-verify",
      payments: [{ id: "provider-addon-day-1", status: "paid", amount: 600, currency: "SAR" }],
    }),
    applyPaymentSideEffects: async ({ payment }) => {
      assert.equal(payment.type, "one_time_addon_day_planning");
      day.oneTimeAddonPaymentStatus = "paid";
      return { applied: true, dayId: String(day._id) };
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.oneTimeAddonPendingCount, 2);
  assert.equal(res.payload.data.oneTimeAddonPaymentStatus, "paid");
  assert.equal(res.payload.data.synchronized, true);

  const confirm = createReqRes({
    params: { id: String(subscription._id), date: targetDate },
    userId,
  });

  await controller.confirmDayPlanning(confirm.req, confirm.res);

  assert.equal(confirm.res.statusCode, 200);
  assert.equal(confirm.res.payload.data.planning.state, "confirmed");
});
