"use strict";

// Staff-triggered delivery add-on preparation. Never auto-charge from reads.
const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionDailyAddonOperation = require("../../models/SubscriptionDailyAddonOperation");
const dailyAddonService = require("../subscription/subscriptionDailyAddonService");
const { resolveEffectiveFulfillmentMode } = require("../subscription/subscriptionFulfillmentPolicyService");
const { getTodayKSADate } = require("../../utils/date");

const PREPARABLE_STATUSES = new Set(["locked", "in_preparation"]);
const STAFF_ROLES = new Set(["admin", "superadmin", "kitchen", "courier"]);

function id(value) {
  return value == null ? "" : String(value);
}

function localized(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      ar: String(value.ar || value.en || "").trim(),
      en: String(value.en || value.ar || "").trim(),
    };
  }
  const name = typeof value === "string" ? value.trim() : "";
  return { ar: name, en: name };
}

function int(value, fallback = 0) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
}

function error(code, message, status = 409) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  return e;
}

function findUniqueBucket(subscription, entitlement) {
  const all = Array.isArray(subscription && subscription.addonBalance)
    ? subscription.addonBalance.filter(Boolean) : [];
  const requested = id(entitlement.balanceBucketId);
  if (requested) {
    const matches = all.filter((b) => id(b._id || b.balanceBucketId) === requested);
    return matches.length === 1 ? matches[0] : null;
  }
  const planId = id(entitlement.addonPlanId || entitlement.addonId);
  const matches = all.filter((b) => id(b.addonPlanId || b.addonId) === planId);
  return matches.length === 1 ? matches[0] : null;
}

function matchingSelections(day, entitlement, bucket) {
  const bucketId = id(bucket && (bucket._id || bucket.balanceBucketId));
  const planId = id(entitlement.addonPlanId || entitlement.addonId);
  const entitlementKey = id(entitlement.entitlementKey);
  return (Array.isArray(day && day.addonSelections) ? day.addonSelections : [])
    .filter((s) => s && s.addonSettlementState !== "released")
    .filter((s) => {
      if (s.balanceBucketId) return id(s.balanceBucketId) === bucketId;
      if (s.entitlementKey) return id(s.entitlementKey) === entitlementKey;
      return Boolean(planId && id(s.addonPlanId) === planId);
    });
}

function productsFor(entitlement) {
  const snapshots = Array.isArray(entitlement.menuProductsSnapshot)
    ? entitlement.menuProductsSnapshot.filter(Boolean) : [];
  const ids = new Set([
    ...(Array.isArray(entitlement.menuProductIds) ? entitlement.menuProductIds.map(id) : []),
    ...snapshots.map((s) => id(s.id || s._id || s.productId)),
  ].filter(Boolean));
  return [...ids].map((productId) => {
    const snapshot = snapshots.find((s) => id(s.id || s._id || s.productId) === productId);
    const nameI18n = localized(snapshot && (snapshot.nameI18n || snapshot.name));
    return {
      productId,
      key: String(snapshot && snapshot.key || ""),
      nameI18n,
      name: nameI18n.ar || nameI18n.en || "",
    };
  });
}

function resolvePlanRows(subscription, day, { today = getTodayKSADate(), role = "kitchen" } = {}) {
  const entitlements = Array.isArray(subscription && subscription.addonSubscriptions)
    ? subscription.addonSubscriptions : [];
  const mode = resolveEffectiveFulfillmentMode({ subscription, day, date: day && day.date });
  const activeDay = Boolean(
    day && day.date === today && PREPARABLE_STATUSES.has(day.status)
    && subscription && subscription.status === "active" && mode === "delivery"
    && !day.stackingExtraSelectionState
  );
  return entitlements.filter(Boolean).map((entitlement, index) => {
    const bucket = findUniqueBucket(subscription, entitlement);
    const selections = matchingSelections(day, entitlement, bucket);
    const dailyQty = Math.max(1, int(entitlement.purchasedDailyQty || entitlement.quantityPerDay, 1));
    const selectedQty = selections.reduce((sum, s) => sum + Math.max(1, int(s.qty || s.quantity, 1)), 0);
    const unresolved = selections.some((s) => s.autoDailyAddon === true || s.requiresKitchenChoice === true);
    const products = productsFor(entitlement);
    const remainingQty = bucket ? int(bucket.remainingQty) : null;
    const labelI18n = localized(entitlement.addonPlanNameI18n || entitlement.addonPlanName || entitlement.name || entitlement.displayCategory || entitlement.category);
    const canPrepare = Boolean(
      activeDay && STAFF_ROLES.has(role) && bucket
      && !unresolved && selectedQty < dailyQty && remainingQty > 0
      && products.length > 0 && products.every((p) => p.name)
    );
    const reason = day && day.stackingExtraSelectionState ? "STACKING_EXTRA_MANAGED_SEPARATELY"
      : !bucket ? "ADDON_BALANCE_MISSING"
      : unresolved ? "UNRESOLVED_OLDER_RESERVATION"
      : selectedQty >= dailyQty ? "ALREADY_SELECTED_FOR_TODAY"
      : !activeDay ? "DAY_NOT_PREPARABLE"
      : !STAFF_ROLES.has(role) ? "ROLE_NOT_ALLOWED"
      : remainingQty < 1 ? "NO_ADDON_BALANCE"
      : !products.length || products.some((p) => !p.name) ? "PRODUCT_CATALOG_MISSING"
      : null;
    return {
      addonPlanId: id(entitlement.addonPlanId || entitlement.addonId) || null,
      balanceBucketId: bucket ? id(bucket._id || bucket.balanceBucketId) : null,
      entitlementKey: id(entitlement.entitlementKey) || null,
      label: labelI18n.ar || labelI18n.en,
      labelI18n,
      quantityPerDay: dailyQty,
      selectedTodayQty: selectedQty,
      stillNeededQty: Math.max(0, dailyQty - selectedQty),
      remainingQty,
      reservedQty: bucket ? int(bucket.reservedQty) : null,
      consumedQty: bucket ? int(bucket.consumedQty) : null,
      products,
      canPrepare,
      blockReason: reason,
      _entitlementIndex: index,
    };
  });
}

function buildAddonPlanSummaries(subscription, day, options = {}) {
  return resolvePlanRows(subscription, day, options).map(({ _entitlementIndex, ...row }) => row);
}

async function prepareDeliveryAddon({
  dayId, balanceBucketId, productId = null, role, actorId,
  today = getTodayKSADate(),
} = {}) {
  if (!STAFF_ROLES.has(role)) throw error("FORBIDDEN", "Only authorized delivery staff may prepare add-ons", 403);
  if (![dayId, balanceBucketId].every((s) => mongoose.isValidObjectId(s))) {
    throw error("INVALID_REQUEST", "Valid day and balance bucket IDs are required", 400);
  }
  if (productId != null && !mongoose.isValidObjectId(productId)) {
    throw error("INVALID_PRODUCT", "Invalid add-on product ID", 400);
  }

  const day = await SubscriptionDay.findById(dayId).lean();
  if (!day) throw error("DAY_NOT_FOUND", "Subscription day not found", 404);
  if (day.date !== today || !PREPARABLE_STATUSES.has(day.status)) {
    throw error("DAY_NOT_PREPARABLE", "Only today's locked or preparing delivery can be modified");
  }
  const subscription = await Subscription.findById(day.subscriptionId).lean();
  if (!subscription || subscription.status !== "active"
    || resolveEffectiveFulfillmentMode({ subscription, day, date: day.date }) !== "delivery") {
    throw error("SUBSCRIPTION_NOT_ELIGIBLE", "An active delivery subscription is required");
  }
  // Stacked purchase extras are settled through a separate transactional ledger.
  // Never debit the legacy addonBalance for an extra already owned by that ledger.
  if (day.stackingExtraSelectionState) {
    throw error("STACKING_EXTRA_MANAGED_SEPARATELY", "Stacked extras require their canonical fulfillment flow");
  }

  const rows = resolvePlanRows(subscription, day, { today, role });
  const matches = rows.filter((p) => p.balanceBucketId === id(balanceBucketId));
  if (matches.length !== 1) throw error("ADDON_PLAN_AMBIGUOUS", "Add-on plan/bucket not found or ambiguous");
  const plan = matches[0];
  if (plan.selectedTodayQty >= plan.quantityPerDay && !plan.blockReason?.includes("UNRESOLVED")) {
    return { alreadyPrepared: true, plan: buildAddonPlanSummaries(subscription, day, { today, role }).find((p) => p.balanceBucketId === id(balanceBucketId)) };
  }
  if (!plan.canPrepare) throw error(plan.blockReason || "ADDON_NOT_PREPARABLE", "Add-on cannot be prepared in this state");
  const selectedProductId = productId || (plan.products.length === 1 ? plan.products[0].productId : null);
  const product = plan.products.find((p) => p.productId === id(selectedProductId));
  if (!product) throw error("PRODUCT_CHOICE_REQUIRED", "Select a product belonging to this add-on package", 422);
  const entitlement = subscription.addonSubscriptions[plan._entitlementIndex];
  const bucket = findUniqueBucket(subscription, entitlement);
  const ordinal = plan.selectedTodayQty + 1;
  const allocationKey = "staff-addon:" + id(day._id) + ":" + id(bucket._id) + ":" + ordinal;

  // Unique operation + deterministic allocation key make browser retries and double clicks idempotent.
  const opQuery = { subscriptionDayId: day._id, allocationKey };
  let op;
  try {
    op = await SubscriptionDailyAddonOperation.findOneAndUpdate(opQuery, {
      $setOnInsert: {
        subscriptionId: subscription._id, date: day.date, allocationKey,
        entitlementKey: plan.entitlementKey || "bucket:" + id(bucket._id),
        balanceBucketId: bucket._id, addonPlanId: entitlement.addonPlanId || entitlement.addonId || null,
        productId: product.productId, status: "started",
        preparedBy: actorId ? id(actorId) : "",
        preparedByRole: role,
      },
    }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
  } catch (e) {
    if (e.code !== 11000) throw e;
    op = await SubscriptionDailyAddonOperation.findOne(opQuery).lean();
  }
  if (!op) throw error("ADDON_PREPARATION_CONFLICT", "Could not create preparation operation");
  if (id(op.productId) !== product.productId) {
    throw error("ADDON_PRODUCT_CONFLICT", "This add-on was already assigned another product");
  }
  if (["consumed", "released", "compensated"].includes(op.status)) {
    throw error("ADDON_ALREADY_SETTLED", "This add-on operation is already settled");
  }

  const allocation = await dailyAddonService.reserveBalanceAllocation({
    subscriptionId: subscription._id,
    bucketId: bucket._id,
    allocationKey,
  });
  if (!allocation.reserved) throw error(allocation.reason || "NO_ADDON_BALANCE", "Insufficient add-on balance");

  const category = String(entitlement.displayCategory || entitlement.category || bucket.category || "addon");
  const nameI18n = product.nameI18n;
  const now = new Date();
  const selection = {
    addonId: product.productId, productId: product.productId, menuProductId: product.productId,
    addonPlanId: entitlement.addonPlanId || entitlement.addonId || null,
    productKey: product.key, addonKey: product.key,
    name: product.name, nameI18n,
    category, entitlementCategory: entitlement.allowanceCategory || entitlement.category || category,
    entitlementKey: plan.entitlementKey || "", balanceBucketId: bucket._id,
    ownedSnapshot: true, snapshotMissing: false,
    isEligibleForAllowance: true, requestedQty: 1, qty: 1, quantity: 1,
    coveredQty: 1, paidQty: 0, priceHalala: 0, unitPriceHalala: 0,
    payableTotalHalala: 0, currency: bucket.currency || "SAR",
    pricingMode: "allowance_covered", maxPerDay: plan.quantityPerDay,
    source: "subscription", dailyEntitlement: true, autoDailyAddon: false,
    selectionOrigin: "staff_prepared", addonSettlementState: "reserved",
    dailyAllocationKey: allocationKey, reservedAt: now, consumedAt: null,
    requiresKitchenChoice: false,
  };

  const updated = await SubscriptionDay.findOneAndUpdate({
    _id: day._id,
    date: today,
    status: { $in: [...PREPARABLE_STATUSES] },
    "addonSelections.dailyAllocationKey": { $ne: allocationKey },
  }, { $push: { addonSelections: selection } }, { new: true }).lean();

  if (!updated) {
    const latest = await SubscriptionDay.findById(day._id).lean();
    const existing = (latest && latest.addonSelections || []).find(
      (s) => id(s.dailyAllocationKey) === allocationKey
    );
    if (!existing) {
      // Only roll back our own reservation, never the reservation of a concurrent winner.
      await dailyAddonService.releaseBalanceAllocation({
        subscriptionId: subscription._id, bucketId: bucket._id, allocationKey,
      });
      await SubscriptionDailyAddonOperation.updateOne(opQuery, {
        $set: { status: "compensated", releasedAt: new Date(), errorCode: "DAY_CHANGED" },
      });
      throw error("DAY_CHANGED", "Delivery changed while reserving add-on; no balance was consumed");
    }
    if (id(existing.productId || existing.addonId) !== product.productId) {
      throw error("ADDON_PRODUCT_CONFLICT", "Another product was selected concurrently");
    }
  }

  await SubscriptionDailyAddonOperation.updateOne(opQuery, {
    $set: {
      status: "completed", completedAt: new Date(), selectionSnapshot: selection,
      errorCode: null, errorMessage: null,
    },
  });
  const latestDay = await SubscriptionDay.findById(day._id).lean();
  const latestSub = await Subscription.findById(subscription._id).lean();
  return {
    prepared: true,
    alreadyPrepared: Boolean(allocation.idempotent),
    plan: buildAddonPlanSummaries(latestSub, latestDay, { today, role })
      .find((p) => p.balanceBucketId === id(bucket._id)) || null,
  };
}

module.exports = {
  PREPARABLE_STATUSES, STAFF_ROLES, buildAddonPlanSummaries,
  findUniqueBucket, matchingSelections, productsFor, prepareDeliveryAddon,
};
