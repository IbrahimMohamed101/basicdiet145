"use strict";

const crypto = require("node:crypto");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionDayAppendOperation = require("../../models/SubscriptionDayAppendOperation");
const SubscriptionDailyAddonOperation = require("../../models/SubscriptionDailyAddonOperation");
const lockService = require("./subscriptionDayMutationLockService");
const pickupAuthority = require("./subscriptionPickupCycleAuthorityService");
const dailyAddonService = require("./subscriptionDailyAddonService");
const { transitionAllocation } = require("./subscriptionMealEntitlementService");
const { assertSubscriptionDayModifiable } = require("./subscriptionDayModificationPolicyService");
const { resolveEffectiveFulfillmentMode } = require("./subscriptionFulfillmentPolicyService");
const {
  serializeSubscriptionDayForClient,
  shapeMealPlannerReadFields,
} = require("./subscriptionClientSupportService");
const { localizeWriteDayPayload } = require("../../utils/subscription/subscriptionWriteLocalization");
const { logger } = require("../../utils/logger");

const OPERATION_LEASE_MS = 5 * 60 * 1000;
const RESUMABLE_STATUSES = new Set(["started", "day_saved", "credits_reserved", "addons_reserved"]);
const TERMINAL_REPLAY_STATUSES = new Set(["completed", "payment_pending"]);

function serviceError(code, message, status = 409, details = undefined) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
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

function clonePlain(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
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

function normalizeRequestPayload(args = {}) {
  const body = args.body || {};
  const addonsPresent = Object.prototype.hasOwnProperty.call(body, "addonsOneTime")
    || Object.prototype.hasOwnProperty.call(body, "oneTimeAddonSelections");
  return {
    mealSlots: Array.isArray(body.mealSlots) ? clonePlain(body.mealSlots) : [],
    addonsPresent,
    addonsOneTime: addonsPresent
      ? clonePlain(body.addonsOneTime !== undefined ? body.addonsOneTime : body.oneTimeAddonSelections)
      : undefined,
    contractVersion: body.contractVersion || body.plannerContractVersion || body.version || null,
  };
}

function hashAppendRequest({ subscriptionId, date, requestPayload }) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize({
      subscriptionId: clean(subscriptionId),
      date: clean(date),
      mealSlots: requestPayload.mealSlots || [],
      addonsPresent: Boolean(requestPayload.addonsPresent),
      addonsOneTime: requestPayload.addonsOneTime,
      contractVersion: requestPayload.contractVersion || null,
    })))
    .digest("hex");
}

function slotKeyOf(slot, fallbackIndex = 0) {
  return clean(slot && (slot.slotKey || (slot.slotIndex ? `slot_${slot.slotIndex}` : "")))
    || `slot_${fallbackIndex + 1}`;
}

function assignedAppendSlots(operation) {
  const requestSlots = operation && operation.requestPayload && Array.isArray(operation.requestPayload.mealSlots)
    ? operation.requestPayload.mealSlots
    : [];
  const expectedKeys = Array.isArray(operation && operation.expectedSlotKeys)
    ? operation.expectedSlotKeys
    : [];
  const startIndex = Math.max(0, Number(operation && operation.preSlotCount || 0));
  return requestSlots.map((slot, index) => ({
    ...clonePlain(slot),
    slotIndex: startIndex + index + 1,
    slotKey: expectedKeys[index] || `slot_${startIndex + index + 1}`,
  }));
}

function expectedSlotsPresent(day, operation) {
  const present = new Set((Array.isArray(day && day.mealSlots) ? day.mealSlots : [])
    .map(slotKeyOf)
    .filter(Boolean));
  return (Array.isArray(operation && operation.expectedSlotKeys) ? operation.expectedSlotKeys : [])
    .every((key) => present.has(clean(key)));
}

function dayPlanningSnapshot(day = {}) {
  return {
    status: day.status,
    mealSlots: clonePlain(day.mealSlots || []),
    plannerMeta: clonePlain(day.plannerMeta),
    plannerState: day.plannerState,
    plannerVersion: day.plannerVersion,
    plannerRevisionHash: clean(day.plannerRevisionHash),
    materializedMeals: clonePlain(day.materializedMeals || []),
    selections: clonePlain(day.selections || []),
    premiumUpgradeSelections: clonePlain(day.premiumUpgradeSelections || []),
    premiumReservationMode: day.premiumReservationMode,
    baseMealSlots: clonePlain(day.baseMealSlots || []),
    addonSelections: clonePlain(day.addonSelections || []),
    planningState: day.planningState,
    planningMeta: clonePlain(day.planningMeta),
    planningVersion: day.planningVersion,
  };
}

function explicitAddonSelections(day = {}) {
  return (Array.isArray(day.addonSelections) ? day.addonSelections : [])
    .filter((selection) => selection && selection.autoDailyAddon !== true)
    .map((selection) => ({
      productId: selection.productId || selection.menuProductId || selection.addonId,
      menuProductId: selection.menuProductId || selection.productId || selection.addonId,
      addonId: selection.addonId || selection.productId || selection.menuProductId,
      addonPlanId: selection.addonPlanId || null,
      balanceBucketId: selection.balanceBucketId || null,
      entitlementKey: selection.entitlementKey || null,
      category: selection.category || selection.entitlementCategory || null,
      allowanceCategory: selection.entitlementCategory || selection.category || null,
      quantity: Math.max(1, Number(selection.quantity || selection.qty || 1)),
    }));
}

function requiresPayment(day = {}, result = null) {
  const resultRequirement = result && result.data && result.data.paymentRequirement;
  if (resultRequirement && resultRequirement.requiresPayment === true) return true;
  if (day.premiumExtraPayment && ["pending", "revision_mismatch"].includes(clean(day.premiumExtraPayment.status))) {
    return true;
  }
  if ((day.premiumUpgradeSelections || []).some((selection) => clean(selection && (selection.source || selection.premiumSource)) === "pending_payment")) {
    return true;
  }
  return (day.addonSelections || []).some((selection) => clean(selection && selection.source) === "pending_payment");
}

function errorResult(err) {
  return {
    ok: false,
    status: Number(err && err.status || 500),
    code: clean(err && err.code) || "APPEND_FAILED",
    message: clean(err && err.message) || "Append meals failed",
    details: err && err.details,
  };
}

function operationLeaseExpired(operation, now = new Date()) {
  const expiry = operation && operation.leaseExpiresAt
    ? new Date(operation.leaseExpiresAt).getTime()
    : 0;
  return !expiry || expiry <= now.getTime();
}

function leaseExpiry(now = new Date()) {
  return new Date(now.getTime() + OPERATION_LEASE_MS);
}

function previousWasConfirmed(operation) {
  const snapshot = operation && operation.previousDaySnapshot || {};
  return snapshot.plannerState === "confirmed" || snapshot.planningState === "confirmed";
}

async function markOperation(operationId, set, options = {}) {
  const update = { $set: set };
  if (options.incrementAttempt) update.$inc = { attemptCount: 1 };
  return SubscriptionDayAppendOperation.findByIdAndUpdate(
    operationId,
    update,
    { new: true }
  );
}

async function releaseOperationLease(operation, { status, active = false, extra = {} } = {}) {
  return markOperation(operation._id, {
    ...(status ? { status } : {}),
    active,
    leaseExpiresAt: null,
    ...extra,
  });
}

async function clearStaleStartedBlocker(blocker, day) {
  if (!blocker || blocker.status !== "started" || !operationLeaseExpired(blocker)) return false;
  if (clean(day.plannerRevisionHash) !== clean(blocker.previousPlannerRevisionHash)) return false;
  if (expectedSlotsPresent(day, blocker)) return false;
  const result = await SubscriptionDayAppendOperation.updateOne(
    {
      _id: blocker._id,
      active: true,
      status: "started",
      $or: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { $lte: new Date() } },
      ],
    },
    {
      $set: {
        status: "failed",
        active: false,
        failedAt: new Date(),
        failureStep: "stale_before_day_save",
        errorCode: "STALE_APPEND_OPERATION",
        errorMessage: "Append operation lease expired before the day projection changed",
        leaseExpiresAt: null,
      },
    }
  );
  return Number(result && (result.modifiedCount !== undefined ? result.modifiedCount : result.nModified) || 0) > 0;
}

async function acquireOperation({ args, subscription, day, requestPayload }) {
  const idempotencyKey = clean(args.body && args.body.idempotencyKey);
  if (!idempotencyKey) {
    throw serviceError("IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey is required", 400);
  }
  const requestHash = hashAppendRequest({
    subscriptionId: subscription._id,
    date: day.date,
    requestPayload,
  });
  const now = new Date();
  let operation = await SubscriptionDayAppendOperation.findOne({
    subscriptionId: subscription._id,
    date: day.date,
    idempotencyKey,
  });

  if (operation) {
    const legacyCompleted = !operation.requestPayload && operation.status === "completed";
    if (operation.requestHash !== requestHash && !legacyCompleted) {
      throw serviceError("IDEMPOTENCY_CONFLICT", "idempotencyKey was already used with a different append payload", 409);
    }
    if (legacyCompleted) return operation;
    if (operation.status === "recovery_required") {
      throw serviceError("APPEND_RECOVERY_REQUIRED", "This append operation requires reconciliation before it can continue", 409, {
        operationId: clean(operation._id),
        failureStep: operation.failureStep,
      });
    }
    if (operation.status === "completed") return operation;
    if (operation.status === "payment_pending" && requiresPayment(day)) return operation;

    if (["failed", "compensated"].includes(operation.status)) {
      if (clean(day.plannerRevisionHash) !== clean(operation.previousPlannerRevisionHash)) {
        throw serviceError("DAY_CHANGED", "The day changed after the previous append attempt", 409);
      }
      operation = await SubscriptionDayAppendOperation.findOneAndUpdate(
        { _id: operation._id, active: false },
        {
          $set: {
            status: "started",
            active: true,
            leaseToken: operation.leaseToken || crypto.randomUUID(),
            leaseExpiresAt: leaseExpiry(now),
            lastAttemptAt: now,
            failedAt: null,
            failureStep: null,
            errorCode: null,
            errorMessage: null,
          },
          $inc: { attemptCount: 1 },
        },
        { new: true }
      );
      if (!operation) throw serviceError("APPEND_IN_PROGRESS", "Another append retry acquired the operation first", 409);
      return operation;
    }

    if (operation.status === "payment_pending") {
      operation = await SubscriptionDayAppendOperation.findOneAndUpdate(
        { _id: operation._id, status: "payment_pending" },
        {
          $set: {
            status: "day_saved",
            active: true,
            paymentRequired: false,
            leaseToken: operation.leaseToken || crypto.randomUUID(),
            leaseExpiresAt: leaseExpiry(now),
            lastAttemptAt: now,
          },
          $inc: { attemptCount: 1 },
        },
        { new: true }
      );
      return operation;
    }

    operation = await SubscriptionDayAppendOperation.findOneAndUpdate(
      { _id: operation._id },
      {
        $set: {
          active: true,
          leaseToken: operation.leaseToken || crypto.randomUUID(),
          leaseExpiresAt: leaseExpiry(now),
          lastAttemptAt: now,
        },
        $inc: { attemptCount: 1 },
      },
      { new: true }
    );
    return operation;
  }

  let blocker = await SubscriptionDayAppendOperation.findOne({
    subscriptionDayId: day._id,
    active: true,
  });
  if (blocker && await clearStaleStartedBlocker(blocker, day)) blocker = null;
  if (blocker) {
    if (blocker.status === "payment_pending") {
      throw serviceError("APPEND_PAYMENT_PENDING", "A previous append is waiting for payment", 409, {
        operationId: clean(blocker._id),
      });
    }
    throw serviceError(
      operationLeaseExpired(blocker) ? "APPEND_RECOVERY_REQUIRED" : "APPEND_IN_PROGRESS",
      operationLeaseExpired(blocker)
        ? "A previous append operation must be recovered before another append can start"
        : "Another meal append is already in progress for this day",
      409,
      { operationId: clean(blocker._id), leaseExpiresAt: blocker.leaseExpiresAt }
    );
  }

  const currentSlots = Array.isArray(day.mealSlots) ? day.mealSlots : [];
  const maxSlotIndex = currentSlots.reduce(
    (max, slot) => Math.max(max, Number(slot && slot.slotIndex || 0)),
    0
  );
  const expectedSlotKeys = requestPayload.mealSlots.map((_slot, index) => `slot_${maxSlotIndex + index + 1}`);
  const leaseToken = crypto.randomUUID();

  try {
    return await SubscriptionDayAppendOperation.create({
      subscriptionId: subscription._id,
      subscriptionDayId: day._id,
      userId: args.userId,
      date: day.date,
      idempotencyKey,
      requestHash,
      requestPayload,
      status: "started",
      active: true,
      leaseToken,
      leaseExpiresAt: leaseExpiry(now),
      attemptCount: 1,
      lastAttemptAt: now,
      preSlotCount: currentSlots.length,
      expectedSlotKeys,
      previousPlannerRevisionHash: clean(day.plannerRevisionHash),
      previousDaySnapshot: dayPlanningSnapshot(day),
      previousExplicitAddonSelections: explicitAddonSelections(day),
    });
  } catch (err) {
    if (!err || err.code !== 11000) throw err;
    operation = await SubscriptionDayAppendOperation.findOne({
      subscriptionId: subscription._id,
      date: day.date,
      idempotencyKey,
    });
    if (operation) {
      if (operation.requestHash !== requestHash) {
        throw serviceError("IDEMPOTENCY_CONFLICT", "idempotencyKey was already used with a different append payload", 409);
      }
      return operation;
    }
    throw serviceError("APPEND_IN_PROGRESS", "Another meal append is already in progress for this day", 409);
  }
}

async function acquireOperationLock(operation, day, expectedRevision) {
  const acquired = await lockService.acquireDayMutationLock({
    subscriptionDayId: day._id,
    subscriptionId: operation.subscriptionId,
    date: operation.date,
    ownerOperationId: operation._id,
    token: operation.leaseToken,
    expectedPlannerRevisionHash: expectedRevision,
    leaseMs: OPERATION_LEASE_MS,
  });
  return acquired.token;
}

async function renewOperation(operation) {
  await Promise.all([
    lockService.renewDayMutationLock({
      subscriptionDayId: operation.subscriptionDayId,
      token: operation.leaseToken,
      leaseMs: OPERATION_LEASE_MS,
    }),
    SubscriptionDayAppendOperation.updateOne(
      { _id: operation._id, active: true },
      { $set: { leaseExpiresAt: leaseExpiry(), lastAttemptAt: new Date() } }
    ),
  ]);
}

async function setPlannerDraftForMutation(day, operation) {
  if (!previousWasConfirmed(operation) && day.plannerState !== "confirmed" && day.planningState !== "confirmed") {
    return day;
  }
  if (day.plannerState !== "confirmed" && day.planningState !== "confirmed") return day;
  const updated = await SubscriptionDay.findOneAndUpdate(
    {
      _id: day._id,
      plannerRevisionHash: clean(day.plannerRevisionHash),
      status: "open",
    },
    { $set: { plannerState: "draft", planningState: "draft" } },
    { new: true }
  );
  if (!updated) throw serviceError("DAY_CHANGED", "The day changed before the append mutation could start", 409);
  return updated;
}

async function restorePlannerProjection({ dayId, expectedRevision, snapshot }) {
  const set = {
    plannerState: snapshot && snapshot.plannerState || "draft",
    planningState: snapshot && snapshot.planningState || snapshot && snapshot.plannerState || "draft",
  };
  if (snapshot && snapshot.plannerMeta !== undefined) set.plannerMeta = snapshot.plannerMeta;
  if (snapshot && snapshot.planningMeta !== undefined) set.planningMeta = snapshot.planningMeta;
  const result = await SubscriptionDay.findOneAndUpdate(
    { _id: dayId, plannerRevisionHash: clean(expectedRevision), status: "open" },
    { $set: set },
    { new: true }
  );
  if (!result) throw serviceError("DAY_CHANGED", "The day changed before its planner state could be restored", 409);
  return result;
}

async function invokeSelectionUpdate({ args, updateSelectionFn, operation, mealSlots, addonsPayload, includeAddons }) {
  const body = {
    mealSlots,
    contractVersion: operation.requestPayload && operation.requestPayload.contractVersion || undefined,
    __dayMutationToken: operation.leaseToken,
  };
  if (includeAddons) body.addonsOneTime = addonsPayload;
  const result = await updateSelectionFn({ ...args, body });
  if (!result || result.ok !== true) {
    throw serviceError(
      result && result.code || "APPEND_SELECTION_SAVE_FAILED",
      result && result.message || "Append selection save failed",
      Number(result && result.status || 409),
      result && result.details
    );
  }
  return result;
}

async function releaseAllocationKeys({ subscriptionId, allocationKeys = [] }) {
  const keys = [...new Set(allocationKeys.map(clean).filter(Boolean))];
  let releasedCount = 0;
  for (const key of keys) {
    const subscription = await Subscription.findById(subscriptionId)
      .select("baseMealAllocations")
      .lean();
    const allocation = (subscription && subscription.baseMealAllocations || [])
      .find((row) => clean(row && row.allocationKey) === key);
    if (!allocation || allocation.state === "released") continue;
    if (allocation.state !== "reserved") {
      throw serviceError("APPEND_ALLOCATION_NOT_RELEASABLE", "An appended meal allocation is no longer releasable", 409, {
        allocationKey: key,
        state: allocation.state,
      });
    }
    const result = await transitionAllocation({
      subscriptionId,
      allocationKey: key,
      toState: "released",
    });
    if (result && result.changed) releasedCount += 1;
  }
  return { releasedCount };
}

async function releaseExtraAutomaticAddons({ dayId, previousSelections = [] }) {
  const day = await SubscriptionDay.findById(dayId).lean();
  if (!day) return { releasedCount: 0 };
  const previousKeys = new Set((previousSelections || [])
    .map((selection) => clean(selection && selection.dailyAllocationKey))
    .filter(Boolean));
  const extras = (day.addonSelections || [])
    .filter((selection) => selection && selection.autoDailyAddon === true)
    .filter((selection) => clean(selection.addonSettlementState || "reserved") === "reserved")
    .filter((selection) => clean(selection.dailyAllocationKey) && !previousKeys.has(clean(selection.dailyAllocationKey)));
  let releasedCount = 0;
  for (const selection of extras) {
    const result = await dailyAddonService.releaseBalanceAllocation({
      subscriptionId: day.subscriptionId,
      bucketId: selection.balanceBucketId,
      allocationKey: selection.dailyAllocationKey,
    });
    if (!result.released) {
      throw serviceError("DAILY_ADDON_RELEASE_FAILED", `Automatic add-on compensation failed: ${result.reason || "unknown"}`, 409);
    }
    if (!result.idempotent) releasedCount += 1;
    await SubscriptionDay.updateOne(
      { _id: day._id },
      { $pull: { addonSelections: { dailyAllocationKey: selection.dailyAllocationKey } } }
    );
    await SubscriptionDailyAddonOperation.updateOne(
      { subscriptionDayId: day._id, allocationKey: selection.dailyAllocationKey },
      { $set: { status: "released", releasedAt: new Date() } }
    );
  }
  return { releasedCount };
}

async function compensateOperation({ operation, args, updateSelectionFn, failure }) {
  operation = await SubscriptionDayAppendOperation.findById(operation._id);
  if (!operation || operation.status === "completed" || operation.status === "payment_pending") {
    return { compensated: false, skipped: true };
  }
  operation = await markOperation(operation._id, {
    status: "compensating",
    compensationStartedAt: new Date(),
    failureStep: failure && failure.step || operation.failureStep || null,
    errorCode: clean(failure && failure.error && failure.error.code) || operation.errorCode || "APPEND_FAILED",
    errorMessage: clean(failure && failure.error && failure.error.message).slice(0, 500) || operation.errorMessage || "Append failed",
  });

  const day = await SubscriptionDay.findById(operation.subscriptionDayId);
  if (!day) {
    await releaseOperationLease(operation, {
      status: "recovery_required",
      active: true,
      extra: { failureStep: "compensation_day_missing" },
    });
    return { compensated: false, recoveryRequired: true };
  }

  if (!operation.appliedPlannerRevisionHash) {
    try {
      if (previousWasConfirmed(operation)) {
        await restorePlannerProjection({
          dayId: day._id,
          expectedRevision: day.plannerRevisionHash,
          snapshot: operation.previousDaySnapshot,
        });
      }
      await releaseOperationLease(operation, {
        status: "failed",
        active: false,
        extra: { failedAt: new Date() },
      });
      await lockService.releaseDayMutationLock({
        subscriptionDayId: day._id,
        token: operation.leaseToken,
      });
      return { compensated: true, beforeDaySave: true };
    } catch (_err) {
      await releaseOperationLease(operation, {
        status: "recovery_required",
        active: true,
        extra: { failureStep: "restore_pre_save_planner_state" },
      });
      return { compensated: false, recoveryRequired: true };
    }
  }

  const ownsLock = await lockService.ownsDayMutationLock({
    subscriptionDayId: day._id,
    token: operation.leaseToken,
  });
  if (!ownsLock || clean(day.plannerRevisionHash) !== clean(operation.appliedPlannerRevisionHash)) {
    await releaseOperationLease(operation, {
      status: "recovery_required",
      active: true,
      extra: {
        failureStep: "compensation_revision_conflict",
        compensationPlannerRevisionHash: clean(day.plannerRevisionHash),
      },
    });
    return { compensated: false, recoveryRequired: true };
  }

  try {
    await renewOperation(operation);
    await setPlannerDraftForMutation(day, operation);
    const includeAddons = Boolean(operation.requestPayload && operation.requestPayload.addonsPresent);
    const reverseResult = await invokeSelectionUpdate({
      args,
      updateSelectionFn,
      operation,
      mealSlots: clonePlain(operation.previousDaySnapshot && operation.previousDaySnapshot.mealSlots || []),
      addonsPayload: clonePlain(operation.previousExplicitAddonSelections || []),
      includeAddons,
    });
    let revertedDay = await SubscriptionDay.findById(day._id);
    if (!revertedDay) throw serviceError("DAY_NOT_FOUND", "Subscription day disappeared during compensation", 404);
    revertedDay = await restorePlannerProjection({
      dayId: revertedDay._id,
      expectedRevision: revertedDay.plannerRevisionHash,
      snapshot: operation.previousDaySnapshot,
    });
    await releaseExtraAutomaticAddons({
      dayId: revertedDay._id,
      previousSelections: operation.previousDaySnapshot && operation.previousDaySnapshot.addonSelections || [],
    });
    await releaseAllocationKeys({
      subscriptionId: operation.subscriptionId,
      allocationKeys: operation.allocationKeys || operation.newlyChangedAllocationKeys || [],
    });
    operation = await releaseOperationLease(operation, {
      status: "compensated",
      active: false,
      extra: {
        compensatedAt: new Date(),
        compensationPlannerRevisionHash: clean(revertedDay.plannerRevisionHash),
      },
    });
    await lockService.releaseDayMutationLock({
      subscriptionDayId: day._id,
      token: operation.leaseToken,
    });
    return { compensated: true, reverseResult };
  } catch (err) {
    await releaseOperationLease(operation, {
      status: "recovery_required",
      active: true,
      extra: {
        failureStep: "compensation_failed",
        errorCode: clean(err.code) || "APPEND_COMPENSATION_FAILED",
        errorMessage: clean(err.message).slice(0, 500),
      },
    });
    return { compensated: false, recoveryRequired: true, error: err };
  }
}

async function shapeAppendResponse({ args, operation, day, idempotent, reservation = null, status = 200 }) {
  const subscription = await Subscription.findById(args.subscriptionId);
  const wallet = reservation && reservation.wallet
    ? reservation.wallet
    : await pickupAuthority.readWallet(args.subscriptionId);
  const dailyAddonWallet = dailyAddonService.buildDailyAddonWallet(subscription);
  let shaped = day;
  try {
    const serialized = serializeSubscriptionDayForClient(
      subscription,
      day && typeof day.toObject === "function" ? day.toObject() : day,
      args.runtime
    );
    const catalog = args.loadWalletCatalogMapsSafelyFn
      ? await args.loadWalletCatalogMapsSafelyFn({
        days: [serialized],
        lang: args.lang,
        context: "delivery_append_saga_result",
      })
      : { addonNames: new Map() };
    shaped = shapeMealPlannerReadFields({
      subscription,
      day: localizeWriteDayPayload(serialized, {
        lang: args.lang,
        addonNames: catalog.addonNames,
      }),
      lang: args.lang,
    });
  } catch (err) {
    logger.warn("delivery append saga response shaping fallback", {
      subscriptionId: clean(args.subscriptionId),
      date: clean(args.date),
      error: err.message,
    });
  }
  return {
    ok: true,
    status,
    data: {
      ...(shaped && typeof shaped === "object" ? shaped : {}),
      appendOperation: {
        id: clean(operation._id),
        state: operation.status,
        idempotencyKey: operation.idempotencyKey,
      },
      entitlementWallet: wallet,
      dailyAddonWallet,
      balanceChange: {
        event: status === 402 ? "append_pending_payment" : "meals_appended_before_fulfillment_cutoff",
        reservedDelta: Number(reservation && reservation.reservedDelta || 0),
        remainingMeals: wallet.remainingMeals,
        reservedMeals: wallet.reservedMeals,
        consumedMeals: wallet.consumedMeals,
        consumptionAppliedAtFulfillment: true,
      },
    },
    idempotent: Boolean(idempotent),
  };
}

function createDeliveryAppendSagaService({ faultInjector = null } = {}) {
  async function inject(step, context) {
    if (typeof faultInjector === "function") await faultInjector(step, context);
  }

  async function appendDeliveryMeals({ args, updateSelectionFn } = {}) {
    let operation = null;
    let step = "validate";
    try {
      const requestPayload = normalizeRequestPayload(args);
      if (!requestPayload.mealSlots.length) {
        throw serviceError("INVALID_MEAL_SLOTS", "mealSlots must contain at least one meal", 400);
      }
      const [subscription, day] = await Promise.all([
        Subscription.findById(args.subscriptionId),
        SubscriptionDay.findOne({ subscriptionId: args.subscriptionId, date: args.date }),
      ]);
      if (!subscription) throw serviceError("NOT_FOUND", "Subscription not found", 404);
      if (!day) throw serviceError("DAY_NOT_FOUND", "Subscription day not found", 404);
      if (clean(subscription.userId) !== clean(args.userId)) throw serviceError("FORBIDDEN", "Forbidden", 403);
      if (subscription.status !== "active") throw serviceError("SUB_INACTIVE", "Subscription not active", 422);
      const effectiveMode = resolveEffectiveFulfillmentMode({ subscription, day, date: args.date });
      if (effectiveMode !== "delivery") {
        throw serviceError("DELIVERY_MODE_REQUIRED", "The delivery append saga only handles delivery days", 400, {
          effectiveFulfillmentMode: effectiveMode,
        });
      }
      await assertSubscriptionDayModifiable({ subscription, day, date: args.date });
      if (day.status !== "open") {
        throw serviceError("LOCKED", "Day is already in operations and cannot be edited", 409);
      }

      operation = await acquireOperation({ args, subscription, day, requestPayload });
      if (operation.status === "completed") {
        const currentDay = await SubscriptionDay.findById(day._id);
        return shapeAppendResponse({ args, operation, day: currentDay, idempotent: true });
      }
      if (operation.status === "payment_pending" && requiresPayment(day)) {
        return shapeAppendResponse({ args, operation, day, idempotent: true, status: 402 });
      }
      if (!RESUMABLE_STATUSES.has(operation.status)) {
        throw serviceError("APPEND_INVALID_STATE", `Append operation cannot continue from ${operation.status}`, 409);
      }

      const expectedRevision = operation.status === "started"
        ? operation.previousPlannerRevisionHash
        : operation.appliedPlannerRevisionHash;
      await acquireOperationLock(operation, day, expectedRevision);

      let currentDay = await SubscriptionDay.findById(day._id);
      let lastSelectionResult = null;
      if (operation.status === "started") {
        step = "day_save";
        if (clean(currentDay.plannerRevisionHash) !== clean(operation.previousPlannerRevisionHash)) {
          throw serviceError("DAY_CHANGED", "The day changed before the append payload could be saved", 409);
        }
        currentDay = await setPlannerDraftForMutation(currentDay, operation);
        const mergedSlots = clonePlain(operation.previousDaySnapshot && operation.previousDaySnapshot.mealSlots || [])
          .concat(assignedAppendSlots(operation));
        lastSelectionResult = await invokeSelectionUpdate({
          args,
          updateSelectionFn,
          operation,
          mealSlots: mergedSlots,
          addonsPayload: operation.requestPayload.addonsOneTime,
          includeAddons: Boolean(operation.requestPayload.addonsPresent),
        });
        currentDay = await SubscriptionDay.findById(day._id);
        if (!currentDay || !expectedSlotsPresent(currentDay, operation)) {
          throw serviceError("APPEND_PROJECTION_MISMATCH", "Appended meal slots were not persisted as expected", 409);
        }
        operation = await markOperation(operation._id, {
          status: "day_saved",
          appendedSlotKeys: operation.expectedSlotKeys,
          appliedPlannerRevisionHash: clean(currentDay.plannerRevisionHash),
          daySavedAt: new Date(),
          failureStep: null,
          errorCode: null,
          errorMessage: null,
        });
        await inject("after_day_saved", { operation, day: currentDay });
      }

      currentDay = await SubscriptionDay.findById(day._id);
      if (requiresPayment(currentDay, lastSelectionResult)) {
        operation = await markOperation(operation._id, {
          status: "payment_pending",
          active: true,
          paymentRequired: true,
          paymentPendingAt: new Date(),
          leaseExpiresAt: null,
        });
        await lockService.releaseDayMutationLock({
          subscriptionDayId: day._id,
          token: operation.leaseToken,
        });
        return shapeAppendResponse({ args, operation, day: currentDay, idempotent: false, status: 402 });
      }

      if (operation.status === "day_saved") {
        step = "credits_reserve";
        await renewOperation(operation);
        if (previousWasConfirmed(operation)) {
          currentDay = await restorePlannerProjection({
            dayId: currentDay._id,
            expectedRevision: currentDay.plannerRevisionHash,
            snapshot: operation.previousDaySnapshot,
          });
        }
        const reservation = await pickupAuthority.reserveMissingDaySlotAllocations({
          subscriptionId: args.subscriptionId,
          dayId: currentDay._id,
          slotKeys: operation.expectedSlotKeys,
        });
        if ((reservation.allocationKeys || []).length !== operation.expectedSlotKeys.length) {
          throw serviceError("APPEND_ALLOCATION_MISMATCH", "Not all appended meal slots received an allocation", 409, {
            expectedSlotKeys: operation.expectedSlotKeys,
            allocationKeys: reservation.allocationKeys || [],
          });
        }
        operation = await markOperation(operation._id, {
          status: "credits_reserved",
          allocationKeys: reservation.allocationKeys || [],
          newlyChangedAllocationKeys: reservation.newlyChangedAllocationKeys || [],
          creditsReservedAt: new Date(),
        });
        operation.__reservation = reservation;
        await inject("after_credits_reserved", { operation, day: currentDay, reservation });
      }

      if (operation.status === "credits_reserved") {
        step = "addons_reserve";
        await renewOperation(operation);
        await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: day._id });
        operation = await markOperation(operation._id, {
          status: "addons_reserved",
          addonsReservedAt: new Date(),
        });
        await inject("after_addons_reserved", { operation, day: currentDay });
      }

      step = "complete";
      currentDay = await SubscriptionDay.findById(day._id);
      if (!currentDay || !expectedSlotsPresent(currentDay, operation)) {
        throw serviceError("APPEND_PROJECTION_MISMATCH", "Appended meal slots disappeared before completion", 409);
      }
      const reservation = operation.__reservation || {
        wallet: await pickupAuthority.readWallet(args.subscriptionId),
        reservedDelta: 0,
      };
      operation = await releaseOperationLease(operation, {
        status: "completed",
        active: false,
        extra: {
          completedAt: new Date(),
          paymentRequired: false,
          failureStep: null,
          errorCode: null,
          errorMessage: null,
        },
      });
      await lockService.releaseDayMutationLock({
        subscriptionDayId: day._id,
        token: operation.leaseToken,
      });
      return shapeAppendResponse({
        args,
        operation,
        day: currentDay,
        idempotent: false,
        reservation,
      });
    } catch (err) {
      if (operation) {
        const compensation = await compensateOperation({
          operation,
          args,
          updateSelectionFn,
          failure: { step, error: err },
        }).catch((compensationError) => ({
          compensated: false,
          recoveryRequired: true,
          error: compensationError,
        }));
        if (compensation && compensation.recoveryRequired) {
          err.details = {
            ...(err.details || {}),
            appendRecoveryRequired: true,
            operationId: clean(operation._id),
          };
        }
      }
      return errorResult(err);
    }
  }

  return {
    appendDeliveryMeals,
  };
}

const defaultService = createDeliveryAppendSagaService();

module.exports = {
  OPERATION_LEASE_MS,
  assignedAppendSlots,
  canonicalize,
  createDeliveryAppendSagaService,
  expectedSlotsPresent,
  hashAppendRequest,
  normalizeRequestPayload,
  ...defaultService,
};
