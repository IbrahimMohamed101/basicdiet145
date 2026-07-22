"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const {
  buildDayAllocationSpecs,
  reacquireAllocation,
  reserveDayEntitlements,
} = require("./subscriptionMealEntitlementService");
const { slotAliases } = require("./pickupEntitlementLinkService");

const MAX_RETRIES = 6;
const OPERATIONAL_STATUSES = new Set([
  "locked",
  "in_preparation",
  "ready_for_pickup",
  "fulfilled",
  "no_show",
  "canceled_at_branch",
]);

function serviceError(code, message, status = 409, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function clean(value) {
  if (value === undefined || value === null) return "";
  try {
    if (value && typeof value === "object" && typeof value.toHexString === "function") {
      return String(value.toHexString()).trim();
    }
    return String(value).trim();
  } catch (_err) {
    return "";
  }
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
}

function withSession(options, session) {
  return session ? { ...options, session } : options;
}

function attachSession(query, session) {
  if (session && query && typeof query.session === "function") query.session(session);
  return query;
}

function slotKeyOf(slot, index = 0) {
  return clean(slot && (slot.slotKey || (slot.slotIndex ? `slot_${slot.slotIndex}` : "")))
    || `slot_${index + 1}`;
}

function isCompleteSlot(slot) {
  return Boolean(slot && String(slot.status || "complete") === "complete");
}

function isConfirmedOrOperationalDay(day) {
  if (!day) return false;
  if (day.plannerState === "confirmed" || day.planningState === "confirmed") return true;
  return OPERATIONAL_STATUSES.has(clean(day.status));
}

function allocationMatchesSlot(allocation, slotKey) {
  const wanted = new Set(slotAliases(slotKey));
  return slotAliases(allocation && allocation.slotKey).some((alias) => wanted.has(alias));
}

function selectedSlotKeysFromInput({
  day,
  selectedMealSlotIds = null,
  selectedPickupItemIds = null,
  pickupRequest = null,
} = {}) {
  const request = pickupRequest || {};
  const requestItemSlots = Array.isArray(request.selectedPickupItems)
    ? request.selectedPickupItems
      .filter((item) => item && ["meal", "premium_meal", "large_salad", "sandwich"].includes(clean(item.itemType)))
      .map((item) => item.slotKey || item.slotId || item.sourceId || item.itemId)
    : [];
  const requestedIds = unique([
    ...(Array.isArray(selectedMealSlotIds) ? selectedMealSlotIds : []),
    ...(Array.isArray(selectedPickupItemIds) ? selectedPickupItemIds : []),
    ...(Array.isArray(request.selectedMealSlotIds) ? request.selectedMealSlotIds : []),
    ...(Array.isArray(request.selectedPickupItemIds) ? request.selectedPickupItemIds : []),
    ...requestItemSlots,
  ]);
  if (!requestedIds.length) return [];

  const matched = [];
  const slots = (Array.isArray(day && day.mealSlots) ? day.mealSlots : []).filter(isCompleteSlot);
  slots.forEach((slot, index) => {
    const key = slotKeyOf(slot, index);
    const aliases = new Set([...slotAliases(key), ...slotAliases(slot.slotIndex)]);
    if (requestedIds.some((id) => slotAliases(id).some((alias) => aliases.has(alias)))) {
      matched.push(key);
    }
  });
  return unique(matched);
}

function stateCounts(subscription) {
  const counts = { reserved: 0, consumed: 0, released: 0, forfeited: 0 };
  for (const allocation of Array.isArray(subscription && subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : []) {
    const state = clean(allocation && allocation.state);
    if (Object.prototype.hasOwnProperty.call(counts, state)) counts[state] += 1;
  }
  return counts;
}

function aggregateGaps(subscription) {
  const ledger = stateCounts(subscription);
  return {
    reserved: Math.max(0, Number(subscription && subscription.reservedMeals || 0) - ledger.reserved),
    consumed: Math.max(0, Number(subscription && subscription.consumedMeals || 0) - ledger.consumed),
    forfeited: Math.max(0, Number(subscription && subscription.forfeitedMeals || 0) - ledger.forfeited),
    ledger,
  };
}

function dayAllocations(subscription, dayId) {
  return (Array.isArray(subscription && subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : []).filter((allocation) => clean(allocation && allocation.dayId) === clean(dayId));
}

function exactAllocation(allocations, spec) {
  return allocations.find((allocation) => allocationMatchesSlot(allocation, spec.slotKey)) || null;
}

function normalizedPremiumKey(value) {
  return clean(value).toLowerCase();
}

function fundingCompatible(left = {}, right = {}) {
  const leftSource = clean(left.source || "none");
  const rightSource = clean(right.source || "none");
  if (leftSource !== rightSource) return false;
  if (leftSource !== "wallet") return true;
  const leftBucket = clean(left.balanceBucketId);
  const rightBucket = clean(right.balanceBucketId);
  if (leftBucket && rightBucket) return leftBucket === rightBucket;
  return normalizedPremiumKey(left.premiumKey) === normalizedPremiumKey(right.premiumKey)
    && (!clean(left.configId) || !clean(right.configId) || clean(left.configId) === clean(right.configId))
    && (!Number(left.revision || 0) || !Number(right.revision || 0)
      || Number(left.revision || 0) === Number(right.revision || 0));
}

function premiumCandidates(subscription, funding = {}) {
  const buckets = Array.isArray(subscription && subscription.premiumBalance)
    ? subscription.premiumBalance
    : [];
  const bucketId = clean(funding.balanceBucketId);
  if (bucketId) return buckets.filter((bucket) => clean(bucket && bucket._id) === bucketId);

  const key = normalizedPremiumKey(funding.premiumKey);
  const configId = clean(funding.configId);
  const revision = Number(funding.revision || 0);
  return buckets.filter((bucket) => {
    if (normalizedPremiumKey(bucket && bucket.premiumKey) !== key) return false;
    if (configId && clean(bucket && bucket.configId) !== configId) return false;
    if ((configId || revision > 0) && Number(bucket && bucket.revision || 0) !== revision) return false;
    return true;
  });
}

function fundedCount(subscription, bucket, states) {
  const bucketId = clean(bucket && bucket._id);
  const key = normalizedPremiumKey(bucket && bucket.premiumKey);
  const wanted = new Set(states);
  return (Array.isArray(subscription && subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : []).filter((allocation) => {
    if (!wanted.has(clean(allocation && allocation.state))) return false;
    const funding = allocation && allocation.premiumFunding || {};
    if (clean(funding.source) !== "wallet") return false;
    const linkedBucketId = clean(funding.balanceBucketId);
    return linkedBucketId ? linkedBucketId === bucketId : normalizedPremiumKey(funding.premiumKey) === key;
  }).length;
}

function choosePremiumPlan(subscription, spec, baseMode) {
  const funding = spec && spec.premiumFunding || {};
  if (clean(funding.source) !== "wallet") return { kind: "none", bucket: null };

  const rows = premiumCandidates(subscription, funding).map((bucket) => ({
    bucket,
    reservedGap: Math.max(0, Number(bucket.reservedQty || 0) - fundedCount(subscription, bucket, ["reserved"])),
    consumedGap: Math.max(0, Number(bucket.consumedQty || 0) - fundedCount(subscription, bucket, ["consumed", "forfeited"])),
    remainingQty: Math.max(0, Number(bucket.remainingQty || 0)),
  }));
  const order = baseMode === "consumed_gap"
    ? ["consumed_gap", "reserved_gap", "remaining"]
    : ["reserved_gap", "consumed_gap", "remaining"];
  for (const kind of order) {
    const eligible = rows.filter((row) => (
      kind === "reserved_gap" ? row.reservedGap > 0
        : kind === "consumed_gap" ? row.consumedGap > 0
          : row.remainingQty > 0
    ));
    if (eligible.length === 1) return { kind, bucket: eligible[0].bucket };
  }

  throw serviceError(
    "PREMIUM_LEDGER_REPAIR_UNSAFE",
    "Premium entitlement ledger could not be repaired safely",
    409,
    {
      messageAr: "تعذر التحقق من رصيد الوجبة المميزة بأمان. لم يتم خصم أي رصيد إضافي، ويرجى مراجعة الدعم.",
      messageEn: "The premium meal balance could not be repaired safely. No extra credit was deducted; please contact support.",
      premiumKey: clean(funding.premiumKey),
      balanceBucketId: clean(funding.balanceBucketId) || null,
      candidateCount: rows.length,
    }
  );
}

function applyPremiumPlan({ subscription, allocation, baseMode, filter, update, options }) {
  const plan = choosePremiumPlan(subscription, allocation, baseMode);
  if (plan.kind === "none") return plan;

  const bucket = plan.bucket;
  allocation.premiumFunding = {
    ...(allocation.premiumFunding || {}),
    balanceBucketId: bucket._id,
    configId: bucket.configId || allocation.premiumFunding.configId || null,
    revision: Number(bucket.revision || allocation.premiumFunding.revision || 0),
    state: "reserved",
  };
  const bucketMatch = {
    _id: bucket._id,
    remainingQty: Number(bucket.remainingQty || 0),
    reservedQty: Number(bucket.reservedQty || 0),
    consumedQty: Number(bucket.consumedQty || 0),
  };
  filter.premiumBalance = { $elemMatch: bucketMatch };

  if (plan.kind === "consumed_gap" || plan.kind === "remaining") {
    options.arrayFilters = [{ "bucket._id": bucket._id }];
    if (plan.kind === "consumed_gap") {
      update.$inc["premiumBalance.$[bucket].consumedQty"] = -1;
      update.$inc["premiumBalance.$[bucket].reservedQty"] = 1;
    } else {
      update.$inc["premiumBalance.$[bucket].remainingQty"] = -1;
      update.$inc["premiumBalance.$[bucket].reservedQty"] = 1;
    }
  }
  return plan;
}

function safeReprojectionMap({ allocations, allSpecs, missingSpecs }) {
  const surplus = allocations.filter((allocation) => {
    if (!["reserved", "released"].includes(clean(allocation && allocation.state))) return false;
    if (clean(allocation && allocation.pickupRequestId)) return false;
    return !allSpecs.some((spec) => allocationMatchesSlot(allocation, spec.slotKey));
  });
  if (!surplus.length || surplus.length !== missingSpecs.length) return new Map();

  const map = new Map();
  for (let index = 0; index < missingSpecs.length; index += 1) {
    if (!fundingCompatible(surplus[index].premiumFunding || {}, missingSpecs[index].premiumFunding || {})) {
      return new Map();
    }
    map.set(clean(missingSpecs[index].slotKey), surplus[index]);
  }
  return map;
}

async function reprojectAllocation({ subscriptionId, day, spec, candidate, session = null }) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const subscription = await attachSession(
      Subscription.findById(subscriptionId).select("__v baseMealAllocations"),
      session
    ).lean();
    if (!subscription) throw serviceError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
    const allocations = dayAllocations(subscription, day._id);
    const already = exactAllocation(allocations, spec);
    if (already) return { allocation: already, changed: false, mode: "already_materialized" };

    const current = allocations.find((row) => clean(row.allocationKey) === clean(candidate.allocationKey));
    if (!current || !["reserved", "released"].includes(clean(current.state)) || clean(current.pickupRequestId)) {
      return null;
    }
    const updated = await Subscription.findOneAndUpdate(
      {
        _id: subscriptionId,
        __v: Number(subscription.__v || 0),
        baseMealAllocations: {
          $elemMatch: {
            allocationKey: current.allocationKey,
            state: { $in: ["reserved", "released"] },
            $or: [{ pickupRequestId: null }, { pickupRequestId: { $exists: false } }],
          },
        },
      },
      {
        $set: {
          "baseMealAllocations.$.date": day.date,
          "baseMealAllocations.$.slotKey": spec.slotKey,
          "baseMealAllocations.$.plannerRevisionHash": day.plannerRevisionHash || "",
        },
        $inc: { __v: 1 },
      },
      withSession({ new: true }, session)
    ).lean();
    if (!updated) continue;
    return {
      allocation: exactAllocation(dayAllocations(updated, day._id), spec),
      changed: true,
      mode: "reprojected_stale_allocation",
    };
  }
  throw serviceError("LINKED_DAY_REPAIR_CONFLICT", "Linked day allocation changed during repair", 409);
}

async function adoptAggregateGap({ subscriptionId, day, spec, session = null }) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const subscription = await attachSession(
      Subscription.findById(subscriptionId).select(
        "__v totalMeals remainingMeals reservedMeals consumedMeals forfeitedMeals baseMealAllocations premiumBalance"
      ),
      session
    ).lean();
    if (!subscription) throw serviceError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
    const already = exactAllocation(dayAllocations(subscription, day._id), spec);
    if (already) return { allocation: already, changed: false, mode: "already_materialized" };

    const gaps = aggregateGaps(subscription);
    const baseMode = gaps.reserved > 0 ? "reserved_gap" : (gaps.consumed > 0 ? "consumed_gap" : null);
    if (!baseMode) return null;

    const allocation = {
      ...spec,
      state: "reserved",
      reservedAt: new Date(),
      consumedAt: null,
      releasedAt: null,
      forfeitedAt: null,
      pickupRequestId: null,
    };
    const filter = {
      _id: subscriptionId,
      __v: Number(subscription.__v || 0),
      remainingMeals: Number(subscription.remainingMeals || 0),
      reservedMeals: Number(subscription.reservedMeals || 0),
      consumedMeals: Number(subscription.consumedMeals || 0),
      forfeitedMeals: Number(subscription.forfeitedMeals || 0),
      "baseMealAllocations.allocationKey": { $ne: allocation.allocationKey },
    };
    const update = {
      $push: { baseMealAllocations: allocation },
      $inc: { __v: 1 },
    };
    if (baseMode === "consumed_gap") {
      update.$inc.consumedMeals = -1;
      update.$inc.reservedMeals = 1;
    }
    const options = withSession({ new: true }, session);
    const premiumPlan = applyPremiumPlan({
      subscription,
      allocation,
      baseMode,
      filter,
      update,
      options,
    });

    const updated = await Subscription.findOneAndUpdate(filter, update, options).lean();
    if (!updated) continue;
    return {
      allocation: exactAllocation(dayAllocations(updated, day._id), allocation),
      changed: true,
      mode: `adopted_${baseMode}`,
      premiumMode: premiumPlan.kind,
    };
  }
  throw serviceError("LINKED_DAY_REPAIR_CONFLICT", "Aggregate meal credit changed during repair", 409);
}

function deltaDay(day, spec) {
  const mealSlots = (Array.isArray(day && day.mealSlots) ? day.mealSlots : [])
    .filter((slot, index) => allocationMatchesSlot({ slotKey: slotKeyOf(slot, index) }, spec.slotKey));
  const premiumUpgradeSelections = (Array.isArray(day && day.premiumUpgradeSelections)
    ? day.premiumUpgradeSelections
    : []).filter((selection) => allocationMatchesSlot(
    { slotKey: selection && (selection.baseSlotKey || selection.slotKey) },
    spec.slotKey
  ));
  return { ...day, mealSlots, premiumUpgradeSelections };
}

async function reserveFresh({ subscriptionId, day, spec, session = null }) {
  const reservation = await reserveDayEntitlements({
    subscriptionId,
    day: deltaDay(day, spec),
    session,
  });
  const subscription = await attachSession(
    Subscription.findById(subscriptionId).select("baseMealAllocations"),
    session
  ).lean();
  return {
    allocation: exactAllocation(dayAllocations(subscription, day._id), spec),
    changed: Boolean(reservation.newlyReservedKeys && reservation.newlyReservedKeys.length),
    mode: "reserved_fresh_credit",
  };
}

async function syncDayProjection({ subscriptionId, dayId, session = null }) {
  const subscription = await attachSession(
    Subscription.findById(subscriptionId).select("baseMealAllocations"),
    session
  ).lean();
  if (!subscription) throw serviceError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
  const keys = unique(dayAllocations(subscription, dayId).map((row) => row.allocationKey));
  await SubscriptionDay.updateOne(
    { _id: dayId, subscriptionId },
    { $set: { baseAllocationKeys: keys, entitlementTransitionState: "reserved" } },
    withSession({}, session)
  );
  return keys;
}

async function repairLinkedDayAllocations({
  subscriptionId,
  date = null,
  dayId = null,
  selectedMealSlotIds = null,
  selectedPickupItemIds = null,
  pickupRequest = null,
  mealCount = null,
  session = null,
} = {}) {
  const explicitDayId = dayId || (pickupRequest && pickupRequest.subscriptionDayId);
  const dayQuery = explicitDayId
    ? SubscriptionDay.findById(explicitDayId)
    : SubscriptionDay.findOne({ subscriptionId, date });
  const day = await attachSession(dayQuery, session).lean();
  if (!day) {
    if (explicitDayId) {
      throw serviceError("LINKED_DAY_NOT_FOUND", "Linked subscription day was not found", 409, {
        messageAr: "تعذر العثور على يوم الاشتراك المرتبط بطلب الاستلام.",
        messageEn: "The subscription day linked to this pickup request could not be found.",
        subscriptionDayId: clean(explicitDayId),
      });
    }
    return { repaired: false, linked: false, reason: "day_not_found" };
  }
  if (clean(day.subscriptionId) !== clean(subscriptionId)) {
    throw serviceError("SUBSCRIPTION_MISMATCH", "Subscription day does not belong to subscription", 409);
  }
  if (!isConfirmedOrOperationalDay(day)) {
    return { repaired: false, linked: false, reason: "day_not_confirmed", day };
  }

  const requestedSlotKeys = selectedSlotKeysFromInput({
    day,
    selectedMealSlotIds,
    selectedPickupItemIds,
    pickupRequest,
  });
  const rawCount = Number(mealCount !== undefined && mealCount !== null
    ? mealCount
    : (pickupRequest && pickupRequest.mealCount));
  const requiredCount = Number.isInteger(rawCount) && rawCount > 0 ? rawCount : requestedSlotKeys.length;
  if (requiredCount <= 0) {
    return { repaired: false, linked: false, reason: "no_base_meal_items", day };
  }

  const allSpecs = buildDayAllocationSpecs({ subscriptionId, day });
  const targetSpecs = (requestedSlotKeys.length
    ? allSpecs.filter((spec) => requestedSlotKeys.some((key) => allocationMatchesSlot(spec, key)))
    : allSpecs.slice(0, requiredCount)).slice(0, requiredCount);
  if (targetSpecs.length < requiredCount) {
    throw serviceError(
      "LINKED_DAY_ENTITLEMENT_INCONSISTENT",
      "Selected pickup meals do not match the linked subscription day",
      409,
      {
        messageAr: "اختيارات الاستلام لا تطابق وجبات اليوم المؤكدة. لم يتم خصم أي رصيد إضافي.",
        messageEn: "The pickup selection does not match the confirmed meals for this day. No extra credit was deducted.",
        subscriptionDayId: clean(day._id),
        requestedSlotKeys,
        requestedMealCount: requiredCount,
        availableSlotKeys: allSpecs.map((spec) => clean(spec.slotKey)),
      }
    );
  }

  let subscription = await attachSession(
    Subscription.findById(subscriptionId).select(
      "__v totalMeals remainingMeals reservedMeals consumedMeals forfeitedMeals baseMealAllocations premiumBalance"
    ),
    session
  ).lean();
  if (!subscription) throw serviceError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
  const initialAllocations = dayAllocations(subscription, day._id);
  const missingSpecs = targetSpecs.filter((spec) => !exactAllocation(initialAllocations, spec));
  const reprojection = safeReprojectionMap({
    allocations: initialAllocations,
    allSpecs,
    missingSpecs,
  });
  const results = [];

  for (const spec of targetSpecs) {
    subscription = await attachSession(
      Subscription.findById(subscriptionId).select(
        "__v totalMeals remainingMeals reservedMeals consumedMeals forfeitedMeals baseMealAllocations premiumBalance"
      ),
      session
    ).lean();
    let allocation = exactAllocation(dayAllocations(subscription, day._id), spec);
    if (allocation) {
      if (allocation.state === "reserved") {
        results.push({ slotKey: spec.slotKey, allocationKey: allocation.allocationKey, changed: false, mode: "already_materialized" });
        continue;
      }
      if (allocation.state === "released") {
        const reopened = await reacquireAllocation({ subscriptionId, allocationKey: allocation.allocationKey, session });
        results.push({
          slotKey: spec.slotKey,
          allocationKey: allocation.allocationKey,
          changed: Boolean(reopened.changed),
          mode: "reacquired_released_allocation",
        });
        continue;
      }
      throw serviceError("PICKUP_ITEM_UNAVAILABLE", "The selected meal entitlement was already settled", 422, {
        messageAr: "تم استهلاك هذه الوجبة أو تسويتها بالفعل.",
        messageEn: "This meal was already consumed or settled.",
        allocationKey: clean(allocation.allocationKey),
        state: clean(allocation.state),
      });
    }

    const candidate = reprojection.get(clean(spec.slotKey));
    if (candidate) {
      const repaired = await reprojectAllocation({ subscriptionId, day, spec, candidate, session });
      if (repaired && repaired.allocation) {
        results.push({
          slotKey: spec.slotKey,
          allocationKey: repaired.allocation.allocationKey,
          changed: Boolean(repaired.changed),
          mode: repaired.mode,
        });
        continue;
      }
    }

    subscription = await attachSession(
      Subscription.findById(subscriptionId).select(
        "__v totalMeals remainingMeals reservedMeals consumedMeals forfeitedMeals baseMealAllocations premiumBalance"
      ),
      session
    ).lean();
    const currentAllocations = dayAllocations(subscription, day._id);
    const unsafeSurplus = currentAllocations.some((row) => (
      ["reserved", "released"].includes(clean(row && row.state))
      && !allSpecs.some((known) => allocationMatchesSlot(row, known.slotKey))
    ));

    let materialized = await adoptAggregateGap({ subscriptionId, day, spec, session });
    if (!materialized && unsafeSurplus) {
      throw serviceError(
        "LINKED_DAY_ENTITLEMENT_INCONSISTENT",
        "Existing day allocations cannot be mapped safely to the selected meal",
        409,
        {
          messageAr: "تعذر مطابقة رصيد اليوم مع الوجبة المحددة بأمان. لم يتم خصم أي رصيد إضافي.",
          messageEn: "The day's balance could not be matched safely to the selected meal. No extra credit was deducted.",
          subscriptionDayId: clean(day._id),
          selectedSlotKey: clean(spec.slotKey),
        }
      );
    }
    if (!materialized) materialized = await reserveFresh({ subscriptionId, day, spec, session });
    if (!materialized || !materialized.allocation) {
      throw serviceError("LINKED_DAY_ENTITLEMENT_INCONSISTENT", "Linked day repair did not produce an allocation", 409);
    }
    results.push({
      slotKey: spec.slotKey,
      allocationKey: materialized.allocation.allocationKey,
      changed: Boolean(materialized.changed),
      mode: materialized.mode,
      premiumMode: materialized.premiumMode || "none",
    });
  }

  const allocationKeys = await syncDayProjection({ subscriptionId, dayId: day._id, session });
  return {
    repaired: results.some((result) => result.changed),
    linked: true,
    day,
    requestedSlotKeys,
    allocationKeys,
    results,
  };
}

module.exports = {
  aggregateGaps,
  allocationMatchesSlot,
  isConfirmedOrOperationalDay,
  repairLinkedDayAllocations,
  selectedSlotKeysFromInput,
};
