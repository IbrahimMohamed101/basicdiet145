const mongoose = require("mongoose");

const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const CheckoutDraft = require("../models/CheckoutDraft");
const {
  LEGACY_PREMIUM_MEAL_BUCKET_ID,
  syncPremiumRemainingFromBalance,
  ensureLegacyPremiumBalanceFromRemaining,
} = require("../utils/premiumWallet");
const {
  GENERIC_PREMIUM_WALLET_MODE,
  isGenericPremiumWalletMode,
  appendGenericPremiumCredits,
} = require("./genericPremiumWalletService");
const {
  isCanonicalDayPlanningEligible,
  isCanonicalPremiumOverageEligible,
} = require("./subscriptionDayPlanningService");
const {
  buildOneTimeAddonPaymentSnapshot,
  matchesOneTimeAddonPaymentSnapshot,
} = require("./oneTimeAddonPlanningService");
const {
  isPhase2CanonicalDayPlanningEnabled,
  isPhase2GenericPremiumWalletEnabled,
} = require("../utils/featureFlags");
const { writeLog } = require("../utils/log");
const { logger } = require("../utils/logger");
const {
  finalizeSubscriptionDraftPaymentFlow,
  activatePendingLegacySubscription,
} = require("./subscriptionActivationService");

const SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES = new Set([
  "subscription_activation",
  "subscription_renewal",
  "premium_topup",
  "premium_overage_day",
  "one_time_addon_day_planning",
  "addon_topup",
  "one_time_addon",
  "custom_salad_day",
  "custom_meal_day",
]);

const SYSTEM_CURRENCY = "SAR";

function defaultRuntime() {
  return {
    async findSubscriptionById(subscriptionId, { session } = {}) {
      return Subscription.findById(subscriptionId).session(session);
    },
    async findDraftById(draftId, { session } = {}) {
      return CheckoutDraft.findById(draftId).session(session);
    },
    async findOpenDayAndAddAddon({ subscriptionId, date, addonId, session }) {
      return SubscriptionDay.findOneAndUpdate(
        { subscriptionId, date, status: "open" },
        { $addToSet: { addonsOneTime: addonId } },
        { new: true, session }
      );
    },
    async findDayStatus({ subscriptionId, date, session }) {
      return SubscriptionDay.findOne(
        { subscriptionId, date },
        { status: 1 }
      ).session(session).lean();
    },
    async findDay({ subscriptionId, date, session }) {
      return SubscriptionDay.findOne({ subscriptionId, date }).session(session);
    },
    async findDayById(dayId, { session } = {}) {
      return SubscriptionDay.findById(dayId).session(session);
    },
    async createDay(payload, { session } = {}) {
      const created = await SubscriptionDay.create([payload], { session });
      return created[0];
    },
    async writeLog(payload) {
      await writeLog(payload);
    },
    finalizeSubscriptionDraftPaymentFlow: (...args) => finalizeSubscriptionDraftPaymentFlow(...args),
    activatePendingLegacySubscription: (...args) => activatePendingLegacySubscription(...args),
  };
}

function metadataOf(payment) {
  return payment && payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
}

function isValidObjectId(value) {
  return Boolean(value) && mongoose.Types.ObjectId.isValid(String(value));
}

async function maybeWriteWebhookLog({ source, entityType, entityId, action, meta }, runtime) {
  if (source !== "webhook") return;
  await runtime.writeLog({
    entityType,
    entityId,
    action,
    byRole: "system",
    meta,
  });
}

async function applyPremiumTopupPayment({ subscription, payment, session, source, runtime }) {
  const metadata = metadataOf(payment);
  if (metadata.subscriptionId && String(metadata.subscriptionId) !== String(subscription._id)) {
    return { applied: false, reason: "subscription_mismatch" };
  }

  if (isGenericPremiumWalletMode(subscription)) {
    const count = parseInt(
      metadata.premiumCount
      || metadata.count
      || (Array.isArray(metadata.items)
        ? metadata.items.reduce((sum, item) => sum + parseInt(item && item.qty, 10), 0)
        : 0),
      10
    );
    if (count <= 0) {
      return { applied: false, reason: "invalid_metadata" };
    }

    const configuredUnit = Number(metadata.unitCreditPriceHalala);
    const fallbackUnit = Math.round(Number(payment.amount || 0) / count);
    const unitCreditPriceHalala = Number.isInteger(configuredUnit) && configuredUnit >= 0
      ? configuredUnit
      : Number.isFinite(fallbackUnit) && fallbackUnit >= 0
        ? fallbackUnit
        : 0;

    appendGenericPremiumCredits(subscription, {
      premiumCount: count,
      unitCreditPriceHalala,
      currency: payment.currency || SYSTEM_CURRENCY,
      source: "topup_payment",
    });
    await subscription.save({ session });
    await maybeWriteWebhookLog({
      source,
      entityType: "subscription",
      entityId: subscription._id,
      action: "premium_topup_webhook",
      meta: { count, paymentId: payment.providerPaymentId || payment.providerInvoiceId || String(payment._id) },
    }, runtime);
    return { applied: true, addedCount: count };
  }

  subscription.premiumBalance = subscription.premiumBalance || [];
  if (Array.isArray(metadata.items) && metadata.items.length) {
    let addedCount = 0;
    for (const item of metadata.items) {
      const qty = parseInt(item.qty, 10);
      const unitExtraFeeHalala = Number(item.unitExtraFeeHalala || 0);
      if (!item.premiumMealId || !qty || qty <= 0) continue;
      subscription.premiumBalance.push({
        premiumMealId: item.premiumMealId,
        purchasedQty: qty,
        remainingQty: qty,
        unitExtraFeeHalala,
        currency: item.currency || SYSTEM_CURRENCY,
      });
      addedCount += qty;
    }
    if (addedCount <= 0) {
      return { applied: false, reason: "invalid_items" };
    }
    syncPremiumRemainingFromBalance(subscription);
    await subscription.save({ session });
    await maybeWriteWebhookLog({
      source,
      entityType: "subscription",
      entityId: subscription._id,
      action: "premium_topup_webhook",
      meta: { count: addedCount, paymentId: payment.providerPaymentId || payment.providerInvoiceId || String(payment._id) },
    }, runtime);
    return { applied: true, addedCount };
  }

  const count = parseInt(metadata.premiumCount || metadata.count || 0, 10);
  if (count <= 0) {
    return { applied: false, reason: "invalid_metadata" };
  }

  const configuredUnit = Number(metadata.unitExtraFeeHalala);
  const fallbackUnit = Math.round(Number(payment.amount || 0) / count);
  const unitExtraFeeHalala = Number.isInteger(configuredUnit) && configuredUnit >= 0
    ? configuredUnit
    : Number.isFinite(fallbackUnit) && fallbackUnit >= 0
      ? fallbackUnit
      : 0;

  ensureLegacyPremiumBalanceFromRemaining(subscription, {
    unitExtraFeeHalala,
    currency: payment.currency || SYSTEM_CURRENCY,
  });
  subscription.premiumBalance.push({
    premiumMealId: LEGACY_PREMIUM_MEAL_BUCKET_ID,
    purchasedQty: count,
    remainingQty: count,
    unitExtraFeeHalala,
    currency: payment.currency || SYSTEM_CURRENCY,
  });
  syncPremiumRemainingFromBalance(subscription);
  await subscription.save({ session });
  await maybeWriteWebhookLog({
    source,
    entityType: "subscription",
    entityId: subscription._id,
    action: "premium_topup_webhook",
    meta: { count, paymentId: payment.providerPaymentId || payment.providerInvoiceId || String(payment._id) },
  }, runtime);
  return { applied: true, addedCount: count };
}

async function applyAddonTopupPayment({ subscription, payment, session, source, runtime }) {
  const metadata = metadataOf(payment);
  if (metadata.subscriptionId && String(metadata.subscriptionId) !== String(subscription._id)) {
    return { applied: false, reason: "subscription_mismatch" };
  }
  if (!Array.isArray(metadata.items) || !metadata.items.length) {
    return { applied: false, reason: "invalid_metadata" };
  }

  subscription.addonBalance = subscription.addonBalance || [];
  let addedCount = 0;
  for (const item of metadata.items) {
    const qty = parseInt(item.qty, 10);
    const unitPriceHalala = Number(item.unitPriceHalala || 0);
    if (!item.addonId || !qty || qty <= 0) continue;
    subscription.addonBalance.push({
      addonId: item.addonId,
      purchasedQty: qty,
      remainingQty: qty,
      unitPriceHalala,
      currency: item.currency || SYSTEM_CURRENCY,
    });
    addedCount += qty;
  }
  if (addedCount <= 0) {
    return { applied: false, reason: "invalid_items" };
  }
  await subscription.save({ session });
  await maybeWriteWebhookLog({
    source,
    entityType: "subscription",
    entityId: subscription._id,
    action: "addon_topup_webhook",
    meta: { count: addedCount, paymentId: payment.providerPaymentId || payment.providerInvoiceId || String(payment._id) },
  }, runtime);
  return { applied: true, addedCount };
}

async function applyWalletTopupPayment({ payment, session, source = "system" }, runtimeOverrides = null) {
  const runtime = runtimeOverrides || defaultRuntime();
  const metadata = metadataOf(payment);
  const subscriptionId = payment.subscriptionId || metadata.subscriptionId;
  if (!isValidObjectId(subscriptionId)) {
    return { applied: false, reason: "invalid_metadata" };
  }

  const subscription = await runtime.findSubscriptionById(subscriptionId, { session });
  if (!subscription) {
    return { applied: false, reason: "subscription_not_found" };
  }

  if (payment.type === "premium_topup") {
    return applyPremiumTopupPayment({ subscription, payment, session, source, runtime });
  }
  if (payment.type === "addon_topup") {
    return applyAddonTopupPayment({ subscription, payment, session, source, runtime });
  }
  return { applied: false, reason: "unsupported_payment_type" };
}

async function applyOneTimeAddonPayment({ payment, session, source = "system" }, runtimeOverrides = null) {
  const runtime = runtimeOverrides || defaultRuntime();
  const metadata = metadataOf(payment);
  if (!isValidObjectId(metadata.subscriptionId) || !metadata.addonId || !metadata.date) {
    return { applied: false, reason: "invalid_metadata" };
  }

  const updatedDay = await runtime.findOpenDayAndAddAddon({
    subscriptionId: metadata.subscriptionId,
    date: metadata.date,
    addonId: metadata.addonId,
    session,
  });
  if (updatedDay) {
    await maybeWriteWebhookLog({
      source,
      entityType: "subscription_day",
      entityId: updatedDay._id,
      action: "one_time_addon_webhook",
      meta: { addonId: metadata.addonId, date: metadata.date, paymentId: payment.providerPaymentId || payment.providerInvoiceId || String(payment._id) },
    }, runtime);
    return { applied: true, dayId: String(updatedDay._id) };
  }

  const dayCheck = await runtime.findDayStatus({ subscriptionId: metadata.subscriptionId, date: metadata.date, session });
  if (!dayCheck) {
    return { applied: false, reason: "day_not_found" };
  }
  return { applied: false, reason: `day_not_open:${dayCheck.status}` };
}

async function applyCustomSaladDayPayment({ payment, session, source = "system" }, runtimeOverrides = null) {
  const runtime = runtimeOverrides || defaultRuntime();
  const metadata = metadataOf(payment);
  const snapshot = metadata.snapshot;
  if (!isValidObjectId(metadata.subscriptionId) || !metadata.date || !snapshot) {
    return { applied: false, reason: "invalid_metadata" };
  }

  const existingDay = await runtime.findDay({
    subscriptionId: metadata.subscriptionId,
    date: metadata.date,
    session,
  });

  let updatedDay;
  if (!existingDay) {
    updatedDay = await runtime.createDay({
      subscriptionId: metadata.subscriptionId,
      date: metadata.date,
      status: "open",
      customSalads: [snapshot],
    }, { session });
  } else if (existingDay.status === "open") {
    existingDay.customSalads = existingDay.customSalads || [];
    existingDay.customSalads.push(snapshot);
    await existingDay.save({ session });
    updatedDay = existingDay;
  } else {
    return { applied: false, reason: `day_not_open:${existingDay.status}` };
  }

  await maybeWriteWebhookLog({
    source,
    entityType: "subscription_day",
    entityId: updatedDay._id,
    action: "custom_salad_day_webhook",
    meta: { date: metadata.date, paymentId: payment.providerPaymentId || payment.providerInvoiceId || String(payment._id) },
  }, runtime);

  return { applied: true, dayId: String(updatedDay._id) };
}

async function applyCustomMealDayPayment({ payment, session, source = "system" }, runtimeOverrides = null) {
  const runtime = runtimeOverrides || defaultRuntime();
  const metadata = metadataOf(payment);
  const snapshot = metadata.snapshot;
  if (!isValidObjectId(metadata.subscriptionId) || !metadata.date || !snapshot) {
    return { applied: false, reason: "invalid_metadata" };
  }

  const existingDay = await runtime.findDay({
    subscriptionId: metadata.subscriptionId,
    date: metadata.date,
    session,
  });

  let updatedDay;
  if (!existingDay) {
    updatedDay = await runtime.createDay({
      subscriptionId: metadata.subscriptionId,
      date: metadata.date,
      status: "open",
      customMeals: [snapshot],
    }, { session });
  } else if (existingDay.status === "open") {
    existingDay.customMeals = existingDay.customMeals || [];
    existingDay.customMeals.push(snapshot);
    await existingDay.save({ session });
    updatedDay = existingDay;
  } else {
    return { applied: false, reason: `day_not_open:${existingDay.status}` };
  }

  await maybeWriteWebhookLog({
    source,
    entityType: "subscription_day",
    entityId: updatedDay._id,
    action: "custom_meal_day_webhook",
    meta: { date: metadata.date, paymentId: payment.providerPaymentId || payment.providerInvoiceId || String(payment._id) },
  }, runtime);

  return { applied: true, dayId: String(updatedDay._id) };
}

async function applyPremiumOverageDayPayment({ payment, session, source = "system" }, runtimeOverrides = null) {
  const runtime = runtimeOverrides || defaultRuntime();
  const metadata = metadataOf(payment);

  if (
    !isValidObjectId(metadata.subscriptionId)
    || !metadata.date
    || !Number.isInteger(Number(metadata.premiumOverageCount))
    || Number(metadata.premiumOverageCount) <= 0
  ) {
    return { applied: false, reason: "invalid_metadata" };
  }

  const subscription = await runtime.findSubscriptionById(metadata.subscriptionId, { session });
  if (!subscription) {
    return { applied: false, reason: "subscription_not_found" };
  }

  if (!isCanonicalPremiumOverageEligible(subscription, {
    dayPlanningFlagEnabled: isPhase2CanonicalDayPlanningEnabled(),
    genericPremiumWalletFlagEnabled: isPhase2GenericPremiumWalletEnabled(),
  })) {
    return { applied: false, reason: "overage_not_supported_for_subscription" };
  }

  let day = null;
  if (isValidObjectId(metadata.dayId)) {
    day = await runtime.findDayById(metadata.dayId, { session });
  } else {
    day = await runtime.findDay({
      subscriptionId: metadata.subscriptionId,
      date: metadata.date,
      session,
    });
  }

  if (!day) {
    return { applied: false, reason: "day_not_found" };
  }
  if (String(day.subscriptionId) !== String(subscription._id)) {
    return { applied: false, reason: "day_subscription_mismatch" };
  }
  if (String(day.date) !== String(metadata.date)) {
    return { applied: false, reason: "day_date_mismatch" };
  }
  if (day.status !== "open") {
    return { applied: false, reason: `day_not_open:${day.status}` };
  }

  const currentOverageCount = Number(day.premiumOverageCount || 0);
  if (currentOverageCount <= 0) {
    return { applied: false, reason: "no_pending_overage" };
  }
  if (day.premiumOverageStatus === "paid") {
    return { applied: false, reason: "overage_already_paid" };
  }

  const snapshotOverageCount = Number(metadata.premiumOverageCount || 0);
  if (currentOverageCount !== snapshotOverageCount) {
    return { applied: false, reason: "overage_mismatch" };
  }

  day.premiumOverageStatus = "paid";
  await day.save({ session });

  await maybeWriteWebhookLog({
    source,
    entityType: "subscription_day",
    entityId: day._id,
    action: "premium_overage_day_webhook",
    meta: {
      date: metadata.date,
      premiumOverageCount: snapshotOverageCount,
      paymentId: payment.providerPaymentId || payment.providerInvoiceId || String(payment._id),
    },
  }, runtime);

  return { applied: true, dayId: String(day._id) };
}

async function applyOneTimeAddonDayPlanningPayment({ payment, session, source = "system" }, runtimeOverrides = null) {
  const runtime = runtimeOverrides || defaultRuntime();
  const metadata = metadataOf(payment);

  if (
    !isValidObjectId(metadata.subscriptionId)
    || !metadata.date
    || !Array.isArray(metadata.oneTimeAddonSelections)
    || !Number.isInteger(Number(metadata.oneTimeAddonCount))
    || Number(metadata.oneTimeAddonCount) <= 0
  ) {
    return { applied: false, reason: "invalid_metadata" };
  }

  const snapshot = {
    oneTimeAddonSelections: metadata.oneTimeAddonSelections,
    oneTimeAddonCount: Number(metadata.oneTimeAddonCount || 0),
  };
  if (buildOneTimeAddonPaymentSnapshot({ day: snapshot }).oneTimeAddonCount !== snapshot.oneTimeAddonCount) {
    return { applied: false, reason: "invalid_metadata" };
  }

  const subscription = await runtime.findSubscriptionById(metadata.subscriptionId, { session });
  if (!subscription) {
    return { applied: false, reason: "subscription_not_found" };
  }

  if (!isCanonicalDayPlanningEligible(subscription, {
    flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
  })) {
    return { applied: false, reason: "one_time_addon_planning_not_supported_for_subscription" };
  }

  let day = null;
  if (isValidObjectId(metadata.dayId)) {
    day = await runtime.findDayById(metadata.dayId, { session });
  } else {
    day = await runtime.findDay({
      subscriptionId: metadata.subscriptionId,
      date: metadata.date,
      session,
    });
  }

  if (!day) {
    return { applied: false, reason: "day_not_found" };
  }
  if (String(day.subscriptionId) !== String(subscription._id)) {
    return { applied: false, reason: "day_subscription_mismatch" };
  }
  if (String(day.date) !== String(metadata.date)) {
    return { applied: false, reason: "day_date_mismatch" };
  }
  if (day.status !== "open") {
    return { applied: false, reason: `day_not_open:${day.status}` };
  }
  if (Number(day.oneTimeAddonPendingCount || 0) <= 0) {
    return { applied: false, reason: "no_pending_one_time_addons" };
  }
  if (day.oneTimeAddonPaymentStatus === "paid") {
    return { applied: false, reason: "one_time_addons_already_paid" };
  }
  if (!matchesOneTimeAddonPaymentSnapshot({
    day,
    oneTimeAddonSelections: metadata.oneTimeAddonSelections,
  })) {
    return { applied: false, reason: "one_time_addon_mismatch" };
  }

  day.oneTimeAddonPaymentStatus = "paid";
  await day.save({ session });

  await maybeWriteWebhookLog({
    source,
    entityType: "subscription_day",
    entityId: day._id,
    action: "one_time_addon_day_planning_webhook",
    meta: {
      date: metadata.date,
      oneTimeAddonCount: snapshot.oneTimeAddonCount,
      paymentId: payment.providerPaymentId || payment.providerInvoiceId || String(payment._id),
    },
  }, runtime);

  return { applied: true, dayId: String(day._id) };
}

async function applySubscriptionActivationPayment({ payment, session, source = "system" }, runtimeOverrides = null) {
  const runtime = runtimeOverrides || defaultRuntime();
  const metadata = metadataOf(payment);

  if (isValidObjectId(metadata.draftId)) {
    const draft = await runtime.findDraftById(metadata.draftId, { session });
    return runtime.finalizeSubscriptionDraftPaymentFlow({ draft, payment, session });
  }

  if (isValidObjectId(metadata.subscriptionId)) {
    const subscription = await runtime.findSubscriptionById(metadata.subscriptionId, { session });
    return runtime.activatePendingLegacySubscription({ subscription, session });
  }

  return { applied: false, reason: "invalid_metadata" };
}

async function applyPaymentSideEffects({ payment, session, source = "system" }, runtimeOverrides = null) {
  if (!payment || !payment.type) {
    logger.warn("applyPaymentSideEffects failed: invalid payment", {
      paymentId: payment && payment._id ? String(payment._id) : null,
      source
    });
    return { applied: false, reason: "invalid_payment" };
  }

  let result;
  switch (String(payment.type)) {
    case "subscription_activation":
    case "subscription_renewal":
      result = await applySubscriptionActivationPayment({ payment, session, source }, runtimeOverrides);
      break;
    case "premium_topup":
    case "premium_overage_day":
    case "one_time_addon_day_planning":
    case "addon_topup":
      if (String(payment.type) === "premium_overage_day") {
        result = await applyPremiumOverageDayPayment({ payment, session, source }, runtimeOverrides);
      } else if (String(payment.type) === "one_time_addon_day_planning") {
        result = await applyOneTimeAddonDayPlanningPayment({ payment, session, source }, runtimeOverrides);
      } else {
        result = await applyWalletTopupPayment({ payment, session, source }, runtimeOverrides);
      }
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
    logger.warn("Payment side effects not applied", {
      paymentId: String(payment._id),
      type: payment.type,
      reason: result.reason,
      source
    });
  }

  return result;
}

module.exports = {
  SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES,
  applyPremiumTopupPayment,
  applyAddonTopupPayment,
  applyWalletTopupPayment,
  applyPremiumOverageDayPayment,
  applyOneTimeAddonDayPlanningPayment,
  applyOneTimeAddonPayment,
  applyCustomSaladDayPayment,
  applyCustomMealDayPayment,
  applySubscriptionActivationPayment,
  applyPaymentSideEffects,
};
