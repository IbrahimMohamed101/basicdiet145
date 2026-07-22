"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const {
  buildDayAllocationSpecs,
  reacquireAllocation,
  reserveDayEntitlements,
} = require("./subscriptionMealEntitlementService");
const { slotAliases } = require("./pickupEntitlementLinkService");

const REPAIR_RETRY_LIMIT = 6;
const OPERATIONAL_DAY_STATUSES = new Set([
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

function withOptionalSession(options, session) {
  return session ? { ...options, session } : options;
}

function attachSession(query, session) {
  if (session && query && typeof query.session === "function") query.session(session);
  return query;
}

function slotKeyOf(slot, fallbackIndex = 0) {
  return clean(slot && (slot.slotKey || (slot.slotIndex ? `slot_${slot.slotIndex}` : "")))
    || `slot_${fallbackIndex + 1}`;
}

function isCompleteSlot(slot) {
  return Boolean(slot && String(slot.status || "complete") === "complete");
}

function isConfirmedOrOperationalDay(day) {
  if (!day) return false;
  if (day.plannerState === "confirmed" || day.planningState === "confirmed") return true;
  return OPERATIONAL_DAY_STATUSES.has(clean(day.status));
}

function aliasesIntersect(left, right) {
  const rightSet = new Set(slotAliases(right));
  return slotAliases(left).some((alias) => rightSet.has(alias));
}

function allocationMatchesSlot(allocation, requestedSlotKey) {
  return aliasesIntersect(allocation && allocation.slotKey, requestedSlotKey);
}

function selectedSlotKeysFromInput({
  day,
  selectedMealSlotIds = null,
  selectedPickupItemIds = null,
  pickupRequest = null,
} = {}) {
  const request = pickupRequest || {};
  const directIds = unique([
    ...(Array.isArray(selectedMealSlotIds) ? selectedMealSlotIds : []),
    ...(Array.isArray(request.selectedMealSlotIds) ? request.selectedMealSlotIds : []),
  ]);
  const itemIds = unique([
    ...(Array.isArray(selectedPickupItemIds) ? selectedPickupItemIds : []),
    ...(Array.isArray(request.selectedPickupItemIds) ? request.selectedPickupItemIds : []),
    ...(Array.isArray(request.selectedPickupItems)
      ? request.selectedPickupItems
        .filter((item) => item && ["meal", "premium_meal", "large_salad", "sandwich"].includes(clean(item.itemType)))
        .map((item) => item.slotKey || item.slotId || item.sourceId || item.itemId)
      : []),
  ]);
  const requestedIds = unique([...directIds, ...itemIds]);
  if (!requestedIds.length) return [];

  const slots = (Array.isArray(day && day.mealSlots) ? day.mealSlots : [])
    .filter(isCompleteSlot);
  const matched = [];
  slots.forEach((slot, index) => {
    const key = slotKeyOf(slot, index);
    const indexAliases = slotAliases(slot && slot.slotIndex);
    const keyAliases = new Set([...slotAliases(key), ...indexAliases]);
    const matches = requestedIds.some((requestedId) => (
      slotAliases(requestedId).some((alias) => keyAliases.has(alias))
    ));
    if (matches) matched.push(key);
  });
  return unique(matched);
}

function countLedgerStates(subscription) {
  const result = {
    reserved: 0,
    consumed: 0,
    released: 0,
    forfeited: 0,
  };
  for (const allocation of Array.isArray(subscription && subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : []) {
    const state = clean(allocation && allocation.state);
    if (Object.prototype.hasOwnProperty.call(result, state)) result[state] += 1;
  }
  return result;
}

function aggregateGaps(subscription) {
  const ledger = countLedgerStates(subscription);
  return {
    reserved: Math.max(0, Number(subscription && subscription.reservedMeals || 0) - ledger.reserved),
    consumed: Math.max(0, Number(subscription && subscription.consumedMeals || 0) - ledger.consumed),
    forfeited: Math.max(0, Number(subscription && subscription.forfeitedMeals || 0) - ledger.forfeited),
    ledger,
  };
}

function normalizedPremiumKey(value) {
  return clean(value).toLowerCase();
}

function premiumFundingCompatible(left = {}, right = {}) {
  const leftSource = clean(left.source || "none");
  const rightSource = clean(right.source || "none");
  if (leftSource !== rightSource) return false;
  if (leftSource !== "wallet") return true;
  const leftBucketId = clean(left.balanceBucketId);
  const rightBucketId = clean(right.balanceBucketId);
  if (leftBucketId && rightBucketId) return leftBucketId === rightBucketId;
  return normalizedPremiumKey(left.premiumKey) === normalizedPremiumKey(right.premiumKey)
    && (!clean(left.configId) || !clean(right.configId) || clean(left.configId) === clean(right.configId))
    && (!Number(left.revision || 0) || !Number(right.revision || 0)
      || Number(left.revision || 0) === Number(right.revision || 0));
}

function premiumBucketCandidates(subscription, funding = {}) {
  const buckets = Array.isArray(subscription && subscription.premiumBalance)
    ? subscription.premiumBalance
    : [];
  const bucketId = clean(funding.balanceBucketId);
  if (bucketId) return buckets.filter((bucket) => clean(bucket && bucket._id) === bucketId);

  const premiumKey = normalizedPremiumKey(funding.premiumKey);
  const configId = clean(funding.configId);
  const revision = Number(funding.revision || 0);
  return buckets.filter((bucket) => {
    if (normalizedPremiumKey(bucket && bucket.premiumKey) !== premiumKey) return false;
    if (configId && clean(bucket && bucket.configId) !== configId) return false;
    if ((configId || revision > 0) && Number(bucket && bucket.revision || 0) !== revision) return false;
    return true;
  });
}

function fundedLedgerCount(subscription, bucket, states) {
  const bucketId = clean(bucket && bucket._id);
  const premiumKey = normalizedPremiumKey(bucket && bucket.premiumKey);
  const wantedStates = new Set(states);
  return (Array.isArray(subscription && subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : []).filter((allocation) => {
    if (!wantedStates.has(clean(allocation && allocation.state))) return false;
    const funding = allocation && allocation.premiumFunding || {};
    if (clean(funding.source) !== "wallet") return false;
    const allocationBucketId = clean(funding.balanceBucketId);
    if (allocationBucketId) return allocationBucketId === bucketId;
    return normalizedPremiumKey(funding.premiumKey) === premiumKey;
  }).length;
}

function premiumRepairPlan(subscription, spec, baseAdoptionMode) {
  const funding = spec && spec.premiumFunding || {};
  if (clean(funding.source) !== "wallet") return { kind: "none", bucket: null };

  const candidates = premiumBucketCandidates(subscription, funding);
  const evaluated = candidates.map((bucket) => ({
    bucket,
    reservedGap: Math.max(
      0,
      Number(bucket && bucket.reservedQty || 0) - fundedLedgerCount(subscription, bucket, ["reserved"])
    ),
    consumedGap: Math.max(
      0,
      Number(bucket && bucket.consumedQty || 0) - fundedLedgerCount(subscription, bucket, ["consumed", "forfeited"])
    ),
    remainingQty: Math.max(0, Number(bucket && bucket.remainingQty || 0)),
  }));

  const preference = baseAdoptionMode === "consumed_gap"
    ? ["consumed_gap", "reserved_gap", "remaining"]
    : ["reserved_gap", "consumed_gap", "remaining"];
  for (const kind of preference) {
    const eligible = evaluated.filter((entry) => (
      kind === "reserved_gap" ? entry.reservedGap > 0
        : kind === "consumed_gap" ? entry.consumedGap > 0
          : entry.remainingQty > 0
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
      candidateCount: candidates.length,
    }
  );
}

function applyPremiumRepairToAtomicUpdate({ subscription, spec, baseAdoptionMode, filter, update, options }) {
  const plan = premiumRepairPlan(subscription, spec, baseAdoptionMode);
  if (plan.kind === "none") return plan;

  const bucket = plan.bucket;
  spec.premiumFunding = {
    ...(spec.premiumFunding || {}),
    balanceBucketId: bucket._id,
    configId: bucket.configId || spec.premiumFunding.configId || null,
    revision: Number(bucket.revision || spec.premiumFunding.revision || 0),
    state: "reserved",
  };
  filter.premiumBalance = { $elemMatch: { _id: bucket._id } };
  options.arrayFilters = [...(options.arrayFilters || []), { "bucket._id": bucket._id }];

  if (plan.kind === "consumed_gap") {
    filter.premiumBalance.$elemMatch.consumedQty = { $gte: 1 };
    update.$inc["premiumBalance.$[bucket].consumedQty"] = -1;
    update.$inc["premiumBalance.$[bucket].reservedQty"] = 1;
  } else if (plan.kind === "remaining") {
    filter.premiumBalance.$elemMatch.remainingQty = { $gte: 1 };
    update.$inc["premiumBalance.$[bucket].remainingQty"] = -1;
    update.$inc["premiumBalance.$[bucket].reservedQty"] = 1;
  }
  return plan;
}

function currentDayAllocations(subscription, dayId) {
  return (Array.isArray(subscription && subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : []).filter((allocation) => clean(allocation && allocation.dayId) === clean(dayId));
}

function exactAllocationForSpec(allocations, spec) {
  return allocations.find((allocation) => allocationMatchesSlot(allocation, spec.slotKey)) || null;
}

function safeReprojectionCandidates({ dayAllocations, allSpecs, missingSpecs }) {
  const validSlotKeys = allSpecs.map((spec) => spec.slotKey);
  const surplus = dayAllocations.filter((allocation) => {
    if (!["reserved", "released"].includes(clean(allocation && allocation.state))) return false;
    if (clean(allocation && allocation.pickupRequestId)) return false;
    return !validSlotKeys.some((slotKey) => allocationMatchesSlot(allocation, slotKey));
  });
  if (surplus.length !== missingSpecs.length || !surplus.length) return new Map();

  const mapping = new Map();
  for (let index = 0; index < missingSpecs.length; index += 1) {
    const candidate = surplus[index];
    const spec = missingSpecs[index];
    if (!premiumFundingCompatible(candidate.premiumFunding || {}, spec.premiumFunding || {})) {
      return new Map();
    }
    mapping.set(clean(spec.slotKey), candidate);
  }
  return mapping;
}

async function reprojectAllocation({ subscriptionId, day, spec, candidate, session = null }) {
  for (let attempt = 0; attempt < REPAIR_RETRY_LIMIT; attempt += 1) {
    const subscription = await attachSession(
      Subscription.findById(subscriptionId).select("__v baseMealAllocations"),
      session
    ).lean();
    if (!subscription) throw serviceError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
    const dayAllocations = currentDayAllocations(subscription, day._id);
    const exact = exactAllocationForSpec(dayAllocations, spec);
    if (exact) return { allocation: exact, changed: false, mode: "already_materialized" };

    const current = dayAllocations.find((allocation) => (
      clean(allocation && allocation.allocationKey) === clean(candidate && candidate.allocationKey)
    ));
    if (!current
      || !["reserved", "released"].includes(clean(current.state))
      || clean(current.pickupRequestId)) {
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
            $or: [
              { pickupRequestId: null },
              { pickupRequestId: { $exists: false } },
            ],
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
      withOptionalSession({ new: true }, session)
    ).lean();
    if (!updated) continue;
    const repaired = exactAllocationForSpec(currentDayAllocations(updated, day._id), spec);
    return { allocation: repaired, changed: true, mode: "reprojected_stale_allocation" };
  }
  throw serviceError(
    "LINKED_DAY_REPAIR_CONFLICT",
    "Linked day allocation changed while it was being repaired",
    409
  );
}

async function adoptAggregateGap({ subscriptionId, day, spec, session = null }) {
  for (let attempt = 0; attempt < REPAIR_RETRY_LIMIT; attempt += 1) {
    const subscription = await attachSession(
      Subscription.findById(subscriptionId).select(
        "__v totalMeals remainingMeals reservedMeals consumedMeals forfeitedMeals baseMealAllocations premiumBalance"
      ),
      session
    ).lean();
    if (!subscription) throw serviceError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);

    const exact = exactAllocationForSpec(currentDayAllocations(subscription, day._id), spec);
    if (exact) return { allocation: exact, changed: false, mode: "already_materialized" };

    const gaps = aggregateGaps(subscription);
    const baseAdoptionMode = gaps.reserved > 0
      ? "reserved_gap"
      : (gaps.consumed > 0 ? "consumed_gap" : null);
    if (!baseAdoptionMode) return null;

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
      "baseMealAllocations.allocationKey": { $ne: allocation.allocationKey },
    };
    const update = {
      $push: { baseMealAllocations: allocation },
      $inc: { __v: 1 },
    };
    if (baseAdoptionMode === "consumed_gap") {
      filter.consumedMeals = { $gte: 1 };
      update.$inc.consumedMeals = -1;
      update.$inc.reservedMeals = 1;
    }
    const options = withOptionalSession({ new: true }, session);
    const premiumPlan = applyPremiumRepairToAtomicUpdate({
      subscription,
      spec: allocation,
      baseAdoptionMode,
      filter,
      update,
      options,
    });

    const updated = await Subscription.findOneAndUpdate(filter, update, options).lean();
    if (!updated) continue;
    const repaired = exactAllocationForSpec(currentDayAllocations(updated, day._id), allocation);
    return {
      allocation: repaired,
      changed: true,
      mode: `adopted_${baseAdoptionMode}`,
      premiumMode: premiumPlan.kind,
    };
  }
  throw serviceError(
    "LINKED_DAY_REPAIR_CONFLICT",
    "Linked day allocation changed while aggregate credit was being materialized",
    409
  );
}

function deltaDayForSpec(day, spec) {
  const sourceSlots = Array.isArray(day && day.mealSlots) ? day.mealSlots : [];
  const selectedSlots = sourceSlots.filter((slot, index) => (
    allocationMatchesSlot({ slotKey: slotKeyOf(slot, index) }, spec.slotKey)
  ));
  const premiumSelections = (Array.isArray(day && day.premiumUpgradeSelections)
    ? day.premiumUpgradeSelections
    : []).filter((selection) => allocationMatchesSlot(
    { slotKey: selection && (selection.baseSlotKey || selection.slotKey) },
    spec.slotKey
  ));
  return {
    ...day,
    mealSlots: selectedSlots,
    premiumUpgradeSelections: premiumSelections,
  };
}

async function reserveFreshAllocation({ subscriptionId, day, spec, session = null }) {
  const reservation = await reserveDayEntitlements({
    subscriptionId,
    day: deltaDayForSpec(day, spec),
    session,
  });
  const subscription = await attachSession(
    Subscription.findById(subscriptionId).select("baseMealAllocations"),
    session
  ).lean();
  const exact = exactAllocationForSpec(currentDayAllocations(subscription, day._id), spec);
  return {
    allocation: exact,
    changed: Boolean(reservation.newlyReservedKeys && reservation.newlyReservedKeys.length),
    mode: "reserved_fresh_credit",
  };
}

async function synchronizeDayAllocationProjection({ subscriptionId, dayId, session = null }) {
  const subscription = await attachSession(
    Subscription.findById(subscriptionId).select("baseMealAllocations"),
    session
  ).lean();
  if (!subscription) throw serviceError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
  const keys = unique(currentDayAllocations(subscription, dayId)
    .map((allocation) => allocation && allocation.allocationKey));
  await SubscriptionDay.updateOne(
    { _id: dayId, subscriptionId },
    {
      $set: {
        baseAllocationKeys: keys,
        entitlementTransitionState: "reserved",
      },
    },
    withOptionalSession({}, session)
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
  const explicitMealCount = Number(
    mealCount !== undefined && mealCount !== null
      ? mealCount
      : (pickupRequest && pickupRequest.mealCount)
  );
  const requiredCount = Number.isInteger(explicitMealCount) && explicitMealCount > 0
    ? explicitMealCount
    : requestedSlotKeys.length;
  if (requiredCount <= 0) {
    return { repaired: false, linked: false, reason: "no_base_meal_items", day };
  }

  const allSpecs = buildDayAllocationSpecs({ subscriptionId, day });
  let targetSpecs = requestedSlotKeys.length
    ? allSpecs.filter((spec) => requestedSlotKeys.some((key) => allocationMatchesSlot(spec, key)))
    : allSpecs.slice(0, requiredCount);
  targetSpecs = targetSpecs.slice(0, requiredCount);
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

  const initialDayAllocations = currentDayAllocations(subscription, day._id);
  const initiallyMissing = targetSpecs.filter((spec) => !exactAllocationForSpec(initialDayAllocations, spec));
  const reprojectionMap = safeReprojectionCandidates({
    dayAllocations: initialDayAllocations,
    allSpecs,
    missingSpecs: initiallyMissing,
  });
  const results = [];

  for (const spec of targetSpecs) {
    subscription = await attachSession(
      Subscription.findById(subscriptionId).select(
        "__v totalMeals remainingMeals reservedMeals consumedMeals forfeitedMeals baseMealAllocations premiumBalance"
      ),
      session
    ).lean();
    let allocation = exactAllocationForSpec(currentDayAllocations(subscription, day._id), spec);
    if (allocation) {
      if (allocation.state === "released") {
        const reopened = await reacquireAllocation({
          subscriptionId,
          allocationKey: allocation.allocationKey,
          session,
        });
        results.push({
          slotKey: spec.slotKey,
          allocationKey: allocation.allocationKey,
          changed: Boolean(reopened.changed),
          mode: "reacquired_released_allocation",
        });
      } else if (allocation.state === "reserved") {
        results.push({
          slotKey: spec.slotKey,
          allocationKey: allocation.allocationKey,
          changed: false,
          mode: "already_materialized",
        });
      } else {
        throw serviceError(
          "PICKUP_ITEM_UNAVAILABLE",
          "The selected meal entitlement was already settled",
          422,
          {
            messageAr: "تم استهلاك هذه الوجبة أو تسويتها بالفعل.",
            messageEn: "This meal was already consumed or settled.",
            allocationKey: clean(allocation.allocationKey),
            state: clean(allocation.state),
          }
        );
      }
      continue;
    }

    const candidate = reprojectionMap.get(clean(spec.slotKey));
    if (candidate) {
      const reprojected = await reprojectAllocation({
        subscriptionId,
        day,
        spec,
        candidate,
        session,
      });
      if (reprojected && reprojected.allocation) {
        results.push({
          slotKey: spec.slotKey,
          allocationKey: reprojected.allocation.allocationKey,
          changed: Boolean(reprojected.changed),
          mode: reprojected.mode,
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
    const dayAllocations = currentDayAllocations(subscription, day._id);
    const hasUnsafeSurplus = dayAllocations.some((entry) => (
      ["reserved", "released"].includes(clean(entry && entry.state))
      && !allSpecs.some((knownSpec) => allocationMatchesSlot(entry, knownSpec.slotKey))
    ));

    let materialized = await adoptAggregateGap({
      subscriptionId,
      day,
      spec,
      session,
    });
    if (!materialized && hasUnsafeSurplus) {
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
    if (!materialized) {
      materialized = await reserveFreshAllocation({
        subscriptionId,
        day,
        spec,
        session,
      });
    }
    if (!materialized || !materialized.allocation) {
      throw serviceError(
        "LINKED_DAY_ENTITLEMENT_INCONSISTENT",
        "Linked day allocation repair did not produce an entitlement allocation",
        409
      );
    }
    results.push({
      slotKey: spec.slotKey,
      allocationKey: materialized.allocation.allocationKey,
      changed: Boolean(materialized.changed),
      mode: materialized.mode,
      premiumMode: materialized.premiumMode || "none",
    });
  }

  const allocationKeys = await synchronizeDayAllocationProjection({
    subscriptionId,
    dayId: day._id,
    session,
  });
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
