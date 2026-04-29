const mongoose = require("mongoose");

const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const CheckoutDraft = require("../models/CheckoutDraft");
const { resolveMealsPerDay } = require("../utils/subscription/subscriptionDaySelectionSync");
const { recomputePlannerMetaFromSlots, projectMaterializedAndLegacyForExistingSlots } = require("./subscription/mealSlotPlannerService");
const { writeLog } = require("../utils/log");
const { logger } = require("../utils/logger");
const { finalizeSubscriptionDraftPaymentFlow } = require("./subscription/subscriptionActivationService");
const { settlePaidPremiumExtraDayPayment } = require("./subscription/premiumExtraDayPaymentService");
const { getPaymentMetadata } = require("./subscription/subscriptionCheckoutHelpers");

const SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES = new Set([
  "subscription_activation",
  "subscription_renewal",
  "premium_extra_day",
  "one_time_addon_day_planning",
  "one_time_addon",
  "custom_salad_day",
  "custom_meal_day",
]);

function defaultRuntime() {
  return {
    async findSubscriptionById(subscriptionId, { session } = {}) { return Subscription.findById(subscriptionId).session(session); },
    async findDraftById(draftId, { session } = {}) { return CheckoutDraft.findById(draftId).session(session); },
    async findOpenDayAndAddAddon({ subscriptionId, date, addonId, session }) {
      return SubscriptionDay.findOneAndUpdate({ subscriptionId, date, status: "open" }, { $addToSet: { addonsOneTime: addonId } }, { new: true, session });
    },
    async findDayStatus({ subscriptionId, date, session }) { return SubscriptionDay.findOne({ subscriptionId, date }, { status: 1 }).session(session).lean(); },
    async findDay({ subscriptionId, date, session }) { return SubscriptionDay.findOne({ subscriptionId, date }).session(session); },
    async findDayById(dayId, { session } = {}) { return SubscriptionDay.findById(dayId).session(session); },
    async createDay(payload, { session } = {}) { const created = await SubscriptionDay.create([payload], { session }); return created[0]; },
    async writeLog(payload) { await writeLog(payload); },
    finalizeSubscriptionDraftPaymentFlow: (...args) => finalizeSubscriptionDraftPaymentFlow(...args),
  };
}

function metadataOf(payment) {
  return getPaymentMetadata(payment);
}

function isValidObjectId(value) {
  return Boolean(value) && mongoose.Types.ObjectId.isValid(String(value));
}

function normalizeOneTimeAddonSnapshotKey(item = {}) {
  const addonId = String(item.addonId || "");
  const unitPriceHalala = Number(item.unitPriceHalala || item.priceHalala || 0);
  const currency = String(item.currency || "").toUpperCase();
  return `${addonId}::${unitPriceHalala}::${currency}`;
}

function buildOneTimeAddonSnapshotCountMap(items = []) {
  return items.reduce((map, item) => {
    const key = normalizeOneTimeAddonSnapshotKey(item);
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map());
}

async function maybeWriteWebhookLog({ source, entityType, entityId, action, meta }, runtime) {
  if (source !== "webhook") return;
  await runtime.writeLog({ entityType, entityId, action, byRole: "system", meta });
}

async function applyOneTimeAddonPayment({ payment, session, source = "system" }, runtimeOverrides = null) {
  const runtime = runtimeOverrides || defaultRuntime();
  const metadata = metadataOf(payment);
  if (!isValidObjectId(metadata.subscriptionId) || !metadata.addonId || !metadata.date) return { applied: false, reason: "invalid_metadata" };

  const updatedDay = await runtime.findOpenDayAndAddAddon({ subscriptionId: metadata.subscriptionId, date: metadata.date, addonId: metadata.addonId, session });
  if (updatedDay) {
    await maybeWriteWebhookLog({ source, entityType: "subscription_day", entityId: updatedDay._id, action: "one_time_addon_webhook", meta: { addonId: metadata.addonId, date: metadata.date, paymentId: payment.providerPaymentId || payment.providerInvoiceId || String(payment._id) } }, runtime);
    return { applied: true, dayId: String(updatedDay._id) };
  }

  const dayCheck = await runtime.findDayStatus({ subscriptionId: metadata.subscriptionId, date: metadata.date, session });
  if (!dayCheck) return { applied: false, reason: "day_not_found" };
  return { applied: false, reason: `day_not_open:${dayCheck.status}` };
}

async function applyCustomSaladDayPayment({ payment, session, source = "system" }, runtimeOverrides = null) {
  const runtime = runtimeOverrides || defaultRuntime();
  const metadata = metadataOf(payment);
  const snapshot = metadata.snapshot;
  if (!isValidObjectId(metadata.subscriptionId) || !metadata.date || !snapshot) return { applied: false, reason: "invalid_metadata" };

  const existingDay = await runtime.findDay({ subscriptionId: metadata.subscriptionId, date: metadata.date, session });
  let updatedDay;
  if (!existingDay) {
    updatedDay = await runtime.createDay({ subscriptionId: metadata.subscriptionId, date: metadata.date, status: "open", customSalads: [snapshot] }, { session });
  } else if (existingDay.status === "open") {
    existingDay.customSalads = existingDay.customSalads || [];
    existingDay.customSalads.push(snapshot);
    await existingDay.save({ session });
    updatedDay = existingDay;
  } else {
    return { applied: false, reason: `day_not_open:${existingDay.status}` };
  }

  await maybeWriteWebhookLog({ source, entityType: "subscription_day", entityId: updatedDay._id, action: "custom_salad_day_webhook", meta: { date: metadata.date, paymentId: payment.providerPaymentId || payment.providerInvoiceId || String(payment._id) } }, runtime);
  return { applied: true, dayId: String(updatedDay._id) };
}

async function applyCustomMealDayPayment({ payment, session, source = "system" }, runtimeOverrides = null) {
  const runtime = runtimeOverrides || defaultRuntime();
  const metadata = metadataOf(payment);
  const snapshot = metadata.snapshot;
  if (!isValidObjectId(metadata.subscriptionId) || !metadata.date || !snapshot) return { applied: false, reason: "invalid_metadata" };

  const existingDay = await runtime.findDay({ subscriptionId: metadata.subscriptionId, date: metadata.date, session });
  let updatedDay;
  if (!existingDay) {
    updatedDay = await runtime.createDay({ subscriptionId: metadata.subscriptionId, date: metadata.date, status: "open", customMeals: [snapshot] }, { session });
  } else if (existingDay.status === "open") {
    existingDay.customMeals = existingDay.customMeals || [];
    existingDay.customMeals.push(snapshot);
    await existingDay.save({ session });
    updatedDay = existingDay;
  } else {
    return { applied: false, reason: `day_not_open:${existingDay.status}` };
  }

  await maybeWriteWebhookLog({ source, entityType: "subscription_day", entityId: updatedDay._id, action: "custom_meal_day_webhook", meta: { date: metadata.date, paymentId: payment.providerPaymentId || payment.providerInvoiceId || String(payment._id) } }, runtime);
  return { applied: true, dayId: String(updatedDay._id) };
}

async function applyOneTimeAddonDayPlanningPayment({ payment, session, source = "system" }, runtimeOverrides = null) {
  const runtime = runtimeOverrides || defaultRuntime();
  const metadata = metadataOf(payment);
  if (!isValidObjectId(metadata.subscriptionId) || !metadata.date || !Array.isArray(metadata.oneTimeAddonSelections)) {
    return { applied: false, reason: "invalid_metadata" };
  }

  const subscription = await runtime.findSubscriptionById(metadata.subscriptionId, { session });
  if (!subscription) return { applied: false, reason: "subscription_not_found" };

  let day = isValidObjectId(metadata.dayId) ? await runtime.findDayById(metadata.dayId, { session }) : await runtime.findDay({ subscriptionId: metadata.subscriptionId, date: metadata.date, session });
  if (!day) return { applied: false, reason: "day_not_found" };
  if (String(day.subscriptionId) !== String(subscription._id)) return { applied: false, reason: "day_subscription_mismatch" };
  if (String(day.date) !== String(metadata.date)) return { applied: false, reason: "day_date_mismatch" };
  if (day.status !== "open") return { applied: false, reason: `day_not_open:${day.status}` };

  const pendingSelections = (day.addonSelections || []).filter(s => s.source === "pending_payment");
  if (pendingSelections.length === 0) return { applied: false, reason: "no_pending_one_time_addons" };

  const expectedSnapshotMap = buildOneTimeAddonSnapshotCountMap(metadata.oneTimeAddonSelections);
  const pendingSnapshotMap = buildOneTimeAddonSnapshotCountMap(pendingSelections);
  if (expectedSnapshotMap.size !== pendingSnapshotMap.size) {
    return { applied: false, reason: "payment_snapshot_mismatch" };
  }
  for (const [key, count] of expectedSnapshotMap.entries()) {
    if (pendingSnapshotMap.get(key) !== count) {
      return { applied: false, reason: "payment_snapshot_mismatch" };
    }
  }

  // Update them to paid
  day.addonSelections = (day.addonSelections || []).map(s => {
    if (s.source === "pending_payment") {
      return { ...s, source: "paid", paidAt: new Date(), paymentId: payment._id };
    }
    return s;
  });

  day.markModified("addonSelections");
  await day.save({ session });
  
  await maybeWriteWebhookLog({ source, entityType: "subscription_day", entityId: day._id, action: "one_time_addon_day_planning_webhook", meta: { date: metadata.date, paymentId: payment.providerPaymentId || payment.providerInvoiceId || String(payment._id) } }, runtime);
  return { applied: true, dayId: String(day._id) };
}

async function applyPremiumExtraDayPayment({ payment, session, source = "system" }, runtimeOverrides = null) {
  const runtime = runtimeOverrides || defaultRuntime();
  const metadata = metadataOf(payment);
  if (!isValidObjectId(metadata.subscriptionId) || !metadata.date) {
    return { applied: false, reason: "invalid_metadata" };
  }

  const subscription = await runtime.findSubscriptionById(metadata.subscriptionId, { session });
  if (!subscription) return { applied: false, reason: "subscription_not_found" };

  const day = isValidObjectId(metadata.dayId)
    ? await runtime.findDayById(metadata.dayId, { session })
    : await runtime.findDay({ subscriptionId: metadata.subscriptionId, date: metadata.date, session });
  if (!day) return { applied: false, reason: "day_not_found" };
  if (String(day.subscriptionId) !== String(subscription._id)) return { applied: false, reason: "day_subscription_mismatch" };
  if (String(day.date) !== String(metadata.date)) return { applied: false, reason: "day_date_mismatch" };

  return settlePaidPremiumExtraDayPayment({
    subscription,
    day,
    payment,
    session,
    userId: payment && payment.userId ? payment.userId : null,
    logDate: metadata.date,
    writeLogFn: source === "webhook"
      ? async (payload) => runtime.writeLog({ ...payload, byRole: "system" })
      : null,
  });
}

async function applySubscriptionActivationPayment({ payment, session, source = "system" }, runtimeOverrides = null) {
  const runtime = runtimeOverrides || defaultRuntime();
  const metadata = metadataOf(payment);
  if (isValidObjectId(metadata.draftId)) {
    const draft = await runtime.findDraftById(metadata.draftId, { session });
    return runtime.finalizeSubscriptionDraftPaymentFlow({ draft, payment, session });
  }
  return { applied: false, reason: "invalid_metadata" };
}

async function applyPaymentSideEffects({ payment, session, source = "system" }, runtimeOverrides = null) {
  if (!payment || !payment.type) {
    logger.warn("applyPaymentSideEffects failed: invalid payment", { paymentId: payment && payment._id ? String(payment._id) : null, source });
    return { applied: false, reason: "invalid_payment" };
  }

  let result;
  switch (String(payment.type)) {
    case "subscription_activation":
    case "subscription_renewal":
      result = await applySubscriptionActivationPayment({ payment, session, source }, runtimeOverrides);
      break;
    case "premium_extra_day":
      result = await applyPremiumExtraDayPayment({ payment, session, source }, runtimeOverrides);
      break;
    case "one_time_addon_day_planning":
      result = await applyOneTimeAddonDayPlanningPayment({ payment, session, source }, runtimeOverrides);
      break;
    case "one_time_addon":
      result = await applyOneTimeAddonPayment({ payment, session, source }, runtimeOverrides);
      break;
    case "custom_salad_day":
      result = await applyCustomSaladDayPayment({ payment, session, source }, runtimeOverrides);
      break;
    case "custom_meal_day":
      result = await applyCustomMealDayPayment({ payment, session, source }, runtimeOverrides);
      break;
    default:
      result = { applied: false, reason: "unsupported_payment_type" };
  }

  if (result && !result.applied) {
    logger.warn("Payment side effects not applied", { paymentId: String(payment._id), type: payment.type, reason: result.reason, source });
  }
  return result;
}

module.exports = {
  SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES,
  applyOneTimeAddonDayPlanningPayment,
  applyPremiumExtraDayPayment,
  applyOneTimeAddonPayment,
  applyCustomSaladDayPayment,
  applyCustomMealDayPayment,
  applySubscriptionActivationPayment,
  applyPaymentSideEffects,
};
