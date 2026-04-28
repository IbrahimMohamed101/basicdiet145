#!/usr/bin/env node

// WARNING: This script must NEVER write tokens, passwords,
// or credentials to disk. Use placeholders only.

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const { connectDb } = require("../src/db");
const User = require("../src/models/User");
const AppUser = require("../src/models/AppUser");
const DashboardUser = require("../src/models/DashboardUser");
const Setting = require("../src/models/Setting");
const Zone = require("../src/models/Zone");
const Plan = require("../src/models/Plan");
const Meal = require("../src/models/Meal");
const MealCategory = require("../src/models/MealCategory");
const PremiumMeal = require("../src/models/PremiumMeal");
const Addon = require("../src/models/Addon");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Payment = require("../src/models/Payment");
const CheckoutDraft = require("../src/models/CheckoutDraft");

const {
  buildDashboardEmailQuery,
  hashDashboardPassword,
  normalizeDashboardEmail,
} = require("../src/services/dashboardPasswordService");
const {
  buildPhase1SubscriptionContract,
  buildCanonicalDraftPersistenceFields,
} = require("../src/services/subscriptionContractService");
const {
  buildCanonicalContractActivationPayload,
} = require("../src/services/subscriptionActivationService");
const {
  buildRecurringAddonEntitlementsFromQuote,
  buildScopedRecurringAddonSnapshot,
} = require("../src/services/recurringAddonService");
const {
  applyCanonicalDraftPlanningToDay,
  applyPremiumOverageState,
  buildScopedCanonicalPlanningSnapshot,
  confirmCanonicalDayPlanning,
} = require("../src/services/subscriptionDayPlanningService");
const {
  buildOneTimeAddonPaymentSnapshot,
  buildOneTimeAddonPlanningSnapshot,
  recomputeOneTimeAddonPlanningState,
} = require("../src/services/oneTimeAddonPlanningService");
const {
  GENERIC_PREMIUM_WALLET_MODE,
} = require("../src/services/genericPremiumWalletService");
const { issueAppAccessToken } = require("../src/services/appTokenService");
const { pickLang } = require("../src/utils/i18n");
const dateUtils = require("../src/utils/date");
const { resolveAddonChargeTotalHalala } = require("../src/utils/subscription/subscriptionCatalog");

const {
  settings: demoSettings,
  deliveryZones,
  pickupLocations,
  plans: planFixtures,
  mealCategories: mealCategoryFixtures,
  regularMeals,
  dashboardUsers,
  demoUsers,
  DASHBOARD_PASSWORD,
} = require("./fixtures/subscription-demo-data");
const {
  premiumMeals: premiumMealFixtures,
  addons: addonFixtures,
} = require("./fixtures/subscription-catalog-demo-data");

const SEED_TAG = "subscription_demo_v2";
const SYSTEM_CURRENCY = "SAR";
const APP_URL = process.env.APP_URL || "https://demo.basicdiet.sa";
const REPORT_PATH = path.join(process.cwd(), ".codex-temp", "subscription-seed-report.json");
const MANAGED_SETTING_KEYS = [...Object.keys(demoSettings), "pickup_locations"];
const SUBSCRIPTION_PAYMENT_TYPES = [
  "subscription_activation",
  "subscription_renewal",
  "premium_topup",
  "addon_topup",
  "premium_overage_day",
  "one_time_addon_day_planning",
];

function parseArgs(argv) {
  const args = new Set(argv);
  return {
    clear: args.has("--clear"),
  };
}

function toKsaMidnight(dateStr) {
  return new Date(`${dateStr}T00:00:00+03:00`);
}

function localizedNameFilter(name) {
  const ar = String(name && name.ar ? name.ar : "").trim();
  const en = String(name && name.en ? name.en : "").trim();
  const filters = [];

  if (en) {
    filters.push({ "name.en": en }, { name: en });
  }
  if (ar) {
    filters.push({ "name.ar": ar }, { name: ar });
  }

  if (filters.length === 0) {
    throw new Error("Localized name filter requires at least one localized value");
  }

  return filters.length === 1 ? filters[0] : { $or: filters };
}

function getLocalizedEnglishName(doc) {
  if (!doc) return "";
  return pickLang(doc.name, "en") || pickLang(doc.name, "ar") || String(doc.name || "");
}

function getLocalizedArabicName(doc) {
  if (!doc) return "";
  return pickLang(doc.name, "ar") || pickLang(doc.name, "en") || String(doc.name || "");
}

function buildMapByEnglishName(docs) {
  return new Map((docs || []).map((doc) => [getLocalizedEnglishName(doc), doc]));
}

function findPlanPriceOption(plan, grams, mealsPerDay) {
  const gramsOption = (plan.gramsOptions || []).find((item) => Number(item.grams) === Number(grams));
  if (!gramsOption) {
    throw new Error(`Plan ${getLocalizedEnglishName(plan)} does not support grams=${grams}`);
  }
  const mealsOption = (gramsOption.mealsOptions || []).find((item) => Number(item.mealsPerDay) === Number(mealsPerDay));
  if (!mealsOption) {
    throw new Error(
      `Plan ${getLocalizedEnglishName(plan)} does not support mealsPerDay=${mealsPerDay} for grams=${grams}`
    );
  }
  return mealsOption;
}

function createDeliveryAddress(zone, labelSuffix) {
  const districtEn = getLocalizedEnglishName(zone);
  const districtAr = getLocalizedArabicName(zone);
  const building = String(40 + Number(labelSuffix || 1));
  return {
    line1: `${districtEn} Residence ${labelSuffix}`,
    line2: `Building ${building}`,
    city: "Riyadh",
    district: districtEn,
    street: "King Fahd Road",
    building,
    apartment: `${labelSuffix}B`,
    notes: `Leave at the front desk for ${districtAr}`,
  };
}

function createDeliverySelection({ zone, address, window }) {
  const slotIndex = Math.max(0, demoSettings.delivery_windows.indexOf(window));
  return {
    type: "delivery",
    address,
    zoneId: zone._id,
    zoneName: getLocalizedEnglishName(zone),
    slot: {
      type: "delivery",
      window,
      slotId: `delivery_slot_${slotIndex + 1}`,
    },
  };
}

function createPickupSelection(location) {
  return {
    type: "pickup",
    pickupLocationId: String(location.id),
    address: {
      line1: location.addressEn,
      city: location.city,
      district: pickLang(location.district, "en"),
      street: pickLang(location.street, "en"),
      building: location.building,
      notes: pickLang(location.notes, "en"),
    },
    slot: {
      type: "pickup",
      window: "",
      slotId: "",
    },
  };
}

function createPremiumQuoteItems(entries) {
  return (entries || []).map(({ premiumMeal, qty }) => ({
    premiumMeal,
    qty,
    unitExtraFeeHalala: Number(premiumMeal.extraFeeHalala || 0),
    currency: SYSTEM_CURRENCY,
  }));
}

function createAddonQuoteItems(entries) {
  return (entries || []).map(({ addon, qty }) => ({
    addon,
    qty,
    unitPriceHalala: Number(addon.priceHalala || 0),
    currency: SYSTEM_CURRENCY,
  }));
}

function buildQuote({
  plan,
  grams,
  mealsPerDay,
  startDate,
  delivery,
  premiumItems = [],
  addonItems = [],
  premiumWalletMode = "legacy_v1",
  premiumCount = 0,
  premiumUnitPriceHalala = 0,
}) {
  const priceOption = findPlanPriceOption(plan, grams, mealsPerDay);
  const basePlanPriceHalala = Number(priceOption.priceHalala || 0);
  const premiumTotalHalala = premiumItems.reduce(
    (sum, item) => sum + Number(item.unitExtraFeeHalala || 0) * Number(item.qty || 0),
    0
  );
  const addonsTotalHalala = addonItems.reduce(
    (sum, item) => sum + resolveAddonChargeTotalHalala({
      unitPriceHalala: Number(item.unitPriceHalala || 0),
      qty: Number(item.qty || 0),
      daysCount: Number(plan && plan.daysCount ? plan.daysCount : 0),
      type: item && item.addon && item.addon.type ? item.addon.type : "subscription",
    }),
    0
  );
  const deliveryFeeHalala = delivery.type === "delivery" ? Number(delivery && delivery.zoneId ? delivery.zoneId.deliveryFeeHalala : 0) : 0;
  const normalizedDeliveryFeeHalala = delivery.type === "delivery"
    ? Number(delivery.deliveryFeeHalala || 0)
    : 0;
  const subtotalHalala = basePlanPriceHalala + premiumTotalHalala + addonsTotalHalala + normalizedDeliveryFeeHalala;
  const vatPercentage = Number(demoSettings.vat_percentage || 0);
  const vatHalala = vatPercentage > 0 ? Math.round((subtotalHalala * vatPercentage) / 100) : 0;

  return {
    plan,
    grams,
    mealsPerDay,
    startDate,
    delivery,
    premiumWalletMode,
    premiumCount,
    premiumUnitPriceHalala,
    premiumItems,
    addonItems,
    breakdown: {
      basePlanPriceHalala,
      premiumTotalHalala,
      addonsTotalHalala,
      deliveryFeeHalala: normalizedDeliveryFeeHalala,
      vatPercentage,
      vatHalala,
      totalHalala: subtotalHalala + vatHalala,
      currency: SYSTEM_CURRENCY,
    },
  };
}

function createQuoteDelivery(selection, zone) {
  if (selection.type === "pickup") {
    return selection;
  }
  return {
    ...selection,
    zoneId: zone ? zone._id : null,
    zoneName: zone ? getLocalizedEnglishName(zone) : "",
    deliveryFeeHalala: zone ? Number(zone.deliveryFeeHalala || 0) : 0,
  };
}

function buildContractFromQuote({ quote, userId, source, renewedFromSubscriptionId = null }) {
  const contractNow = toKsaMidnight(dateUtils.addDaysToKSADateString(quote.startDate, -2));
  return buildPhase1SubscriptionContract({
    payload: {
      startDate: quote.startDate,
      delivery: quote.delivery,
      renewedFromSubscriptionId,
    },
    resolvedQuote: quote,
    actorContext: { actorRole: "system", actorUserId: userId },
    source,
    now: contractNow,
  });
}

function buildDayDate(baseDate, offset) {
  return dateUtils.addDaysToKSADateString(baseDate, offset);
}

function selectMealIds(mealsByName, names) {
  return names.map((name) => {
    const doc = mealsByName.get(name);
    if (!doc) throw new Error(`Regular meal not found: ${name}`);
    return doc._id;
  });
}

function selectPremiumIds(premiumMealsByName, names) {
  return names.map((name) => {
    const doc = premiumMealsByName.get(name);
    if (!doc) throw new Error(`Premium meal not found: ${name}`);
    return doc._id;
  });
}

function buildLockedSnapshot(subscription, day) {
  return {
    planning: buildScopedCanonicalPlanningSnapshot({
      subscription,
      day,
      flagEnabled: true,
    }),
    recurringAddons: buildScopedRecurringAddonSnapshot({ subscription }),
    oneTimeAddonSelections: Array.isArray(day.oneTimeAddonSelections) ? day.oneTimeAddonSelections : [],
    oneTimeAddonPendingCount: Number(day.oneTimeAddonPendingCount || 0),
    oneTimeAddonPaymentStatus: day.oneTimeAddonPaymentStatus || null,
    selections: Array.isArray(day.selections) ? day.selections : [],
    premiumSelections: Array.isArray(day.premiumSelections) ? day.premiumSelections : [],
  };
}

async function applyPlanningState({
  subscription,
  day,
  baseMealIds,
  premiumMealIds = [],
  confirmed = false,
  now,
}) {
  applyCanonicalDraftPlanningToDay({
    subscription,
    day,
    selections: baseMealIds,
    premiumSelections: premiumMealIds,
    assignmentSource: "client",
    now,
  });
  day.premiumSelections = premiumMealIds;
  if (confirmed) {
    confirmCanonicalDayPlanning({
      subscription,
      day,
      actorRole: "client",
      now,
    });
  }
  await day.save();
}

async function markLocked(subscription, day, status, now) {
  day.status = status;
  day.lockedSnapshot = buildLockedSnapshot(subscription, day);
  day.lockedAt = now;
  await day.save();
}

async function markFulfilled(subscription, day, now) {
  day.status = "fulfilled";
  day.lockedSnapshot = buildLockedSnapshot(subscription, day);
  day.lockedAt = now;
  day.fulfilledSnapshot = {
    ...day.lockedSnapshot,
  };
  day.fulfilledAt = now;
  day.creditsDeducted = true;
  await day.save();
}

async function upsertSettings() {
  const operations = [
    ...Object.entries(demoSettings).map(([key, value]) => ({
      key,
      value,
      description: `${SEED_TAG}:${key}`,
    })),
    {
      key: "pickup_locations",
      value: pickupLocations,
      description: `${SEED_TAG}:pickup_locations`,
    },
  ];

  for (const entry of operations) {
    await Setting.findOneAndUpdate(
      { key: entry.key },
      { $set: entry },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  }
}

async function upsertCatalogDocs(Model, docs) {
  const savedDocs = [];
  for (const doc of docs) {
    const saved = await Model.findOneAndUpdate(
      localizedNameFilter(doc.name),
      { $set: doc },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    savedDocs.push(saved.toObject ? saved.toObject() : saved);
  }
  return savedDocs;
}

async function upsertMealCategories(docs) {
  const savedDocs = [];
  for (const doc of docs) {
    const saved = await MealCategory.findOneAndUpdate(
      { key: doc.key },
      { $set: doc },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    savedDocs.push(saved.toObject ? saved.toObject() : saved);
  }
  return savedDocs;
}

async function upsertDashboardUsers() {
  const saved = [];
  for (const user of dashboardUsers) {
    const passwordHash = await hashDashboardPassword(user.password);
    const normalizedEmail = normalizeDashboardEmail(user.email);
    const doc = await DashboardUser.findOneAndUpdate(
      buildDashboardEmailQuery(normalizedEmail),
      {
        $set: {
          email: normalizedEmail,
          role: user.role,
          isActive: user.isActive,
          passwordHash,
          passwordChangedAt: new Date(),
          failedAttempts: 0,
          lockUntil: null,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    saved.push(doc.toObject ? doc.toObject() : doc);
  }
  return saved;
}

async function upsertDemoUsersAndApps() {
  const users = [];
  const appUsers = [];
  for (const demoUser of demoUsers) {
    const coreUser = await User.findOneAndUpdate(
      { phone: demoUser.phone },
      {
        $set: {
          phone: demoUser.phone,
          name: demoUser.fullName,
          email: demoUser.email,
          role: "client",
          isActive: true,
          fcmTokens: [],
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    users.push(coreUser.toObject ? coreUser.toObject() : coreUser);

    const appUser = await AppUser.findOneAndUpdate(
      { phone: demoUser.phone },
      {
        $set: {
          fullName: demoUser.fullName,
          phone: demoUser.phone,
          email: demoUser.email,
          coreUserId: coreUser._id,
          fcmTokens: [],
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    appUsers.push(appUser.toObject ? appUser.toObject() : appUser);
  }
  return { users, appUsers };
}

async function clearManagedCatalogs() {
  await Promise.all([
    Setting.deleteMany({ key: { $in: MANAGED_SETTING_KEYS } }),
    Zone.deleteMany({}),
    Plan.deleteMany({}),
    MealCategory.deleteMany({}),
    Meal.deleteMany({}),
    PremiumMeal.deleteMany({}),
    Addon.deleteMany({}),
  ]);
}

async function purgeDemoUsersDomain(userIds) {
  const subscriptions = await Subscription.find({ userId: { $in: userIds } }).select("_id").lean();
  const subscriptionIds = subscriptions.map((item) => item._id);
  const paymentClauses = [{ userId: { $in: userIds }, type: { $in: SUBSCRIPTION_PAYMENT_TYPES } }];
  if (subscriptionIds.length) {
    paymentClauses.push({ subscriptionId: { $in: subscriptionIds } });
  }

  await Promise.all([
    SubscriptionDay.deleteMany(subscriptionIds.length ? { subscriptionId: { $in: subscriptionIds } } : { _id: null }),
    CheckoutDraft.deleteMany({ userId: { $in: userIds } }),
    Payment.deleteMany({ $or: paymentClauses }),
    Subscription.deleteMany({ userId: { $in: userIds } }),
  ]);
}

function buildActivationRuntimeData({
  quote,
  premiumWalletMode = "legacy_v1",
  premiumBalance = [],
  genericPremiumBalance = [],
  addonBalance = [],
}) {
  return {
    premiumWalletMode,
    premiumBalance,
    genericPremiumBalance,
    premiumPrice: premiumWalletMode === GENERIC_PREMIUM_WALLET_MODE
      ? Number(quote.premiumUnitPriceHalala || 0) / 100
      : 0,
    addonBalance,
    addonSubscriptions: buildRecurringAddonEntitlementsFromQuote({
      addonItems: quote.addonItems || [],
      lang: "en",
    }),
  };
}

async function createCanonicalSubscription({
  user,
  plan,
  grams,
  mealsPerDay,
  startDate,
  deliverySelection,
  zone = null,
  premiumQuoteItems = [],
  addonQuoteItems = [],
  premiumWalletMode = "legacy_v1",
  premiumCount = 0,
  premiumUnitPriceHalala = 0,
  premiumBalance = [],
  genericPremiumBalance = [],
  addonBalance = [],
  source = "customer_checkout",
  status = "active",
  renewedFromSubscriptionId = null,
}) {
  const quote = buildQuote({
    plan,
    grams,
    mealsPerDay,
    startDate,
    delivery: createQuoteDelivery(deliverySelection, zone),
    premiumItems: premiumQuoteItems,
    addonItems: addonQuoteItems,
    premiumWalletMode,
    premiumCount,
    premiumUnitPriceHalala,
  });

  const contract = buildContractFromQuote({
    quote,
    userId: user._id,
    source,
    renewedFromSubscriptionId,
  });

  const activation = buildCanonicalContractActivationPayload({
    userId: user._id,
    planId: plan._id,
    contract,
    legacyRuntimeData: buildActivationRuntimeData({
      quote,
      premiumWalletMode,
      premiumBalance,
      genericPremiumBalance,
      addonBalance,
    }),
  });

  const subscriptionPayload = {
    ...activation.subscriptionPayload,
    status,
  };

  if (status === "canceled") {
    subscriptionPayload.canceledAt = toKsaMidnight(buildDayDate(startDate, 3));
  }

  const subscription = await Subscription.create(subscriptionPayload);
  const dayDocs = await SubscriptionDay.insertMany(
    activation.dayEntries.map((entry) => ({
      ...entry,
      subscriptionId: subscription._id,
    }))
  );

  return {
    subscription,
    quote,
    contract,
    dayMap: new Map(dayDocs.map((day) => [String(day.date), day])),
  };
}

async function refreshRemainingMeals(subscription) {
  const days = await SubscriptionDay.find({ subscriptionId: subscription._id }).lean();
  const mealsPerDay = Number(subscription.selectedMealsPerDay || 0);
  const consumedStatuses = new Set(["locked", "in_preparation", "out_for_delivery", "ready_for_pickup", "fulfilled"]);
  const consumedDays = days.filter((day) => (
    Boolean(day.creditsDeducted)
    || consumedStatuses.has(String(day.status || ""))
  )).length;
  subscription.remainingMeals = Math.max(0, Number(subscription.totalMeals || 0) - (consumedDays * mealsPerDay));
  await subscription.save();
}

async function createCheckoutDraft({
  user,
  quote,
  contract,
  idempotencyKey,
  paymentType,
  status,
  paymentStatus,
  paymentApplied,
  subscriptionId = null,
  renewedFromSubscriptionId = null,
  providerSuffix,
}) {
  const draft = await CheckoutDraft.create({
    userId: user._id,
    planId: quote.plan._id,
    idempotencyKey,
    requestHash: `${SEED_TAG}:${idempotencyKey}:hash`,
    status,
    daysCount: quote.plan.daysCount,
    grams: quote.grams,
    mealsPerDay: quote.mealsPerDay,
    delivery: quote.delivery,
    premiumItems: quote.premiumItems.map((item) => ({
      premiumMealId: item.premiumMeal._id,
      qty: item.qty,
      unitExtraFeeHalala: item.unitExtraFeeHalala,
      currency: SYSTEM_CURRENCY,
    })),
    addonItems: quote.addonItems.map((item) => ({
      addonId: item.addon._id,
      qty: item.qty,
      unitPriceHalala: item.unitPriceHalala,
      currency: SYSTEM_CURRENCY,
    })),
    addonSubscriptions: buildRecurringAddonEntitlementsFromQuote({
      addonItems: quote.addonItems,
      lang: "en",
    }),
    breakdown: quote.breakdown,
    renewedFromSubscriptionId,
    ...buildCanonicalDraftPersistenceFields({ contract }),
  });

  const invoiceId = `seed-invoice-${providerSuffix}`;
  const providerPaymentId = `seed-payment-${providerSuffix}`;
  const payment = await Payment.create({
    provider: "moyasar",
    type: paymentType,
    status: paymentStatus,
    amount: Number(quote.breakdown.totalHalala || 0),
    currency: SYSTEM_CURRENCY,
    userId: user._id,
    subscriptionId,
    providerInvoiceId: invoiceId,
    providerPaymentId,
    applied: paymentApplied,
    paidAt: paymentStatus === "paid" ? new Date() : null,
    metadata: {
      seedTag: SEED_TAG,
      type: paymentType,
      draftId: String(draft._id),
      userId: String(user._id),
      renewedFromSubscriptionId: renewedFromSubscriptionId ? String(renewedFromSubscriptionId) : null,
      grams: quote.grams,
      mealsPerDay: quote.mealsPerDay,
      paymentUrl: `${APP_URL}/payments/${invoiceId}`,
      initiationResponseShape: paymentType === "subscription_renewal" ? "subscription_renewal" : "subscription_checkout",
      totalHalala: Number(quote.breakdown.totalHalala || 0),
    },
  });

  draft.paymentId = payment._id;
  draft.providerInvoiceId = invoiceId;
  draft.paymentUrl = `${APP_URL}/payments/${invoiceId}`;
  if (status === "completed" && subscriptionId) {
    draft.subscriptionId = subscriptionId;
    draft.completedAt = new Date();
  }
  await draft.save();

  return { draft, payment };
}

async function createWalletTopupPayment({
  subscription,
  user,
  type,
  status,
  applied,
  items = [],
  premiumCount = 0,
  unitCreditPriceHalala = 0,
  providerSuffix,
}) {
  const metadata = {
    seedTag: SEED_TAG,
    type,
    subscriptionId: String(subscription._id),
    userId: String(user._id),
    paymentUrl: `${APP_URL}/payments/seed-invoice-${providerSuffix}`,
    initiationResponseShape: type === "addon_topup" ? "addon_credits_topup" : "premium_credits_topup",
  };

  let amount = 0;
  if (type === "premium_topup") {
    metadata.premiumWalletMode = GENERIC_PREMIUM_WALLET_MODE;
    metadata.premiumCount = premiumCount;
    metadata.unitCreditPriceHalala = unitCreditPriceHalala;
    metadata.currency = SYSTEM_CURRENCY;
    amount = premiumCount * unitCreditPriceHalala;
  } else {
    metadata.items = items;
    amount = items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.unitPriceHalala || 0), 0);
  }
  metadata.totalHalala = amount;

  return Payment.create({
    provider: "moyasar",
    type,
    status,
    amount,
    currency: SYSTEM_CURRENCY,
    userId: user._id,
    subscriptionId: subscription._id,
    providerInvoiceId: `seed-invoice-${providerSuffix}`,
    providerPaymentId: `seed-payment-${providerSuffix}`,
    applied,
    paidAt: status === "paid" ? new Date() : null,
    metadata,
  });
}

async function createPremiumOveragePayment({
  subscription,
  user,
  day,
  premiumOverageCount,
  unitPriceHalala,
  status,
  applied,
  providerSuffix,
}) {
  return Payment.create({
    provider: "moyasar",
    type: "premium_overage_day",
    status,
    amount: premiumOverageCount * unitPriceHalala,
    currency: SYSTEM_CURRENCY,
    userId: user._id,
    subscriptionId: subscription._id,
    providerInvoiceId: `seed-invoice-${providerSuffix}`,
    providerPaymentId: `seed-payment-${providerSuffix}`,
    applied,
    paidAt: status === "paid" ? new Date() : null,
    metadata: {
      seedTag: SEED_TAG,
      type: "premium_overage_day",
      subscriptionId: String(subscription._id),
      userId: String(user._id),
      dayId: String(day._id),
      date: day.date,
      premiumOverageCount,
      paymentUrl: `${APP_URL}/payments/seed-invoice-${providerSuffix}`,
      initiationResponseShape: "premium_overage_day",
      totalHalala: premiumOverageCount * unitPriceHalala,
    },
  });
}

async function createOneTimeAddonDayPayment({
  subscription,
  user,
  day,
  status,
  applied,
  providerSuffix,
}) {
  const snapshot = buildOneTimeAddonPaymentSnapshot({ day });
  const addonIds = snapshot.oneTimeAddonSelections.map((item) => item.addonId);
  const addonDocs = await Addon.find({ _id: { $in: addonIds } }).lean();
  const addonById = new Map(addonDocs.map((doc) => [String(doc._id), doc]));
  const amount = snapshot.oneTimeAddonSelections.reduce((sum, item) => {
    const doc = addonById.get(String(item.addonId));
    return sum + Number(doc && doc.priceHalala ? doc.priceHalala : 0);
  }, 0);

  return Payment.create({
    provider: "moyasar",
    type: "one_time_addon_day_planning",
    status,
    amount,
    currency: SYSTEM_CURRENCY,
    userId: user._id,
    subscriptionId: subscription._id,
    providerInvoiceId: `seed-invoice-${providerSuffix}`,
    providerPaymentId: `seed-payment-${providerSuffix}`,
    applied,
    paidAt: status === "paid" ? new Date() : null,
    metadata: {
      seedTag: SEED_TAG,
      type: "one_time_addon_day_planning",
      subscriptionId: String(subscription._id),
      userId: String(user._id),
      dayId: String(day._id),
      date: day.date,
      oneTimeAddonSelections: snapshot.oneTimeAddonSelections,
      oneTimeAddonCount: snapshot.oneTimeAddonCount,
      paymentUrl: `${APP_URL}/payments/seed-invoice-${providerSuffix}`,
      initiationResponseShape: "one_time_addon_day_planning",
      totalHalala: amount,
    },
  });
}

async function seedScenarioData({ usersByKey, plansByName, mealsByName, premiumMealsByName, addonsByName, zonesByName }) {
  const pickupLocation = pickupLocations[0];
  const subscriptions = [];
  const drafts = [];
  const payments = [];

  const plan28 = plansByName.get("28 Days Plan");
  const plan21 = plansByName.get("21 Days Plan");
  const plan14 = plansByName.get("14 Days Plan");
  const plan7 = plansByName.get("7 Days Plan");

  const zoneMalqa = zonesByName.get("Al Malqa");
  const zoneYasmin = zonesByName.get("Al Yasmin");
  const zoneNarjis = zonesByName.get("Al Narjis");
  const zoneHittin = zonesByName.get("Hittin");
  const zoneSahafa = zonesByName.get("Al Sahafa");

  const recurringGreenJuice = addonsByName.get("Juice Subscription");
  const recurringSoup = addonsByName.get("Snack Subscription");
  const addonSideSalad = addonsByName.get("Small Salad");
  const addonChia = addonsByName.get("Protein Bar");
  const addonGranola = addonsByName.get("Classic Bisc");
  const addonCheesecake = addonsByName.get("Blueberry Cheesecake");
  const addonHummus = addonsByName.get("Cinnamon Apple Muffin (2 pieces)");

  const premiumLobster = premiumMealsByName.get("Lobster Tail Dinner");
  const premiumPrawns = premiumMealsByName.get("Garlic Butter King Prawns");

  const today = dateUtils.getTodayKSADate();

  const activeDeliveryUser = usersByKey.get("active_delivery");
  const activeDelivery = await createCanonicalSubscription({
    user: activeDeliveryUser,
    plan: plan28,
    grams: 500,
    mealsPerDay: 3,
    startDate: buildDayDate(today, -10),
    deliverySelection: createDeliverySelection({
      zone: zoneMalqa,
      address: createDeliveryAddress(zoneMalqa, 1),
      window: demoSettings.delivery_windows[0],
    }),
    zone: zoneMalqa,
    addonQuoteItems: createAddonQuoteItems([
      { addon: recurringGreenJuice, qty: 1 },
      { addon: recurringSoup, qty: 1 },
    ]),
    source: "customer_checkout",
  });
  subscriptions.push(activeDelivery.subscription);

  const activeDeliveryStart = buildDayDate(today, -10);
  const activeDeliveryFulfilledDay = activeDelivery.dayMap.get(activeDeliveryStart);
  await applyPlanningState({
    subscription: activeDelivery.subscription,
    day: activeDeliveryFulfilledDay,
    baseMealIds: selectMealIds(mealsByName, [
      "Grilled Chicken Salad",
      "Quinoa Power Bowl",
      "Turkey Club Sandwich",
    ]),
    confirmed: true,
    now: new Date(`${activeDeliveryFulfilledDay.date}T08:00:00+03:00`),
  });
  await markFulfilled(activeDelivery.subscription, activeDeliveryFulfilledDay, new Date(`${activeDeliveryFulfilledDay.date}T11:00:00+03:00`));

  const activeDeliveryLockedDay = activeDelivery.dayMap.get(buildDayDate(activeDeliveryStart, 1));
  await applyPlanningState({
    subscription: activeDelivery.subscription,
    day: activeDeliveryLockedDay,
    baseMealIds: selectMealIds(mealsByName, [
      "Teriyaki Chicken Bowl",
      "Lemon Herb Chicken Plate",
      "Mediterranean Quinoa Salad",
    ]),
    confirmed: true,
    now: new Date(`${activeDeliveryLockedDay.date}T08:30:00+03:00`),
  });
  await markLocked(activeDelivery.subscription, activeDeliveryLockedDay, "locked", new Date(`${activeDeliveryLockedDay.date}T12:00:00+03:00`));

  const activeDeliveryToday = activeDelivery.dayMap.get(today);
  await applyPlanningState({
    subscription: activeDelivery.subscription,
    day: activeDeliveryToday,
    baseMealIds: selectMealIds(mealsByName, [
      "Spicy Beef Burrito Bowl",
      "Garlic Beef Rice Plate",
      "Avocado Turkey Salad",
    ]),
    confirmed: true,
    now: new Date(`${today}T09:00:00+03:00`),
  });
  await markLocked(activeDelivery.subscription, activeDeliveryToday, "out_for_delivery", new Date(`${today}T10:00:00+03:00`));
  activeDeliveryToday.creditsDeducted = true;
  await activeDeliveryToday.save();

  const activeDeliveryTomorrow = activeDelivery.dayMap.get(buildDayDate(today, 1));
  await applyPlanningState({
    subscription: activeDelivery.subscription,
    day: activeDeliveryTomorrow,
    baseMealIds: selectMealIds(mealsByName, [
      "Buddha Bowl",
      "Mushroom Chicken Pasta",
      "Citrus Kale Crunch Salad",
    ]),
    confirmed: true,
    now: new Date(`${activeDeliveryTomorrow.date}T09:15:00+03:00`),
  });

  const activeDeliveryDraftDay = activeDelivery.dayMap.get(buildDayDate(today, 2));
  await applyPlanningState({
    subscription: activeDelivery.subscription,
    day: activeDeliveryDraftDay,
    baseMealIds: selectMealIds(mealsByName, [
      "Moroccan Chicken Couscous",
      "Hummus Veggie Wrap",
      "Roast Beef Ciabatta",
    ]),
    confirmed: false,
    now: new Date(`${activeDeliveryDraftDay.date}T09:20:00+03:00`),
  });

  const activeDeliveryOverrideDay = activeDelivery.dayMap.get(buildDayDate(today, 4));
  activeDeliveryOverrideDay.deliveryAddressOverride = {
    line1: "Al Malqa Residence 4",
    line2: "Building 55",
    city: "Riyadh",
    district: "Al Malqa",
    street: "Prince Mohammed Bin Saad Road",
    building: "55",
    apartment: "8A",
    notes: "Call upon arrival, security gate requires confirmation.",
  };
  activeDeliveryOverrideDay.deliveryWindowOverride = demoSettings.delivery_windows[2];
  await activeDeliveryOverrideDay.save();

  await refreshRemainingMeals(activeDelivery.subscription);

  const activeDeliveryDraft = await createCheckoutDraft({
    user: activeDeliveryUser,
    quote: activeDelivery.quote,
    contract: activeDelivery.contract,
    idempotencyKey: `${SEED_TAG}:checkout:active-delivery:completed`,
    paymentType: "subscription_activation",
    status: "completed",
    paymentStatus: "paid",
    paymentApplied: true,
    subscriptionId: activeDelivery.subscription._id,
    providerSuffix: "checkout-active-delivery-completed",
  });
  drafts.push(activeDeliveryDraft.draft);
  payments.push(activeDeliveryDraft.payment);

  const activePickupUser = usersByKey.get("active_pickup");
  const activePickup = await createCanonicalSubscription({
    user: activePickupUser,
    plan: plan14,
    grams: 500,
    mealsPerDay: 2,
    startDate: buildDayDate(today, -5),
    deliverySelection: createPickupSelection(pickupLocation),
    source: "customer_checkout",
  });
  subscriptions.push(activePickup.subscription);
  const pickupFulfilledDay = activePickup.dayMap.get(buildDayDate(today, -2));
  await applyPlanningState({
    subscription: activePickup.subscription,
    day: pickupFulfilledDay,
    baseMealIds: selectMealIds(mealsByName, [
      "Mushroom Chicken Pasta",
      "Avocado Turkey Salad",
    ]),
    confirmed: true,
    now: new Date(`${pickupFulfilledDay.date}T08:00:00+03:00`),
  });
  pickupFulfilledDay.pickupRequested = true;
  pickupFulfilledDay.status = "ready_for_pickup";
  pickupFulfilledDay.lockedSnapshot = buildLockedSnapshot(activePickup.subscription, pickupFulfilledDay);
  pickupFulfilledDay.lockedAt = new Date(`${pickupFulfilledDay.date}T09:30:00+03:00`);
  pickupFulfilledDay.creditsDeducted = true;
  await pickupFulfilledDay.save();
  const pickupOpenDay = activePickup.dayMap.get(buildDayDate(today, 1));
  pickupOpenDay.pickupRequested = false;
  await pickupOpenDay.save();
  await refreshRemainingMeals(activePickup.subscription);

  const expiredRenewableUser = usersByKey.get("expired_renewable");
  const expiredRenewable = await createCanonicalSubscription({
    user: expiredRenewableUser,
    plan: plan14,
    grams: 350,
    mealsPerDay: 2,
    startDate: buildDayDate(today, -25),
    deliverySelection: createDeliverySelection({
      zone: zoneYasmin,
      address: createDeliveryAddress(zoneYasmin, 2),
      window: demoSettings.delivery_windows[1],
    }),
    zone: zoneYasmin,
    source: "customer_checkout",
    status: "expired",
  });
  subscriptions.push(expiredRenewable.subscription);
  const expiredFirstDay = expiredRenewable.dayMap.get(buildDayDate(today, -25));
  await applyPlanningState({
    subscription: expiredRenewable.subscription,
    day: expiredFirstDay,
    baseMealIds: selectMealIds(mealsByName, [
      "Grilled Chicken Salad",
      "Pesto Chicken Sandwich",
    ]),
    confirmed: true,
    now: new Date(`${expiredFirstDay.date}T08:00:00+03:00`),
  });
  await markFulfilled(expiredRenewable.subscription, expiredFirstDay, new Date(`${expiredFirstDay.date}T11:00:00+03:00`));
  await refreshRemainingMeals(expiredRenewable.subscription);

  const renewalQuote = buildQuote({
    plan: plan14,
    grams: 350,
    mealsPerDay: 2,
    startDate: buildDayDate(today, 2),
    delivery: createQuoteDelivery(createDeliverySelection({
      zone: zoneYasmin,
      address: createDeliveryAddress(zoneYasmin, 22),
      window: demoSettings.delivery_windows[1],
    }), zoneYasmin),
    premiumItems: [],
    addonItems: [],
  });
  const renewalContract = buildContractFromQuote({
    quote: renewalQuote,
    userId: expiredRenewableUser._id,
    source: "renewal",
    renewedFromSubscriptionId: expiredRenewable.subscription._id,
  });
  const renewalDraft = await createCheckoutDraft({
    user: expiredRenewableUser,
    quote: renewalQuote,
    contract: renewalContract,
    idempotencyKey: `${SEED_TAG}:renewal:expired-renewable:pending`,
    paymentType: "subscription_renewal",
    status: "pending_payment",
    paymentStatus: "initiated",
    paymentApplied: false,
    renewedFromSubscriptionId: expiredRenewable.subscription._id,
    providerSuffix: "renewal-expired-pending",
  });
  drafts.push(renewalDraft.draft);
  payments.push(renewalDraft.payment);

  const frozenUser = usersByKey.get("frozen_subscription");
  const frozenSub = await createCanonicalSubscription({
    user: frozenUser,
    plan: plan21,
    grams: 500,
    mealsPerDay: 2,
    startDate: buildDayDate(today, -8),
    deliverySelection: createDeliverySelection({
      zone: zoneNarjis,
      address: createDeliveryAddress(zoneNarjis, 3),
      window: demoSettings.delivery_windows[0],
    }),
    zone: zoneNarjis,
    source: "customer_checkout",
  });
  subscriptions.push(frozenSub.subscription);
  const frozenPastDay = frozenSub.dayMap.get(buildDayDate(today, -6));
  await applyPlanningState({
    subscription: frozenSub.subscription,
    day: frozenPastDay,
    baseMealIds: selectMealIds(mealsByName, [
      "Garlic Beef Rice Plate",
      "Citrus Kale Crunch Salad",
    ]),
    confirmed: true,
    now: new Date(`${frozenPastDay.date}T08:00:00+03:00`),
  });
  await markFulfilled(frozenSub.subscription, frozenPastDay, new Date(`${frozenPastDay.date}T11:00:00+03:00`));
  const frozenDay = frozenSub.dayMap.get(buildDayDate(today, 2));
  frozenDay.status = "frozen";
  frozenDay.canonicalDayActionType = "freeze";
  await frozenDay.save();
  const extensionDate = buildDayDate(dateUtils.toKSADateString(frozenSub.subscription.endDate), 1);
  await SubscriptionDay.create({
    subscriptionId: frozenSub.subscription._id,
    date: extensionDate,
    status: "open",
    recurringAddons: frozenDay.recurringAddons || [],
  });
  frozenSub.subscription.validityEndDate = toKsaMidnight(extensionDate);
  await frozenSub.subscription.save();
  await refreshRemainingMeals(frozenSub.subscription);

  const skippedUser = usersByKey.get("skipped_days");
  const skippedSub = await createCanonicalSubscription({
    user: skippedUser,
    plan: plan14,
    grams: 350,
    mealsPerDay: 2,
    startDate: buildDayDate(today, -6),
    deliverySelection: createDeliverySelection({
      zone: zoneSahafa,
      address: createDeliveryAddress(zoneSahafa, 4),
      window: demoSettings.delivery_windows[2],
    }),
    zone: zoneSahafa,
    source: "customer_checkout",
  });
  subscriptions.push(skippedSub.subscription);
  const skippedPastDay = skippedSub.dayMap.get(buildDayDate(today, -4));
  await applyPlanningState({
    subscription: skippedSub.subscription,
    day: skippedPastDay,
    baseMealIds: selectMealIds(mealsByName, [
      "Lemon Herb Chicken Plate",
      "Turkey Club Sandwich",
    ]),
    confirmed: true,
    now: new Date(`${skippedPastDay.date}T08:00:00+03:00`),
  });
  await markFulfilled(skippedSub.subscription, skippedPastDay, new Date(`${skippedPastDay.date}T11:00:00+03:00`));
  const skippedFutureDay = skippedSub.dayMap.get(buildDayDate(today, 1));
  skippedFutureDay.status = "skipped";
  skippedFutureDay.canonicalDayActionType = "skip";
  skippedFutureDay.skippedByUser = true;
  await skippedFutureDay.save();
  skippedSub.subscription.skippedCount = 1;
  await skippedSub.subscription.save();
  await refreshRemainingMeals(skippedSub.subscription);

  const walletUser = usersByKey.get("wallet_balance");
  const walletSubscription = await createCanonicalSubscription({
    user: walletUser,
    plan: plan28,
    grams: 500,
    mealsPerDay: 3,
    startDate: buildDayDate(today, -7),
    deliverySelection: createDeliverySelection({
      zone: zoneNarjis,
      address: createDeliveryAddress(zoneNarjis, 5),
      window: demoSettings.delivery_windows[1],
    }),
    zone: zoneNarjis,
    premiumWalletMode: GENERIC_PREMIUM_WALLET_MODE,
    premiumCount: 5,
    premiumUnitPriceHalala: Number(demoSettings.premium_price || 0) * 100,
    genericPremiumBalance: [
      { purchasedQty: 2, remainingQty: 1, unitCreditPriceHalala: 2400, currency: SYSTEM_CURRENCY, source: "subscription_purchase" },
      { purchasedQty: 3, remainingQty: 2, unitCreditPriceHalala: 2400, currency: SYSTEM_CURRENCY, source: "topup_payment" },
    ],
    addonBalance: [
      { addonId: addonSideSalad._id, purchasedQty: 3, remainingQty: 2, unitPriceHalala: Number(addonSideSalad.priceHalala || 0), currency: SYSTEM_CURRENCY },
      { addonId: addonChia._id, purchasedQty: 2, remainingQty: 1, unitPriceHalala: Number(addonChia.priceHalala || 0), currency: SYSTEM_CURRENCY },
    ],
    source: "customer_checkout",
  });
  subscriptions.push(walletSubscription.subscription);
  const walletHistoryDay = walletSubscription.dayMap.get(buildDayDate(today, -1));
  await applyPlanningState({
    subscription: walletSubscription.subscription,
    day: walletHistoryDay,
    baseMealIds: selectMealIds(mealsByName, [
      "Quinoa Power Bowl",
      "Mediterranean Quinoa Salad",
    ]),
    premiumMealIds: selectPremiumIds(premiumMealsByName, ["Lobster Tail Dinner"]),
    confirmed: true,
    now: new Date(`${walletHistoryDay.date}T08:00:00+03:00`),
  });
  walletHistoryDay.addonCreditSelections = [
    {
      addonId: addonSideSalad._id,
      qty: 1,
      unitPriceHalala: Number(addonSideSalad.priceHalala || 0),
      currency: SYSTEM_CURRENCY,
      consumedAt: new Date(`${walletHistoryDay.date}T09:00:00+03:00`),
    },
  ];
  await markFulfilled(walletSubscription.subscription, walletHistoryDay, new Date(`${walletHistoryDay.date}T11:00:00+03:00`));
  walletSubscription.subscription.premiumSelections.push(
    {
      dayId: walletHistoryDay._id,
      date: walletHistoryDay.date,
      baseSlotKey: "base_slot_3",
      premiumMealId: premiumLobster._id,
      unitExtraFeeHalala: Number(premiumLobster.extraFeeHalala || 0),
      currency: SYSTEM_CURRENCY,
      premiumWalletMode: GENERIC_PREMIUM_WALLET_MODE,
      premiumWalletRowId: walletSubscription.subscription.genericPremiumBalance[0]._id,
      consumedAt: new Date(`${walletHistoryDay.date}T09:00:00+03:00`),
    },
    {
      dayId: walletHistoryDay._id,
      date: walletHistoryDay.date,
      baseSlotKey: "base_slot_2",
      premiumMealId: premiumPrawns._id,
      unitExtraFeeHalala: Number(premiumPrawns.extraFeeHalala || 0),
      currency: SYSTEM_CURRENCY,
      premiumWalletMode: GENERIC_PREMIUM_WALLET_MODE,
      premiumWalletRowId: walletSubscription.subscription.genericPremiumBalance[1]._id,
      consumedAt: new Date(`${walletHistoryDay.date}T09:15:00+03:00`),
    }
  );
  walletSubscription.subscription.addonSelections.push(
    {
      dayId: walletHistoryDay._id,
      date: walletHistoryDay.date,
      addonId: addonSideSalad._id,
      qty: 1,
      unitPriceHalala: Number(addonSideSalad.priceHalala || 0),
      currency: SYSTEM_CURRENCY,
      consumedAt: new Date(`${walletHistoryDay.date}T09:20:00+03:00`),
    },
    {
      dayId: walletHistoryDay._id,
      date: walletHistoryDay.date,
      addonId: addonChia._id,
      qty: 1,
      unitPriceHalala: Number(addonChia.priceHalala || 0),
      currency: SYSTEM_CURRENCY,
      consumedAt: new Date(`${walletHistoryDay.date}T09:25:00+03:00`),
    }
  );
  await walletSubscription.subscription.save();
  await refreshRemainingMeals(walletSubscription.subscription);

  payments.push(
    await createWalletTopupPayment({
      subscription: walletSubscription.subscription,
      user: walletUser,
      type: "premium_topup",
      status: "paid",
      applied: true,
      premiumCount: 3,
      unitCreditPriceHalala: 2400,
      providerSuffix: "wallet-premium-paid",
    }),
    await createWalletTopupPayment({
      subscription: walletSubscription.subscription,
      user: walletUser,
      type: "premium_topup",
      status: "initiated",
      applied: false,
      premiumCount: 2,
      unitCreditPriceHalala: 2400,
      providerSuffix: "wallet-premium-initiated",
    }),
    await createWalletTopupPayment({
      subscription: walletSubscription.subscription,
      user: walletUser,
      type: "addon_topup",
      status: "paid",
      applied: true,
      items: [
        { addonId: addonSideSalad._id, qty: 2, unitPriceHalala: Number(addonSideSalad.priceHalala || 0), currency: SYSTEM_CURRENCY },
        { addonId: addonChia._id, qty: 1, unitPriceHalala: Number(addonChia.priceHalala || 0), currency: SYSTEM_CURRENCY },
      ],
      providerSuffix: "wallet-addon-paid",
    }),
    await createWalletTopupPayment({
      subscription: walletSubscription.subscription,
      user: walletUser,
      type: "addon_topup",
      status: "initiated",
      applied: false,
      items: [
        { addonId: addonGranola._id, qty: 2, unitPriceHalala: Number(addonGranola.priceHalala || 0), currency: SYSTEM_CURRENCY },
      ],
      providerSuffix: "wallet-addon-initiated",
    })
  );

  const premiumOverageUser = usersByKey.get("premium_overage");
  const premiumOverageSub = await createCanonicalSubscription({
    user: premiumOverageUser,
    plan: plan14,
    grams: 500,
    mealsPerDay: 2,
    startDate: buildDayDate(today, -4),
    deliverySelection: createDeliverySelection({
      zone: zoneHittin,
      address: createDeliveryAddress(zoneHittin, 6),
      window: demoSettings.delivery_windows[0],
    }),
    zone: zoneHittin,
    premiumWalletMode: GENERIC_PREMIUM_WALLET_MODE,
    premiumCount: 0,
    premiumUnitPriceHalala: 2400,
    genericPremiumBalance: [],
    source: "customer_checkout",
  });
  subscriptions.push(premiumOverageSub.subscription);
  const overagePendingDay = premiumOverageSub.dayMap.get(buildDayDate(today, 1));
  await applyPlanningState({
    subscription: premiumOverageSub.subscription,
    day: overagePendingDay,
    baseMealIds: selectMealIds(mealsByName, ["Teriyaki Chicken Bowl"]),
    premiumMealIds: selectPremiumIds(premiumMealsByName, ["Wagyu Ribeye"]),
    confirmed: false,
    now: new Date(`${overagePendingDay.date}T09:00:00+03:00`),
  });
  applyPremiumOverageState({
    day: overagePendingDay,
    requestedPremiumSelectionCount: 1,
    walletBackedConsumedCount: 0,
  });
  await overagePendingDay.save();

  const overagePaidDay = premiumOverageSub.dayMap.get(buildDayDate(today, 2));
  await applyPlanningState({
    subscription: premiumOverageSub.subscription,
    day: overagePaidDay,
    baseMealIds: selectMealIds(mealsByName, ["Buddha Bowl"]),
    premiumMealIds: selectPremiumIds(premiumMealsByName, ["Garlic Butter King Prawns"]),
    confirmed: false,
    now: new Date(`${overagePaidDay.date}T09:00:00+03:00`),
  });
  applyPremiumOverageState({
    day: overagePaidDay,
    requestedPremiumSelectionCount: 1,
    walletBackedConsumedCount: 0,
  });
  overagePaidDay.premiumOverageStatus = "paid";
  await overagePaidDay.save();
  payments.push(
    await createPremiumOveragePayment({
      subscription: premiumOverageSub.subscription,
      user: premiumOverageUser,
      day: overagePaidDay,
      premiumOverageCount: 1,
      unitPriceHalala: 2400,
      status: "paid",
      applied: true,
      providerSuffix: "premium-overage-paid",
    })
  );
  await refreshRemainingMeals(premiumOverageSub.subscription);

  const addonPendingUser = usersByKey.get("addon_pending");
  const addonPendingSub = await createCanonicalSubscription({
    user: addonPendingUser,
    plan: plan14,
    grams: 350,
    mealsPerDay: 2,
    startDate: buildDayDate(today, -4),
    deliverySelection: createDeliverySelection({
      zone: zoneSahafa,
      address: createDeliveryAddress(zoneSahafa, 7),
      window: demoSettings.delivery_windows[2],
    }),
    zone: zoneSahafa,
    source: "customer_checkout",
  });
  subscriptions.push(addonPendingSub.subscription);
  const addonPendingDay = addonPendingSub.dayMap.get(buildDayDate(today, 1));
  await applyPlanningState({
    subscription: addonPendingSub.subscription,
    day: addonPendingDay,
    baseMealIds: selectMealIds(mealsByName, ["Pesto Chicken Sandwich", "Grilled Chicken Salad"]),
    confirmed: false,
    now: new Date(`${addonPendingDay.date}T09:00:00+03:00`),
  });
  recomputeOneTimeAddonPlanningState({
    day: addonPendingDay,
    selections: [
      { addonId: addonSideSalad._id, name: getLocalizedEnglishName(addonSideSalad), category: addonSideSalad.category },
      { addonId: addonCheesecake._id, name: getLocalizedEnglishName(addonCheesecake), category: addonCheesecake.category },
    ],
  });
  await addonPendingDay.save();

  const addonPaidDay = addonPendingSub.dayMap.get(buildDayDate(today, 2));
  await applyPlanningState({
    subscription: addonPendingSub.subscription,
    day: addonPaidDay,
    baseMealIds: selectMealIds(mealsByName, ["Turkey Club Sandwich", "Citrus Kale Crunch Salad"]),
    confirmed: false,
    now: new Date(`${addonPaidDay.date}T09:00:00+03:00`),
  });
  recomputeOneTimeAddonPlanningState({
    day: addonPaidDay,
    selections: [
      { addonId: addonHummus._id, name: getLocalizedEnglishName(addonHummus), category: addonHummus.category },
    ],
  });
  addonPaidDay.oneTimeAddonPaymentStatus = "paid";
  addonPaidDay.lockedSnapshot = {
    ...buildLockedSnapshot(addonPendingSub.subscription, addonPaidDay),
    oneTimeAddon: buildOneTimeAddonPlanningSnapshot({ day: addonPaidDay }),
  };
  await addonPaidDay.save();
  payments.push(
    await createOneTimeAddonDayPayment({
      subscription: addonPendingSub.subscription,
      user: addonPendingUser,
      day: addonPaidDay,
      status: "paid",
      applied: true,
      providerSuffix: "one-time-addon-paid",
    })
  );
  await refreshRemainingMeals(addonPendingSub.subscription);

  const canceledUser = usersByKey.get("canceled_subscription");
  const canceledSub = await createCanonicalSubscription({
    user: canceledUser,
    plan: plan7,
    grams: 350,
    mealsPerDay: 2,
    startDate: buildDayDate(today, -12),
    deliverySelection: createDeliverySelection({
      zone: zoneMalqa,
      address: createDeliveryAddress(zoneMalqa, 8),
      window: demoSettings.delivery_windows[1],
    }),
    zone: zoneMalqa,
    source: "customer_checkout",
    status: "canceled",
  });
  subscriptions.push(canceledSub.subscription);
  const canceledDay = canceledSub.dayMap.get(buildDayDate(today, -12));
  await applyPlanningState({
    subscription: canceledSub.subscription,
    day: canceledDay,
    baseMealIds: selectMealIds(mealsByName, ["Grilled Chicken Salad", "Avocado Turkey Salad"]),
    confirmed: true,
    now: new Date(`${canceledDay.date}T08:00:00+03:00`),
  });
  await markFulfilled(canceledSub.subscription, canceledDay, new Date(`${canceledDay.date}T11:00:00+03:00`));
  await refreshRemainingMeals(canceledSub.subscription);

  const newUser = usersByKey.get("new_user");
  const pendingCheckoutQuote = buildQuote({
    plan: plan21,
    grams: 500,
    mealsPerDay: 3,
    startDate: buildDayDate(today, 2),
    delivery: createQuoteDelivery(createDeliverySelection({
      zone: zoneHittin,
      address: createDeliveryAddress(zoneHittin, 21),
      window: demoSettings.delivery_windows[0],
    }), zoneHittin),
    premiumItems: createPremiumQuoteItems([
      { premiumMeal: premiumLobster, qty: 1 },
    ]),
    addonItems: createAddonQuoteItems([
      { addon: recurringGreenJuice, qty: 1 },
    ]),
  });
  const pendingCheckoutContract = buildContractFromQuote({
    quote: pendingCheckoutQuote,
    userId: newUser._id,
    source: "customer_checkout",
  });
  const pendingCheckoutDraft = await createCheckoutDraft({
    user: newUser,
    quote: pendingCheckoutQuote,
    contract: pendingCheckoutContract,
    idempotencyKey: `${SEED_TAG}:checkout:new-user:pending`,
    paymentType: "subscription_activation",
    status: "pending_payment",
    paymentStatus: "initiated",
    paymentApplied: false,
    providerSuffix: "checkout-new-user-pending",
  });
  drafts.push(pendingCheckoutDraft.draft);
  payments.push(pendingCheckoutDraft.payment);

  return { subscriptions, drafts, payments };
}

function countWalletRows(subscriptions) {
  return subscriptions.reduce((sum, subscription) => (
    sum
    + (Array.isArray(subscription.premiumBalance) ? subscription.premiumBalance.length : 0)
    + (Array.isArray(subscription.genericPremiumBalance) ? subscription.genericPremiumBalance.length : 0)
    + (Array.isArray(subscription.addonBalance) ? subscription.addonBalance.length : 0)
  ), 0);
}

async function writeReport({ users, dashboardDocs, subscriptions, drafts, payments }) {
  const sampleAccounts = {
    appUsers: users.map((user) => {
      const demoMeta = demoUsers.find((item) => item.phone === user.phone);
      return {
        key: demoMeta ? demoMeta.key : user.phone,
        email: user.email || null,
        phone: user.phone,
        token: '[TOKEN_REDACTED — generate via /auth/login]',
        useCase: demoMeta ? demoMeta.useCase : "",
      };
    }),
    dashboardUsers: dashboardDocs.map((user) => ({
      email: user.email,
      password: '[SEE .env DASHBOARD_PASSWORD]',
      role: user.role,
    })),
  };

  const report = {
    seedTag: SEED_TAG,
    generatedAt: new Date().toISOString(),
    counts: {
      zones: deliveryZones.length,
      pickupBranches: pickupLocations.length,
      mealCategories: mealCategoryFixtures.length,
      plans: planFixtures.length,
      regularMeals: regularMeals.length,
      premiumMeals: premiumMealFixtures.length,
      addons: addonFixtures.length,
      users: users.length,
      subscriptions: subscriptions.length,
      subscriptionDays: await SubscriptionDay.countDocuments({
        subscriptionId: { $in: subscriptions.map((subscription) => subscription._id) },
      }),
      walletRows: countWalletRows(subscriptions),
      payments: payments.length,
      drafts: drafts.length,
      dashboardUsers: dashboardDocs.length,
    },
    sampleAccounts,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  try {
    console.log("Seeding subscription demo data...");
    console.log(`  clear managed catalog data: ${options.clear}`);
    console.log(`  seed tag: ${SEED_TAG}`);

    await connectDb();

    if (options.clear) {
      await clearManagedCatalogs();
    }

    await upsertSettings();
    const [zones, _mealCategories, plans, meals, premiumMeals, addons, dashboardDocs, { users }] = await Promise.all([
      upsertCatalogDocs(Zone, deliveryZones),
      upsertMealCategories(mealCategoryFixtures),
      upsertCatalogDocs(Plan, planFixtures),
      upsertCatalogDocs(Meal, regularMeals),
      upsertCatalogDocs(PremiumMeal, premiumMealFixtures),
      upsertCatalogDocs(Addon, addonFixtures),
      upsertDashboardUsers(),
      upsertDemoUsersAndApps(),
    ]);

    await purgeDemoUsersDomain(users.map((user) => user._id));

    const usersByKey = new Map(
      users.map((user) => {
        const meta = demoUsers.find((entry) => entry.phone === user.phone);
        return [meta.key, user];
      })
    );
    const plansByName = buildMapByEnglishName(plans);
    const mealsByName = buildMapByEnglishName(meals);
    const premiumMealsByName = buildMapByEnglishName(premiumMeals);
    const addonsByName = buildMapByEnglishName(addons);
    const zonesByName = buildMapByEnglishName(zones);

    const { subscriptions, drafts, payments } = await seedScenarioData({
      usersByKey,
      plansByName,
      mealsByName,
      premiumMealsByName,
      addonsByName,
      zonesByName,
    });

    const report = await writeReport({
      users,
      dashboardDocs,
      subscriptions,
      drafts,
      payments,
    });

    console.log("Subscription demo seed completed successfully.");
    console.log(JSON.stringify(report.counts, null, 2));
    console.log(`Report written to ${REPORT_PATH}`);
    console.log("Important demo app accounts:");
    for (const account of report.sampleAccounts.appUsers.slice(0, 5)) {
      console.log(`  - ${account.key}: ${account.phone} | ${account.email}`);
    }
    console.log("Dashboard login:");
    console.log(`  - superadmin@basicdiet.sa / ${DASHBOARD_PASSWORD}`);
  } catch (error) {
    console.error("Subscription demo seed failed.");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
};
