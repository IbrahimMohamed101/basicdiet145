const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const menuController = require("../src/controllers/menuController");
const subscriptionController = require("../src/controllers/subscriptionController");
const Plan = require("../src/models/Plan");
const Meal = require("../src/models/Meal");
const PremiumMeal = require("../src/models/PremiumMeal");
const Addon = require("../src/models/Addon");
const Setting = require("../src/models/Setting");
const Zone = require("../src/models/Zone");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const Payment = require("../src/models/Payment");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createReqRes({ params = {}, query = {}, headers = {}, userId = objectId() } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
  );

  const req = {
    params,
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

function createQueryStub(result) {
  return {
    sort() {
      return this;
    },
    select() {
      return this;
    },
    populate() {
      return this;
    },
    skip() {
      return this;
    },
    limit() {
      return this;
    },
    session() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
}

test("getSubscriptionMenu respects query language and falls back safely for incomplete bilingual data", async (t) => {
  const originalPlanFind = Plan.find;
  const originalMealFind = Meal.find;
  const originalPremiumFind = PremiumMeal.find;
  const originalAddonFind = Addon.find;
  const originalSettingFindOne = Setting.findOne;
  const originalZoneFind = Zone.find;
  t.after(() => {
    Plan.find = originalPlanFind;
    Meal.find = originalMealFind;
    PremiumMeal.find = originalPremiumFind;
    Addon.find = originalAddonFind;
    Setting.findOne = originalSettingFindOne;
    Zone.find = originalZoneFind;
  });

  const planId = objectId();
  Plan.find = () => createQueryStub([
    {
      _id: planId,
      isActive: true,
      currency: "SAR",
      daysCount: 5,
      name: { ar: "الخطة الأساسية" },
      gramsOptions: [{
        grams: 150,
        isActive: true,
        mealsOptions: [{
          mealsPerDay: 3,
          priceHalala: 10000,
          compareAtHalala: 12000,
          isActive: true,
        }],
      }],
    },
  ]);
  Meal.find = () => createQueryStub([
    {
      _id: objectId(),
      name: { ar: "وجبة اليوم", en: "Meal of the Day" },
      description: { ar: "وجبة لذيذة", en: "Tasty meal" },
      imageUrl: "",
    },
  ]);
  PremiumMeal.find = () => createQueryStub([]);
  Addon.find = () => createQueryStub([]);
  Zone.find = () => createQueryStub([
    {
      _id: objectId(),
      name: "Al Malqa",
      deliveryFeeHalala: 1500,
      isActive: true,
    },
    {
      _id: objectId(),
      name: "Al Kharj",
      deliveryFeeHalala: 2000,
      isActive: false,
    },
  ]);
  Setting.findOne = ({ key }) => createQueryStub(
    key === "delivery_windows"
      ? { value: ["08:00-11:00"] }
      : key === "subscription_delivery_fee_halala"
        ? { value: 0 }
        : key === "pickup_locations"
          ? { value: [{ id: "pickup-1", name: { ar: "الفرع الرئيسي" } }] }
          : key === "custom_salad_base_price" || key === "custom_meal_base_price"
            ? { value: 0 }
            : null
  );

  const { req, res } = createReqRes({
    query: { lang: "en" },
    headers: { "accept-language": "ar-SA,ar;q=0.9" },
  });

  await menuController.getSubscriptionMenu(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.plans[0].name, "الخطة الأساسية");
  assert.equal(res.payload.data.flow.steps[0].title, "Subscription Packages");
  assert.equal(res.payload.data.delivery.methods[0].title, "Home Delivery");
  assert.equal(res.payload.data.delivery.methods[0].pricingMode, "zone_based");
  assert.equal(res.payload.data.delivery.methods[0].feeLabel, "Depends on area");
  assert.equal(res.payload.data.delivery.areas[0].name, "Al Malqa");
  assert.equal(res.payload.data.delivery.areas[0].feeLabel, "15 SAR");
  assert.equal(res.payload.data.delivery.areas[1].availability, "unavailable");
  assert.equal(res.payload.data.delivery.pickupLocations[0].name, "الفرع الرئيسي");
});

test("getSubscription localizes plan and recurring add-on names while keeping machine fields stable", async (t) => {
  const originalSnapshotReads = process.env.PHASE1_SNAPSHOT_FIRST_READS;
  const originalSubscriptionFindById = Subscription.findById;
  const originalAddonFind = Addon.find;
  const originalPremiumFind = PremiumMeal.find;
  process.env.PHASE1_SNAPSHOT_FIRST_READS = "true";
  t.after(() => {
    process.env.PHASE1_SNAPSHOT_FIRST_READS = originalSnapshotReads;
    Subscription.findById = originalSubscriptionFindById;
    Addon.find = originalAddonFind;
    PremiumMeal.find = originalPremiumFind;
  });

  const userId = objectId();
  const addonId = objectId();
  const subscriptionId = objectId();
  Subscription.findById = () => createQueryStub({
    _id: subscriptionId,
    userId,
    planId: objectId(),
    status: "active",
    deliveryMode: "delivery",
    deliveryAddress: { city: "Riyadh" },
    deliverySlot: { type: "delivery", window: "08:00-11:00", slotId: "slot-1" },
    selectedMealsPerDay: 3,
    premiumBalance: [],
    genericPremiumBalance: [],
    addonBalance: [],
    premiumSelections: [],
    addonSelections: [],
    addonSubscriptions: [{
      addonId,
      name: "اسم قديم",
      type: "subscription",
      category: "starter",
    }],
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractSnapshot: {
      plan: {
        planId: String(objectId()),
        planName: { ar: "الخطة الذهبية", en: "Gold Plan" },
        selectedGrams: 150,
        mealsPerDay: 3,
        totalMeals: 15,
      },
      delivery: {
        mode: "delivery",
        slot: { window: "08:00-11:00", slotId: "slot-1" },
      },
    },
  });
  Addon.find = () => createQueryStub([{ _id: addonId, name: { ar: "شوربة", en: "Soup" } }]);
  PremiumMeal.find = () => createQueryStub([]);

  const { req, res } = createReqRes({
    params: { id: String(subscriptionId) },
    headers: { "accept-language": "en-US,en;q=0.9" },
    userId,
  });

  await subscriptionController.getSubscription(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.status, "active");
  assert.equal(res.payload.data.statusLabel, "Active");
  assert.equal(res.payload.data.planName, "Gold Plan");
  assert.equal(res.payload.data.deliveryMode, "delivery");
  assert.equal(res.payload.data.deliveryModeLabel, "Delivery");
  assert.equal(res.payload.data.addonSubscriptions[0].name, "Soup");
});

test("getCheckoutDraftStatus adds localized read labels without changing checkout state fields", async (t) => {
  const originalCheckoutDraftFindOne = CheckoutDraft.findOne;
  const originalPaymentFindOne = Payment.findOne;
  t.after(() => {
    CheckoutDraft.findOne = originalCheckoutDraftFindOne;
    Payment.findOne = originalPaymentFindOne;
  });

  const userId = objectId();
  const draftId = objectId();
  const paymentId = objectId();
  CheckoutDraft.findOne = () => createQueryStub({
    _id: draftId,
    userId,
    status: "pending_payment",
    paymentId,
    paymentUrl: "https://pay.test/checkout",
    breakdown: { totalHalala: 11500, currency: "SAR" },
    contractSnapshot: {
      plan: {
        planName: { ar: "الخطة الذهبية", en: "Gold Plan" },
      },
    },
    delivery: {
      type: "pickup",
      slot: { type: "pickup", window: "08:00-12:00", slotId: "pickup-1" },
    },
  });
  Payment.findOne = () => createQueryStub({
    _id: paymentId,
    userId,
    status: "initiated",
    amount: 11500,
    currency: "SAR",
    provider: "moyasar",
    applied: false,
  });

  const { req, res } = createReqRes({
    params: { draftId: String(draftId) },
    query: { lang: "ar" },
    userId,
  });

  await subscriptionController.getCheckoutDraftStatus(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.checkoutStatus, "pending_payment");
  assert.equal(res.payload.data.checkoutStatusLabel, "دفع معلق");
  assert.equal(res.payload.data.paymentStatus, "initiated");
  assert.equal(res.payload.data.paymentStatusLabel, "مبدئي");
  assert.equal(res.payload.data.planName, "الخطة الذهبية");
  assert.equal(res.payload.data.deliveryModeLabel, "استلام");
});

test("getSubscriptionTimeline keeps machine fields stable and adds localized labels", async (t) => {
  const originalSubscriptionFindById = Subscription.findById;
  const originalSubscriptionDayFind = SubscriptionDay.find;
  t.after(() => {
    Subscription.findById = originalSubscriptionFindById;
    SubscriptionDay.find = originalSubscriptionDayFind;
  });

  const userId = objectId();
  const subscriptionId = objectId();
  Subscription.findById = () => createQueryStub({
    _id: subscriptionId,
    userId,
    startDate: new Date("2026-03-19T21:00:00.000Z"),
    endDate: new Date("2026-03-22T21:00:00.000Z"),
    validityEndDate: new Date("2026-03-22T21:00:00.000Z"),
  });
  SubscriptionDay.find = () => createQueryStub([
    { date: "2026-03-21", status: "open" },
    { date: "2026-03-22", status: "fulfilled" },
  ]);

  const { req, res } = createReqRes({
    params: { id: String(subscriptionId) },
    headers: { "accept-language": "ar-SA" },
    userId,
  });

  await subscriptionController.getSubscriptionTimeline(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.days[0].status, "planned");
  assert.equal(res.payload.data.days[0].statusLabel, "مخطط");
  assert.equal(res.payload.data.days[0].source, "base");
  assert.equal(res.payload.data.days[0].sourceLabel, "أساسي");
});

test("getSubscriptionRenewalSeed adds localized display companions with safe fallback", async () => {
  const userId = objectId();
  const subscriptionId = objectId();
  const planId = objectId();
  const { req, res } = createReqRes({
    params: { id: String(subscriptionId) },
    headers: { "accept-language": "en-US,en;q=0.9" },
    userId,
  });

  await subscriptionController.getSubscriptionRenewalSeed(req, res, {
    async findSubscriptionById() {
      return {
        _id: subscriptionId,
        userId,
        planId,
        contractSnapshot: {
          plan: {
            planId: String(planId),
            planName: { ar: "خطة سابقة", en: "Previous Plan" },
            selectedGrams: 150,
            mealsPerDay: 3,
            daysCount: 10,
          },
          delivery: {
            mode: "pickup",
            slot: { type: "pickup", window: "08:00-11:00", slotId: "pickup-1" },
          },
        },
      };
    },
    async findActivePlanById() {
      return {
        _id: planId,
        isActive: true,
        name: { ar: "الخطة الذهبية" },
        daysCount: 10,
        gramsOptions: [
          {
            grams: 150,
            isActive: true,
            mealsOptions: [{ mealsPerDay: 3, isActive: true }],
          },
        ],
      };
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.seed.planId, String(planId));
  assert.equal(res.payload.data.seed.planName, "الخطة الذهبية");
  assert.equal(res.payload.data.seed.daysLabel, "10 Days");
  assert.equal(res.payload.data.seed.mealsPerDayLabel, "3 meals/day");
  assert.equal(res.payload.data.seed.deliveryPreference.mode, "pickup");
  assert.equal(res.payload.data.seed.deliveryPreference.modeLabel, "Pickup");
});

test("getSubscriptionWallet localizes balance row names without changing wallet machine fields", async (t) => {
  const originalSubscriptionFindById = Subscription.findById;
  const originalAddonFind = Addon.find;
  const originalPremiumFind = PremiumMeal.find;
  t.after(() => {
    Subscription.findById = originalSubscriptionFindById;
    Addon.find = originalAddonFind;
    PremiumMeal.find = originalPremiumFind;
  });

  const userId = objectId();
  const subscriptionId = objectId();
  const addonId = objectId();
  Subscription.findById = () => createQueryStub({
    _id: subscriptionId,
    userId,
    premiumWalletMode: "generic_v1",
    genericPremiumBalance: [{
      _id: objectId(),
      purchasedQty: 2,
      remainingQty: 1,
      unitCreditPriceHalala: 500,
      currency: "SAR",
      purchasedAt: new Date("2026-03-18T10:00:00.000Z"),
    }],
    addonBalance: [{
      _id: objectId(),
      addonId,
      purchasedQty: 2,
      remainingQty: 1,
      unitPriceHalala: 300,
      currency: "SAR",
      purchasedAt: new Date("2026-03-18T10:00:00.000Z"),
    }],
    premiumSelections: [],
    addonSelections: [],
  });
  Addon.find = () => createQueryStub([{ _id: addonId, name: { ar: "شوربة", en: "Soup" } }]);
  PremiumMeal.find = () => createQueryStub([]);

  const { req, res } = createReqRes({
    params: { id: String(subscriptionId) },
    query: { lang: "en" },
    userId,
  });

  await subscriptionController.getSubscriptionWallet(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.premiumWalletMode, "generic_v1");
  assert.equal(res.payload.data.premiumBalance[0].name, "Premium credits");
  assert.equal(res.payload.data.addonBalance[0].name, "Soup");
});

test("wallet history and top-up status read endpoints localize labels while preserving machine fields", async (t) => {
  const originalSubscriptionFindById = Subscription.findById;
  const originalPaymentFind = Payment.find;
  const originalPaymentFindOne = Payment.findOne;
  const originalAddonFind = Addon.find;
  const originalPremiumFind = PremiumMeal.find;
  t.after(() => {
    Subscription.findById = originalSubscriptionFindById;
    Payment.find = originalPaymentFind;
    Payment.findOne = originalPaymentFindOne;
    Addon.find = originalAddonFind;
    PremiumMeal.find = originalPremiumFind;
  });

  const userId = objectId();
  const subscriptionId = objectId();
  const paymentId = objectId();
  const addonId = objectId();
  const subscription = {
    _id: subscriptionId,
    userId,
    premiumBalance: [],
    addonBalance: [],
    premiumSelections: [],
    addonSelections: [],
  };
  const payment = {
    _id: paymentId,
    userId,
    subscriptionId,
    type: "addon_topup",
    status: "paid",
    amount: 600,
    currency: "SAR",
    applied: true,
    createdAt: new Date("2026-03-20T09:00:00.000Z"),
    metadata: {
      items: [{ addonId: String(addonId), qty: 2, unitPriceHalala: 300, currency: "SAR" }],
    },
  };

  Subscription.findById = () => createQueryStub(subscription);
  Payment.find = () => createQueryStub([payment]);
  Payment.findOne = () => createQueryStub(payment);
  Addon.find = () => createQueryStub([{ _id: addonId, name: { ar: "شوربة", en: "Soup" } }]);
  PremiumMeal.find = () => createQueryStub([]);

  const history = createReqRes({
    params: { id: String(subscriptionId) },
    query: { lang: "ar" },
    userId,
  });
  await subscriptionController.getSubscriptionWalletHistory(history.req, history.res);

  assert.equal(history.res.statusCode, 200);
  assert.equal(history.res.payload.data.entries[0].walletType, "addon");
  assert.equal(history.res.payload.data.entries[0].walletTypeLabel, "إضافة");
  assert.equal(history.res.payload.data.entries[0].source, "topup_payment");
  assert.equal(history.res.payload.data.entries[0].sourceLabel, "عملية شحن");
  assert.equal(history.res.payload.data.entries[0].name, "شوربة");

  const status = createReqRes({
    params: { id: String(subscriptionId), paymentId: String(paymentId) },
    headers: { "accept-language": "en" },
    userId,
  });
  await subscriptionController.getWalletTopupPaymentStatus(status.req, status.res);

  assert.equal(status.res.statusCode, 200);
  assert.equal(status.res.payload.data.walletType, "addon");
  assert.equal(status.res.payload.data.walletTypeLabel, "Add-on");
  assert.equal(status.res.payload.data.paymentStatus, "paid");
  assert.equal(status.res.payload.data.paymentStatusLabel, "Paid");
  assert.equal(status.res.payload.data.items[0].name, "Soup");
});

test("wallet history read endpoints honor query.lang over headers and fall back safely for unsupported languages", async (t) => {
  const originalSubscriptionFindById = Subscription.findById;
  const originalPaymentFind = Payment.find;
  const originalPaymentFindOne = Payment.findOne;
  const originalAddonFind = Addon.find;
  const originalPremiumFind = PremiumMeal.find;
  t.after(() => {
    Subscription.findById = originalSubscriptionFindById;
    Payment.find = originalPaymentFind;
    Payment.findOne = originalPaymentFindOne;
    Addon.find = originalAddonFind;
    PremiumMeal.find = originalPremiumFind;
  });

  const userId = objectId();
  const subscriptionId = objectId();
  const paymentId = objectId();
  const addonId = objectId();
  const subscription = {
    _id: subscriptionId,
    userId,
    premiumBalance: [],
    addonBalance: [],
    premiumSelections: [],
    addonSelections: [],
  };
  const payment = {
    _id: paymentId,
    userId,
    subscriptionId,
    type: "addon_topup",
    status: "paid",
    amount: 600,
    currency: "SAR",
    applied: true,
    createdAt: new Date("2026-03-20T09:00:00.000Z"),
    metadata: {
      items: [{ addonId: String(addonId), qty: 2, unitPriceHalala: 300, currency: "SAR" }],
    },
  };

  Subscription.findById = () => createQueryStub(subscription);
  Payment.find = () => createQueryStub([payment]);
  Payment.findOne = () => createQueryStub(payment);
  Addon.find = () => createQueryStub([{ _id: addonId, name: { ar: "شوربة", en: "Soup" } }]);
  PremiumMeal.find = () => createQueryStub([]);

  const history = createReqRes({
    params: { id: String(subscriptionId) },
    query: { lang: "en" },
    headers: { "accept-language": "ar-SA,ar;q=0.9" },
    userId,
  });
  await subscriptionController.getSubscriptionWalletHistory(history.req, history.res);

  assert.equal(history.res.statusCode, 200);
  assert.equal(history.res.payload.data.entries[0].source, "topup_payment");
  assert.equal(history.res.payload.data.entries[0].sourceLabel, "Top-up payment");
  assert.equal(history.res.payload.data.entries[0].walletType, "addon");
  assert.equal(history.res.payload.data.entries[0].walletTypeLabel, "Add-on");
  assert.equal(history.res.payload.data.entries[0].status, "paid");
  assert.equal(history.res.payload.data.entries[0].statusLabel, "Paid");
  assert.equal(history.res.payload.data.entries[0].name, "Soup");

  const status = createReqRes({
    params: { id: String(subscriptionId), paymentId: String(paymentId) },
    query: { lang: "fr" },
    headers: { "accept-language": "de-DE,de;q=0.9" },
    userId,
  });
  await subscriptionController.getWalletTopupPaymentStatus(status.req, status.res);

  assert.equal(status.res.statusCode, 200);
  assert.equal(status.res.payload.data.walletType, "addon");
  assert.equal(status.res.payload.data.walletTypeLabel, "إضافة");
  assert.equal(status.res.payload.data.paymentStatus, "paid");
  assert.equal(status.res.payload.data.paymentStatusLabel, "مدفوع");
  assert.equal(status.res.payload.data.items[0].name, "شوربة");
});

test("getSubscriptionDay localizes current day read content and keeps machine fields unchanged", async (t) => {
  const originalPlanningFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  const originalSubscriptionFindById = Subscription.findById;
  const originalSubscriptionDayFindOne = SubscriptionDay.findOne;
  const originalAddonFind = Addon.find;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPlanningFlag;
    Subscription.findById = originalSubscriptionFindById;
    SubscriptionDay.findOne = originalSubscriptionDayFindOne;
    Addon.find = originalAddonFind;
  });

  const userId = objectId();
  const subscriptionId = objectId();
  const recurringAddonId = objectId();
  const oneTimeAddonId = objectId();
  const dayDate = "2026-03-25";

  Subscription.findById = () => createQueryStub({
    _id: subscriptionId,
    userId,
    status: "active",
    selectedMealsPerDay: 1,
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
    addonSubscriptions: [{
      addonId: recurringAddonId,
      name: "اسم قديم",
      type: "subscription",
      category: "starter",
      entitlementMode: "daily_recurring",
      maxPerDay: 1,
    }],
  });
  SubscriptionDay.findOne = () => createQueryStub({
    _id: objectId(),
    subscriptionId,
    date: dayDate,
    status: "open",
    selections: [objectId()],
    premiumSelections: [],
    oneTimeAddonSelections: [{
      addonId: oneTimeAddonId,
      name: "اسم قديم",
      category: "dessert",
    }],
    oneTimeAddonPendingCount: 1,
    oneTimeAddonPaymentStatus: "pending",
    customMeals: [{
      items: [{ name_ar: "دجاج", name_en: "Chicken", quantity: 1 }],
    }],
    customSalads: [{
      items: [{ name_ar: "خيار", name_en: "Cucumber", quantity: 1 }],
    }],
  });
  Addon.find = () => createQueryStub([
    { _id: recurringAddonId, name: { ar: "شوربة", en: "Soup" } },
    { _id: oneTimeAddonId, name: { ar: "كوكي", en: "Cookie" } },
  ]);

  const { req, res } = createReqRes({
    params: { id: String(subscriptionId), date: dayDate },
    query: { lang: "en" },
    userId,
  });

  await subscriptionController.getSubscriptionDay(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.status, "open");
  assert.equal(res.payload.data.statusLabel, "Open");
  assert.equal(res.payload.data.recurringAddons[0].name, "Soup");
  assert.equal(res.payload.data.oneTimeAddonSelections[0].name, "Cookie");
  assert.equal(res.payload.data.oneTimeAddonPaymentStatus, "pending");
  assert.equal(res.payload.data.oneTimeAddonPaymentStatusLabel, "Pending");
  assert.equal(res.payload.data.planning.state, "draft");
  assert.equal(res.payload.data.planning.stateLabel, "Draft");
  assert.equal(res.payload.data.customMeals[0].items[0].name, "Chicken");
  assert.equal(res.payload.data.customSalads[0].items[0].name, "Cucumber");
});
