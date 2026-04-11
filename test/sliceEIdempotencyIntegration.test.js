const test = require("node:test");
const assert = require("node:assert/strict");
const {
  objectId,
  createReqRes,
  createQueryStub,
} = require("./helpers/httpMocks");

const controller = require("../src/controllers/subscriptionController");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Payment = require("../src/models/Payment");
const PremiumMeal = require("../src/models/PremiumMeal");
const Addon = require("../src/models/Addon");
const Setting = require("../src/models/Setting");
const dateUtils = require("../src/utils/date");

test("topupPremiumCredits with flag off preserves legacy initiation behavior even when an idempotency key is provided", async (t) => {
  const originalFlag = process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY;
  delete process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY;
  t.after(() => {
    process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY = originalFlag;
  });

  const originalSubFindById = Subscription.findById;
  const originalPremiumFind = PremiumMeal.find;
  t.after(() => {
    Subscription.findById = originalSubFindById;
    PremiumMeal.find = originalPremiumFind;
  });

  const subscriptionId = objectId();
  const premiumMealId = objectId();
  const userId = objectId();

  Subscription.findById = () => Promise.resolve({
    _id: subscriptionId,
    userId,
    status: "active",
  });
  PremiumMeal.find = () => createQueryStub([
    { _id: premiumMealId, extraFeeHalala: 700, currency: "SAR", isActive: true },
  ]);

  let createPaymentPayload = null;
  const { req, res } = createReqRes({
    params: { id: String(subscriptionId) },
    userId,
    headers: { "Idempotency-Key": "optional-key" },
    body: { items: [{ premiumMealId: String(premiumMealId), qty: 2 }] },
  });

  await controller.topupPremiumCredits(req, res, {
    createInvoice: async () => ({
      id: "invoice-premium-off",
      url: "https://pay.test/premium-off",
      currency: "SAR",
      metadata: { type: "premium_topup", subscriptionId: String(subscriptionId), items: [] },
    }),
    async createPayment(payload) {
      createPaymentPayload = payload;
      return { id: "payment-premium-off" };
    },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.data, {
    payment_url: "https://pay.test/premium-off",
    invoice_id: "invoice-premium-off",
    payment_id: "payment-premium-off",
    totalHalala: 1400,
  });
  assert.equal("operationIdempotencyKey" in createPaymentPayload, false);
  assert.equal(createPaymentPayload.metadata.paymentUrl, "https://pay.test/premium-off");
});

test("topupPremiumCredits reuses the same initiated payment for same key and same payload when the flag is enabled", async (t) => {
  const originalFlag = process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY;
  process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY = "true";
  t.after(() => {
    process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY = originalFlag;
  });

  const originalSubFindById = Subscription.findById;
  const originalPremiumFind = PremiumMeal.find;
  t.after(() => {
    Subscription.findById = originalSubFindById;
    PremiumMeal.find = originalPremiumFind;
  });

  const subscriptionId = objectId();
  const premiumMealId = objectId();
  const userId = objectId();

  Subscription.findById = () => Promise.resolve({
    _id: subscriptionId,
    userId,
    status: "active",
  });
  PremiumMeal.find = () => createQueryStub([
    { _id: premiumMealId, extraFeeHalala: 800, currency: "SAR", isActive: true },
  ]);

  const existingPayment = {
    _id: objectId(),
    id: "payment-premium-reuse",
    providerInvoiceId: "invoice-premium-reuse",
    status: "initiated",
    applied: false,
    amount: 1600,
    operationScope: "premium_topup",
    operationIdempotencyKey: "premium-key",
    operationRequestHash: "premium-hash",
    metadata: {
      paymentUrl: "https://pay.test/premium-reuse",
      initiationResponseShape: "premium_credits_topup",
      totalHalala: 1600,
    },
  };

  let createPaymentCalls = 0;
  const { req, res } = createReqRes({
    params: { id: String(subscriptionId) },
    userId,
    headers: { "Idempotency-Key": "premium-key" },
    body: { items: [{ premiumMealId: String(premiumMealId), qty: 2 }] },
  });

  await controller.topupPremiumCredits(req, res, {
    buildOperationRequestHash: () => "premium-hash",
    compareIdempotentRequest: () => "reuse",
    async findPaymentByOperationKey() {
      return existingPayment;
    },
    async findReusableInitiatedPaymentByHash() {
      return null;
    },
    createInvoice: async () => {
      throw new Error("createInvoice should not be called on idempotent reuse");
    },
    async createPayment() {
      createPaymentCalls += 1;
      return { id: "should-not-create" };
    },
  });

  assert.equal(createPaymentCalls, 0);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.data, {
    payment_url: "https://pay.test/premium-reuse",
    invoice_id: "invoice-premium-reuse",
    payment_id: "payment-premium-reuse",
    totalHalala: 1600,
  });
});

test("topupPremiumCredits returns idempotency conflict for the same key with a different payload", async (t) => {
  const originalFlag = process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY;
  process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY = "true";
  t.after(() => {
    process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY = originalFlag;
  });

  const originalSubFindById = Subscription.findById;
  const originalPremiumFind = PremiumMeal.find;
  t.after(() => {
    Subscription.findById = originalSubFindById;
    PremiumMeal.find = originalPremiumFind;
  });

  const subscriptionId = objectId();
  const premiumMealId = objectId();
  const userId = objectId();

  Subscription.findById = () => Promise.resolve({
    _id: subscriptionId,
    userId,
    status: "active",
  });
  PremiumMeal.find = () => createQueryStub([
    { _id: premiumMealId, extraFeeHalala: 800, currency: "SAR", isActive: true },
  ]);

  const { req, res } = createReqRes({
    params: { id: String(subscriptionId) },
    userId,
    headers: { "Idempotency-Key": "premium-conflict-key" },
    body: { items: [{ premiumMealId: String(premiumMealId), qty: 1 }] },
  });

  await controller.topupPremiumCredits(req, res, {
    buildOperationRequestHash: () => "incoming-hash",
    compareIdempotentRequest: () => "conflict",
    async findPaymentByOperationKey() {
      return {
        _id: objectId(),
        operationRequestHash: "other-hash",
        status: "initiated",
        applied: false,
      };
    },
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.error.code, "IDEMPOTENCY_CONFLICT");
});

test("topupAddonCredits uses same-hash dedupe across different idempotency keys for reusable initiated payments", async (t) => {
  const originalFlag = process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY;
  process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY = "true";
  t.after(() => {
    process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY = originalFlag;
  });

  const originalSubFindById = Subscription.findById;
  const originalAddonFind = Addon.find;
  t.after(() => {
    Subscription.findById = originalSubFindById;
    Addon.find = originalAddonFind;
  });

  const subscriptionId = objectId();
  const addonId = objectId();
  const userId = objectId();

  Subscription.findById = () => Promise.resolve({
    _id: subscriptionId,
    userId,
    status: "active",
  });
  Addon.find = () => createQueryStub([
    { _id: addonId, price: 12, currency: "SAR", isActive: true, type: "subscription" },
  ]);

  const existingPayment = {
    _id: objectId(),
    id: "payment-addon-reuse",
    providerInvoiceId: "invoice-addon-reuse",
    status: "initiated",
    applied: false,
    amount: 1200,
    operationScope: "addon_topup",
    operationIdempotencyKey: "older-key",
    operationRequestHash: "addon-hash",
    metadata: {
      paymentUrl: "https://pay.test/addon-reuse",
      initiationResponseShape: "addon_credits_topup",
      totalHalala: 1200,
    },
  };

  const { req, res } = createReqRes({
    params: { id: String(subscriptionId) },
    userId,
    headers: { "Idempotency-Key": "newer-key" },
    body: { items: [{ addonId: String(addonId), qty: 1 }] },
  });

  await controller.topupAddonCredits(req, res, {
    buildOperationRequestHash: () => "addon-hash",
    async findPaymentByOperationKey() {
      return null;
    },
    async findReusableInitiatedPaymentByHash() {
      return existingPayment;
    },
    createInvoice: async () => {
      throw new Error("createInvoice should not be called on same-hash reuse");
    },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.data, {
    payment_url: "https://pay.test/addon-reuse",
    invoice_id: "invoice-addon-reuse",
    payment_id: "payment-addon-reuse",
    totalHalala: 1200,
  });
});

test("addOneTimeAddon reuses the same initiated payment and preserves response shape", async (t) => {
  const originalFlag = process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY;
  process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY = "true";
  t.after(() => {
    process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY = originalFlag;
  });

  const originalSubFindById = Subscription.findById;
  const originalAddonFindById = Addon.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  const originalSettingFindOne = Setting.findOne;
  t.after(() => {
    Subscription.findById = originalSubFindById;
    Addon.findById = originalAddonFindById;
    SubscriptionDay.findOne = originalDayFindOne;
    Setting.findOne = originalSettingFindOne;
  });

  const subscriptionId = objectId();
  const addonId = objectId();
  const userId = objectId();
  const addonDate = dateUtils.addDaysToKSADateString(dateUtils.getTomorrowKSADate(), 1);

  Subscription.findById = () => createQueryStub({
    _id: subscriptionId,
    userId,
    status: "active",
    planId: { _id: objectId() },
    endDate: new Date("2099-12-31T21:00:00.000Z"),
    validityEndDate: new Date("2099-12-31T21:00:00.000Z"),
  });
  Addon.findById = () => createQueryStub({
    _id: addonId,
    type: "one_time",
    isActive: true,
    price: 15,
    currency: "SAR",
    name: { ar: "سلطة", en: "Salad" },
  });
  SubscriptionDay.findOne = () => createQueryStub(null);
  Setting.findOne = () => createQueryStub({ value: "23:59" });

  const existingPayment = {
    _id: objectId(),
    id: "payment-addon-day-reuse",
    providerInvoiceId: "invoice-addon-day-reuse",
    status: "initiated",
    applied: false,
    amount: 1500,
    operationScope: "one_time_addon",
    operationIdempotencyKey: "day-addon-key",
    operationRequestHash: "day-addon-hash",
    metadata: {
      paymentUrl: "https://pay.test/day-addon-reuse",
      initiationResponseShape: "one_time_addon",
    },
  };

  const { req, res } = createReqRes({
    params: { id: String(subscriptionId) },
    userId,
    headers: { "Idempotency-Key": "day-addon-key" },
    body: { addonId: String(addonId), date: addonDate },
  });

  await controller.addOneTimeAddon(req, res, {
    buildOperationRequestHash: () => "day-addon-hash",
    compareIdempotentRequest: () => "reuse",
    async findPaymentByOperationKey() {
      return existingPayment;
    },
    async findReusableInitiatedPaymentByHash() {
      return null;
    },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.data, {
    payment_url: "https://pay.test/day-addon-reuse",
    invoice_id: "invoice-addon-day-reuse",
    payment_id: "payment-addon-day-reuse",
  });
});

test("legacy topupPremium persists operation metadata and reuses the legacy response shape cleanly", async (t) => {
  const originalFlag = process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY;
  process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY = "true";
  t.after(() => {
    process.env.PHASE1_NON_CHECKOUT_PAID_IDEMPOTENCY = originalFlag;
  });

  const originalSubFindById = Subscription.findById;
  const originalSettingFindOne = Setting.findOne;
  t.after(() => {
    Subscription.findById = originalSubFindById;
    Setting.findOne = originalSettingFindOne;
  });

  const subscriptionId = objectId();
  const userId = objectId();
  Subscription.findById = () => Promise.resolve({
    _id: subscriptionId,
    userId,
    status: "active",
  });
  Setting.findOne = () => createQueryStub({ value: 20 });

  let createPaymentPayload = null;
  const { req, res } = createReqRes({
    params: { id: String(subscriptionId) },
    userId,
    headers: { "Idempotency-Key": "legacy-premium-key" },
    body: { count: 2 },
  });

  await controller.topupPremium(req, res, {
    buildOperationRequestHash: () => "legacy-premium-hash",
    async findPaymentByOperationKey() {
      return null;
    },
    async findReusableInitiatedPaymentByHash() {
      return null;
    },
    createInvoice: async () => ({
      id: "invoice-legacy-premium",
      url: "https://pay.test/legacy-premium",
      currency: "SAR",
      metadata: { type: "premium_topup", subscriptionId: String(subscriptionId), premiumCount: 2 },
    }),
    async createPayment(payload) {
      createPaymentPayload = payload;
      return { id: "payment-legacy-premium" };
    },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.data, {
    payment_url: "https://pay.test/legacy-premium",
    invoice_id: "invoice-legacy-premium",
    payment_id: "payment-legacy-premium",
  });
  assert.equal(createPaymentPayload.operationScope, "premium_topup");
  assert.equal(createPaymentPayload.operationIdempotencyKey, "legacy-premium-key");
  assert.equal(createPaymentPayload.operationRequestHash, "legacy-premium-hash");
  assert.equal(createPaymentPayload.metadata.paymentUrl, "https://pay.test/legacy-premium");
  assert.equal(createPaymentPayload.metadata.initiationResponseShape, "legacy_premium_topup");
});
