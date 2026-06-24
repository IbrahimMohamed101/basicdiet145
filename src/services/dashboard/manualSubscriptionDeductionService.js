"use strict";

const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const { runMongoTransactionWithRetry } = require("../mongoTransactionRetryService");
const { MANUAL_DEDUCTION_ACTION } = require("./manualDeduction/constants");
const { ManualDeductionError, assertCashierOrAdminRole } = require("./manualDeduction/ManualDeductionError");
const {
  chooseDefaultSubscription,
  resolveAddonBalances,
  resolveBalances,
  validateBalances,
  validateCounts,
  validateSubscriptionCanDeduct,
} = require("./manualDeduction/manualDeductionPolicy");
const {
  buildDeductionLog,
  buildDeductionResponse,
  serializeCustomer,
  serializeManualDeductionLog,
  serializeSubscription,
} = require("./manualDeduction/manualDeductionPresenter");
const manualDeductionRepository = require("./manualDeduction/manualDeductionRepository");

async function findLastManualDeduction(subscriptionId, businessDate = null, session = null) {
  return manualDeductionRepository.findLastManualDeduction(subscriptionId, businessDate, session);
}

async function buildTodaySummary(subscription, businessDate) {
  const lastToday = await findLastManualDeduction(subscription._id, businessDate);
  const lastAny = lastToday || await findLastManualDeduction(subscription._id);
  return {
    businessDate,
    hasDeliveryDeductionToday: subscription.deliveryMode === "delivery" && Boolean(lastToday),
    lastDeductionAt: lastAny ? lastAny.createdAt || null : null,
  };
}

async function searchByPhone({ phone, role, lang = "en" }) {
  assertCashierOrAdminRole(role);
  const normalizedPhone = String(phone || "").trim();
  if (!normalizedPhone) {
    throw new ManualDeductionError("CUSTOMER_NOT_FOUND", "Customer not found", 404);
  }

  const user = await manualDeductionRepository.findUserByPhone(normalizedPhone);
  if (!user) {
    throw new ManualDeductionError("CUSTOMER_NOT_FOUND", "Customer not found", 404);
  }

  const activeSubscriptions = await manualDeductionRepository.findActiveSubscriptionsByUserId(user._id);

  if (!activeSubscriptions.length) {
    throw new ManualDeductionError("SUBSCRIPTION_NOT_FOUND", "Active subscription not found", 404);
  }

  const businessDate = await getRestaurantBusinessDate();
  const defaultSubscription = chooseDefaultSubscription(activeSubscriptions, businessDate);
  const planIds = [...new Set(activeSubscriptions.map((sub) => String(sub.planId)).filter(Boolean))];
  const plans = await manualDeductionRepository.findPlansByIds(planIds);
  const planMap = new Map(plans.map((plan) => [String(plan._id), plan]));
  const today = await buildTodaySummary(defaultSubscription, businessDate);

  return {
    customer: serializeCustomer(user),
    subscription: serializeSubscription(defaultSubscription, planMap.get(String(defaultSubscription.planId)), lang),
    subscriptions: activeSubscriptions.map((sub) => serializeSubscription(sub, planMap.get(String(sub.planId)), lang)),
    today,
  };
}

async function validateSubscriptionCustomerExists(subscription, session) {
  const customer = await manualDeductionRepository.customerExists(subscription.userId, session);
  if (!customer) {
    throw new ManualDeductionError("CUSTOMER_NOT_FOUND", "Customer not found", 404);
  }
}

async function deductAtomically({ subscription, counts, session }) {
  return manualDeductionRepository.deductAtomically({ subscription, counts, session });
}

async function ensureNoDeliveryDeductionToday(subscription, businessDate, session) {
  if (subscription.deliveryMode !== "delivery") return;
  const existing = await findLastManualDeduction(subscription._id, businessDate, session);
  if (existing) {
    throw new ManualDeductionError("DELIVERY_ALREADY_DEDUCTED_TODAY", "Delivery subscription already deducted today", 409);
  }
}

async function createDeductionLog({ subscription, counts, before, after, actorId, actorRole, reason, notes, businessDate, session }) {
  const log = buildDeductionLog({ subscription, counts, before, after, actorId, actorRole, reason, notes, businessDate });
  await manualDeductionRepository.createDeductionLog(log, session);
}

async function manualDeduction({ subscriptionId, body, actorId, actorRole }) {
  assertCashierOrAdminRole(actorRole);
  if (!manualDeductionRepository.isValidObjectId(subscriptionId)) {
    throw new ManualDeductionError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
  }

  const counts = validateCounts(body || {});
  const businessDate = await getRestaurantBusinessDate();

  try {
    return await runMongoTransactionWithRetry(async (session) => {
      const subscription = await manualDeductionRepository.findSubscriptionById(subscriptionId, session);
      validateSubscriptionCanDeduct(subscription);
      await validateSubscriptionCustomerExists(subscription, session);
      await ensureNoDeliveryDeductionToday(subscription, businessDate, session);
      const before = validateBalances(subscription, counts);
      const updated = await deductAtomically({ subscription, counts, session });
      const after = resolveBalances(updated);
      const afterAddonBalances = resolveAddonBalances(updated);

      await createDeductionLog({
        subscription: updated,
        counts,
        before,
        after,
        actorId,
        actorRole,
        reason: body && body.reason,
        notes: body && body.notes,
        businessDate,
        session,
      });

      return buildDeductionResponse({
        subscription: updated,
        counts,
        balances: after,
        addonBalances: afterAddonBalances,
        businessDate,
      });
    }, {
      label: "manual_subscription_deduction",
      context: { subscriptionId: String(subscriptionId) },
    });
  } catch (err) {
    if (err && err.code === 11000) {
      throw new ManualDeductionError("DELIVERY_ALREADY_DEDUCTED_TODAY", "Delivery subscription already deducted today", 409);
    }
    throw err;
  }
}

async function listManualDeductions({ subscriptionId, role, limit = 50 }) {
  assertCashierOrAdminRole(role);
  if (!manualDeductionRepository.isValidObjectId(subscriptionId)) {
    throw new ManualDeductionError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
  }

  const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const logs = await manualDeductionRepository.listManualDeductionLogs(subscriptionId, cappedLimit);

  return {
    contractVersion: "dashboard_manual_deductions.v1",
    subscriptionId: String(subscriptionId),
    count: logs.length,
    items: logs.map(serializeManualDeductionLog),
  };
}

module.exports = {
  MANUAL_DEDUCTION_ACTION,
  ManualDeductionError,
  listManualDeductions,
  resolveBalances,
  searchByPhone,
  manualDeduction,
  serializeManualDeductionLog,
};
