const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const controller = require("../src/controllers/subscriptionController");
const Plan = require("../src/models/Plan");
const Addon = require("../src/models/Addon");
const PremiumMeal = require("../src/models/PremiumMeal");
const Zone = require("../src/models/Zone");
const Setting = require("../src/models/Setting");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const Payment = require("../src/models/Payment");
const Subscription = require("../src/models/Subscription");
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
    sort() {
      return query;
    },
    select() {
      return query;
    },
    populate() {
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

function getFutureDate(daysAhead = 2) {
  const base = new Date(`${getTomorrowKSADate()}T00:00:00+03:00`);
  base.setDate(base.getDate() + (daysAhead - 1));
  return toKSADateString(base);
}

function createPlan({ _id = objectId(), daysCount }) {
  return {
    _id,
    currency: "SAR",
    isActive: true,
    daysCount,
    gramsOptions: [
      {
        grams: 150,
        isActive: true,
        mealsOptions: [
          {
            mealsPerDay: 3,
            isActive: true,
            priceHalala: 10000,
          },
        ],
      },
    ],
  };
}

function installPricingModelStubs(t, { plans, addons, premiumMeals = [], vatPercentage = 0 }) {
  const originalPlanFindOne = Plan.findOne;
  const originalAddonFind = Addon.find;
  const originalPremiumMealFind = PremiumMeal.find;
  const originalZoneFindById = Zone.findById;
  const originalSettingFindOne = Setting.findOne;

  t.after(() => {
    Plan.findOne = originalPlanFindOne;
    Addon.find = originalAddonFind;
    PremiumMeal.find = originalPremiumMealFind;
    Zone.findById = originalZoneFindById;
    Setting.findOne = originalSettingFindOne;
  });

  const planMap = new Map(plans.map((plan) => [String(plan._id), plan]));
  const addonMap = new Map(addons.map((addon) => [String(addon._id), addon]));
  const premiumMap = new Map(premiumMeals.map((premiumMeal) => [String(premiumMeal._id), premiumMeal]));

  Plan.findOne = (query = {}) => createQueryStub(planMap.get(String(query._id)) || null);
  Addon.find = (query = {}) => {
    const requestedIds = query && query._id && Array.isArray(query._id.$in)
      ? query._id.$in.map((id) => String(id))
      : Array.from(addonMap.keys());
    const rows = requestedIds
      .map((id) => addonMap.get(id))
      .filter((row) => row && row.isActive !== false);
    return createQueryStub(rows);
  };
  PremiumMeal.find = (query = {}) => {
    const requestedIds = query && query._id && Array.isArray(query._id.$in)
      ? query._id.$in.map((id) => String(id))
      : Array.from(premiumMap.keys());
    const rows = requestedIds
      .map((id) => premiumMap.get(id))
      .filter((row) => row && row.isActive !== false);
    return createQueryStub(rows);
  };
  Zone.findById = () => createQueryStub(null);
  Setting.findOne = ({ key }) => createQueryStub(
    key === "vat_percentage"
      ? { value: vatPercentage }
      : key === "delivery_windows"
        ? { value: [] }
        : key === "pickup_locations"
          ? { value: [] }
          : key === "premium_price"
            ? { value: 20 }
            : null
  );
}

function disableCheckoutFlags(t) {
  const originalCanonicalWrite = process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;
  const originalGenericPremium = process.env.PHASE2_GENERIC_PREMIUM_WALLET;

  delete process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE;
  delete process.env.PHASE2_GENERIC_PREMIUM_WALLET;

  t.after(() => {
    process.env.PHASE1_CANONICAL_CHECKOUT_DRAFT_WRITE = originalCanonicalWrite;
    process.env.PHASE2_GENERIC_PREMIUM_WALLET = originalGenericPremium;
  });
}

function buildPickupBody({ planId, addons = [], premiumItems = [] }) {
  return {
    planId: String(planId),
    grams: 150,
    mealsPerDay: 3,
    startDate: getFutureDate(3),
    premiumItems,
    addons,
    delivery: {
      type: "pickup",
      address: { branch: "Olaya" },
      slot: { type: "pickup", window: "09:00 - 12:00", slotId: "pickup-1" },
    },
  };
}

test("quoteSubscription accepts premiumItems objects plus recurring add-on ids and exposes daily UI labels", async (t) => {
  const plan = createPlan({ daysCount: 10 });
  const addonId = objectId();
  const premiumMealId = objectId();
  installPricingModelStubs(t, {
    plans: [plan],
    premiumMeals: [{
      _id: premiumMealId,
      isActive: true,
      currency: "SAR",
      name: { en: "Citrus Herb Salmon" },
      extraFeeHalala: 2500,
    }],
    addons: [{
      _id: addonId,
      isActive: true,
      currency: "SAR",
      type: "subscription",
      category: "juice",
      name: { en: "Daily Green Juice" },
      priceHalala: 1200,
      price: 12,
    }],
  });

  const { req, res } = createReqRes({
    query: { lang: "en" },
    body: buildPickupBody({
      planId: plan._id,
      premiumItems: [{ premiumMealId: String(premiumMealId), qty: 2 }],
      addons: [String(addonId)],
    }),
  });

  await controller.quoteSubscription(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.breakdown.premiumTotalHalala, 5000);
  assert.equal(res.payload.data.breakdown.addonsTotalHalala, 12000);
  assert.equal(res.payload.data.breakdown.totalHalala, 27000);
  assert.equal(res.payload.data.summary.premiumItems[0].qty, 2);
  assert.equal(res.payload.data.summary.addons[0].qty, 1);
  assert.equal(res.payload.data.summary.addons[0].pricingModel, "daily_recurring");
  assert.equal(res.payload.data.summary.addons[0].billingUnit, "day");
  assert.equal(res.payload.data.summary.addons[0].durationDays, 10);
  assert.equal(res.payload.data.summary.addons[0].unitPriceHalala, 1200);
  assert.equal(res.payload.data.summary.addons[0].unitPriceLabel, "12 SAR / day");
  assert.equal(res.payload.data.summary.addons[0].formulaLabel, "12 SAR/day × 10 days");
  assert.equal(res.payload.data.summary.addons[0].totalHalala, 12000);
  assert.equal(res.payload.data.summary.lineItems.find((item) => item.kind === "addons").amountHalala, 12000);
});

test("resolveCheckoutQuoteOrThrow updates recurring add-on totals when the plan changes from 10 to 20 days", async (t) => {
  const plan10 = createPlan({ daysCount: 10 });
  const plan20 = createPlan({ daysCount: 20 });
  const addonId = objectId();
  installPricingModelStubs(t, {
    plans: [plan10, plan20],
    addons: [{
      _id: addonId,
      isActive: true,
      currency: "SAR",
      type: "subscription",
      category: "juice",
      name: { en: "Daily Green Juice" },
      priceHalala: 1200,
      price: 12,
    }],
  });

  const quote10 = await controller.resolveCheckoutQuoteOrThrow(buildPickupBody({
    planId: plan10._id,
    addons: [String(addonId)],
  }), { lang: "en" });
  const quote20 = await controller.resolveCheckoutQuoteOrThrow(buildPickupBody({
    planId: plan20._id,
    addons: [String(addonId)],
  }), { lang: "en" });

  assert.equal(quote10.breakdown.addonsTotalHalala, 12000);
  assert.equal(quote20.breakdown.addonsTotalHalala, 24000);
});

test("resolveCheckoutQuoteOrThrow sums multiple recurring add-ons using plan days when multiple ids are selected", async (t) => {
  const plan = createPlan({ daysCount: 20 });
  const juiceId = objectId();
  const coffeeId = objectId();
  installPricingModelStubs(t, {
    plans: [plan],
    addons: [
      {
        _id: juiceId,
        isActive: true,
        currency: "SAR",
        type: "subscription",
        category: "juice",
        name: { en: "Daily Green Juice" },
        priceHalala: 1200,
        price: 12,
      },
      {
        _id: coffeeId,
        isActive: true,
        currency: "SAR",
        type: "subscription",
        category: "coffee",
        name: { en: "Daily Black Coffee" },
        priceHalala: 900,
        price: 9,
      },
    ],
  });

  const quote = await controller.resolveCheckoutQuoteOrThrow(buildPickupBody({
    planId: plan._id,
    addons: [String(juiceId), String(coffeeId)],
  }), { lang: "en" });

  assert.equal(quote.addonItems.length, 2);
  assert.equal(quote.addonItems[0].qty, 1);
  assert.equal(quote.addonItems[1].qty, 1);
  assert.equal(quote.breakdown.addonsTotalHalala, 42000);
  assert.equal(quote.breakdown.totalHalala, 52000);
});

test("resolveCheckoutQuoteOrThrow normalizes duplicate recurring add-on ids safely", async (t) => {
  const plan = createPlan({ daysCount: 20 });
  const addonId = objectId();
  installPricingModelStubs(t, {
    plans: [plan],
    addons: [{
      _id: addonId,
      isActive: true,
      currency: "SAR",
      type: "subscription",
      category: "juice",
      name: { en: "Daily Green Juice" },
      priceHalala: 1200,
      price: 12,
    }],
  });

  const quote = await controller.resolveCheckoutQuoteOrThrow(buildPickupBody({
    planId: plan._id,
    addons: [String(addonId), String(addonId), String(addonId)],
  }), { lang: "en" });

  assert.equal(quote.addonItems.length, 1);
  assert.equal(quote.addonItems[0].qty, 1);
  assert.equal(quote.breakdown.addonsTotalHalala, 24000);
  assert.equal(quote.breakdown.totalHalala, 34000);
});

test("quoteSubscription rejects invalid recurring add-on ids in the purchase contract", async (t) => {
  const plan = createPlan({ daysCount: 10 });
  installPricingModelStubs(t, {
    plans: [plan],
    addons: [],
  });

  const { req, res } = createReqRes({
    query: { lang: "en" },
    body: buildPickupBody({
      planId: plan._id,
      addons: ["not-an-object-id"],
    }),
  });

  await controller.quoteSubscription(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error.code, "VALIDATION_ERROR");
  assert.match(res.payload.error.message, /addonId/i);
});

test("checkoutSubscription accepts premiumItems objects plus recurring add-on ids and restored draft totals remain consistent", async (t) => {
  disableCheckoutFlags(t);

  const plan = createPlan({ daysCount: 10 });
  const addonId = objectId();
  const premiumMealId = objectId();
  installPricingModelStubs(t, {
    plans: [plan],
    premiumMeals: [{
      _id: premiumMealId,
      isActive: true,
      currency: "SAR",
      name: { en: "Citrus Herb Salmon" },
      extraFeeHalala: 2500,
    }],
    addons: [{
      _id: addonId,
      isActive: true,
      currency: "SAR",
      type: "subscription",
      category: "juice",
      name: { en: "Daily Green Juice" },
      priceHalala: 1200,
      price: 12,
    }],
  });

  const originalCheckoutDraftFindOne = CheckoutDraft.findOne;
  const originalCheckoutDraftCreate = CheckoutDraft.create;
  const originalPaymentFindById = Payment.findById;
  const originalPaymentFindOne = Payment.findOne;
  const originalPaymentCreate = Payment.create;

  t.after(() => {
    CheckoutDraft.findOne = originalCheckoutDraftFindOne;
    CheckoutDraft.create = originalCheckoutDraftCreate;
    Payment.findById = originalPaymentFindById;
    Payment.findOne = originalPaymentFindOne;
    Payment.create = originalPaymentCreate;
  });

  let createdDraft = null;
  let createdPayment = null;
  let createdInvoicePayload = null;

  CheckoutDraft.findOne = () => createQueryStub(null);
  CheckoutDraft.create = async (payload) => {
    createdDraft = createDraftRecord(payload);
    return createdDraft;
  };
  Payment.findById = () => createQueryStub(null);
  Payment.create = async (payload) => {
    createdPayment = createPaymentRecord(payload);
    return createdPayment;
  };

  const userId = objectId();
  const { req, res } = createReqRes({
    userId,
    query: { lang: "en" },
    body: {
      ...buildPickupBody({
        planId: plan._id,
        premiumItems: [{ premiumMealId: String(premiumMealId), qty: 2 }],
        addons: [String(addonId)],
      }),
      idempotencyKey: "recurring-addon-checkout",
    },
  });

  await controller.checkoutSubscription(req, res, {
    createInvoice: async (payload) => {
      createdInvoicePayload = payload;
      return {
        id: "invoice-recurring-addon-checkout",
        url: "https://pay.test/recurring-addon-checkout",
        currency: "SAR",
        metadata: payload.metadata,
      };
    },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.data.totals.premiumTotalHalala, 5000);
  assert.equal(res.payload.data.totals.addonsTotalHalala, 12000);
  assert.equal(createdDraft.breakdown.premiumTotalHalala, 5000);
  assert.equal(createdDraft.breakdown.addonsTotalHalala, 12000);
  assert.equal(createdDraft.premiumItems[0].qty, 2);
  assert.equal(createdDraft.addonItems[0].unitPriceHalala, 1200);
  assert.equal(createdDraft.addonItems[0].qty, 1);
  assert.equal(createdDraft.addonSubscriptions[0].price, 12);
  assert.equal(createdDraft.addonSubscriptions[0].maxPerDay, 1);
  assert.equal(createdInvoicePayload.amount, 27000);

  CheckoutDraft.findOne = () => createQueryStub(createdDraft);
  Payment.findOne = () => createQueryStub(createdPayment);

  const { req: statusReq, res: statusRes } = createReqRes({
    params: { draftId: String(createdDraft._id) },
    query: { lang: "en" },
    userId,
  });

  await controller.getCheckoutDraftStatus(statusReq, statusRes);

  assert.equal(statusRes.statusCode, 200);
  assert.equal(statusRes.payload.data.totals.premiumTotalHalala, 5000);
  assert.equal(statusRes.payload.data.totals.addonsTotalHalala, 12000);
  assert.equal(statusRes.payload.data.totals.totalHalala, 27000);
});

test("renewSubscription accepts premiumItems objects plus recurring add-on ids and keeps daily pricing aligned", async (t) => {
  disableCheckoutFlags(t);

  const plan = createPlan({ daysCount: 20 });
  const addonId = objectId();
  const premiumMealId = objectId();
  installPricingModelStubs(t, {
    plans: [plan],
    premiumMeals: [{
      _id: premiumMealId,
      isActive: true,
      currency: "SAR",
      name: { en: "Citrus Herb Salmon" },
      extraFeeHalala: 2500,
    }],
    addons: [{
      _id: addonId,
      isActive: true,
      currency: "SAR",
      type: "subscription",
      category: "juice",
      name: { en: "Daily Green Juice" },
      priceHalala: 1200,
      price: 12,
    }],
  });

  const originalSubscriptionFindById = Subscription.findById;
  const originalCheckoutDraftFindOne = CheckoutDraft.findOne;
  const originalCheckoutDraftCreate = CheckoutDraft.create;
  const originalPaymentFindById = Payment.findById;
  const originalPaymentCreate = Payment.create;

  t.after(() => {
    Subscription.findById = originalSubscriptionFindById;
    CheckoutDraft.findOne = originalCheckoutDraftFindOne;
    CheckoutDraft.create = originalCheckoutDraftCreate;
    Payment.findById = originalPaymentFindById;
    Payment.create = originalPaymentCreate;
  });

  const userId = objectId();
  const previousSubscriptionId = objectId();
  let createdDraft = null;
  let createdInvoicePayload = null;

  Subscription.findById = () => createQueryStub({
    _id: previousSubscriptionId,
    userId,
    planId: plan._id,
    selectedGrams: 150,
    selectedMealsPerDay: 3,
    deliveryMode: "pickup",
    deliveryAddress: { branch: "Olaya" },
    deliverySlot: { type: "pickup", window: "09:00 - 12:00", slotId: "pickup-1" },
    validityEndDate: new Date("2020-01-01T00:00:00+03:00"),
    endDate: new Date("2020-01-01T00:00:00+03:00"),
  });
  CheckoutDraft.findOne = () => createQueryStub(null);
  CheckoutDraft.create = async (payload) => {
    createdDraft = createDraftRecord(payload);
    return createdDraft;
  };
  Payment.findById = () => createQueryStub(null);
  Payment.create = async (payload) => createPaymentRecord(payload);

  const { req, res } = createReqRes({
    params: { id: String(previousSubscriptionId) },
    userId,
    query: { lang: "en" },
    body: {
      idempotencyKey: "renew-recurring-addon",
      premiumItems: [{ premiumMealId: String(premiumMealId), qty: 2 }],
      addons: [String(addonId)],
    },
  });

  await controller.renewSubscription(req, res, {
    createInvoice: async (payload) => {
      createdInvoicePayload = payload;
      return {
        id: "invoice-renew-recurring-addon",
        url: "https://pay.test/renew-recurring-addon",
        currency: "SAR",
        metadata: payload.metadata,
      };
    },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.data.totals.premiumTotalHalala, 5000);
  assert.equal(res.payload.data.totals.addonsTotalHalala, 24000);
  assert.equal(res.payload.data.totals.totalHalala, 39000);
  assert.equal(createdDraft.premiumItems[0].qty, 2);
  assert.equal(createdDraft.addonItems[0].qty, 1);
  assert.equal(createdDraft.breakdown.addonsTotalHalala, 24000);
  assert.equal(createdDraft.addonSubscriptions[0].price, 12);
  assert.equal(createdDraft.addonSubscriptions[0].maxPerDay, 1);
  assert.equal(createdInvoicePayload.amount, 39000);
});
