"use strict";

const crypto = require("node:crypto");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const { logger } = require("../../utils/logger");

function serviceError(code, message, status = 409, details = undefined) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details) err.details = details;
  return err;
}

function plain(value) {
  return value && typeof value.toObject === "function" ? value.toObject() : value;
}

function allocationKeyOf({ subscriptionId, dayId = null, date, slotKey, plannerRevisionHash = "", pickupRequestId = null }) {
  return crypto.createHash("sha256").update([
    String(subscriptionId),
    String(dayId || "pickup"),
    String(pickupRequestId || ""),
    String(date || ""),
    String(slotKey || ""),
    String(plannerRevisionHash || ""),
  ].join(":"), "utf8").digest("hex");
}

async function ensureEntitlementLedger(subscriptionId, session = null) {
  const query = Subscription.findById(subscriptionId).select(
    "totalMeals remainingMeals entitlementVersion reservedMeals consumedMeals forfeitedMeals baseMealAllocations premiumBalance"
  );
  if (session) query.session(session);
  let subscription = await query.lean();
  if (!subscription) throw serviceError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
  if (Number(subscription.entitlementVersion || 0) >= 2) return subscription;

  const totalMeals = Math.max(0, Number(subscription.totalMeals || 0));
  const remainingMeals = Math.max(0, Number(subscription.remainingMeals || 0));
  const legacyConsumedMeals = Math.max(0, totalMeals - remainingMeals);
  const updated = await Subscription.findOneAndUpdate(
    { _id: subscriptionId, entitlementVersion: { $ne: 2 } },
    {
      $set: {
        entitlementVersion: 2,
        reservedMeals: 0,
        consumedMeals: legacyConsumedMeals,
        forfeitedMeals: 0,
        baseMealAllocations: [],
      },
    },
    { new: true, ...(session ? { session } : {}) }
  ).lean();
  if (updated) return updated;

  const reread = Subscription.findById(subscriptionId).lean();
  if (session) reread.session(session);
  subscription = await reread;
  if (!subscription) throw serviceError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
  return subscription;
}

function findPremiumSelection(day, slot) {
  const selections = Array.isArray(day && day.premiumUpgradeSelections) ? day.premiumUpgradeSelections : [];
  const slotKey = String(slot && (slot.slotKey || `slot_${slot.slotIndex || 0}`) || "");
  return selections.find((selection) => String(selection && (selection.baseSlotKey || selection.slotKey) || "") === slotKey) || null;
}

function premiumFundingFor(day, slot) {
  const selection = plain(findPremiumSelection(day, slot)) || {};
  const isPremium = Boolean(slot && (slot.isPremium === true || ["premium_meal", "premium_large_salad"].includes(slot.selectionType)));
  if (!isPremium) return { source: "none", state: "none", premiumKey: "" };
  const clientSource = String(selection.premiumSource || slot.premiumSource || "pending_payment");
  const source = clientSource === "balance"
    ? "wallet"
    : (["paid", "paid_extra"].includes(clientSource) ? "paid_difference" : "pending_payment");
  return {
    source,
    state: source === "paid_difference" ? "paid" : (source === "wallet" ? "reserved" : "reserved"),
    premiumKey: String(selection.premiumKey || slot.premiumKey || ""),
    balanceBucketId: selection.balanceBucketId || selection.premiumWalletRowId || null,
    configId: selection.configId || null,
    revision: Number(selection.revision || 0),
    paymentId: selection.paymentId || null,
  };
}

function buildDayAllocationSpecs({ subscriptionId, day, paymentId = null }) {
  const sourceDay = plain(day) || {};
  const slots = (Array.isArray(sourceDay.mealSlots) ? sourceDay.mealSlots : []).filter(
    (slot) => slot && slot.status === "complete"
  );
  return slots.map((rawSlot, index) => {
    const slot = plain(rawSlot);
    const slotKey = String(slot.slotKey || `slot_${slot.slotIndex || index + 1}`);
    const premiumFunding = premiumFundingFor(sourceDay, slot);
    if (paymentId && premiumFunding.source === "pending_payment") premiumFunding.paymentId = paymentId;
    return {
      allocationKey: allocationKeyOf({
        subscriptionId,
        dayId: sourceDay._id,
        date: sourceDay.date,
        slotKey,
        plannerRevisionHash: sourceDay.plannerRevisionHash || "",
      }),
      dayId: sourceDay._id,
      date: sourceDay.date,
      slotKey,
      plannerRevisionHash: sourceDay.plannerRevisionHash || "",
      quantity: 1,
      state: "reserved",
      reservedAt: new Date(),
      paymentId: paymentId || null,
      premiumFunding,
    };
  });
}

function normalizedPremiumKey(value) {
  return String(value || "").trim().toLowerCase();
}

function premiumBucketIdentity(row) {
  return JSON.stringify({
    premiumKey: normalizedPremiumKey(row && row.premiumKey),
    configId: String(row && row.configId || ""),
    revision: Number(row && row.revision || 0),
    proteinId: String(row && row.proteinId || ""),
    kind: String(row && row.kind || ""),
    entityType: String(row && row.entityType || ""),
    selectionType: String(row && row.selectionType || ""),
    sourceType: String(row && row.sourceType || ""),
    sourceId: String(row && row.sourceId || ""),
    sourceProductId: String(row && row.sourceProductId || ""),
    sourceGroupId: String(row && row.sourceGroupId || ""),
    sourceGroupKey: String(row && row.sourceGroupKey || ""),
    sourceKey: String(row && row.sourceKey || ""),
    unitExtraFeeHalala: Number(row && row.unitExtraFeeHalala || 0),
    currency: String(row && row.currency || "SAR"),
  });
}

function comparePremiumBuckets(left, right) {
  const leftPurchasedAt = new Date(left && left.purchasedAt || 0).getTime();
  const rightPurchasedAt = new Date(right && right.purchasedAt || 0).getTime();
  if (leftPurchasedAt !== rightPurchasedAt) return leftPurchasedAt - rightPurchasedAt;
  return String(left && left._id || "").localeCompare(String(right && right._id || ""));
}

function resolveWalletBucket(subscription, funding, { requireRemaining = false, requireReserved = false } = {}) {
  const rows = Array.isArray(subscription && subscription.premiumBalance) ? subscription.premiumBalance : [];
  if (funding.balanceBucketId) {
    return rows.find((row) => String(row._id) === String(funding.balanceBucketId)) || null;
  }

  const premiumKey = normalizedPremiumKey(funding.premiumKey);
  if (!premiumKey) return null;

  const configId = String(funding.configId || "");
  const revision = Number(funding.revision || 0);
  const hasRevisionIdentity = Boolean(configId) || revision > 0;
  const matches = rows.filter((row) => {
    if (normalizedPremiumKey(row && row.premiumKey) !== premiumKey) return false;
    if (configId && String(row && row.configId || "") !== configId) return false;
    if (hasRevisionIdentity && Number(row && row.revision || 0) !== revision) return false;
    return true;
  });
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) return null;

  // Multiple rows are safely interchangeable only when every immutable Premium
  // identity field is identical. This supports repeated purchases of the same
  // Premium entitlement without ever crossing config/revision/product identity.
  if (new Set(matches.map(premiumBucketIdentity)).size !== 1) return null;

  let eligible = matches;
  if (requireRemaining) {
    eligible = eligible.filter((row) => Number(row && row.remainingQty || 0) >= 1);
  }
  if (requireReserved) {
    eligible = eligible.filter((row) => Number(row && row.reservedQty || 0) >= 1);
  }
  if (eligible.length === 0) return null;

  // Equivalent buckets represent fungible credits. Pick the oldest bucket first
  // and persist its exact _id on the allocation so every later transition is exact.
  return [...eligible].sort(comparePremiumBuckets)[0];
}

async function reserveOneAllocation({ subscriptionId, spec, session = null }) {
  let subscription = await ensureEntitlementLedger(subscriptionId, session);
  const existing = (subscription.baseMealAllocations || []).find((entry) => entry.allocationKey === spec.allocationKey);
  if (existing) {
    if (["reserved", "consumed", "forfeited"].includes(existing.state)) {
      return { allocation: existing, newlyReserved: false };
    }
    throw serviceError("ENTITLEMENT_RELEASED", "The meal entitlement reservation was already released", 409);
  }

  const filter = {
    _id: subscriptionId,
    entitlementVersion: 2,
    remainingMeals: { $gte: 1 },
    "baseMealAllocations.allocationKey": { $ne: spec.allocationKey },
  };
  const update = {
    $inc: { remainingMeals: -1, reservedMeals: 1 },
    $push: { baseMealAllocations: spec },
  };
  const options = { new: true, ...(session ? { session } : {}) };

  if (spec.premiumFunding && spec.premiumFunding.source === "wallet") {
    const bucket = resolveWalletBucket(subscription, spec.premiumFunding, { requireRemaining: true });
    if (!bucket) throw serviceError("DATA_INTEGRITY_ERROR", "Premium balance bucket identity is missing or ambiguous", 409);
    spec.premiumFunding.balanceBucketId = bucket._id;
    spec.premiumFunding.configId = bucket.configId || null;
    spec.premiumFunding.revision = Number(bucket.revision || 0);
    filter.premiumBalance = { $elemMatch: { _id: bucket._id, remainingQty: { $gte: 1 } } };
    update.$inc["premiumBalance.$[bucket].remainingQty"] = -1;
    update.$inc["premiumBalance.$[bucket].reservedQty"] = 1;
    options.arrayFilters = [{ "bucket._id": bucket._id }];
  }

  const updated = await Subscription.findOneAndUpdate(filter, update, options).lean();
  if (!updated) {
    subscription = await Subscription.findById(subscriptionId).lean();
    const raced = (subscription && subscription.baseMealAllocations || []).find((entry) => entry.allocationKey === spec.allocationKey);
    if (raced && ["reserved", "consumed", "forfeited"].includes(raced.state)) {
      return { allocation: raced, newlyReserved: false };
    }
    throw serviceError("INSUFFICIENT_CREDITS", "Not enough credits", 422);
  }
  logger.info("subscription entitlement transition", {
    event: "base_reserved",
    subscriptionId: String(subscriptionId),
    allocationKey: spec.allocationKey,
    delta: { remainingMeals: -1, reservedMeals: 1 },
  });
  return {
    allocation: (updated.baseMealAllocations || []).find((entry) => entry.allocationKey === spec.allocationKey),
    newlyReserved: true,
  };
}

async function reserveDayEntitlements({ subscriptionId, day, paymentId = null, session = null }) {
  const specs = buildDayAllocationSpecs({ subscriptionId, day, paymentId });
  const allocationKeys = [];
  const newlyReservedKeys = [];
  try {
    for (const spec of specs) {
      const result = await reserveOneAllocation({ subscriptionId, spec, session });
      allocationKeys.push(spec.allocationKey);
      if (result.newlyReserved) newlyReservedKeys.push(spec.allocationKey);
    }
  } catch (err) {
    for (const key of newlyReservedKeys) {
      await transitionAllocation({ subscriptionId, allocationKey: key, toState: "released", session });
    }
    throw err;
  }
  if (day && day._id && allocationKeys.length) {
    await SubscriptionDay.updateOne(
      { _id: day._id },
      { $set: { baseAllocationKeys: allocationKeys, entitlementTransitionState: "reserved" } },
      session ? { session } : {}
    );
  }
  return { allocationKeys, newlyReservedKeys };
}

async function transitionAllocation({ subscriptionId, allocationKey, toState, paymentId = null, session = null }) {
  const subscription = await ensureEntitlementLedger(subscriptionId, session);
  const allocation = (subscription.baseMealAllocations || []).find((entry) => entry.allocationKey === allocationKey);
  if (!allocation) throw serviceError("DATA_INTEGRITY_ERROR", "Base entitlement allocation was not found", 409);
  if (allocation.state === toState) return { changed: false, alreadyApplied: true, allocation };
  if (allocation.state !== "reserved" || !["consumed", "released", "forfeited"].includes(toState)) {
    throw serviceError("DATA_INTEGRITY_ERROR", "Base entitlement allocation transition is invalid", 409, {
      fromState: allocation.state,
      toState,
    });
  }

  const filter = {
    _id: subscriptionId,
    baseMealAllocations: { $elemMatch: { allocationKey, state: "reserved" } },
  };
  const now = new Date();
  const update = {
    $set: {
      "baseMealAllocations.$[allocation].state": toState,
      [`baseMealAllocations.$[allocation].${toState}At`]: now,
    },
    $inc: { reservedMeals: -1 },
  };
  if (paymentId) {
    update.$set["baseMealAllocations.$[allocation].paymentId"] = paymentId;
    update.$set["baseMealAllocations.$[allocation].premiumFunding.paymentId"] = paymentId;
  }
  if (toState === "consumed") update.$inc.consumedMeals = 1;
  if (toState === "released") update.$inc.remainingMeals = 1;
  if (toState === "forfeited") update.$inc.forfeitedMeals = 1;
  const options = {
    new: true,
    arrayFilters: [{ "allocation.allocationKey": allocationKey, "allocation.state": "reserved" }],
    ...(session ? { session } : {}),
  };

  const funding = allocation.premiumFunding || {};
  if (funding.source === "wallet") {
    const bucket = resolveWalletBucket(subscription, funding, { requireReserved: true });
    if (!bucket) throw serviceError("DATA_INTEGRITY_ERROR", "Premium balance bucket identity mismatch", 409);
    filter.premiumBalance = { $elemMatch: { _id: bucket._id, reservedQty: { $gte: 1 } } };
    update.$inc["premiumBalance.$[bucket].reservedQty"] = -1;
    if (toState === "released") update.$inc["premiumBalance.$[bucket].remainingQty"] = 1;
    else update.$inc["premiumBalance.$[bucket].consumedQty"] = 1;
    update.$set["baseMealAllocations.$[allocation].premiumFunding.state"] = toState;
    options.arrayFilters.push({ "bucket._id": bucket._id });
  } else if (funding.source !== "none") {
    update.$set["baseMealAllocations.$[allocation].premiumFunding.state"] = toState === "consumed" ? "consumed" : toState;
  }

  const updated = await Subscription.findOneAndUpdate(filter, update, options).lean();
  if (!updated) {
    const current = await Subscription.findById(subscriptionId).lean();
    const currentAllocation = (current && current.baseMealAllocations || []).find((entry) => entry.allocationKey === allocationKey);
    if (currentAllocation && currentAllocation.state === toState) {
      return { changed: false, alreadyApplied: true, allocation: currentAllocation };
    }
    throw serviceError("DATA_INTEGRITY_ERROR", "Entitlement transition compare-and-set failed", 409);
  }
  logger.info("subscription entitlement transition", {
    event: `base_${toState}`,
    subscriptionId: String(subscriptionId),
    allocationKey,
    delta: toState === "released"
      ? { reservedMeals: -1, remainingMeals: 1 }
      : { reservedMeals: -1, [`${toState}Meals`]: 1 },
  });
  return { changed: true, alreadyApplied: false };
}

async function transitionDayEntitlements({ subscriptionId, day, toState, session = null }) {
  const sourceDay = plain(day) || {};
  const subscription = await ensureEntitlementLedger(subscriptionId, session);
  const projectedKeys = Array.isArray(sourceDay.baseAllocationKeys) ? sourceDay.baseAllocationKeys : [];
  const matching = (subscription.baseMealAllocations || []).filter((entry) =>
    projectedKeys.includes(entry.allocationKey)
      || (sourceDay._id && String(entry.dayId || "") === String(sourceDay._id))
  );
  if (!matching.length) return { handled: false, changedCount: 0, allocationKeys: [] };
  let changedCount = 0;
  for (const allocation of matching) {
    if (allocation.state === "reserved") {
      const result = await transitionAllocation({ subscriptionId, allocationKey: allocation.allocationKey, toState, session });
      if (result.changed) changedCount += 1;
    } else if (allocation.state !== toState && !(toState === "consumed" && allocation.state === "consumed")) {
      throw serviceError("DATA_INTEGRITY_ERROR", "Day entitlement allocation has incompatible state", 409);
    }
  }
  await SubscriptionDay.updateOne(
    { _id: sourceDay._id },
    { $set: { baseAllocationKeys: matching.map((entry) => entry.allocationKey), entitlementTransitionState: toState } },
    session ? { session } : {}
  );
  return { handled: true, changedCount, allocationKeys: matching.map((entry) => entry.allocationKey) };
}

async function reacquireAllocation({ subscriptionId, allocationKey, session = null }) {
  const subscription = await ensureEntitlementLedger(subscriptionId, session);
  const allocation = (subscription.baseMealAllocations || []).find((entry) => entry.allocationKey === allocationKey);
  if (!allocation) throw serviceError("DATA_INTEGRITY_ERROR", "Base entitlement allocation was not found", 409);
  if (allocation.state === "reserved") return { changed: false, alreadyApplied: true };
  if (allocation.state !== "released") {
    throw serviceError("DATA_INTEGRITY_ERROR", "Only a released entitlement can be reopened", 409);
  }
  const filter = {
    _id: subscriptionId,
    remainingMeals: { $gte: 1 },
    baseMealAllocations: { $elemMatch: { allocationKey, state: "released" } },
  };
  const update = {
    $inc: { remainingMeals: -1, reservedMeals: 1 },
    $set: {
      "baseMealAllocations.$[allocation].state": "reserved",
      "baseMealAllocations.$[allocation].reservedAt": new Date(),
      "baseMealAllocations.$[allocation].releasedAt": null,
    },
  };
  const options = {
    new: true,
    arrayFilters: [{ "allocation.allocationKey": allocationKey, "allocation.state": "released" }],
    ...(session ? { session } : {}),
  };
  const funding = allocation.premiumFunding || {};
  if (funding.source === "wallet") {
    const bucket = resolveWalletBucket(subscription, funding, { requireRemaining: true });
    if (!bucket) throw serviceError("DATA_INTEGRITY_ERROR", "Premium balance bucket identity mismatch", 409);
    filter.premiumBalance = { $elemMatch: { _id: bucket._id, remainingQty: { $gte: 1 } } };
    update.$inc["premiumBalance.$[bucket].remainingQty"] = -1;
    update.$inc["premiumBalance.$[bucket].reservedQty"] = 1;
    update.$set["baseMealAllocations.$[allocation].premiumFunding.state"] = "reserved";
    options.arrayFilters.push({ "bucket._id": bucket._id });
  } else if (funding.source === "paid_difference") {
    update.$set["baseMealAllocations.$[allocation].premiumFunding.state"] = "paid";
  }
  const updated = await Subscription.findOneAndUpdate(filter, update, options).lean();
  if (!updated) throw serviceError("INSUFFICIENT_CREDITS", "Not enough credits to reopen this day", 422);
  return { changed: true, alreadyApplied: false };
}

async function reopenDayEntitlements({ subscriptionId, day, session = null }) {
  const sourceDay = plain(day) || {};
  const subscription = await ensureEntitlementLedger(subscriptionId, session);
  const projectedKeys = Array.isArray(sourceDay.baseAllocationKeys) ? sourceDay.baseAllocationKeys : [];
  const matching = (subscription.baseMealAllocations || []).filter((entry) =>
    projectedKeys.includes(entry.allocationKey)
      || (sourceDay._id && String(entry.dayId || "") === String(sourceDay._id))
  );
  if (!matching.length) return { handled: false, changedCount: 0 };
  let changedCount = 0;
  for (const allocation of matching) {
    const result = await reacquireAllocation({ subscriptionId, allocationKey: allocation.allocationKey, session });
    if (result.changed) changedCount += 1;
  }
  await SubscriptionDay.updateOne(
    { _id: sourceDay._id },
    { $set: { entitlementTransitionState: "reserved" } },
    session ? { session } : {}
  );
  return { handled: true, changedCount };
}

async function markPaidFunding({ subscriptionId, allocationKeys, paymentId, session = null }) {
  const keys = Array.isArray(allocationKeys) ? allocationKeys.filter(Boolean) : [];
  if (!keys.length) return { applied: false, reason: "no_allocations" };
  const result = await Subscription.updateOne(
    {
      _id: subscriptionId,
      baseMealAllocations: {
        $elemMatch: {
          allocationKey: { $in: keys },
          state: { $in: ["reserved", "consumed"] },
          "premiumFunding.source": { $in: ["pending_payment", "paid_difference"] },
        },
      },
    },
    {
      $set: {
        "baseMealAllocations.$[allocation].paymentId": paymentId,
        "baseMealAllocations.$[allocation].premiumFunding.paymentId": paymentId,
        "baseMealAllocations.$[allocation].premiumFunding.source": "paid_difference",
        "baseMealAllocations.$[allocation].premiumFunding.state": "paid",
      },
    },
    {
      arrayFilters: [{
        "allocation.allocationKey": { $in: keys },
        "allocation.state": { $in: ["reserved", "consumed"] },
        "allocation.premiumFunding.source": { $in: ["pending_payment", "paid_difference"] },
      }],
      ...(session ? { session } : {}),
    }
  );
  return { applied: Boolean(result.matchedCount), modified: Boolean(result.modifiedCount) };
}

async function linkPaymentToAllocations({ subscriptionId, allocationKeys, paymentId, session = null }) {
  const keys = Array.isArray(allocationKeys) ? allocationKeys.filter(Boolean) : [];
  if (!keys.length) return { linked: false };
  const result = await Subscription.updateOne(
    { _id: subscriptionId, "baseMealAllocations.allocationKey": { $in: keys } },
    {
      $set: {
        "baseMealAllocations.$[allocation].paymentId": paymentId,
        "baseMealAllocations.$[allocation].premiumFunding.paymentId": paymentId,
      },
    },
    {
      arrayFilters: [{ "allocation.allocationKey": { $in: keys } }],
      ...(session ? { session } : {}),
    }
  );
  return { linked: Boolean(result.matchedCount), modified: Boolean(result.modifiedCount) };
}

async function validatePaymentAllocations({ subscriptionId, allocationKeys, plannerRevisionHash }) {
  const keys = Array.isArray(allocationKeys) ? allocationKeys.filter(Boolean) : [];
  if (!keys.length) return { valid: false, reason: "missing_allocations" };
  const subscription = await Subscription.findById(subscriptionId).select("baseMealAllocations").lean();
  const allocations = (subscription && subscription.baseMealAllocations || []).filter((entry) => keys.includes(entry.allocationKey));
  const valid = allocations.length === keys.length && allocations.every((entry) =>
    ["reserved", "consumed"].includes(entry.state)
      && String(entry.plannerRevisionHash || "") === String(plannerRevisionHash || "")
  );
  return { valid, reason: valid ? null : "allocation_revision_mismatch", allocations };
}

function buildPickupAllocationSpecs({ subscriptionId, pickupRequest }) {
  const request = plain(pickupRequest) || {};
  const count = Math.max(0, Number(request.mealCount || 0));
  return Array.from({ length: count }, (_, index) => {
    const slotKey = `pickup_${index + 1}`;
    return {
      allocationKey: allocationKeyOf({ subscriptionId, pickupRequestId: request._id, date: request.date, slotKey }),
      dayId: request.subscriptionDayId || null,
      date: request.date,
      slotKey,
      plannerRevisionHash: "",
      quantity: 1,
      state: "reserved",
      reservedAt: new Date(),
      pickupRequestId: request._id,
      premiumFunding: { source: "none", state: "none", premiumKey: "" },
    };
  });
}

async function reservePickupEntitlements({ subscriptionId, pickupRequest, session = null }) {
  const specs = buildPickupAllocationSpecs({ subscriptionId, pickupRequest });
  const keys = [];
  const newlyReservedKeys = [];
  try {
    for (const spec of specs) {
      const result = await reserveOneAllocation({ subscriptionId, spec, session });
      keys.push(spec.allocationKey);
      if (result.newlyReserved) newlyReservedKeys.push(spec.allocationKey);
    }
  } catch (err) {
    for (const key of newlyReservedKeys) await transitionAllocation({ subscriptionId, allocationKey: key, toState: "released", session });
    throw err;
  }
  return { allocationKeys: keys, newlyReservedKeys };
}

async function transitionPickupEntitlements({ subscriptionId, allocationKeys, toState, session = null }) {
  const keys = Array.isArray(allocationKeys) ? allocationKeys.filter(Boolean) : [];
  if (!keys.length) return { handled: false, changedCount: 0 };
  let changedCount = 0;
  for (const key of keys) {
    const result = await transitionAllocation({ subscriptionId, allocationKey: key, toState, session });
    if (result.changed) changedCount += 1;
  }
  return { handled: true, changedCount };
}

function checkEntitlementInvariants(subscription) {
  const totalMeals = Number(subscription && subscription.totalMeals || 0);
  const remainingMeals = Number(subscription && subscription.remainingMeals || 0);
  const reservedMeals = Number(subscription && subscription.reservedMeals || 0);
  const consumedMeals = Number(subscription && subscription.consumedMeals || 0);
  const forfeitedMeals = Number(subscription && subscription.forfeitedMeals || 0);
  const actual = remainingMeals + reservedMeals + consumedMeals + forfeitedMeals;
  const premiumViolations = (subscription && subscription.premiumBalance || []).filter((row) =>
    Number(row.purchasedQty || 0) !== Number(row.remainingQty || 0) + Number(row.reservedQty || 0) + Number(row.consumedQty || 0)
  );
  return { valid: totalMeals === actual && premiumViolations.length === 0, totalMeals, actual, premiumViolations };
}

module.exports = {
  allocationKeyOf,
  buildDayAllocationSpecs,
  checkEntitlementInvariants,
  ensureEntitlementLedger,
  linkPaymentToAllocations,
  markPaidFunding,
  reacquireAllocation,
  reopenDayEntitlements,
  reserveDayEntitlements,
  reservePickupEntitlements,
  transitionAllocation,
  transitionDayEntitlements,
  transitionPickupEntitlements,
  validatePaymentAllocations,
};