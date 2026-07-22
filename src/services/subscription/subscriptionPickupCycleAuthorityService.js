"use strict";

const crypto = require("node:crypto");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const SubscriptionDayAppendOperation = require("../../models/SubscriptionDayAppendOperation");
const { logger } = require("../../utils/logger");
const dateUtils = require("../../utils/date");
const {
  assertRestaurantOpenForOrdering,
  getRestaurantBusinessDate,
} = require("../restaurantHoursService");
const {
  buildDayAllocationSpecs,
  checkEntitlementInvariants,
  ensureEntitlementLedger,
  reacquireAllocation,
  reserveDayEntitlements,
  transitionAllocation,
} = require("./subscriptionMealEntitlementService");
const {
  consumeReservedPickupMeals,
} = require("./subscriptionPickupRequestBalanceService");
const {
  clearLinkedClaims,
} = require("./pickupEntitlementLinkService");
const {
  serializeSubscriptionDayForClient,
  shapeMealPlannerReadFields,
} = require("./subscriptionClientSupportService");
const {
  localizeWriteDayPayload,
} = require("../../utils/subscription/subscriptionWriteLocalization");

const ACTIVE_PICKUP_REQUEST_STATUSES = ["locked", "in_preparation", "ready_for_pickup"];
const OPERATION_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

function serviceError(code, message, status = 409, details = undefined) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

function errorResult(err) {
  return {
    ok: false,
    status: Number(err && err.status || 500),
    code: String(err && err.code || "INTERNAL"),
    message: String(err && err.message || "Pickup cycle operation failed"),
    details: err && err.details,
  };
}

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (value[key] !== undefined) result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }
  return value;
}

function hashAppendRequest({ subscriptionId, date, mealSlots = [], addonsOneTime = undefined }) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize({
      subscriptionId: clean(subscriptionId),
      date: clean(date),
      mealSlots,
      addonsOneTime,
    })))
    .digest("hex");
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
  return [
    "locked",
    "in_preparation",
    "ready_for_pickup",
    "fulfilled",
    "no_show",
    "canceled_at_branch",
  ].includes(String(day.status || ""));
}

function dayPlanningSnapshot(day) {
  return {
    status: day.status,
    mealSlots: day.mealSlots || [],
    plannerMeta: day.plannerMeta || undefined,
    plannerState: day.plannerState || undefined,
    plannerVersion: day.plannerVersion || undefined,
    plannerRevisionHash: day.plannerRevisionHash || "",
    materializedMeals: day.materializedMeals || [],
    selections: day.selections || [],
    premiumUpgradeSelections: day.premiumUpgradeSelections || [],
    premiumReservationMode: day.premiumReservationMode || undefined,
    baseMealSlots: day.baseMealSlots || [],
    addonSelections: day.addonSelections || [],
    planningState: day.planningState || undefined,
    planningMeta: day.planningMeta || undefined,
    planningVersion: day.planningVersion || undefined,
  };
}

function walletFromSubscription(subscription) {
  const source = subscription || {};
  const wallet = {
    sourceOfTruth: "subscription.baseMealAllocations",
    entitlementVersion: Number(source.entitlementVersion || 0),
    totalMeals: Number(source.totalMeals || 0),
    remainingMeals: Number(source.remainingMeals || 0),
    reservedMeals: Number(source.reservedMeals || 0),
    consumedMeals: Number(source.consumedMeals || 0),
    forfeitedMeals: Number(source.forfeitedMeals || 0),
    availableToOrder: Number(source.remainingMeals || 0),
    awaitingPickup: Number(source.reservedMeals || 0),
    usedAfterFulfillment: Number(source.consumedMeals || 0),
    uncollectedPolicy: "release_on_next_business_day",
  };
  const invariant = checkEntitlementInvariants(source);
  wallet.invariant = {
    valid: Boolean(invariant.valid),
    totalMeals: Number(invariant.totalMeals || 0),
    projectedTotal: Number(invariant.actual || 0),
  };
  return wallet;
}

async function readWallet(subscriptionId) {
  const subscription = await ensureEntitlementLedger(subscriptionId);
  return walletFromSubscription(subscription);
}

function allocationIdentity(allocation) {
  return `${clean(allocation && allocation.dayId)}:${clean(allocation && allocation.slotKey)}`;
}

function specIdentity(spec) {
  return `${clean(spec && spec.dayId)}:${clean(spec && spec.slotKey)}`;
}

async function compensateChangedAllocations(subscriptionId, allocationKeys) {
  const keys = [...new Set((allocationKeys || []).map(clean).filter(Boolean))];
  if (!keys.length) return;
  const subscription = await Subscription.findById(subscriptionId)
    .select("baseMealAllocations")
    .lean();
  const byKey = new Map((subscription && subscription.baseMealAllocations || [])
    .map((allocation) => [clean(allocation.allocationKey), allocation]));
  for (const key of keys) {
    const allocation = byKey.get(key);
    if (!allocation || allocation.state !== "reserved") continue;
    await transitionAllocation({
      subscriptionId,
      allocationKey: key,
      toState: "released",
    });
  }
}

async function reserveMissingDaySlotAllocations({
  subscriptionId,
  dayId,
  slotKeys = null,
} = {}) {
  const day = await SubscriptionDay.findById(dayId).lean();
  if (!day) throw serviceError("DAY_NOT_FOUND", "Subscription day not found", 404);
  if (String(day.subscriptionId) !== String(subscriptionId)) {
    throw serviceError("SUBSCRIPTION_MISMATCH", "Subscription day does not belong to subscription", 409);
  }
  if (!isConfirmedOrOperationalDay(day)) {
    return {
      reservedDelta: 0,
      allocationKeys: [],
      skipped: true,
      reason: "day_not_confirmed",
      wallet: await readWallet(subscriptionId),
    };
  }

  const requestedKeys = slotKeys
    ? new Set(slotKeys.map(clean).filter(Boolean))
    : null;
  const targetSlots = (Array.isArray(day.mealSlots) ? day.mealSlots : [])
    .filter(isCompleteSlot)
    .filter((slot, index) => !requestedKeys || requestedKeys.has(slotKeyOf(slot, index)));
  if (!targetSlots.length) {
    return {
      reservedDelta: 0,
      allocationKeys: [],
      skipped: true,
      reason: "no_complete_slots",
      wallet: await readWallet(subscriptionId),
    };
  }

  const targetKeys = new Set(targetSlots.map(slotKeyOf));
  const allSpecs = buildDayAllocationSpecs({ subscriptionId, day });
  const targetSpecs = allSpecs.filter((spec) => targetKeys.has(clean(spec.slotKey)));
  const beforeSubscription = await ensureEntitlementLedger(subscriptionId);
  const beforeWallet = walletFromSubscription(beforeSubscription);
  const existingByIdentity = new Map((beforeSubscription.baseMealAllocations || [])
    .filter((allocation) => clean(allocation.dayId) === clean(day._id))
    .map((allocation) => [allocationIdentity(allocation), allocation]));

  const allocationKeys = [];
  const changedKeys = [];
  const missingSpecs = [];
  try {
    for (const spec of targetSpecs) {
      const existing = existingByIdentity.get(specIdentity(spec));
      if (!existing) {
        missingSpecs.push(spec);
        continue;
      }
      allocationKeys.push(clean(existing.allocationKey));
      if (existing.state === "released") {
        const reopened = await reacquireAllocation({
          subscriptionId,
          allocationKey: existing.allocationKey,
        });
        if (reopened.changed) changedKeys.push(clean(existing.allocationKey));
      } else if (!["reserved", "consumed", "forfeited"].includes(existing.state)) {
        throw serviceError("DATA_INTEGRITY_ERROR", "Unsupported entitlement allocation state", 409, {
          allocationKey: clean(existing.allocationKey),
          state: existing.state,
        });
      }
    }

    if (missingSpecs.length) {
      const missingKeys = new Set(missingSpecs.map((spec) => clean(spec.slotKey)));
      const deltaDay = {
        ...day,
        mealSlots: targetSlots.filter((slot, index) => missingKeys.has(slotKeyOf(slot, index))),
        premiumUpgradeSelections: Array.isArray(day.premiumUpgradeSelections)
          ? day.premiumUpgradeSelections.filter((selection) => missingKeys.has(clean(selection && (selection.baseSlotKey || selection.slotKey))))
          : [],
      };
      const reservation = await reserveDayEntitlements({
        subscriptionId,
        day: deltaDay,
      });
      allocationKeys.push(...reservation.allocationKeys.map(clean));
      changedKeys.push(...reservation.newlyReservedKeys.map(clean));
    }

    const latestSubscription = await Subscription.findById(subscriptionId)
      .select("baseMealAllocations totalMeals remainingMeals reservedMeals consumedMeals forfeitedMeals entitlementVersion premiumBalance")
      .lean();
    const authoritativeDayKeys = (latestSubscription && latestSubscription.baseMealAllocations || [])
      .filter((allocation) => clean(allocation.dayId) === clean(day._id))
      .map((allocation) => clean(allocation.allocationKey))
      .filter(Boolean);

    if (authoritativeDayKeys.length) {
      await SubscriptionDay.updateOne(
        { _id: day._id },
        {
          $addToSet: { baseAllocationKeys: { $each: authoritativeDayKeys } },
          $set: { entitlementTransitionState: "reserved" },
        }
      );
    }

    const afterWallet = walletFromSubscription(latestSubscription);
    return {
      reservedDelta: Math.max(0, beforeWallet.remainingMeals - afterWallet.remainingMeals),
      allocationKeys: [...new Set(allocationKeys.filter(Boolean))],
      newlyChangedAllocationKeys: [...new Set(changedKeys.filter(Boolean))],
      skipped: false,
      wallet: afterWallet,
      beforeWallet,
    };
  } catch (err) {
    await compensateChangedAllocations(subscriptionId, changedKeys).catch((compensationError) => {
      logger.error("append entitlement compensation failed", {
        subscriptionId: clean(subscriptionId),
        dayId: clean(dayId),
        error: compensationError.message,
      });
    });
    throw err;
  }
}

async function reconcileConfirmedDayAllocations({ subscriptionId, date = null, dayId = null } = {}) {
  const query = dayId ? { _id: dayId } : { subscriptionId, date };
  const day = await SubscriptionDay.findOne(query).lean();
  if (!day || !isConfirmedOrOperationalDay(day)) {
    return { reconciled: false, reservedDelta: 0, wallet: await readWallet(subscriptionId) };
  }

  const subscription = await ensureEntitlementLedger(subscriptionId);
  const allocatedSlotKeys = new Set((subscription.baseMealAllocations || [])
    .filter((allocation) => clean(allocation.dayId) === clean(day._id))
    .map((allocation) => clean(allocation.slotKey))
    .filter(Boolean));
  const missingSlotKeys = (Array.isArray(day.mealSlots) ? day.mealSlots : [])
    .filter(isCompleteSlot)
    .map(slotKeyOf)
    .filter((slotKey) => !allocatedSlotKeys.has(slotKey));

  if (!missingSlotKeys.length) {
    return { reconciled: false, reservedDelta: 0, wallet: walletFromSubscription(subscription) };
  }

  const result = await reserveMissingDaySlotAllocations({
    subscriptionId,
    dayId: day._id,
    slotKeys: missingSlotKeys,
  });
  return { ...result, reconciled: true, missingSlotKeys };
}

async function releaseAllocationKeys({ subscriptionId, allocationKeys = [] } = {}) {
  const keys = [...new Set(allocationKeys.map(clean).filter(Boolean))];
  if (!keys.length) return { changedCount: 0, releasedKeys: [] };
  let changedCount = 0;
  const releasedKeys = [];
  for (const key of keys) {
    const subscription = await Subscription.findById(subscriptionId)
      .select("baseMealAllocations")
      .lean();
    const allocation = (subscription && subscription.baseMealAllocations || [])
      .find((entry) => clean(entry.allocationKey) === key);
    if (!allocation) continue;
    if (allocation.state === "released") {
      releasedKeys.push(key);
      continue;
    }
    if (allocation.state !== "reserved") continue;
    const result = await transitionAllocation({
      subscriptionId,
      allocationKey: key,
      toState: "released",
    });
    if (result.changed) changedCount += 1;
    releasedKeys.push(key);
  }
  return { changedCount, releasedKeys };
}

async function releaseExpiredReservationsForSubscription({
  subscriptionId,
  businessDate = null,
} = {}) {
  const resolvedBusinessDate = businessDate || await getRestaurantBusinessDate();
  const subscription = await ensureEntitlementLedger(subscriptionId);
  const historicalReserved = (subscription.baseMealAllocations || [])
    .filter((allocation) => allocation.state === "reserved")
    .filter((allocation) => clean(allocation.date) && clean(allocation.date) < clean(resolvedBusinessDate));

  const activeRequests = await SubscriptionPickupRequest.find({
    subscriptionId,
    date: { $lt: clean(resolvedBusinessDate) },
    status: { $in: ACTIVE_PICKUP_REQUEST_STATUSES },
    creditsConsumedAt: null,
  }).lean();

  const allKeys = new Set(historicalReserved.map((allocation) => clean(allocation.allocationKey)).filter(Boolean));
  for (const request of activeRequests) {
    for (const key of Array.isArray(request.baseAllocationKeys) ? request.baseAllocationKeys : []) {
      allKeys.add(clean(key));
    }
  }

  const releaseResult = await releaseAllocationKeys({
    subscriptionId,
    allocationKeys: [...allKeys],
  });
  const now = new Date();

  for (const request of activeRequests) {
    const requestKeys = (Array.isArray(request.baseAllocationKeys) ? request.baseAllocationKeys : [])
      .map(clean)
      .filter(Boolean);
    await clearLinkedClaims({
      subscriptionId,
      pickupRequestId: request._id,
      allocationKeys: requestKeys,
    }).catch(() => {});
    await SubscriptionPickupRequest.updateOne(
      {
        _id: request._id,
        creditsConsumedAt: null,
      },
      {
        $set: {
          status: "canceled",
          creditsReleasedAt: request.creditsReleasedAt || now,
          canceledAt: request.canceledAt || now,
          canceledBy: "system",
          cancellationReason: "expired_uncollected_returned_to_balance",
          settlementReason: "next_business_day_release",
          settlementBy: "system",
          settledAt: now,
        },
        $push: {
          operationAuditLog: {
            action: "auto_release_uncollected",
            by: "system",
            at: now,
          },
        },
      }
    );
  }

  const affectedDayIds = [...new Set(historicalReserved.map((allocation) => clean(allocation.dayId)).filter(Boolean))];
  if (affectedDayIds.length) {
    await SubscriptionDay.updateMany(
      { _id: { $in: affectedDayIds } },
      { $set: { entitlementTransitionState: "released_expired" } }
    );
  }

  const latest = await Subscription.findById(subscriptionId).lean();
  return {
    releasedCount: releaseResult.changedCount,
    releasedAllocationKeys: releaseResult.releasedKeys,
    settledRequestCount: activeRequests.length,
    businessDate: clean(resolvedBusinessDate),
    wallet: walletFromSubscription(latest),
  };
}

async function releaseExpiredReservationsForUser({ userId, businessDate = null } = {}) {
  const subscription = await Subscription.findOne({ userId, status: "active" })
    .sort({ createdAt: -1 })
    .select("_id")
    .lean();
  if (!subscription) return null;
  return releaseExpiredReservationsForSubscription({
    subscriptionId: subscription._id,
    businessDate,
  });
}

async function settlePickupRequestAsUncollected({ requestId, userId = null, reason = "no_show" } = {}) {
  const request = await SubscriptionPickupRequest.findById(requestId).lean();
  if (!request) throw serviceError("NOT_FOUND", "Pickup request not found", 404);
  if (request.creditsConsumedAt) {
    throw serviceError("CREDITS_CONSUMED", "Pickup request was already fulfilled", 409);
  }
  if (request.status === "no_show" && request.creditsReleasedAt) {
    return {
      pickupRequest: request,
      releasedCount: 0,
      wallet: await readWallet(request.subscriptionId),
      idempotent: true,
    };
  }

  const keys = (Array.isArray(request.baseAllocationKeys) ? request.baseAllocationKeys : [])
    .map(clean)
    .filter(Boolean);
  const releaseResult = await releaseAllocationKeys({
    subscriptionId: request.subscriptionId,
    allocationKeys: keys,
  });
  await clearLinkedClaims({
    subscriptionId: request.subscriptionId,
    pickupRequestId: request._id,
    allocationKeys: keys,
  }).catch(() => {});

  const now = new Date();
  const updated = await SubscriptionPickupRequest.findOneAndUpdate(
    { _id: request._id, creditsConsumedAt: null },
    {
      $set: {
        status: "no_show",
        pickupNoShowAt: request.pickupNoShowAt || now,
        creditsReleasedAt: request.creditsReleasedAt || now,
        canceledAt: request.canceledAt || now,
        canceledBy: clean(userId) || "system",
        cancellationReason: reason || "no_show",
        settlementReason: "uncollected_returned_to_balance",
        settlementBy: clean(userId) || "system",
        settledAt: now,
      },
      $push: {
        operationAuditLog: {
          action: "no_show_release_to_balance",
          by: clean(userId) || "system",
          at: now,
        },
      },
    },
    { new: true }
  ).lean();

  return {
    pickupRequest: updated || request,
    releasedCount: releaseResult.changedCount,
    wallet: await readWallet(request.subscriptionId),
    idempotent: false,
  };
}

async function fulfillPickupRequestSafely({ requestId, actorId = null } = {}) {
  const request = await SubscriptionPickupRequest.findById(requestId).lean();
  if (!request) throw serviceError("NOT_FOUND", "Pickup request not found", 404);
  if (request.creditsReleasedAt) {
    throw serviceError("CREDITS_RELEASED", "Reserved pickup credits were already returned", 409);
  }
  if (!["ready_for_pickup", "fulfilled"].includes(request.status)) {
    throw serviceError("INVALID_TRANSITION", "Pickup request is not ready for fulfillment", 409);
  }

  const consumption = await consumeReservedPickupMeals({
    pickupRequestId: request._id,
    entitlementState: "consumed",
  });
  const now = new Date();
  const updated = await SubscriptionPickupRequest.findOneAndUpdate(
    { _id: request._id, creditsConsumedAt: { $ne: null } },
    {
      $set: {
        status: "fulfilled",
        fulfilledAt: request.fulfilledAt || now,
        fulfilledByDashboardUserId: actorId || request.fulfilledByDashboardUserId || null,
        settlementReason: "fulfilled_consumed",
        settlementBy: clean(actorId) || "dashboard",
        settledAt: now,
      },
      $push: {
        operationAuditLog: {
          action: "fulfill_consume",
          by: clean(actorId) || "dashboard",
          at: now,
        },
      },
    },
    { new: true }
  ).lean();

  if (!updated) {
    throw serviceError("DATA_INTEGRITY_ERROR", "Pickup credits were consumed but request projection was not updated", 409);
  }

  return {
    pickupRequest: updated,
    consumedCount: consumption.consumed ? Number(consumption.mealCount || 0) : 0,
    wallet: await readWallet(request.subscriptionId),
    idempotent: Boolean(consumption.alreadyConsumed),
  };
}

async function assertAppendBusinessPolicy({ subscriptionId, date, userId }) {
  const businessDate = await getRestaurantBusinessDate();
  if (clean(date) !== clean(businessDate)) {
    throw serviceError("INVALID_DATE", "Meals can only be appended for the current business day", 400, {
      businessDate: clean(businessDate),
    });
  }
  const subscription = await Subscription.findById(subscriptionId).lean();
  if (!subscription) throw serviceError("NOT_FOUND", "Subscription not found", 404);
  if (clean(subscription.userId) !== clean(userId)) throw serviceError("FORBIDDEN", "Forbidden", 403);
  if (subscription.status !== "active") throw serviceError("SUB_INACTIVE", "Subscription not active", 422);
  if (subscription.deliveryMode !== "pickup") {
    throw serviceError("PICKUP_MODE_REQUIRED", "Same-day meal append is only available for pickup subscriptions", 400);
  }
  await assertRestaurantOpenForOrdering({
    pickupLocationId: subscription.pickupLocationId,
    deliveryMode: "pickup",
  });
  return { subscription, businessDate };
}

async function acquireAppendOperation({ subscriptionId, day, date, userId, body }) {
  const idempotencyKey = clean(body && body.idempotencyKey);
  if (!idempotencyKey) {
    throw serviceError("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey is required", 400);
  }
  const requestHash = hashAppendRequest({
    subscriptionId,
    date,
    mealSlots: body.mealSlots || [],
    addonsOneTime: body.addonsOneTime !== undefined ? body.addonsOneTime : body.oneTimeAddonSelections,
  });

  let existing = await SubscriptionDayAppendOperation.findOne({
    subscriptionId,
    date,
    idempotencyKey,
  });
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw serviceError("IDEMPOTENCY_CONFLICT", "idempotencyKey was already used with a different append payload", 409);
    }
    return existing;
  }

  const mealSlots = Array.isArray(body.mealSlots) ? body.mealSlots : [];
  const existingSlots = Array.isArray(day.mealSlots) ? day.mealSlots : [];
  const maxSlotIndex = existingSlots.reduce(
    (max, slot) => Math.max(max, Number(slot && slot.slotIndex || 0)),
    0
  );
  const expectedSlotKeys = mealSlots.map((_slot, index) => `slot_${maxSlotIndex + index + 1}`);

  try {
    return await SubscriptionDayAppendOperation.create({
      subscriptionId,
      subscriptionDayId: day._id,
      userId,
      date,
      idempotencyKey,
      requestHash,
      status: "started",
      active: true,
      preSlotCount: existingSlots.length,
      expectedSlotKeys,
      previousPlannerRevisionHash: day.plannerRevisionHash || "",
      previousDaySnapshot: dayPlanningSnapshot(day),
    });
  } catch (err) {
    if (err && err.code === 11000) {
      existing = await SubscriptionDayAppendOperation.findOne({
        subscriptionId,
        date,
        idempotencyKey,
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw serviceError("IDEMPOTENCY_CONFLICT", "idempotencyKey was already used with a different append payload", 409);
        }
        return existing;
      }
      const active = await SubscriptionDayAppendOperation.findOne({
        subscriptionDayId: day._id,
        active: true,
      }).lean();
      throw serviceError("APPEND_IN_PROGRESS", "Another meal append is already in progress for this day", 409, {
        retryAfterSeconds: active && active.startedAt
          ? Math.max(1, Math.ceil((OPERATION_LOCK_TIMEOUT_MS - (Date.now() - new Date(active.startedAt).getTime())) / 1000))
          : 5,
      });
    }
    throw err;
  }
}

function expectedSlotsPresent(day, operation) {
  const present = new Set((Array.isArray(day && day.mealSlots) ? day.mealSlots : [])
    .map(slotKeyOf)
    .filter(Boolean));
  return (operation.expectedSlotKeys || []).every((key) => present.has(clean(key)));
}

async function restoreDaySnapshot(operation) {
  const snapshot = operation && operation.previousDaySnapshot;
  if (!snapshot || !operation.subscriptionDayId) return false;
  const filter = { _id: operation.subscriptionDayId };
  if (operation.appliedPlannerRevisionHash) {
    filter.plannerRevisionHash = operation.appliedPlannerRevisionHash;
  }
  const result = await SubscriptionDay.updateOne(filter, { $set: snapshot });
  return Boolean(result.modifiedCount);
}

async function buildAppendResponse({ args, day, idempotent, reservation }) {
  const subscription = await Subscription.findById(args.subscriptionId);
  const wallet = reservation && reservation.wallet
    ? reservation.wallet
    : await readWallet(args.subscriptionId);
  let shapedDay = day;
  try {
    const serializedDay = serializeSubscriptionDayForClient(
      subscription,
      day && typeof day.toObject === "function" ? day.toObject() : day,
      args.runtime
    );
    const catalog = args.loadWalletCatalogMapsSafelyFn
      ? await args.loadWalletCatalogMapsSafelyFn({
        days: [serializedDay],
        lang: args.lang,
        context: "append_day_meals_authority_result",
      })
      : { addonNames: new Map() };
    shapedDay = shapeMealPlannerReadFields({
      subscription,
      day: localizeWriteDayPayload(serializedDay, {
        lang: args.lang,
        addonNames: catalog.addonNames,
      }),
      lang: args.lang,
    });
  } catch (err) {
    logger.warn("append authority response shaping fallback", {
      subscriptionId: clean(args.subscriptionId),
      date: clean(args.date),
      error: err.message,
    });
  }
  return {
    ok: true,
    status: 200,
    data: {
      ...(shapedDay && typeof shapedDay === "object" ? shapedDay : {}),
      entitlementWallet: wallet,
      balanceChange: {
        event: "same_day_meals_appended",
        reservedDelta: Number(reservation && reservation.reservedDelta || 0),
        consumedDelta: 0,
        remainingMeals: wallet.remainingMeals,
        reservedMeals: wallet.reservedMeals,
        consumedMeals: wallet.consumedMeals,
        consumptionAppliedAtFulfillment: true,
      },
    },
    idempotent: Boolean(idempotent),
  };
}

async function appendMealsWithAuthority(args, originalAppend) {
  let operation = null;
  let originalResult = null;
  try {
    await assertAppendBusinessPolicy({
      subscriptionId: args.subscriptionId,
      date: args.date,
      userId: args.userId,
    });
    let day = await SubscriptionDay.findOne({
      subscriptionId: args.subscriptionId,
      date: args.date,
    });
    if (!day) throw serviceError("DAY_NOT_FOUND", "Subscription day not found", 404);

    operation = await acquireAppendOperation({
      subscriptionId: args.subscriptionId,
      day,
      date: args.date,
      userId: args.userId,
      body: args.body || {},
    });

    if (operation.status === "completed") {
      const reservation = await reconcileConfirmedDayAllocations({
        subscriptionId: args.subscriptionId,
        dayId: day._id,
      });
      day = await SubscriptionDay.findById(day._id);
      return buildAppendResponse({ args, day, idempotent: true, reservation });
    }

    let daySaved = ["day_saved", "credits_reserved"].includes(operation.status)
      || expectedSlotsPresent(day, operation);
    if (!daySaved) {
      originalResult = await originalAppend(args);
      if (!originalResult || originalResult.ok !== true) {
        await SubscriptionDayAppendOperation.updateOne(
          { _id: operation._id },
          {
            $set: {
              status: "failed",
              active: false,
              failedAt: new Date(),
              errorCode: originalResult && originalResult.code || "APPEND_FAILED",
              errorMessage: originalResult && originalResult.message || "Append failed",
            },
          }
        );
        return originalResult;
      }
      day = await SubscriptionDay.findById(day._id);
      if (!day || !expectedSlotsPresent(day, operation)) {
        throw serviceError("APPEND_PROJECTION_MISMATCH", "Appended meal slots were not persisted as expected", 409);
      }
      daySaved = true;
      operation = await SubscriptionDayAppendOperation.findOneAndUpdate(
        { _id: operation._id },
        {
          $set: {
            status: "day_saved",
            appendedSlotKeys: operation.expectedSlotKeys,
            appliedPlannerRevisionHash: day.plannerRevisionHash || "",
          },
        },
        { new: true }
      );
    }

    const reservation = await reserveMissingDaySlotAllocations({
      subscriptionId: args.subscriptionId,
      dayId: day._id,
      slotKeys: operation.expectedSlotKeys,
    });
    operation = await SubscriptionDayAppendOperation.findOneAndUpdate(
      { _id: operation._id },
      {
        $set: {
          status: "completed",
          active: false,
          allocationKeys: reservation.allocationKeys,
          completedAt: new Date(),
          appliedPlannerRevisionHash: day.plannerRevisionHash || operation.appliedPlannerRevisionHash || "",
        },
      },
      { new: true }
    );

    day = await SubscriptionDay.findById(day._id);
    return buildAppendResponse({
      args,
      day,
      idempotent: Boolean(!originalResult),
      reservation,
    });
  } catch (err) {
    if (operation && ["day_saved", "credits_reserved"].includes(operation.status)) {
      await restoreDaySnapshot(operation).catch(() => false);
    }
    if (operation) {
      await SubscriptionDayAppendOperation.updateOne(
        { _id: operation._id, status: { $ne: "completed" } },
        {
          $set: {
            status: operation.status === "day_saved" ? "compensated" : "failed",
            active: false,
            failedAt: new Date(),
            errorCode: clean(err.code) || "APPEND_FAILED",
            errorMessage: clean(err.message).slice(0, 500),
          },
        }
      ).catch(() => {});
    }
    return errorResult(err);
  }
}

function attachWalletToAvailability(result, wallet) {
  if (!result || typeof result !== "object") return result;
  const summary = result.summary && typeof result.summary === "object" ? result.summary : {};
  return {
    ...result,
    remainingMeals: wallet.remainingMeals,
    wallet: {
      ...(result.wallet && typeof result.wallet === "object" ? result.wallet : {}),
      ...wallet,
      availableMeals: wallet.availableToOrder,
    },
    entitlementWallet: wallet,
    summary: {
      ...summary,
      canAppendMeals: wallet.remainingMeals > 0,
      appendLimit: wallet.remainingMeals,
    },
  };
}

function attachWalletToPickupCreateResult(result, wallet) {
  if (!result || typeof result !== "object") return result;
  return {
    ...result,
    data: result.data && typeof result.data === "object"
      ? {
        ...result.data,
        entitlementWallet: wallet,
        balanceChange: {
          event: "pickup_request_reserved",
          remainingMeals: wallet.remainingMeals,
          reservedMeals: wallet.reservedMeals,
          consumedMeals: wallet.consumedMeals,
          consumptionAppliedAtFulfillment: true,
        },
      }
      : result.data,
  };
}

function attachWalletToOverview(result, wallet) {
  if (!result || !result.data || typeof result.data !== "object") return result;
  return {
    ...result,
    data: {
      ...result.data,
      remainingMeals: wallet.remainingMeals,
      entitlementWallet: wallet,
    },
  };
}

module.exports = {
  appendMealsWithAuthority,
  attachWalletToAvailability,
  attachWalletToOverview,
  attachWalletToPickupCreateResult,
  fulfillPickupRequestSafely,
  hashAppendRequest,
  readWallet,
  reconcileConfirmedDayAllocations,
  releaseExpiredReservationsForSubscription,
  releaseExpiredReservationsForUser,
  reserveMissingDaySlotAllocations,
  settlePickupRequestAsUncollected,
  walletFromSubscription,
};
