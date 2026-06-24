"use strict";

const mongoose = require("mongoose");
const User = require("../../models/User");
const Plan = require("../../models/Plan");
const Subscription = require("../../models/Subscription");
const ActivityLog = require("../../models/ActivityLog");
const { pickLang } = require("../../utils/i18n");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const { runMongoTransactionWithRetry } = require("../mongoTransactionRetryService");
const { ACTIVE_STATUS, MANUAL_DEDUCTION_ACTION } = require("./manualDeduction/constants");
const { ManualDeductionError, assertCashierOrAdminRole } = require("./manualDeduction/ManualDeductionError");
const {
  buildPremiumAllocation,
  chooseDefaultSubscription,
  resolveAddonBalances,
  resolveBalances,
  validateBalances,
  validateCounts,
  validateSubscriptionCanDeduct,
} = require("./manualDeduction/manualDeductionPolicy");

function serializeCustomer(user) {
  return {
    id: String(user._id),
    name: user.name || "",
    phone: user.phone || "",
  };
}

function serializeSubscription(subscription, plan, lang = "en") {
  const balances = resolveBalances(subscription);
  const addonBalances = resolveAddonBalances(subscription);
  return {
    id: String(subscription._id),
    planName: plan ? pickLang(plan.name, lang) || pickLang(plan.name, "en") || "" : "",
    status: subscription.status,
    fulfillmentMethod: subscription.deliveryMode === "pickup" ? "pickup" : "delivery",
    totalMeals: balances.totalMeals,
    consumedMeals: balances.consumedMeals,
    remainingMeals: balances.remainingMeals,
    remainingRegularMeals: balances.remainingRegularMeals,
    remainingPremiumMeals: balances.remainingPremiumMeals,
    addonBalances,
  };
}

async function findLastManualDeduction(subscriptionId, businessDate = null, session = null) {
  const query = {
    entityType: "subscription",
    entityId: subscriptionId,
    action: MANUAL_DEDUCTION_ACTION,
  };
  if (businessDate) {
    query["meta.businessDate"] = businessDate;
  }
  let cursor = ActivityLog.findOne(query).sort({ createdAt: -1 });
  if (session) cursor = cursor.session(session);
  return cursor.lean();
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

  const user = await User.findOne({ phone: normalizedPhone }).lean();
  if (!user) {
    throw new ManualDeductionError("CUSTOMER_NOT_FOUND", "Customer not found", 404);
  }

  const activeSubscriptions = await Subscription.find({
    userId: user._id,
    status: ACTIVE_STATUS,
  }).sort({ createdAt: -1 }).lean();

  if (!activeSubscriptions.length) {
    throw new ManualDeductionError("SUBSCRIPTION_NOT_FOUND", "Active subscription not found", 404);
  }

  const businessDate = await getRestaurantBusinessDate();
  const defaultSubscription = chooseDefaultSubscription(activeSubscriptions, businessDate);
  const planIds = [...new Set(activeSubscriptions.map((sub) => String(sub.planId)).filter(Boolean))];
  const plans = await Plan.find({ _id: { $in: planIds } }).lean();
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
  const customer = await User.exists({ _id: subscription.userId }).session(session);
  if (!customer) {
    throw new ManualDeductionError("CUSTOMER_NOT_FOUND", "Customer not found", 404);
  }
}

async function deductAtomically({ subscription, counts, session }) {
  const allocations = buildPremiumAllocation(subscription, counts.premiumMeals);
  const filter = {
    _id: subscription._id,
    status: ACTIVE_STATUS,
    remainingMeals: { $gte: counts.total },
  };
  
  const andClauses = [];
  if (allocations.length) {
    andClauses.push(...allocations.map((allocation) => ({
      premiumBalance: {
        $elemMatch: {
          _id: allocation.rowId,
          remainingQty: { $gte: allocation.qty },
        },
      },
    })));
  }

  if (counts.addons && counts.addons.length > 0) {
    andClauses.push(...counts.addons.map((addonReq) => ({
      addonBalance: {
        $elemMatch: {
          addonId: new mongoose.Types.ObjectId(addonReq.addonId),
          remainingQty: { $gte: addonReq.qty },
        },
      },
    })));
  }

  if (andClauses.length > 0) {
    filter.$and = andClauses;
  }

  const update = {};
  if (counts.total > 0) {
    update.$inc = { remainingMeals: -counts.total };
  }
  
  const options = { new: true, session };
  const arrayFilters = [];
  
  if (allocations.length) {
    if (!update.$inc) update.$inc = {};
    allocations.forEach((allocation, index) => {
      update.$inc[`premiumBalance.$[p${index}].remainingQty`] = -allocation.qty;
      arrayFilters.push({ [`p${index}._id`]: allocation.rowId });
    });
  }

  if (counts.addons && counts.addons.length > 0) {
    if (!update.$inc) update.$inc = {};
    counts.addons.forEach((addonReq, index) => {
      update.$inc[`addonBalance.$[a${index}].remainingQty`] = -addonReq.qty;
      arrayFilters.push({ [`a${index}.addonId`]: new mongoose.Types.ObjectId(addonReq.addonId) });
    });
  }

  if (arrayFilters.length > 0) {
    options.arrayFilters = arrayFilters;
  }

  const updated = await Subscription.findOneAndUpdate(filter, update, options);
  if (!updated) {
    throw new ManualDeductionError("INSUFFICIENT_REMAINING_MEALS", "Subscription balance changed; not enough remaining balance", 409);
  }
  return updated;
}

async function ensureNoDeliveryDeductionToday(subscription, businessDate, session) {
  if (subscription.deliveryMode !== "delivery") return;
  const existing = await findLastManualDeduction(subscription._id, businessDate, session);
  if (existing) {
    throw new ManualDeductionError("DELIVERY_ALREADY_DEDUCTED_TODAY", "Delivery subscription already deducted today", 409);
  }
}

async function createDeductionLog({ subscription, counts, before, after, actorId, actorRole, reason, notes, businessDate, session }) {
  const deductedAddons = before.beforeAddons ? before.beforeAddons.map(b => ({
    addonId: String(b.addonId),
    qty: b.qty,
    remainingBefore: b.remainingBefore,
    remainingAfter: Math.max(0, b.remainingBefore - b.qty)
  })) : [];

  const log = {
    entityType: "subscription",
    entityId: subscription._id,
    action: MANUAL_DEDUCTION_ACTION,
    byUserId: actorId,
    byRole: actorRole,
    meta: {
      subscriptionId: String(subscription._id),
      customerId: String(subscription.userId),
      deductedRegularMeals: counts.regularMeals,
      deductedPremiumMeals: counts.premiumMeals,
      deductedTotalMeals: counts.total,
      deductedAddons,
      before: {
        remainingRegularMeals: before.remainingRegularMeals,
        remainingPremiumMeals: before.remainingPremiumMeals,
        remainingMeals: before.remainingMeals,
      },
      after: {
        remainingRegularMeals: after.remainingRegularMeals,
        remainingPremiumMeals: after.remainingPremiumMeals,
        remainingMeals: after.remainingMeals,
      },
      actorId: actorId ? String(actorId) : null,
      actorRole,
      reason: String(reason || ""),
      notes: String(notes || ""),
      fulfillmentMethod: subscription.deliveryMode === "pickup" ? "pickup" : "delivery",
      isPickup: subscription.deliveryMode === "pickup",
      isDelivery: subscription.deliveryMode === "delivery",
      businessDate,
    },
  };
  await ActivityLog.create([log], { session });
}

async function manualDeduction({ subscriptionId, body, actorId, actorRole }) {
  assertCashierOrAdminRole(actorRole);
  if (!mongoose.Types.ObjectId.isValid(subscriptionId)) {
    throw new ManualDeductionError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
  }

  const counts = validateCounts(body || {});
  const businessDate = await getRestaurantBusinessDate();

  try {
    return await runMongoTransactionWithRetry(async (session) => {
      const subscription = await Subscription.findById(subscriptionId).session(session);
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

      return {
        subscriptionId: String(updated._id),
        deducted: {
          regularMeals: counts.regularMeals,
          premiumMeals: counts.premiumMeals,
          total: counts.total,
          addons: counts.addons.map(a => ({ addonId: a.addonId, qty: a.qty })),
        },
        remaining: {
          regularMeals: after.remainingRegularMeals,
          premiumMeals: after.remainingPremiumMeals,
          totalMeals: after.remainingMeals,
          addons: afterAddonBalances.map(a => ({ addonId: String(a.addonId), remainingQty: a.remainingQty })),
        },
        businessDate,
        fulfillmentMethod: updated.deliveryMode === "pickup" ? "pickup" : "delivery",
      };
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

function serializeManualDeductionLog(log) {
  const meta = log && log.meta && typeof log.meta === "object" ? log.meta : {};
  return {
    id: log && log._id ? String(log._id) : null,
    subscriptionId: meta.subscriptionId || (log && log.entityId ? String(log.entityId) : null),
    customerId: meta.customerId || null,
    businessDate: meta.businessDate || null,
    deducted: {
      regularMeals: Number(meta.deductedRegularMeals || 0),
      premiumMeals: Number(meta.deductedPremiumMeals || 0),
      total: Number(meta.deductedTotalMeals || 0),
      addons: Array.isArray(meta.deductedAddons) ? meta.deductedAddons : [],
    },
    before: {
      remainingRegularMeals: meta.before ? Number(meta.before.remainingRegularMeals || 0) : null,
      remainingPremiumMeals: meta.before ? Number(meta.before.remainingPremiumMeals || 0) : null,
      remainingMeals: meta.before ? Number(meta.before.remainingMeals || 0) : null,
    },
    after: {
      remainingRegularMeals: meta.after ? Number(meta.after.remainingRegularMeals || 0) : null,
      remainingPremiumMeals: meta.after ? Number(meta.after.remainingPremiumMeals || 0) : null,
      remainingMeals: meta.after ? Number(meta.after.remainingMeals || 0) : null,
    },
    fulfillmentMethod: meta.fulfillmentMethod || null,
    actor: {
      id: meta.actorId || (log && log.byUserId ? String(log.byUserId) : null),
      role: meta.actorRole || (log && log.byRole ? String(log.byRole) : null),
    },
    reason: meta.reason || "",
    notes: meta.notes || "",
    createdAt: log && log.createdAt ? log.createdAt : null,
  };
}

async function listManualDeductions({ subscriptionId, role, limit = 50 }) {
  assertCashierOrAdminRole(role);
  if (!mongoose.Types.ObjectId.isValid(subscriptionId)) {
    throw new ManualDeductionError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
  }

  const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const logs = await ActivityLog.find({
    entityType: "subscription",
    entityId: subscriptionId,
    action: MANUAL_DEDUCTION_ACTION,
  }).sort({ createdAt: -1 }).limit(cappedLimit).lean();

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
