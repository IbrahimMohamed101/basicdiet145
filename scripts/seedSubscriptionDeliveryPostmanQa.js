"use strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";

require("dotenv").config();

const mongoose = require("mongoose");
const request = require("supertest");
const jwt = require("jsonwebtoken");

const { createApp } = require("../src/app");
const Addon = require("../src/models/Addon");
const CatalogItem = require("../src/models/CatalogItem");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const DashboardUser = require("../src/models/DashboardUser");
const Delivery = require("../src/models/Delivery");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const Payment = require("../src/models/Payment");
const Plan = require("../src/models/Plan");
const Order = require("../src/models/Order");
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");
const PromoCode = require("../src/models/PromoCode");
const PromoUsage = require("../src/models/PromoUsage");
const Setting = require("../src/models/Setting");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const User = require("../src/models/User");
const Zone = require("../src/models/Zone");
const { hashAppPassword } = require("../src/services/appPasswordService");
const { hashDashboardPassword } = require("../src/services/dashboardPasswordService");
const { finalizeSubscriptionDraftPaymentFlow } = require("../src/services/subscription/subscriptionActivationService");
const dateUtils = require("../src/utils/date");

const TAG = "postman-subscription-delivery-qa";
const CLIENT_PHONE = "+966500145145";
const CLIENT_PASSWORD = "Client12345";
const ADMIN_EMAIL = "postman-subscription-delivery-qa-admin@example.com";
const ADMIN_PASSWORD = "PostmanAdmin@123";
const DELIVERY_SLOT_ID = "delivery_slot_1";
const DELIVERY_WINDOW = "12:00-14:00";
const BRANCH_ID = "branch_postman_qa_main";

function parseArgs(argv) {
  const args = { reset: true, date: process.env.POSTMAN_TEST_DATE || dateUtils.getTodayKSADate() };
  for (const arg of argv) {
    if (arg === "--no-reset") args.reset = false;
    if (arg.startsWith("--date=")) args.date = arg.slice("--date=".length);
  }
  return args;
}

function getMongoUri() {
  return process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test";
}

function assertSafeDatabase(uri) {
  if (process.env.ALLOW_SUBSCRIPTION_DELIVERY_QA_SEED === "true") return;
  const lower = String(uri || "").toLowerCase();
  const safe = lower.includes("localhost")
    || lower.includes("127.0.0.1")
    || lower.includes("basicdiet_test")
    || lower.includes("test")
    || lower.includes("dev");
  if (!safe) {
    throw new Error("Refusing to seed a non-local/non-test database. Set ALLOW_SUBSCRIPTION_DELIVERY_QA_SEED=true to override intentionally.");
  }
}

async function connect() {
  const uri = getMongoUri();
  assertSafeDatabase(uri);
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
}

function appAuth(userId) {
  return {
    Authorization: `Bearer ${jwt.sign(
      { userId: String(userId), role: "client", tokenType: "app_access" },
      process.env.JWT_SECRET || "supersecret",
      { expiresIn: "31d" }
    )}`,
    "Accept-Language": "en",
  };
}

async function cleanup() {
  const taggedUsers = await User.find({
    $or: [{ phone: CLIENT_PHONE }, { phoneE164: CLIENT_PHONE }, { name: { $regex: TAG } }],
  }).select("_id").lean();
  const userIds = taggedUsers.map((user) => user._id);
  const taggedPlans = await Plan.find({ key: { $regex: `^${TAG}` } }).select("_id").lean();
  const planIds = taggedPlans.map((plan) => plan._id);
  const taggedSubs = await Subscription.find({
    $or: [{ userId: { $in: userIds } }, { planId: { $in: planIds } }, { "deliveryAddress.notes": TAG }],
  }).select("_id").lean();
  const subIds = taggedSubs.map((sub) => sub._id);
  const taggedOrders = await Order.find({ orderNumber: { $regex: `^${TAG}` } }).select("_id").lean();
  const orderIds = taggedOrders.map((order) => order._id);

  await Promise.all([
    Delivery.deleteMany({ subscriptionId: { $in: subIds } }),
    Delivery.deleteMany({ orderId: { $in: orderIds } }),
    SubscriptionPickupRequest.deleteMany({ $or: [{ userId: { $in: userIds } }, { subscriptionId: { $in: subIds } }] }),
    SubscriptionDay.deleteMany({ subscriptionId: { $in: subIds } }),
    CheckoutDraft.deleteMany({ $or: [{ userId: { $in: userIds } }, { planId: { $in: planIds } }] }),
    Payment.deleteMany({ $or: [{ userId: { $in: userIds } }, { subscriptionId: { $in: subIds } }] }),
    Subscription.deleteMany({ _id: { $in: subIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
    DashboardUser.deleteMany({ email: ADMIN_EMAIL }),
    Zone.deleteMany({ "name.en": "Postman QA Riyadh" }),
    Zone.deleteMany({ "name.en": "Postman QA Inactive District" }),
    Addon.deleteMany({ "name.en": { $regex: "Postman QA" } }),
    MenuProduct.deleteMany({ key: { $regex: `^${TAG}` } }),
    MenuCategory.deleteMany({ key: `${TAG}-meals` }),
    CatalogItem.deleteMany({ key: { $regex: `^${TAG}` } }),
    Order.deleteMany({ orderNumber: { $regex: `^${TAG}` } }),
    Delivery.deleteMany({ cancellationNote: TAG }),
    PromoUsage.deleteMany({ code: { $regex: "^PMQA" } }),
    PromoCode.deleteMany({ codeNormalized: { $regex: "^PMQA" } }),
    PremiumUpgradeConfig.deleteMany({ premiumKey: { $regex: `^${TAG}` } }),
  ]);
}

async function upsertSettings() {
  await Setting.updateOne(
    { key: "pickup_locations" },
    {
      $set: {
        value: [{
          id: BRANCH_ID,
          locationId: BRANCH_ID,
          name: { ar: "فرع بوستمان", en: "Postman QA Main Branch" },
          address: {
            ar: "شارع العليا، الرياض",
            en: "Olaya QA Street, Riyadh",
            line1: { ar: "شارع العليا، الرياض", en: "Olaya QA Street, Riyadh" },
            street: "Olaya QA Street",
            city: "Riyadh",
            district: "Olaya",
          },
          workingHours: "08:00-22:00",
          isActive: true,
        }],
      },
    },
    { upsert: true }
  );
  await Setting.updateOne(
    { key: "delivery_windows" },
    { $set: { value: [DELIVERY_WINDOW] } },
    { upsert: true }
  );
  await Setting.updateOne({ key: "restaurant_open_time" }, { $set: { value: "00:00" } }, { upsert: true });
  await Setting.updateOne({ key: "restaurant_close_time" }, { $set: { value: "23:59" } }, { upsert: true });
  await Setting.updateOne({ key: "restaurant_is_open" }, { $set: { value: true } }, { upsert: true });
}

async function seedAccounts() {
  const user = await User.create({
    phone: CLIENT_PHONE,
    phoneE164: CLIENT_PHONE,
    phoneVerified: true,
    passwordHash: await hashAppPassword(CLIENT_PASSWORD),
    passwordSetAt: new Date(),
    name: `${TAG} customer`,
    role: "client",
    isActive: true,
  });

  const admin = await DashboardUser.create({
    email: ADMIN_EMAIL,
    role: "admin",
    isActive: true,
    passwordHash: await hashDashboardPassword(ADMIN_PASSWORD),
    failedAttempts: 0,
    lockUntil: null,
  });

  return { user, admin };
}

async function seedPlanZoneMealsAddons() {
  const plan = await Plan.create({
    key: `${TAG}-plan`,
    name: { ar: "خطة بوستمان QA", en: "Postman QA Subscription Plan" },
    description: { en: "Local/dev plan for subscription delivery QA" },
    daysCount: 6,
    durationDays: 7,
    currency: "SAR",
    gramsOptions: [{
      grams: 200,
      isActive: true,
      mealsOptions: [
        { mealsPerDay: 2, priceHalala: 60000, compareAtHalala: 65000, isActive: true },
        { mealsPerDay: 3, priceHalala: 80000, compareAtHalala: 85000, isActive: true },
      ],
    }],
    isActive: true,
  });

  const zone = await Zone.create({
    name: { ar: "منطقة بوستمان QA", en: "Postman QA Riyadh" },
    deliveryFeeHalala: 1000,
    isActive: true,
    sortOrder: 1,
  });

  await Zone.create({
    name: { ar: "منطقة بوستمان غير نشطة", en: "Postman QA Inactive District" },
    deliveryFeeHalala: 1500,
    isActive: false,
    sortOrder: 99,
  });

  const category = await MenuCategory.create({
    key: `${TAG}-meals`,
    name: { ar: "وجبات QA", en: "Postman QA Meals" },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: new Date(),
  });

  const meals = [];
  for (let index = 1; index <= 3; index += 1) {
    const key = `${TAG}-meal-${index}`;
    const catalogItem = await CatalogItem.create({
      key,
      itemKind: "product",
      nameI18n: { ar: `وجبة بوستمان ${index}`, en: `Postman QA Meal ${index}` },
      isActive: true,
      isAvailable: true,
    });
    const product = await MenuProduct.create({
      categoryId: category._id,
      catalogItemId: catalogItem._id,
      key,
      name: { ar: `وجبة بوستمان ${index}`, en: `Postman QA Meal ${index}` },
      itemType: "product",
      priceHalala: 0,
      availableFor: ["subscription"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
      sortOrder: index,
    });
    meals.push(product);
  }

  const addon = await Addon.create({
    name: { ar: "عصير بوستمان QA", en: "Postman QA Juice Add-on" },
    priceHalala: 0,
    kind: "item",
    category: "juice",
    isActive: true,
    isArchived: false,
  });

  return { plan, zone, meals, addon };
}

async function seedSupplementalDashboardQaData({ user, plan, zone, meals, addon, today, subscriptionIds }) {
  await Subscription.updateMany(
    { _id: { $in: subscriptionIds.map((id) => new mongoose.Types.ObjectId(id)) } },
    {
      $set: {
        premiumBalance: [{
          premiumKey: `${TAG}-premium-chicken`,
          purchasedQty: 4,
          remainingQty: 3,
          unitExtraFeeHalala: 1200,
          currency: "SAR",
          purchasedAt: new Date(),
        }],
        addonBalance: [{
          addonId: addon._id,
          name: addon.name,
          category: addon.category,
          purchasedDailyQty: 1,
          includedTotalQty: 6,
          purchasedQty: 6,
          consumedQty: 1,
          reservedQty: 1,
          remainingQty: 4,
          unitPriceHalala: 0,
          currency: "SAR",
          purchasedAt: new Date(),
        }],
      },
    }
  );

  await PremiumUpgradeConfig.create({
    sourceType: "menu_product",
    sourceId: meals[2]._id,
    sourceProductId: meals[2]._id,
    selectionType: "premium_meal",
    premiumKey: `${TAG}-premium-meal-3`,
    displayGroupKey: "premium",
    upgradeDeltaHalala: 1200,
    currency: "SAR",
    isEnabled: true,
    isVisible: true,
    status: "active",
    sourceSnapshot: { key: meals[2].key, name: meals[2].name, context: { tag: TAG } },
  });

  const archiveConflictPromo = await PromoCode.create({
    code: "PMQAARCHIVECONFLICT",
    title: "Postman QA Archive Conflict",
    description: TAG,
    appliesTo: "subscription",
    discountType: "percentage",
    discountValue: 10,
    usageLimitTotal: 10,
    currentUsageCount: 1,
    isActive: true,
    metadata: { tag: TAG, qaIssue: 21, expectedArchiveResult: "PROMO_IN_USE" },
  });
  await PromoUsage.create({
    promoCodeId: archiveConflictPromo._id,
    userId: user._id,
    subscriptionId: subscriptionIds[0],
    code: archiveConflictPromo.code,
    discountAmountHalala: 5000,
    status: "consumed",
    consumedAt: new Date(),
    metadata: { tag: TAG, qaIssue: 21 },
  });
  const archiveSafePromo = await PromoCode.create({
    code: "PMQAARCHIVESAFE",
    title: "Postman QA Archive Safe",
    description: TAG,
    appliesTo: "subscription",
    discountType: "fixed",
    discountValue: 2500,
    currentUsageCount: 0,
    isActive: true,
    metadata: { tag: TAG, qaIssue: 21, expectedArchiveResult: "archived" },
  });

  const statuses = ["pending_payment", "confirmed", "in_preparation", "out_for_delivery", "fulfilled", "cancelled"];
  for (const [index, status] of statuses.entries()) {
    const order = await Order.create({
      orderNumber: `${TAG}-order-${index + 1}`,
      userId: user._id,
      status,
      paymentStatus: status === "pending_payment" ? "initiated" : "paid",
      fulfillmentMethod: "delivery",
      fulfillmentDate: today,
      deliveryMode: "delivery",
      deliveryDate: today,
      items: [{
        itemType: "product",
        productId: meals[index % meals.length]._id,
        name: meals[index % meals.length].name,
        qty: 1,
        unitPriceHalala: 2500,
        lineTotalHalala: 2500,
      }],
      pricing: {
        subtotalHalala: 2500,
        deliveryFeeHalala: 1000,
        totalHalala: 3500,
        currency: "SAR",
      },
      delivery: {
        zoneId: zone._id,
        zoneName: zone.name,
        deliveryFeeHalala: 1000,
        address: { line1: "Postman QA Order St", city: "Riyadh", notes: TAG },
      },
      deliveryAddress: { line1: "Postman QA Order St", city: "Riyadh", notes: TAG },
      deliveryWindow: DELIVERY_WINDOW,
      idempotencyKey: `${TAG}-order-${index + 1}`,
      confirmedAt: status !== "pending_payment" ? new Date() : undefined,
      preparationStartedAt: status === "in_preparation" ? new Date() : undefined,
      dispatchedAt: status === "out_for_delivery" ? new Date() : undefined,
      fulfilledAt: status === "fulfilled" ? new Date() : undefined,
      canceledAt: status === "cancelled" ? new Date() : undefined,
      cancellationNote: status === "cancelled" ? TAG : undefined,
    });

    const deliveryStatus = status === "fulfilled"
      ? "delivered"
      : status === "out_for_delivery"
        ? "out_for_delivery"
        : status === "cancelled"
          ? "canceled"
          : status === "in_preparation"
            ? "ready_for_delivery"
            : "scheduled";
    await Delivery.create({
      orderId: order._id,
      date: today,
      status: deliveryStatus,
      address: { line1: "Postman QA Order St", city: "Riyadh", notes: TAG },
      window: DELIVERY_WINDOW,
      cancellationNote: TAG,
      deliveredAt: deliveryStatus === "delivered" ? new Date() : undefined,
      canceledAt: deliveryStatus === "canceled" ? new Date() : undefined,
    });
  }

  const actionableCourierOrder = await Order.create({
    orderNumber: `${TAG}-courier-actionable-order`,
    userId: user._id,
    status: "out_for_delivery",
    paymentStatus: "paid",
    fulfillmentMethod: "delivery",
    fulfillmentDate: today,
    deliveryMode: "delivery",
    deliveryDate: today,
    items: [{
      itemType: "product",
      productId: meals[0]._id,
      name: meals[0].name,
      qty: 1,
      unitPriceHalala: 2500,
      lineTotalHalala: 2500,
    }],
    pricing: {
      subtotalHalala: 2500,
      deliveryFeeHalala: 1000,
      totalHalala: 3500,
      currency: "SAR",
    },
    delivery: {
      zoneId: zone._id,
      zoneName: zone.name,
      deliveryFeeHalala: 1000,
      address: { line1: "Postman QA Actionable Courier St", city: "Riyadh", notes: TAG },
    },
    deliveryAddress: { line1: "Postman QA Actionable Courier St", city: "Riyadh", notes: TAG },
    deliveryWindow: DELIVERY_WINDOW,
    idempotencyKey: `${TAG}-courier-actionable-order`,
    confirmedAt: new Date(),
    preparationStartedAt: new Date(),
    dispatchedAt: new Date(),
    metadata: { tag: TAG, qaIssue: 22 },
  });
  const actionableCourierDelivery = await Delivery.create({
    orderId: actionableCourierOrder._id,
    date: today,
    status: "out_for_delivery",
    address: { line1: "Postman QA Actionable Courier St", city: "Riyadh", notes: TAG },
    window: DELIVERY_WINDOW,
  });

  return {
    archiveSafePromo,
    archiveConflictPromo,
    actionableCourierOrder,
    actionableCourierDelivery,
  };
}

function checkoutPayload({ plan, zone, startDate, override = false, mealsPerDay = 2, idempotencyKey }) {
  const delivery = {
    type: "delivery",
    address: { street: "Postman QA Delivery Street", city: "Riyadh", district: "Olaya", notes: TAG },
    zoneId: String(zone._id),
    slot: { slotId: DELIVERY_SLOT_ID, window: DELIVERY_WINDOW },
  };
  if (override) {
    delivery.firstDayFulfillmentOverride = {
      type: "pickup",
      pickupLocationId: BRANCH_ID,
    };
  }
  return {
    planId: String(plan._id),
    grams: 200,
    mealsPerDay,
    startDate,
    delivery,
    idempotencyKey,
  };
}

async function activateDraft({ draftId, userId, paymentType }) {
  const draft = await CheckoutDraft.findById(draftId);
  if (!draft) throw new Error(`Draft not found: ${draftId}`);
  const payment = await Payment.create({
    userId,
    draftId: draft._id,
    type: paymentType,
    amount: draft.breakdown.totalHalala,
    currency: draft.currency || "SAR",
    status: "paid",
    provider: "moyasar",
    providerInvoiceId: `${TAG}-${draft._id}`,
    paidAt: new Date(),
  });
  const result = await finalizeSubscriptionDraftPaymentFlow({ draft, payment }, null);
  if (!result.applied) throw new Error(`Draft finalization failed: ${result.reason}`);
  return String(result.subscriptionId);
}

async function createCheckoutSubscription({ api, user, payload, paymentType = "subscription_activation" }) {
  const res = await api.post("/api/subscriptions/checkout").set(appAuth(user._id)).send(payload);
  if (res.status !== 201) throw new Error(`Checkout failed ${res.status}: ${JSON.stringify(res.body)}`);
  const subscriptionId = await activateDraft({ draftId: res.body.data.draftId, userId: user._id, paymentType });
  return { subscriptionId, checkout: res.body };
}

async function createExpiredSubscription({ user, plan, zone, label, today }) {
  const startDate = dateUtils.addDaysToKSADateString(today, -14);
  const endDate = dateUtils.addDaysToKSADateString(today, -8);
  return Subscription.create({
    userId: user._id,
    planId: plan._id,
    contractMode: "canonical",
    status: "active",
    startDate: new Date(`${startDate}T00:00:00+03:00`),
    endDate: new Date(`${endDate}T00:00:00+03:00`),
    validityEndDate: new Date(`${endDate}T00:00:00+03:00`),
    totalMeals: 12,
    remainingMeals: 0,
    selectedGrams: 200,
    selectedMealsPerDay: 2,
    deliveryMode: "delivery",
    deliveryAddress: { street: `${label} Old Delivery St`, city: "Riyadh", notes: TAG },
    deliveryWindow: DELIVERY_WINDOW,
    deliverySlot: { type: "delivery", window: DELIVERY_WINDOW, slotId: DELIVERY_SLOT_ID },
    deliveryZoneId: zone._id,
  });
}

function mealSlot(product, index) {
  return {
    slotIndex: index,
    slotKey: `slot_${index}`,
    status: "complete",
    selectionType: "standard_meal",
    productId: product._id,
    productKey: product.key,
    isPremium: false,
    premiumSource: "none",
    confirmationSnapshot: {
      product: { id: String(product._id), key: product.key, name: product.name },
    },
  };
}

async function ensureDayFixture({ subscriptionId, date, requiredMeals, selectedProducts = [], status = "open", label }) {
  const slots = selectedProducts.map((product, index) => mealSlot(product, index + 1));
  const day = await SubscriptionDay.findOneAndUpdate(
    { subscriptionId, date },
    {
      $set: {
        subscriptionId,
        date,
        status,
        plannerState: slots.length ? "confirmed" : "draft",
        planningState: slots.length ? "confirmed" : "draft",
        mealSlots: slots,
        materializedMeals: slots.map((slot) => ({
          slotKey: slot.slotKey,
          selectionType: slot.selectionType,
          operationalSku: slot.productKey,
          isPremium: false,
          premiumSource: "none",
        })),
        plannerMeta: {
          requiredSlotCount: requiredMeals,
          emptySlotCount: Math.max(0, requiredMeals - slots.length),
          completeSlotCount: slots.length,
          partialSlotCount: 0,
          isDraftValid: slots.length === requiredMeals,
          isConfirmable: slots.length === requiredMeals,
          confirmedAt: slots.length ? new Date() : null,
          confirmedByRole: slots.length ? "client" : null,
        },
        planningMeta: {
          requiredMealCount: requiredMeals,
          selectedTotalMealCount: slots.length,
          isExactCountSatisfied: slots.length === requiredMeals,
          confirmedAt: slots.length ? new Date() : null,
          confirmedByRole: slots.length ? "client" : null,
        },
        qaLabel: label,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return day;
}

async function createOperationalSubscription({ user, plan, zone, today }) {
  const subscription = await Subscription.create({
    userId: user._id,
    planId: plan._id,
    contractMode: "canonical",
    status: "active",
    startDate: new Date(`${today}T00:00:00+03:00`),
    endDate: new Date(`${dateUtils.addDaysToKSADateString(today, 6)}T00:00:00+03:00`),
    validityEndDate: new Date(`${dateUtils.addDaysToKSADateString(today, 10)}T00:00:00+03:00`),
    totalMeals: 12,
    remainingMeals: 12,
    selectedGrams: 200,
    selectedMealsPerDay: 2,
    deliveryMode: "delivery",
    deliveryAddress: { street: "Postman QA Ops Delivery St", city: "Riyadh", notes: TAG },
    deliveryWindow: DELIVERY_WINDOW,
    deliverySlot: { type: "delivery", window: DELIVERY_WINDOW, slotId: DELIVERY_SLOT_ID },
    deliveryZoneId: zone._id,
  });
  return subscription;
}

function firstDay(subscription) {
  return SubscriptionDay.find({ subscriptionId: subscription._id || subscription }).sort("date").limit(2).lean();
}

function stringify(value) {
  return value === undefined || value === null ? "" : String(value);
}

function testsScriptSetJson(name, expression) {
  return `pm.test("${name}", function () {\n  pm.expect(${expression}).to.exist;\n});`;
}

function printPack(data) {
  const env = {
    baseUrl: process.env.BASE_URL || "http://localhost:5000/api",
    clientPhone: CLIENT_PHONE,
    clientPassword: CLIENT_PASSWORD,
    clientToken: "",
    adminPhone: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
    adminToken: "",
    customerId: stringify(data.user._id),
    planId: stringify(data.plan._id),
    zoneId: stringify(data.zone._id),
    branchId: BRANCH_ID,
    deliverySlotId: DELIVERY_SLOT_ID,
    deliveryWindow: DELIVERY_WINDOW,
    today: data.today,
    tomorrow: data.tomorrow,
    futureDate: data.futureDate,
    subscriptionId_pickupOverride: data.ids.pickupOverride,
    subscriptionId_deliveryOnly: data.ids.deliveryOnly,
    subscriptionId_renewalPickup: data.ids.renewalPickup,
    subscriptionId_renewalDeliveryOnly: data.ids.renewalDeliveryOnly,
    subscriptionId_futureDeliveryOnly: data.ids.futureDeliveryOnly,
    expiredSubscriptionId_forRenewalPickup: data.ids.expiredRenewalPickupSource,
    expiredSubscriptionId_forRenewalDeliveryOnly: data.ids.expiredRenewalDeliverySource,
    subscriptionId_cutoffNone: data.ids.cutoffNone,
    subscriptionId_cutoffPartial: data.ids.cutoffPartial,
    subscriptionId_cutoffFull: data.ids.cutoffFull,
    subscriptionId_operational: data.ids.operational,
    day1Date: data.today,
    day2Date: data.tomorrow,
    pickupRequestId: "",
    mealSlotId1: stringify(data.meals[0]._id),
    mealSlotId2: stringify(data.meals[1]._id),
    mealSlotId3: stringify(data.meals[2]._id),
    operationalDayId: data.ids.operationalDay,
    cutoffNoneDayId: data.ids.cutoffNoneDay,
    cutoffPartialDayId: data.ids.cutoffPartialDay,
    cutoffFullDayId: data.ids.cutoffFullDay,
    promoId_archiveSafe: data.ids.archiveSafePromo,
    promoCode_archiveSafe: "PMQAARCHIVESAFE",
    promoId_archiveConflict: data.ids.archiveConflictPromo,
    promoCode_archiveConflict: "PMQAARCHIVECONFLICT",
    actionableCourierOrderId: data.ids.actionableCourierOrder,
    actionableCourierDeliveryId: data.ids.actionableCourierDelivery,
    actionableCourierSubscriptionId: data.ids.actionableCourierSubscription,
    actionableCourierSubscriptionDayId: data.ids.actionableCourierSubscriptionDay,
    actionableCourierSubscriptionDeliveryId: data.ids.actionableCourierSubscriptionDelivery,
    addonId: stringify(data.addon._id),
  };

  const lines = [];
  lines.push("1. Summary");
  lines.push("Seeded a local/dev Postman data pack for subscription delivery QA. Checkout and renewal scenarios were created through the real API and activated with local paid Payment records. Cutoff and operational rows were seeded directly because they are state fixtures for dashboard verification.");
  lines.push("");
  lines.push("2. Test data table");
  lines.push("| Item | Value |");
  lines.push("| --- | --- |");
  lines.push(`| Customer | ${data.user.name} / ${CLIENT_PHONE} / id ${data.user._id} |`);
  lines.push(`| Customer password | ${CLIENT_PASSWORD} (local/dev only) |`);
  lines.push(`| Dashboard admin | ${ADMIN_EMAIL} / id ${data.admin._id} / role admin |`);
  lines.push(`| Admin password | ${ADMIN_PASSWORD} (local/dev only) |`);
  lines.push(`| Plan | ${data.plan._id} / grams 200 / mealsPerDay 2,3 / daysCount 6 / durationDays 7 |`);
  lines.push(`| Zone | ${data.zone._id} / Postman QA Riyadh / active true |`);
  lines.push(`| Delivery slot | ${DELIVERY_SLOT_ID} / ${DELIVERY_WINDOW} |`);
  lines.push(`| Pickup branch | ${BRANCH_ID} / Postman QA Main Branch / active true / Olaya QA Street, Riyadh / 08:00-22:00 |`);
  data.meals.forEach((meal, index) => lines.push(`| Meal ${index + 1} | ${meal._id} / key ${meal.key} / ${meal.name.en} |`));
  lines.push(`| Add-on | ${data.addon._id} / Postman QA Juice Add-on / does not participate in delivery/pickup mode logic |`);
  lines.push(`| Issue #21 archive-safe promo | ${data.ids.archiveSafePromo} / PMQAARCHIVESAFE / currentUsageCount 0 / DELETE should soft archive |`);
  lines.push(`| Issue #21 in-use promo | ${data.ids.archiveConflictPromo} / PMQAARCHIVECONFLICT / currentUsageCount 1 / DELETE should return 409 PROMO_IN_USE |`);
  lines.push(`| Issue #22 actionable courier subscription delivery | subscription ${data.ids.actionableCourierSubscription} / day ${data.ids.actionableCourierSubscriptionDay} / delivery ${data.ids.actionableCourierSubscriptionDelivery} / out_for_delivery / allowedActions arriving_soon, delivered, cancel |`);
  lines.push(`| Issue #22 actionable courier order | order ${data.ids.actionableCourierOrder} / delivery ${data.ids.actionableCourierDelivery} / out_for_delivery / allowedActions arriving_soon, delivered, cancel |`);
  lines.push("");
  lines.push("3. Postman environment variables");
  lines.push("```txt");
  for (const [key, value] of Object.entries(env)) lines.push(`${key}=${value}`);
  lines.push("```");
  lines.push("");
  lines.push("4. Request-by-request runbook");
  lines.push("Run from top to bottom. For checkout requests, use the Tests scripts below to overwrite subscription variables with newly created IDs if you want fresh runs instead of the seeded subscriptions.");
  lines.push("");
  lines.push("Customer login");
  lines.push("```http\nPOST {{baseUrl}}/auth/login\nContent-Type: application/json\n```");
  lines.push("```json\n{\n  \"phoneE164\": \"{{clientPhone}}\",\n  \"password\": \"{{clientPassword}}\"\n}\n```");
  lines.push("");
  lines.push("Dashboard login");
  lines.push("```http\nPOST {{baseUrl}}/dashboard/auth/login\nContent-Type: application/json\n```");
  lines.push("```json\n{\n  \"email\": \"{{adminPhone}}\",\n  \"password\": \"{{adminPassword}}\"\n}\n```");
  lines.push("");
  lines.push("Scenario 1: new subscription today + first-day pickup override");
  lines.push("```http\nPOST {{baseUrl}}/subscriptions/checkout\nAuthorization: Bearer {{clientToken}}\nContent-Type: application/json\n```");
  lines.push("```json");
  lines.push(JSON.stringify(checkoutPayload({ plan: data.plan, zone: data.zone, startDate: "{{today}}", override: true, idempotencyKey: "postman-s1-{{$timestamp}}" }), null, 2));
  lines.push("```");
  lines.push("If the response is a draft, complete payment through your configured provider or use the pre-activated seeded id `{{subscriptionId_pickupOverride}}` for the rest of the scenario.");
  lines.push("```http\nGET {{baseUrl}}/subscriptions/{{subscriptionId_pickupOverride}}/timeline\nAuthorization: Bearer {{clientToken}}\n```");
  lines.push("```http\nGET {{baseUrl}}/subscriptions/{{subscriptionId_pickupOverride}}/days/{{day1Date}}/fulfillment/status\nAuthorization: Bearer {{clientToken}}\n```");
  lines.push("```http\nGET {{baseUrl}}/subscriptions/{{subscriptionId_pickupOverride}}/pickup-availability?date={{day1Date}}\nAuthorization: Bearer {{clientToken}}\n```");
  lines.push("```http\nPOST {{baseUrl}}/subscriptions/{{subscriptionId_pickupOverride}}/pickup-requests\nAuthorization: Bearer {{clientToken}}\nContent-Type: application/json\n```");
  lines.push("```json\n{ \"date\": \"{{day1Date}}\", \"mealCount\": 1, \"idempotencyKey\": \"pickup-s1-{{$timestamp}}\" }\n```");
  lines.push("```http\nGET {{baseUrl}}/subscriptions/{{subscriptionId_pickupOverride}}/pickup-requests/{{pickupRequestId}}/status\nAuthorization: Bearer {{clientToken}}\n```");
  lines.push("```http\nGET {{baseUrl}}/subscriptions/{{subscriptionId_pickupOverride}}/pickup-availability?date={{day2Date}}\nAuthorization: Bearer {{clientToken}}\n```");
  lines.push("```http\nPOST {{baseUrl}}/subscriptions/{{subscriptionId_pickupOverride}}/pickup-requests\nAuthorization: Bearer {{clientToken}}\nContent-Type: application/json\n```");
  lines.push("```json\n{ \"date\": \"{{day2Date}}\", \"mealCount\": 1, \"idempotencyKey\": \"pickup-s1-day2-{{$timestamp}}\" }\n```");
  lines.push("```http\nGET {{baseUrl}}/dashboard/courier/queue?date={{day1Date}}&method=delivery&view=legacy\nAuthorization: Bearer {{adminToken}}\n```");
  lines.push("");
  lines.push("Scenario 2: new subscription today + delivery only");
  lines.push("```http\nPOST {{baseUrl}}/subscriptions/checkout\nAuthorization: Bearer {{clientToken}}\nContent-Type: application/json\n```");
  lines.push("```json");
  lines.push(JSON.stringify(checkoutPayload({ plan: data.plan, zone: data.zone, startDate: "{{today}}", override: false, idempotencyKey: "postman-s2-{{$timestamp}}" }), null, 2));
  lines.push("```");
  lines.push("Then verify seeded or newly activated `{{subscriptionId_deliveryOnly}}`:");
  lines.push("```http\nGET {{baseUrl}}/subscriptions/{{subscriptionId_deliveryOnly}}/timeline\nAuthorization: Bearer {{clientToken}}\n```");
  lines.push("```http\nGET {{baseUrl}}/dashboard/courier/queue?date={{today}}&method=delivery&view=legacy\nAuthorization: Bearer {{adminToken}}\n```");
  lines.push("");
  lines.push("Scenario 3: renewal today + first-day pickup override");
  lines.push("```http\nPOST {{baseUrl}}/subscriptions/{{expiredSubscriptionId_forRenewalPickup}}/renew\nAuthorization: Bearer {{clientToken}}\nContent-Type: application/json\n```");
  lines.push("```json");
  lines.push(JSON.stringify(checkoutPayload({ plan: data.plan, zone: data.zone, startDate: "{{today}}", override: true, idempotencyKey: "postman-s3-{{$timestamp}}" }), null, 2));
  lines.push("```");
  lines.push(`Seeded expired source id for reference: ${data.ids.expiredRenewalPickupSource}`);
  lines.push("Use seeded activated renewal id `{{subscriptionId_renewalPickup}}` for timeline, pickup availability, pickup request, and Day 2 rejection checks (same requests as Scenario 1 with this subscription id).");
  lines.push("");
  lines.push("Scenario 4: renewal today + delivery only");
  lines.push("```http\nPOST {{baseUrl}}/subscriptions/{{expiredSubscriptionId_forRenewalDeliveryOnly}}/renew\nAuthorization: Bearer {{clientToken}}\nContent-Type: application/json\n```");
  lines.push("```json");
  lines.push(JSON.stringify(checkoutPayload({ plan: data.plan, zone: data.zone, startDate: "{{today}}", override: false, idempotencyKey: "postman-s4-{{$timestamp}}" }), null, 2));
  lines.push("```");
  lines.push(`Seeded expired source id for reference: ${data.ids.expiredRenewalDeliverySource}`);
  lines.push("Verify `{{subscriptionId_renewalDeliveryOnly}}` timeline first day is `{{tomorrow}}`, fulfillmentMode is `delivery`, and no courier queue item exists for `{{today}}`.");
  lines.push("");
  lines.push("Scenario 5: future start date + delivery only");
  lines.push("```http\nPOST {{baseUrl}}/subscriptions/checkout\nAuthorization: Bearer {{clientToken}}\nContent-Type: application/json\n```");
  lines.push("```json");
  lines.push(JSON.stringify(checkoutPayload({ plan: data.plan, zone: data.zone, startDate: "{{futureDate}}", override: false, idempotencyKey: "postman-s5-{{$timestamp}}" }), null, 2));
  lines.push("```");
  lines.push("Verify `{{subscriptionId_futureDeliveryOnly}}` timeline first day is `{{futureDate}}`, fulfillmentMode is `delivery`, and no pickup override fields are present.");
  lines.push("");
  lines.push("Scenario 6: delivery cutoff + Chef Choice");
  lines.push("Run the timeline checks after 10:00 KSA for the 12:00-14:00 delivery window.");
  lines.push("```http\nGET {{baseUrl}}/subscriptions/{{subscriptionId_cutoffNone}}/timeline\nAuthorization: Bearer {{clientToken}}\n```");
  lines.push("```http\nGET {{baseUrl}}/dashboard/kitchen/queue?date={{today}}&view=legacy\nAuthorization: Bearer {{adminToken}}\n```");
  lines.push("Repeat both requests twice. Case A uses `{{subscriptionId_cutoffNone}}` and expects two Chef Choice slots. Case B uses `{{subscriptionId_cutoffPartial}}` and expects one customer meal plus two Chef Choice slots. Case C uses `{{subscriptionId_cutoffFull}}` and expects no Chef Choice slots.");
  lines.push("");
  lines.push("Scenario 7: operational delivery timeline");
  lines.push("Use seeded `{{subscriptionId_operational}}` and `{{today}}`.");
  lines.push("```http\nPOST {{baseUrl}}/kitchen/subscriptions/{{subscriptionId_operational}}/days/{{today}}/lock\nAuthorization: Bearer {{adminToken}}\n```");
  lines.push("```http\nPOST {{baseUrl}}/kitchen/subscriptions/{{subscriptionId_operational}}/days/{{today}}/in-preparation\nAuthorization: Bearer {{adminToken}}\n```");
  lines.push("```http\nPUT {{baseUrl}}/dashboard/operations/subscription-days/{{operationalDayId}}/ready-for-delivery\nAuthorization: Bearer {{adminToken}}\n```");
  lines.push("```http\nPOST {{baseUrl}}/dashboard/ops/actions/out_for_delivery\nAuthorization: Bearer {{adminToken}}\nContent-Type: application/json\n```");
  lines.push("```json\n{ \"entityType\": \"subscription_day\", \"entityId\": \"{{operationalDayId}}\" }\n```");
  lines.push("```http\nPOST {{baseUrl}}/dashboard/ops/actions/fulfill\nAuthorization: Bearer {{adminToken}}\nContent-Type: application/json\n```");
  lines.push("```json\n{ \"entityType\": \"subscription_day\", \"entityId\": \"{{operationalDayId}}\" }\n```");
  lines.push("After every transition call:");
  lines.push("```http\nGET {{baseUrl}}/subscriptions/{{subscriptionId_operational}}/timeline\nAuthorization: Bearer {{clientToken}}\n```");
  lines.push("");
  lines.push("Issue #21: promo archive fixtures");
  lines.push("```http\nDELETE {{baseUrl}}/admin/promo-codes/{{promoId_archiveSafe}}\nAuthorization: Bearer {{adminToken}}\n```");
  lines.push("Expected: 200 with `deletedAt` and `isActive: false`.");
  lines.push("```http\nDELETE {{baseUrl}}/admin/promo-codes/{{promoId_archiveConflict}}\nAuthorization: Bearer {{adminToken}}\n```");
  lines.push("Expected: 409 with error code `PROMO_IN_USE`.");
  lines.push("");
  lines.push("Issue #22: actionable courier order fixture");
  lines.push("```http\nGET {{baseUrl}}/courier/orders/today?date={{today}}\nAuthorization: Bearer {{adminToken}}\n```");
  lines.push("Find `{{actionableCourierOrderId}}`; it should expose executable `allowedActions` with PUT endpoints for arriving soon, delivered, and cancel when one-time delivery is enabled.");
  lines.push("```http\nGET {{baseUrl}}/courier/deliveries/today?date={{today}}\nAuthorization: Bearer {{adminToken}}\n```");
  lines.push("Find `{{actionableCourierSubscriptionDeliveryId}}`; it should expose executable `allowedActions` with PUT endpoints for arriving soon, delivered, and cancel in the currently deployed QA config.");
  lines.push("");
  lines.push("5. Tests tab scripts");
  lines.push("Customer login:");
  lines.push("```js\npm.test(\"customer login ok\", function () {\n  pm.response.to.have.status(200);\n  pm.expect(pm.response.json().accessToken).to.be.a(\"string\");\n});\npm.environment.set(\"clientToken\", pm.response.json().accessToken);\npm.environment.set(\"customerId\", pm.response.json().user.id || pm.response.json().user._id);\n```");
  lines.push("Dashboard login:");
  lines.push("```js\npm.test(\"admin login ok\", function () {\n  pm.response.to.have.status(200);\n  pm.expect(pm.response.json().token).to.be.a(\"string\");\n});\npm.environment.set(\"adminToken\", pm.response.json().token);\n```");
  lines.push("Checkout draft:");
  lines.push("```js\npm.test(\"checkout draft created\", function () {\n  pm.response.to.have.status(201);\n  const json = pm.response.json();\n  pm.expect(json.data.draftId).to.be.a(\"string\");\n  pm.expect(json.data.fulfillmentOptions).to.exist;\n});\npm.environment.set(\"checkoutDraftId\", pm.response.json().data.draftId);\n```");
  lines.push("Timeline Day 1 pickup / Day 2 delivery:");
  lines.push("```js\nconst days = pm.response.json().data.days;\nconst day1 = days.find(d => d.date === pm.environment.get(\"day1Date\"));\nconst day2 = days.find(d => d.date === pm.environment.get(\"day2Date\"));\npm.test(\"Day 1 is pickup override\", function () {\n  pm.expect(day1.fulfillmentMode).to.eql(\"pickup\");\n  pm.expect(day1.fulfillmentModeOverride || day1.fulfillmentOverride).to.eql(\"pickup\");\n  pm.expect(day1.pickupLocationIdOverride || day1.pickupLocationId).to.exist;\n});\npm.test(\"Day 2 is delivery\", function () {\n  pm.expect(day2.fulfillmentMode).to.eql(\"delivery\");\n  pm.expect(day2.fulfillmentModeOverride || null).to.eql(null);\n});\n```");
  lines.push("Pickup request created:");
  lines.push("```js\npm.test(\"pickup request created\", function () {\n  pm.response.to.have.status(200);\n  pm.expect(pm.response.json().data.requestId).to.be.a(\"string\");\n});\npm.environment.set(\"pickupRequestId\", pm.response.json().data.requestId);\n```");
  lines.push("INVALID_DELIVERY_MODE:");
  lines.push("```js\npm.test(\"rejects invalid pickup mode\", function () {\n  pm.expect([400, 422]).to.include(pm.response.code);\n  pm.expect(pm.response.json().error.code).to.eql(\"INVALID_DELIVERY_MODE\");\n});\n```");
  lines.push("Delivery-only shifted:");
  lines.push("```js\nconst days = pm.response.json().data.days;\npm.test(\"first timeline day shifted to tomorrow\", function () {\n  pm.expect(days[0].date).to.eql(pm.environment.get(\"tomorrow\"));\n  pm.expect(days[0].date).to.not.eql(pm.environment.get(\"today\"));\n  pm.expect(days[0].fulfillmentMode).to.eql(\"delivery\");\n});\n```");
  lines.push("Cutoff timeline:");
  lines.push("```js\nconst day = pm.response.json().data.days.find(d => d.date === pm.environment.get(\"today\"));\npm.test(\"delivery cutoff locked timeline\", function () {\n  pm.expect(day.status).to.eql(\"locked\");\n  pm.expect(day.dayStatus).to.eql(\"locked\");\n  pm.expect(day.canEdit).to.eql(false);\n  pm.expect(day.lockedReason).to.eql(\"DELIVERY_SELECTION_CUTOFF_PASSED\");\n});\n```");
  lines.push("Kitchen Chef Choice idempotency:");
  lines.push("```js\nconst rows = Array.isArray(pm.response.json().data) ? pm.response.json().data : (pm.response.json().data.items || []);\nconst row = rows.find(r => r.meta && r.meta.subscriptionId === pm.environment.get(\"subscriptionId_cutoffPartial\"));\npm.test(\"partial selection preserves customer meal and fills missing with Chef Choice\", function () {\n  const slots = row.kitchenDetails.mealSlots;\n  pm.expect(slots.filter(s => s.isChefChoice).length).to.eql(2);\n  pm.expect(slots.filter(s => !s.isChefChoice).length).to.eql(1);\n  pm.expect(new Set(slots.map(s => s.slotKey)).size).to.eql(slots.length);\n});\n```");
  lines.push("Operational timeline status:");
  lines.push("```js\nconst day = pm.response.json().data.days.find(d => d.date === pm.environment.get(\"today\"));\npm.test(\"operational status mapping\", function () {\n  const allowed = {\n    in_preparation: \"locked\",\n    ready_for_delivery: \"locked\",\n    out_for_delivery: \"locked\",\n    fulfilled: \"delivered\"\n  };\n  pm.expect(day.status).to.eql(allowed[day.dayStatus]);\n});\n```");
  lines.push("");
  lines.push("6. Expected response snippets");
  lines.push("```json\n{ \"ok\": true, \"status\": \"logged_in\", \"accessToken\": \"...\", \"user\": { \"id\": \"{{customerId}}\" } }\n```");
  lines.push("```json\n{ \"status\": true, \"token\": \"...\", \"user\": { \"id\": \"<adminId>\", \"role\": \"admin\" } }\n```");
  lines.push("```json\n{ \"status\": true, \"data\": { \"draftId\": \"...\", \"fulfillmentOptions\": { \"startDateShifted\": true, \"deliveryStartDateIfNoPickup\": \"{{tomorrow}}\" } } }\n```");
  lines.push("```json\n{ \"data\": { \"days\": [{ \"date\": \"{{day1Date}}\", \"status\": \"locked\", \"dayStatus\": \"locked\", \"fulfillmentMode\": \"pickup\", \"canEdit\": false }] } }\n```");
  lines.push("```json\n{ \"error\": { \"code\": \"INVALID_DELIVERY_MODE\" } }\n```");
  lines.push("");
  lines.push("7. PASS checklist");
  lines.push("```txt");
  [
    "Customer login works",
    "Admin login works",
    "New subscription today + pickup override created",
    "Day 1 is pickup",
    "Day 2 is delivery",
    "Day 1 pickup availability works",
    "Day 1 pickup request works",
    "Day 2 pickup availability rejects INVALID_DELIVERY_MODE",
    "Day 2 pickup request rejects INVALID_DELIVERY_MODE",
    "Day 1 pickup override excluded from courier queue",
    "Delivery-only today shifts to next KSA service date",
    "Renewal pickup override works",
    "Renewal delivery-only shifts to next KSA service date",
    "Future delivery starts normally",
    "Cutoff locks timeline",
    "Chef Choice appears only for missing meals",
    "No duplicate Chef Choice",
    "Delivery operational timeline mapping is correct",
  ].forEach((item) => lines.push(`[ ] ${item}`));
  lines.push("```");
  lines.push("");
  lines.push("8. Known risks or blockers");
  lines.push("- Scenario 6 cutoff assertions require the request time to be at or after 10:00 KSA for `{{today}}` and `12:00-14:00`.");
  lines.push("- Checkout responses create drafts. The script pre-activates seeded drafts with local Payment records; manual Postman checkout needs your normal payment verification path unless `ENABLE_DEV_SUBSCRIPTION_ACTIVATION=true` is enabled.");
  lines.push("- Renewal request examples require an expired source subscription id. The seeded source IDs are printed above, but if you rerun checkout manually you should create or reuse an eligible expired subscription first.");
  lines.push("");
  lines.push("Raw Postman env JSON");
  lines.push("```json");
  lines.push(JSON.stringify(env, null, 2));
  lines.push("```");

  console.log(lines.join("\n"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const today = args.date;
  const tomorrow = dateUtils.addDaysToKSADateString(today, 1);
  const futureDate = dateUtils.addDaysToKSADateString(today, 3);

  await connect();
  if (args.reset) await cleanup();
  await upsertSettings();
  const { user, admin } = await seedAccounts();
  const { plan, zone, meals, addon } = await seedPlanZoneMealsAddons();
  const api = request(createApp());

  const pickupOverride = await createCheckoutSubscription({
    api,
    user,
    payload: checkoutPayload({ plan, zone, startDate: today, override: true, idempotencyKey: `${TAG}-pickup-override` }),
  });
  const deliveryOnly = await createCheckoutSubscription({
    api,
    user,
    payload: checkoutPayload({ plan, zone, startDate: today, override: false, idempotencyKey: `${TAG}-delivery-only` }),
  });
  const futureDeliveryOnly = await createCheckoutSubscription({
    api,
    user,
    payload: checkoutPayload({ plan, zone, startDate: futureDate, override: false, idempotencyKey: `${TAG}-future-delivery-only` }),
  });

  const expiredRenewalPickup = await createExpiredSubscription({ user, plan, zone, label: "renewal-pickup", today });
  const renewalPickupRes = await api.post(`/api/subscriptions/${expiredRenewalPickup._id}/renew`)
    .set(appAuth(user._id))
    .send(checkoutPayload({ plan, zone, startDate: today, override: true, idempotencyKey: `${TAG}-renewal-pickup` }));
  if (renewalPickupRes.status !== 201) throw new Error(`Renewal pickup failed ${renewalPickupRes.status}: ${JSON.stringify(renewalPickupRes.body)}`);
  const renewalPickupId = await activateDraft({ draftId: renewalPickupRes.body.data.draftId, userId: user._id, paymentType: "subscription_renewal" });

  const expiredRenewalDelivery = await createExpiredSubscription({ user, plan, zone, label: "renewal-delivery", today });
  const renewalDeliveryRes = await api.post(`/api/subscriptions/${expiredRenewalDelivery._id}/renew`)
    .set(appAuth(user._id))
    .send(checkoutPayload({ plan, zone, startDate: today, override: false, idempotencyKey: `${TAG}-renewal-delivery` }));
  if (renewalDeliveryRes.status !== 201) throw new Error(`Renewal delivery failed ${renewalDeliveryRes.status}: ${JSON.stringify(renewalDeliveryRes.body)}`);
  const renewalDeliveryId = await activateDraft({ draftId: renewalDeliveryRes.body.data.draftId, userId: user._id, paymentType: "subscription_renewal" });

  const cutoffNoneSub = await createOperationalSubscription({ user, plan, zone, today });
  cutoffNoneSub.selectedMealsPerDay = 2;
  await cutoffNoneSub.save();
  const cutoffNoneDay = await ensureDayFixture({ subscriptionId: cutoffNoneSub._id, date: today, requiredMeals: 2, selectedProducts: [], status: "open", label: "cutoff-none" });

  const cutoffPartialSub = await createOperationalSubscription({ user, plan, zone, today });
  cutoffPartialSub.selectedMealsPerDay = 3;
  await cutoffPartialSub.save();
  const cutoffPartialDay = await ensureDayFixture({ subscriptionId: cutoffPartialSub._id, date: today, requiredMeals: 3, selectedProducts: [meals[0]], status: "open", label: "cutoff-partial" });

  const cutoffFullSub = await createOperationalSubscription({ user, plan, zone, today });
  cutoffFullSub.selectedMealsPerDay = 2;
  await cutoffFullSub.save();
  const cutoffFullDay = await ensureDayFixture({ subscriptionId: cutoffFullSub._id, date: today, requiredMeals: 2, selectedProducts: [meals[0], meals[1]], status: "open", label: "cutoff-full" });

  const operationalSub = await createOperationalSubscription({ user, plan, zone, today });
  const operationalDay = await ensureDayFixture({ subscriptionId: operationalSub._id, date: today, requiredMeals: 2, selectedProducts: [meals[0], meals[1]], status: "open", label: "operational" });

  const actionableCourierSub = await createOperationalSubscription({ user, plan, zone, today });
  const actionableCourierDay = await ensureDayFixture({
    subscriptionId: actionableCourierSub._id,
    date: today,
    requiredMeals: 2,
    selectedProducts: [meals[0], meals[1]],
    status: "out_for_delivery",
    label: "courier-actionable-subscription-delivery",
  });
  const actionableCourierSubscriptionDelivery = await Delivery.create({
    subscriptionId: actionableCourierSub._id,
    dayId: actionableCourierDay._id,
    date: today,
    status: "out_for_delivery",
    address: { line1: "Postman QA Actionable Subscription Delivery St", city: "Riyadh", notes: TAG },
    window: DELIVERY_WINDOW,
  });

  const [pickupDays] = await Promise.all([firstDay(pickupOverride.subscriptionId)]);
  if (!pickupDays || pickupDays.length < 2) throw new Error("Pickup override subscription did not create two days");

  const supplementalQa = await seedSupplementalDashboardQaData({
    user,
    plan,
    zone,
    meals,
    addon,
    today,
    subscriptionIds: [
      pickupOverride.subscriptionId,
      deliveryOnly.subscriptionId,
      renewalPickupId,
      renewalDeliveryId,
      futureDeliveryOnly.subscriptionId,
      String(cutoffNoneSub._id),
      String(cutoffPartialSub._id),
      String(cutoffFullSub._id),
      String(operationalSub._id),
      String(actionableCourierSub._id),
    ],
  });

  printPack({
    user,
    admin,
    plan,
    zone,
    meals,
    addon,
    today,
    tomorrow,
    futureDate,
    ids: {
      pickupOverride: pickupOverride.subscriptionId,
      deliveryOnly: deliveryOnly.subscriptionId,
      renewalPickup: renewalPickupId,
      renewalDeliveryOnly: renewalDeliveryId,
      futureDeliveryOnly: futureDeliveryOnly.subscriptionId,
      expiredRenewalPickupSource: String(expiredRenewalPickup._id),
      expiredRenewalDeliverySource: String(expiredRenewalDelivery._id),
      cutoffNone: String(cutoffNoneSub._id),
      cutoffPartial: String(cutoffPartialSub._id),
      cutoffFull: String(cutoffFullSub._id),
      cutoffNoneDay: String(cutoffNoneDay._id),
      cutoffPartialDay: String(cutoffPartialDay._id),
      cutoffFullDay: String(cutoffFullDay._id),
      operational: String(operationalSub._id),
      operationalDay: String(operationalDay._id),
      actionableCourierSubscription: String(actionableCourierSub._id),
      actionableCourierSubscriptionDay: String(actionableCourierDay._id),
      actionableCourierSubscriptionDelivery: String(actionableCourierSubscriptionDelivery._id),
      archiveSafePromo: String(supplementalQa.archiveSafePromo._id),
      archiveConflictPromo: String(supplementalQa.archiveConflictPromo._id),
      actionableCourierOrder: String(supplementalQa.actionableCourierOrder._id),
      actionableCourierDelivery: String(supplementalQa.actionableCourierDelivery._id),
    },
  });
}

main()
  .catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
