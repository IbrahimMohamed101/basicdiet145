"use strict";

const Payment = require("../../models/Payment");
const Plan = require("../../models/Plan");
const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const { pickLang } = require("../../utils/i18n");

const DASHBOARD_STACKING_READ_VERSION = "dashboard_stacking_read.v1";

function stringId(value) {
  return value ? String(value && value._id ? value._id : value) : "";
}

function isSubscriptionReadModel(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const id = stringId(value._id || value.id);
  return /^[a-f0-9]{24}$/i.test(id)
    && Object.prototype.hasOwnProperty.call(value, "totalMeals")
    && Object.prototype.hasOwnProperty.call(value, "remainingMeals");
}

function subscriptionModelsInPayload(payload) {
  const data = payload && payload.data;
  if (Array.isArray(data)) return data.filter(isSubscriptionReadModel);
  if (isSubscriptionReadModel(data)) return [data];
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];

  return [
    ...(Array.isArray(data.subscriptions)
      ? data.subscriptions.filter(isSubscriptionReadModel)
      : []),
    ...(isSubscriptionReadModel(data.subscription) ? [data.subscription] : []),
    ...(Array.isArray(data.items)
      ? data.items.filter(isSubscriptionReadModel)
      : []),
  ];
}

function paymentReadModel(payment) {
  if (!payment) return null;
  return {
    id: stringId(payment._id),
    status: payment.status || null,
    type: payment.type || null,
    provider: payment.provider || null,
    method: payment.method
      || (payment.metadata && payment.metadata.paymentMethod)
      || null,
    amountHalala: Number(payment.amount || 0),
    currency: payment.currency || "SAR",
    providerReference:
      payment.providerPaymentId || payment.providerInvoiceId || null,
    paidAt: payment.paidAt || null,
    createdAt: payment.createdAt || null,
  };
}

function batchReadModel(batch, { planNames, payments } = {}) {
  const planId = stringId(batch.planId);
  const paymentId = stringId(batch.paymentId);
  return {
    id: stringId(batch._id),
    sourceType: batch.sourceType,
    isLegacyPackage: batch.sourceType === "legacy_seed",
    planId,
    planName: planNames.get(planId) || null,
    status: batch.status,
    applicationState: batch.applicationState,
    requestedStartDate: batch.requestedStartDate || null,
    effectiveStartDate: batch.effectiveStartDate || null,
    endDate: batch.endDate || null,
    validityEndDate: batch.validityEndDate || null,
    daysCount: Number(batch.daysCount || 0),
    mealsPerDay: Number(batch.mealsPerDay || 0),
    proteinGrams: Number(batch.proteinGrams || 0),
    totalMeals: Number(batch.totalMeals || 0),
    remainingMeals: Number(batch.remainingMeals || 0),
    reservedMeals: Number(batch.reservedMeals || 0),
    consumedMeals: Number(batch.consumedMeals || 0),
    forfeitedMeals: Number(batch.forfeitedMeals || 0),
    fulfillment: batch.deliverySnapshot || null,
    pricing: batch.pricingSnapshot || null,
    payment: paymentReadModel(payments.get(paymentId)),
    createdAt: batch.createdAt || null,
  };
}

function defaultRuntime() {
  return {
    findBatches(subscriptionIds) {
      return SubscriptionEntitlementBatch.find({
        containerSubscriptionId: { $in: subscriptionIds },
      })
        .sort({ effectiveStartDate: 1, createdAt: 1, _id: 1 })
        .lean();
    },
    findPlans(planIds) {
      return Plan.find({ _id: { $in: planIds } }).select("_id name").lean();
    },
    findPayments(paymentIds) {
      return Payment.find({ _id: { $in: paymentIds } })
        .select(
          "_id status type provider method amount currency providerInvoiceId providerPaymentId metadata.paymentMethod paidAt createdAt"
        )
        .lean();
    },
  };
}

function buildContext({ subscription, batches, planNames, payments }) {
  const packages = batches.map((batch) => batchReadModel(batch, {
    planNames,
    payments,
  }));
  const transactionById = new Map();
  for (const item of packages) {
    if (item.payment) transactionById.set(item.payment.id, item.payment);
  }

  return {
    version: DASHBOARD_STACKING_READ_VERSION,
    hasEntitlementBatches: packages.length > 0,
    isCombinedPackage: packages.length > 1,
    packageCount: packages.length,
    parentSubscriptionId: stringId(subscription._id || subscription.id),
    parentRole: "operational_container",
    manualDeductionAllowed: packages.length === 0,
    aggregateBalance: {
      totalMeals: Number(subscription.totalMeals || 0),
      remainingMeals: Number(subscription.remainingMeals || 0),
      reservedMeals: Number(subscription.reservedMeals || 0),
      consumedMeals: Number(subscription.consumedMeals || 0),
      forfeitedMeals: Number(subscription.forfeitedMeals || 0),
    },
    packages,
    transactions: Array.from(transactionById.values()),
  };
}

function applyContexts(payload, contexts) {
  const decorate = (value) => {
    if (!isSubscriptionReadModel(value)) return value;
    const id = stringId(value._id || value.id);
    return { ...value, stacking: contexts.get(id) };
  };
  const data = payload.data;

  if (Array.isArray(data)) {
    return { ...payload, data: data.map(decorate) };
  }
  if (isSubscriptionReadModel(data)) {
    return { ...payload, data: decorate(data) };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return payload;

  return {
    ...payload,
    data: {
      ...data,
      ...(Array.isArray(data.subscriptions)
        ? { subscriptions: data.subscriptions.map(decorate) }
        : {}),
      ...(isSubscriptionReadModel(data.subscription)
        ? { subscription: decorate(data.subscription) }
        : {}),
      ...(Array.isArray(data.items)
        ? { items: data.items.map(decorate) }
        : {}),
    },
  };
}

async function projectDashboardStackingReadModel(payload, {
  lang = "ar",
  runtime: runtimeOverrides = null,
} = {}) {
  const subscriptions = subscriptionModelsInPayload(payload);
  if (subscriptions.length === 0) return payload;

  const runtime = { ...defaultRuntime(), ...(runtimeOverrides || {}) };
  const subscriptionIds = [
    ...new Set(subscriptions.map((item) => stringId(item._id || item.id))),
  ];
  const batches = await runtime.findBatches(subscriptionIds);
  const planIds = [...new Set(batches.map((batch) => stringId(batch.planId)).filter(Boolean))];
  const paymentIds = [
    ...new Set(batches.map((batch) => stringId(batch.paymentId)).filter(Boolean)),
  ];
  const [plans, paymentRows] = await Promise.all([
    planIds.length ? runtime.findPlans(planIds) : [],
    paymentIds.length ? runtime.findPayments(paymentIds) : [],
  ]);
  const planNames = new Map(plans.map((plan) => [
    stringId(plan._id),
    pickLang(plan.name, lang) || pickLang(plan.name, "en") || null,
  ]));
  const payments = new Map(paymentRows.map((payment) => [
    stringId(payment._id),
    payment,
  ]));
  const batchesByParent = new Map();
  for (const batch of batches) {
    const parentId = stringId(batch.containerSubscriptionId);
    const rows = batchesByParent.get(parentId) || [];
    rows.push(batch);
    batchesByParent.set(parentId, rows);
  }

  const contexts = new Map(subscriptions.map((subscription) => {
    const id = stringId(subscription._id || subscription.id);
    return [id, buildContext({
      subscription,
      batches: batchesByParent.get(id) || [],
      planNames,
      payments,
    })];
  }));
  return applyContexts(payload, contexts);
}

module.exports = {
  DASHBOARD_STACKING_READ_VERSION,
  applyContexts,
  batchReadModel,
  buildContext,
  isSubscriptionReadModel,
  paymentReadModel,
  projectDashboardStackingReadModel,
  subscriptionModelsInPayload,
};
