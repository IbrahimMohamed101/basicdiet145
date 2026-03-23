const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const controller = require("../src/controllers/subscriptionController");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Plan = require("../src/models/Plan");
const PremiumMeal = require("../src/models/PremiumMeal");
const Setting = require("../src/models/Setting");

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
    lean() {
      return Promise.resolve(result);
    },
    populate() {
      return Promise.resolve(result);
    },
    session() {
      return Promise.resolve(result);
    },
    sort() {
      return this;
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

test("resolveCheckoutQuoteOrThrow uses premiumCount and generic premium pricing for canonical generic premium mode", async (t) => {
  const originalPlanFindOne = Plan.findOne;
  const originalPremiumFind = PremiumMeal.find;
  const originalAddonFind = require("../src/models/Addon").find;
  const originalSettingFindOne = Setting.findOne;
  const originalZoneFindById = require("../src/models/Zone").findById;
  
  t.after(() => {
    Plan.findOne = originalPlanFindOne;
    PremiumMeal.find = originalPremiumFind;
    require("../src/models/Addon").find = originalAddonFind;
    Setting.findOne = originalSettingFindOne;
    require("../src/models/Zone").findById = originalZoneFindById;
  });

  const planId = objectId();
  const zoneId = objectId();

  Plan.findOne = () => createQueryStub({
    _id: planId,
    isActive: true,
    currency: "SAR",
    daysCount: 5,
    name: { ar: "الخطة", en: "Plan" },
    gramsOptions: [{
      grams: 150,
      isActive: true,
      mealsOptions: [{ mealsPerDay: 3, priceHalala: 10000, isActive: true }],
    }],
  });
  
  require("../src/models/Zone").findById = () => createQueryStub({
    _id: zoneId,
    name: "Riyadh Center",
    deliveryFeeHalala: 1000,
    isActive: true
  });

  PremiumMeal.find = () => {
    throw new Error("PremiumMeal.find should not be used for generic premium quote mode");
  };
  require("../src/models/Addon").find = () => createQueryStub([]);
  Setting.findOne = ({ key }) => createQueryStub(
    key === "subscription_delivery_fee_halala"
      ? { value: 0 }
      : key === "vat_percentage"
        ? { value: 15 }
        : key === "premium_price"
          ? { value: 5 }
          : null
  );

  const quote = await controller.resolveCheckoutQuoteOrThrow(
    {
      planId: String(planId),
      grams: 150,
      mealsPerDay: 3,
      premiumCount: 2,
      delivery: {
        type: "delivery",
        zoneId: String(zoneId),
        address: { city: "Riyadh" },
        slot: { type: "delivery", window: "", slotId: "" },
      },
    },
    {
      lang: "en",
      useGenericPremiumWallet: true,
    }
  );

  assert.equal(quote.premiumWalletMode, "generic_v1");
  assert.equal(quote.premiumCount, 2);
  assert.equal(quote.premiumUnitPriceHalala, 500);
  assert.equal(quote.premiumItems.length, 0);
  assert.equal(quote.breakdown.premiumTotalHalala, 1000);
});

test("topupPremiumCredits normalizes generic premium topup items to a generic premium count for generic subscriptions", async (t) => {
  const originalSubFindById = Subscription.findById;
  const originalPremiumFind = PremiumMeal.find;
  const originalSettingFindOne = Setting.findOne;
  t.after(() => {
    Subscription.findById = originalSubFindById;
    PremiumMeal.find = originalPremiumFind;
    Setting.findOne = originalSettingFindOne;
  });

  const subscriptionId = objectId();
  const userId = objectId();
  Subscription.findById = () => Promise.resolve({
    _id: subscriptionId,
    userId,
    status: "active",
    premiumWalletMode: "generic_v1",
  });
  PremiumMeal.find = () => {
    throw new Error("PremiumMeal.find should not be used for generic premium topup compatibility bridge");
  };
  Setting.findOne = ({ key }) => createQueryStub(key === "premium_price" ? { value: 5 } : null);

  let createPaymentPayload = null;
  const { req, res } = createReqRes({
    params: { id: String(subscriptionId) },
    userId,
    body: {
      items: [
        { premiumMealId: String(objectId()), qty: 1 },
        { premiumMealId: String(objectId()), qty: 2 },
      ],
    },
  });

  await controller.topupPremiumCredits(req, res, {
    createInvoice: async (payload) => ({
      id: "invoice-generic-premium-topup",
      url: "https://pay.test/generic-premium-topup",
      currency: "SAR",
      metadata: payload.metadata,
    }),
    async createPayment(payload) {
      createPaymentPayload = payload;
      return { id: "payment-generic-premium-topup" };
    },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.data, {
    payment_url: "https://pay.test/generic-premium-topup",
    invoice_id: "invoice-generic-premium-topup",
    payment_id: "payment-generic-premium-topup",
    totalHalala: 1500,
  });
  assert.equal(createPaymentPayload.metadata.premiumWalletMode, "generic_v1");
  assert.equal(createPaymentPayload.metadata.premiumCount, 3);
  assert.equal(createPaymentPayload.metadata.unitCreditPriceHalala, 500);
  assert.equal("items" in createPaymentPayload.metadata, false);
});

test("consumePremiumSelection and removePremiumSelection use the generic premium wallet for generic subscriptions", async (t) => {
  const originalStartSession = mongoose.startSession;
  const originalSubFindById = Subscription.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  t.after(() => {
    mongoose.startSession = originalStartSession;
    Subscription.findById = originalSubFindById;
    SubscriptionDay.findOne = originalDayFindOne;
  });

  mongoose.startSession = async () => createSessionStub();

  const userId = objectId();
  const subscriptionId = objectId();
  const walletRowId = objectId();
  const premiumMealId = objectId();
  const targetDate = "2026-03-20";
  const subscription = {
    _id: subscriptionId,
    id: String(subscriptionId),
    userId,
    status: "active",
    startDate: new Date("2026-03-18T21:00:00.000Z"),
    endDate: new Date("2026-04-18T21:00:00.000Z"),
    validityEndDate: new Date("2026-04-18T21:00:00.000Z"),
    premiumWalletMode: "generic_v1",
    genericPremiumBalance: [{
      _id: walletRowId,
      purchasedQty: 2,
      remainingQty: 2,
      unitCreditPriceHalala: 500,
      currency: "SAR",
      purchasedAt: new Date("2026-03-18T10:00:00.000Z"),
    }],
    premiumRemaining: 2,
    premiumSelections: [],
    addonSelections: [],
    addonBalance: [],
    async save() {
      return this;
    },
  };
  const day = {
    _id: objectId(),
    subscriptionId,
    date: targetDate,
    status: "open",
    premiumUpgradeSelections: [],
    addonCreditSelections: [],
    selections: [objectId()],
    premiumSelections: [],
    async save() {
      return this;
    },
  };

  Subscription.findById = () => ({
    session() {
      return Promise.resolve(subscription);
    },
  });
  SubscriptionDay.findOne = () => ({
    session() {
      return Promise.resolve(day);
    },
  });

  const consumeReqRes = createReqRes({
    params: { id: String(subscriptionId) },
    userId,
    body: {
      date: targetDate,
      baseSlotKey: "slot-1",
      premiumMealId: String(premiumMealId),
    },
  });
  await controller.consumePremiumSelection(consumeReqRes.req, consumeReqRes.res);

  assert.equal(consumeReqRes.res.statusCode, 200);
  assert.equal(subscription.premiumRemaining, 1);
  assert.equal(subscription.premiumSelections.length, 1);
  assert.equal(subscription.premiumSelections[0].premiumWalletMode, "generic_v1");
  assert.equal(String(subscription.premiumSelections[0].premiumWalletRowId), String(walletRowId));

  const removeReqRes = createReqRes({
    params: { id: String(subscriptionId) },
    userId,
    body: {
      date: targetDate,
      baseSlotKey: "slot-1",
    },
  });
  await controller.removePremiumSelection(removeReqRes.req, removeReqRes.res);

  assert.equal(removeReqRes.res.statusCode, 200);
  assert.equal(subscription.premiumRemaining, 2);
  assert.equal(subscription.premiumSelections.length, 0);
  assert.equal(subscription.genericPremiumBalance[0].remainingQty, 2);
});

test("getSubscriptionWallet exposes generic premium wallet rows while keeping premiumRemaining as a compatibility mirror", async (t) => {
  const originalSubFindById = Subscription.findById;
  t.after(() => {
    Subscription.findById = originalSubFindById;
  });

  const subscriptionId = objectId();
  const userId = objectId();
  Subscription.findById = () => createQueryStub({
    _id: subscriptionId,
    userId,
    premiumWalletMode: "generic_v1",
    genericPremiumBalance: [{
      _id: objectId(),
      purchasedQty: 2,
      remainingQty: 2,
      unitCreditPriceHalala: 500,
      currency: "SAR",
      purchasedAt: new Date("2026-03-18T10:00:00.000Z"),
    }],
    premiumRemaining: 2,
    premiumSelections: [],
    addonBalance: [],
    addonSelections: [],
  });

  const { req, res } = createReqRes({
    params: { id: String(subscriptionId) },
    userId,
  });

  await controller.getSubscriptionWallet(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.premiumWalletMode, "generic_v1");
  assert.equal(res.payload.data.premiumRemaining, 2);
  assert.equal(res.payload.data.premiumSummary[0].remainingQtyTotal, 2);
  assert.equal(res.payload.data.premiumBalance[0].walletMode, "generic_v1");
});

test("grandfathered legacy subscriptions stay on legacy premium behavior even when the generic premium flag is enabled", async (t) => {
  const originalGenericFlag = process.env.PHASE2_GENERIC_PREMIUM_WALLET;
  process.env.PHASE2_GENERIC_PREMIUM_WALLET = "true";
  t.after(() => {
    process.env.PHASE2_GENERIC_PREMIUM_WALLET = originalGenericFlag;
  });

  const originalStartSession = mongoose.startSession;
  const originalSubFindById = Subscription.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  t.after(() => {
    mongoose.startSession = originalStartSession;
    Subscription.findById = originalSubFindById;
    SubscriptionDay.findOne = originalDayFindOne;
  });

  mongoose.startSession = async () => createSessionStub();

  const userId = objectId();
  const subscriptionId = objectId();
  const premiumMealId = objectId();
  const targetDate = "2026-03-20";
  const subscription = {
    _id: subscriptionId,
    id: String(subscriptionId),
    userId,
    status: "active",
    startDate: new Date("2026-03-18T21:00:00.000Z"),
    endDate: new Date("2026-04-18T21:00:00.000Z"),
    validityEndDate: new Date("2026-04-18T21:00:00.000Z"),
    premiumWalletMode: "legacy_itemized",
    premiumBalance: [],
    genericPremiumBalance: [],
    premiumRemaining: 0,
    premiumSelections: [],
    addonSelections: [],
    addonBalance: [],
    async save() {
      return this;
    },
  };
  const day = {
    _id: objectId(),
    subscriptionId,
    date: targetDate,
    status: "open",
    premiumUpgradeSelections: [],
    addonCreditSelections: [],
    selections: [objectId()],
    premiumSelections: [],
    async save() {
      return this;
    },
  };

  const topupResult = await controller.applyWalletTopupPayment({
    subscription,
    payment: {
      _id: objectId(),
      type: "premium_topup",
      amount: 1000,
      currency: "SAR",
      metadata: {
        subscriptionId: String(subscriptionId),
        premiumWalletMode: "generic_v1",
        premiumCount: 2,
        unitCreditPriceHalala: 500,
      },
    },
    session: { id: "legacy-topup-session" },
  });

  assert.equal(topupResult.applied, true);
  assert.equal(subscription.premiumWalletMode, "legacy_itemized");
  assert.equal(subscription.genericPremiumBalance.length, 0);
  assert.equal(subscription.premiumBalance.length, 1);
  assert.equal(subscription.premiumRemaining, 2);

  Subscription.findById = () => ({
    session() {
      return Promise.resolve(subscription);
    },
  });
  SubscriptionDay.findOne = () => ({
    session() {
      return Promise.resolve(day);
    },
  });

  const consumeReqRes = createReqRes({
    params: { id: String(subscriptionId) },
    userId,
    body: {
      date: targetDate,
      baseSlotKey: "slot-legacy-1",
      premiumMealId: String(premiumMealId),
    },
  });
  await controller.consumePremiumSelection(consumeReqRes.req, consumeReqRes.res);

  assert.equal(consumeReqRes.res.statusCode, 200);
  assert.equal(subscription.premiumWalletMode, "legacy_itemized");
  assert.equal(subscription.genericPremiumBalance.length, 0);
  assert.equal(subscription.premiumSelections.length, 1);
  assert.equal(subscription.premiumSelections[0].premiumWalletMode, "legacy_itemized");
  assert.equal(subscription.premiumBalance[0].remainingQty, 1);

  const removeReqRes = createReqRes({
    params: { id: String(subscriptionId) },
    userId,
    body: {
      date: targetDate,
      baseSlotKey: "slot-legacy-1",
    },
  });
  await controller.removePremiumSelection(removeReqRes.req, removeReqRes.res);

  assert.equal(removeReqRes.res.statusCode, 200);
  assert.equal(subscription.premiumWalletMode, "legacy_itemized");
  assert.equal(subscription.genericPremiumBalance.length, 0);
  assert.equal(subscription.premiumSelections.length, 0);
  assert.equal(subscription.premiumBalance[0].remainingQty, 2);
  assert.equal(subscription.premiumRemaining, 2);
});
