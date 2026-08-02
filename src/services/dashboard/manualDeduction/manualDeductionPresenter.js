"use strict";

const { pickLang } = require("../../../utils/i18n");
const { MANUAL_DEDUCTION_ACTION } = require("./constants");
const { resolveAddonBalances, resolveBalances } = require("./manualDeductionPolicy");
const {
  buildManualDeductionBalanceReadModel,
} = require("./manualDeductionBalanceReadModel");

function serializeCustomer(user) {
  return {
    id: String(user._id),
    name: user.name || "",
    phone: user.phone || "",
  };
}

function serializeSubscription(subscription, plan, lang = "en") {
  const balances = resolveBalances(subscription);
  const balance = buildManualDeductionBalanceReadModel(subscription, balances);
  const addonBalances = resolveAddonBalances(subscription);
  return {
    id: String(subscription._id),
    planName: plan ? pickLang(plan.name, lang) || pickLang(plan.name, "en") || "" : "",
    status: subscription.status,
    fulfillmentMethod: subscription.deliveryMode === "pickup" ? "pickup" : "delivery",
    totalMeals: balances.totalMeals,
    consumedMeals: balance.consumedMeals,
    forfeitedMeals: balance.forfeitedMeals,
    reservedMeals: balance.reservedMeals,
    // Backward-compatible write-capacity field. This must stay unreserved.
    remainingMeals: balance.availableMeals,
    availableMeals: balance.availableMeals,
    displayRemainingMeals: balance.displayRemainingMeals,
    remainingMealsSemantics: balance.availableSemantics,
    remainingRegularMeals: balances.remainingRegularMeals,
    remainingPremiumMeals: balances.remainingPremiumMeals,
    balance,
    addonBalances,
  };
}

function buildDeductionLog({ subscription, counts, before, after, actorId, actorRole, reason, notes, businessDate }) {
  const deductedAddons = before.beforeAddons ? before.beforeAddons.map((addon) => ({
    addonId: String(addon.addonId),
    qty: addon.qty,
    remainingBefore: addon.remainingBefore,
    remainingAfter: Math.max(0, addon.remainingBefore - addon.qty),
  })) : [];

  return {
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
}

function buildDeductionResponse({ subscription, counts, balances, addonBalances, businessDate }) {
  const balance = buildManualDeductionBalanceReadModel(subscription, balances);
  return {
    subscriptionId: String(subscription._id),
    deducted: {
      regularMeals: counts.regularMeals,
      premiumMeals: counts.premiumMeals,
      total: counts.total,
      addons: counts.addons.map((addon) => ({ addonId: addon.addonId, qty: addon.qty })),
    },
    remaining: {
      regularMeals: balances.remainingRegularMeals,
      premiumMeals: balances.remainingPremiumMeals,
      // Kept for old dashboards: totalMeals is the safe unreserved capacity.
      totalMeals: balance.availableMeals,
      availableMeals: balance.availableMeals,
      displayRemainingMeals: balance.displayRemainingMeals,
      reservedMeals: balance.reservedMeals,
      consumedMeals: balance.consumedMeals,
      forfeitedMeals: balance.forfeitedMeals,
      addons: addonBalances.map((addon) => ({ addonId: String(addon.addonId), remainingQty: addon.remainingQty })),
    },
    balance,
    businessDate,
    fulfillmentMethod: subscription.deliveryMode === "pickup" ? "pickup" : "delivery",
  };
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

module.exports = {
  buildDeductionLog,
  buildDeductionResponse,
  serializeCustomer,
  serializeManualDeductionLog,
  serializeSubscription,
};
