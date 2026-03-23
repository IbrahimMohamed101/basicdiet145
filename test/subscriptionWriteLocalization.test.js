const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const controller = require("../src/controllers/subscriptionController");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Payment = require("../src/models/Payment");
const PremiumMeal = require("../src/models/PremiumMeal");
const Addon = require("../src/models/Addon");
const Setting = require("../src/models/Setting");
const ActivityLog = require("../src/models/ActivityLog");
const { buildPaymentDescription } = require("../src/utils/subscriptionWriteLocalization");
const { getTomorrowKSADate, toKSADateString } = require("../src/utils/date");

function objectId() {
  return new mongoose.Types.ObjectId();
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
    set() {},
    append() {},
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
    select() {
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

function createDraftRecord(payload = {}) {
  return {
    _id: objectId(),
    id: String(objectId()),
    status: "pending_payment",
    paymentUrl: "",
    async save() {
      return this;
    },
    ...payload,
  };
}

function createPaymentRecord(payload = {}) {
  return {
    _id: objectId(),
    id: String(objectId()),
    status: "initiated",
    applied: false,
    async save() {
      return this;
    },
    ...payload,
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

test("checkoutSubscription localizes the checkout invoice description in Arabic and preserves the response shape", async (t) => {
  const originalWriteFlag = process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;
  const originalFindOne = CheckoutDraft.findOne;
  const originalCreate = CheckoutDraft.create;
  const originalPaymentFindById = Payment.findById;
  const originalPaymentCreate = Payment.create;

  delete process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;

  t.after(() => {
    process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE = originalWriteFlag;
    CheckoutDraft.findOne = originalFindOne;
    CheckoutDraft.create = originalCreate;
    Payment.findById = originalPaymentFindById;
    Payment.create = originalPaymentCreate;
  });

  CheckoutDraft.findOne = () => createQueryStub(null);
  CheckoutDraft.create = async (payload) => createDraftRecord(payload);
  Payment.findById = () => createQueryStub(null);
  Payment.create = async (payload) => createPaymentRecord(payload);

  const startDate = new Date(`${getFutureDate(3)}T00:00:00+03:00`);
  const quote = {
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
      slot: { type: "delivery", window: "08:00-11:00", slotId: "slot-1" },
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

  let createdInvoicePayload = null;
  const { req, res } = createReqRes({
    userId: objectId(),
    query: { lang: "ar" },
    body: { idempotencyKey: "checkout-ar-key" },
  });

  await controller.checkoutSubscription(req, res, {
    resolveCheckoutQuoteOrThrow: async () => quote,
    createInvoice: async (payload) => {
      createdInvoicePayload = payload;
      return {
        id: "invoice-checkout-ar",
        url: "https://pay.test/checkout-ar",
        currency: "SAR",
        metadata: payload.metadata,
      };
    },
  });

  assert.equal(res.statusCode, 201);
  assert.deepEqual(
    Object.keys(res.payload.data).sort(),
    ["draftId", "paymentId", "payment_url", "subscriptionId", "totals"].sort()
  );
  assert.equal(createdInvoicePayload.description, "دفع الاشتراك (10 يوم)");
});

test("quoteSubscription keeps machine totals stable while returning a localized summary", async () => {
  const quote = {
    plan: {
      _id: objectId(),
      name: { ar: "الخطة الذهبية", en: "Gold Plan" },
      daysCount: 7,
      currency: "SAR",
      isActive: true,
      gramsOptions: [{
        grams: 150,
        isActive: true,
        mealsOptions: [{
          mealsPerDay: 3,
          isActive: true,
          priceHalala: 7000,
          compareAtHalala: 0,
        }],
      }],
    },
    grams: 150,
    mealsPerDay: 3,
    startDate: getFutureDate(2),
    delivery: {
      type: "delivery",
      address: { city: "Riyadh" },
      slot: { type: "delivery", slotId: "slot-1", window: "08:00-11:00" },
    },
    premiumWalletMode: "generic_v1",
    premiumCount: 2,
    premiumUnitPriceHalala: 500,
    premiumItems: [],
    addonItems: [],
    breakdown: {
      basePlanPriceHalala: 7000,
      premiumTotalHalala: 1000,
      addonsTotalHalala: 0,
      deliveryFeeHalala: 500,
      vatHalala: 1125,
      totalHalala: 9625,
      currency: "SAR",
    },
  };

  const { req, res } = createReqRes({
    query: { lang: "ar" },
    body: {},
  });

  await controller.quoteSubscription(req, res, {
    resolveCheckoutQuoteOrThrow: async () => quote,
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.totalSar, 96.25);
  assert.equal(res.payload.data.breakdown.totalHalala, 9625);
  assert.equal(res.payload.data.summary.plan.name, "الخطة الذهبية");
  assert.equal(res.payload.data.summary.delivery.label, "توصيل للمنزل");
  assert.equal(res.payload.data.summary.lineItems[0].label, "الباقة");
});

test("topupPremiumCredits localizes payment-facing text from Accept-Language and keeps the initiation payload unchanged", async (t) => {
  const originalFindById = Subscription.findById;
  const originalSettingFindOne = Setting.findOne;
  const originalPremiumFind = PremiumMeal.find;

  t.after(() => {
    Subscription.findById = originalFindById;
    Setting.findOne = originalSettingFindOne;
    PremiumMeal.find = originalPremiumFind;
  });

  const subscriptionId = objectId();
  const userId = objectId();
  Subscription.findById = () => Promise.resolve({
    _id: subscriptionId,
    userId,
    status: "active",
    premiumWalletMode: "generic_v1",
  });
  Setting.findOne = () => createQueryStub({ value: 5 });
  PremiumMeal.find = () => createQueryStub([]);

  let createdInvoicePayload = null;
  const { req, res } = createReqRes({
    params: { id: String(subscriptionId) },
    userId,
    headers: { "accept-language": "en-US,en;q=0.9,ar;q=0.8" },
    body: { items: [{ premiumMealId: String(objectId()), qty: 2 }] },
  });

  await controller.topupPremiumCredits(req, res, {
    async createInvoice(payload) {
      createdInvoicePayload = payload;
      return {
        id: "invoice-premium-en",
        url: "https://pay.test/premium-en",
        currency: "SAR",
        metadata: payload.metadata,
      };
    },
    async createPayment() {
      return { id: "payment-premium-en" };
    },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.data, {
    payment_url: "https://pay.test/premium-en",
    invoice_id: "invoice-premium-en",
    payment_id: "payment-premium-en",
    totalHalala: 1000,
  });
  assert.equal(createdInvoicePayload.description, "Premium credits top-up");
});

test("verifyWalletTopupPayment localizes additive labels using query.lang over Accept-Language and keeps machine fields stable", async (t) => {
  const originalSubscriptionFindById = Subscription.findById;
  const originalPaymentFindOne = Payment.findOne;
  const originalAddonFind = Addon.find;
  const originalPremiumFind = PremiumMeal.find;

  t.after(() => {
    Subscription.findById = originalSubscriptionFindById;
    Payment.findOne = originalPaymentFindOne;
    Addon.find = originalAddonFind;
    PremiumMeal.find = originalPremiumFind;
  });

  const subscriptionId = objectId();
  const paymentId = objectId();
  const addonId = objectId();
  const userId = objectId();
  const subscription = {
    _id: subscriptionId,
    userId,
    status: "active",
    premiumBalance: [],
    addonBalance: [],
  };
  const payment = {
    _id: paymentId,
    provider: "moyasar",
    type: "addon_topup",
    status: "paid",
    applied: true,
    amount: 600,
    currency: "SAR",
    providerInvoiceId: "invoice-addon-topup-1",
    createdAt: new Date("2026-03-23T10:00:00.000Z"),
    updatedAt: new Date("2026-03-23T10:00:00.000Z"),
    metadata: {
      items: [{ addonId: String(addonId), qty: 2, unitPriceHalala: 300, currency: "SAR" }],
    },
  };

  Subscription.findById = () => createQueryStub(subscription);
  Payment.findOne = () => createQueryStub(payment);
  Addon.find = () => createQueryStub([{ _id: addonId, name: { ar: "شوربة", en: "Soup" } }]);
  PremiumMeal.find = () => createQueryStub([]);

  const { req, res } = createReqRes({
    params: { id: String(subscriptionId), paymentId: String(paymentId) },
    query: { lang: "en" },
    headers: { "accept-language": "ar-SA,ar;q=0.9" },
    userId,
  });

  await controller.verifyWalletTopupPayment(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.walletType, "addon");
  assert.equal(res.payload.data.walletTypeLabel, "Add-on");
  assert.equal(res.payload.data.paymentStatus, "paid");
  assert.equal(res.payload.data.paymentStatusLabel, "Paid");
  assert.equal(res.payload.data.items[0].name, "Soup");
  assert.equal(res.payload.data.payment.status, "paid");
  assert.equal(res.payload.data.payment.statusLabel, "Paid");
  assert.equal(res.payload.data.providerInvoice, null);
});

test("verifyCheckoutDraftPayment adds localized write labels while preserving machine-readable fields", async (t) => {
  const originalFindOne = CheckoutDraft.findOne;
  const originalPaymentFindOne = Payment.findOne;

  t.after(() => {
    CheckoutDraft.findOne = originalFindOne;
    Payment.findOne = originalPaymentFindOne;
  });

  const draftId = objectId();
  const paymentId = objectId();
  const userId = objectId();
  const draft = {
    _id: draftId,
    userId,
    subscriptionId: objectId(),
    paymentId,
    status: "completed",
    paymentUrl: "https://pay.test/checkout-status",
    providerInvoiceId: "invoice-status-1",
    breakdown: { totalHalala: 1800, currency: "SAR" },
    delivery: {
      type: "delivery",
      slot: { type: "delivery", window: "08:00-11:00", slotId: "slot-1" },
    },
    contractSnapshot: {
      plan: {
        planName: { ar: "الخطة الذهبية", en: "Gold Plan" },
      },
    },
  };
  const payment = {
    _id: paymentId,
    provider: "moyasar",
    type: "subscription_activation",
    status: "initiated",
    amount: 1800,
    currency: "SAR",
    applied: false,
    providerInvoiceId: "invoice-status-1",
    providerPaymentId: null,
    createdAt: new Date("2026-03-23T10:00:00.000Z"),
    updatedAt: new Date("2026-03-23T10:00:00.000Z"),
  };

  CheckoutDraft.findOne = () => createQueryStub(draft);
  Payment.findOne = () => createQueryStub(payment);

  const { req, res } = createReqRes({
    params: { draftId: String(draftId) },
    query: { lang: "ar" },
    userId,
  });

  await controller.verifyCheckoutDraftPayment(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.checkoutStatus, "completed");
  assert.equal(res.payload.data.paymentStatus, "initiated");
  assert.equal(res.payload.data.checkoutStatusLabel, "مكتمل");
  assert.equal(res.payload.data.paymentStatusLabel, "مبدئي");
  assert.equal(res.payload.data.planName, "الخطة الذهبية");
  assert.equal(res.payload.data.deliveryModeLabel, "توصيل");
  assert.equal(res.payload.data.providerInvoice, null);
});

test("updateDaySelection localizes additive write-day fields without changing the machine-readable status", async (t) => {
  const originalPlanningFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  const originalStartSession = mongoose.startSession;
  const originalSubFindById = Subscription.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  const originalDayFindOneAndUpdate = SubscriptionDay.findOneAndUpdate;
  const originalAddonFind = Addon.find;
  const originalSettingFindOne = Setting.findOne;
  const originalLogCreate = ActivityLog.create;

  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";

  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPlanningFlag;
    mongoose.startSession = originalStartSession;
    Subscription.findById = originalSubFindById;
    SubscriptionDay.findOne = originalDayFindOne;
    SubscriptionDay.findOneAndUpdate = originalDayFindOneAndUpdate;
    Addon.find = originalAddonFind;
    Setting.findOne = originalSettingFindOne;
    ActivityLog.create = originalLogCreate;
  });

  mongoose.startSession = async () => createSessionStub();
  ActivityLog.create = async () => ({});

  const userId = objectId();
  const subscription = {
    _id: objectId(),
    id: null,
    userId,
    status: "active",
    startDate: new Date("2026-03-10T21:00:00.000Z"),
    endDate: new Date("2026-04-10T21:00:00.000Z"),
    validityEndDate: new Date("2026-04-10T21:00:00.000Z"),
    selectedMealsPerDay: 3,
    premiumSelections: [],
    premiumBalance: [],
    addonSelections: [],
    addonBalance: [],
    addonSubscriptions: [],
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
    async save() {
      return this;
    },
  };

  const addonId = objectId();
  const targetDate = getFutureDate(2);
  const dayDoc = {
    _id: objectId(),
    subscriptionId: subscription._id,
    date: targetDate,
    status: "open",
    selections: [],
    premiumSelections: [],
    oneTimeAddonSelections: [],
    oneTimeAddonPendingCount: 0,
    oneTimeAddonPaymentStatus: null,
    addonsOneTime: [],
    recurringAddons: [],
    async save() {
      return this;
    },
    toObject() {
      return { ...this };
    },
  };

  Subscription.findById = () => createQueryStub(subscription);
  SubscriptionDay.findOne = () => createQueryStub(dayDoc);
  SubscriptionDay.findOneAndUpdate = async (_query, update) => {
    Object.assign(dayDoc, update);
    return dayDoc;
  };
  Addon.find = () => createQueryStub([
    { _id: addonId, isActive: true, type: "one_time", category: "starter", name: { ar: "شوربة", en: "Soup" } },
  ]);
  Setting.findOne = () => createQueryStub({ value: 20 });

  const { req, res } = createReqRes({
    params: { id: String(subscription._id), date: targetDate },
    query: { lang: "ar" },
    body: {
      selections: [objectId(), objectId(), objectId()],
      premiumSelections: [],
      oneTimeAddonSelections: [addonId],
    },
    userId,
  });

  await controller.updateDaySelection(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.status, "open");
  assert.equal(res.payload.data.statusLabel, "مفتوح");
  assert.equal(res.payload.data.oneTimeAddonSelections[0].name, "شوربة");
  assert.equal(res.payload.data.oneTimeAddonPaymentStatus, "pending");
  assert.equal(res.payload.data.oneTimeAddonPaymentStatusLabel, "قيد الانتظار");
});

test("buildPaymentDescription keeps custom payment text localized without touching payment metadata semantics", () => {
  assert.equal(
    buildPaymentDescription("customMeal", "ar", { date: "2026-03-25" }),
    "وجبة مخصصة (2026-03-25)"
  );
  assert.equal(
    buildPaymentDescription("customSalad", "en", { date: "2026-03-25" }),
    "Custom salad (2026-03-25)"
  );
  assert.equal(
    buildPaymentDescription("oneTimeAddon", "ar", { name: "شوربة" }),
    "إضافة (شوربة)"
  );
});
