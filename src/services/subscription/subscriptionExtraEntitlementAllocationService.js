"use strict";

const crypto = require("node:crypto");
const mongoose = require("mongoose");

const SubscriptionExtraEntitlementBucket = require("../../models/SubscriptionExtraEntitlementBucket");
const SubscriptionExtraEntitlementAllocation = require("../../models/SubscriptionExtraEntitlementAllocation");
const { startSafeSession } = require("../../utils/mongoTransactionSupport");
const dateUtils = require("../../utils/date");
const {
  isRetryableMongoTransactionError,
} = require("../mongoTransactionRetryService");
const {
  assertTransactionalSession,
} = require("./subscriptionEntitlementLedgerService");

const TERMINAL_STATES = new Set(["consumed", "released"]);
const DEFAULT_TRANSACTION_RETRIES = 12;

function allocationError(code, message, status = 409, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function plain(value) {
  if (!value) return value;
  return typeof value.toObject === "function" ? value.toObject() : value;
}

function id(value) {
  if (!value) return "";
  return String(value && value._id ? value._id : value);
}

function objectId(value, fieldName) {
  const normalized = id(value).trim();
  if (!normalized || !mongoose.isValidObjectId(normalized)) {
    throw allocationError(
      "STACKING_EXTRA_ALLOCATION_ID_INVALID",
      `${fieldName} must be a valid ObjectId`,
      422,
      { fieldName }
    );
  }
  return new mongoose.Types.ObjectId(normalized);
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function positiveInteger(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw allocationError(
      "STACKING_EXTRA_ALLOCATION_QUANTITY_INVALID",
      `${fieldName} must be a positive integer`,
      422,
      { fieldName }
    );
  }
  return parsed;
}

function nonNegativeInteger(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw allocationError(
      "STACKING_EXTRA_BUCKET_CONSERVATION_FAILED",
      `${fieldName} must be a non-negative integer`,
      409,
      { fieldName }
    );
  }
  return parsed;
}

function normalizeBusinessDate(value) {
  const normalized = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw allocationError(
      "STACKING_EXTRA_ALLOCATION_DATE_INVALID",
      "businessDate must use YYYY-MM-DD",
      422
    );
  }
  const start = new Date(`${normalized}T00:00:00+03:00`);
  if (
    Number.isNaN(start.getTime())
    || dateUtils.toKSADateString(start) !== normalized
  ) {
    throw allocationError(
      "STACKING_EXTRA_ALLOCATION_DATE_INVALID",
      "businessDate must be a real calendar date",
      422
    );
  }
  return normalized;
}

function dateWindow(businessDate) {
  const normalized = normalizeBusinessDate(businessDate);
  const start = new Date(`${normalized}T00:00:00+03:00`);
  return {
    normalized,
    start,
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1),
  };
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function assertPersistedBucketConservation(bucketInput) {
  const bucket = plain(bucketInput) || {};
  const purchasedQty = nonNegativeInteger(bucket.purchasedQty, "purchasedQty");
  const remainingQty = nonNegativeInteger(bucket.remainingQty, "remainingQty");
  const reservedQty = nonNegativeInteger(bucket.reservedQty, "reservedQty");
  const consumedQty = nonNegativeInteger(bucket.consumedQty, "consumedQty");
  const forfeitedQty = nonNegativeInteger(bucket.forfeitedQty, "forfeitedQty");
  const conserved = remainingQty + reservedQty + consumedQty + forfeitedQty;
  if (conserved !== purchasedQty) {
    throw allocationError(
      "STACKING_EXTRA_BUCKET_CONSERVATION_FAILED",
      "Extra entitlement bucket counters do not conserve purchased quantity",
      409,
      {
        bucketId: id(bucket._id),
        purchasedQty,
        conserved,
      }
    );
  }
  return {
    purchasedQty,
    remainingQty,
    reservedQty,
    consumedQty,
    forfeitedQty,
  };
}

function normalizeReservationRequest(input = {}) {
  const userId = objectId(input.userId, "userId");
  const containerSubscriptionId = objectId(
    input.containerSubscriptionId,
    "containerSubscriptionId"
  );
  const reservationKey = normalizeText(input.reservationKey);
  if (!reservationKey || reservationKey.length > 200) {
    throw allocationError(
      "STACKING_EXTRA_RESERVATION_KEY_INVALID",
      "reservationKey is required and cannot exceed 200 characters",
      422
    );
  }
  const sourceKey = normalizeText(input.sourceKey || reservationKey);
  if (!sourceKey || sourceKey.length > 240) {
    throw allocationError(
      "STACKING_EXTRA_SOURCE_KEY_INVALID",
      "sourceKey cannot exceed 240 characters",
      422
    );
  }
  const kind = normalizeKey(input.kind);
  if (!new Set(["premium", "addon"]).has(kind)) {
    throw allocationError(
      "STACKING_EXTRA_ALLOCATION_KIND_INVALID",
      "kind must be premium or addon",
      422
    );
  }
  const quantity = positiveInteger(input.quantity, "quantity");
  const businessDate = normalizeBusinessDate(input.businessDate);

  const identity = {
    premiumKey: "",
    addonId: "",
    addonPlanId: "",
    entitlementKey: "",
    category: "",
  };
  if (kind === "premium") {
    identity.premiumKey = normalizeKey(input.premiumKey || input.entitlementKey);
    identity.entitlementKey = identity.premiumKey;
    if (!identity.premiumKey) {
      throw allocationError(
        "STACKING_EXTRA_PREMIUM_KEY_REQUIRED",
        "premium reservation requires premiumKey",
        422
      );
    }
  } else {
    identity.entitlementKey = normalizeKey(input.entitlementKey);
    identity.addonId = id(input.addonId).trim();
    identity.addonPlanId = id(input.addonPlanId).trim();
    identity.category = normalizeKey(input.category);
    if (!identity.entitlementKey || (!identity.addonId && !identity.addonPlanId)) {
      throw allocationError(
        "STACKING_EXTRA_ADDON_IDENTITY_REQUIRED",
        "add-on reservation requires entitlementKey and addonId or addonPlanId",
        422
      );
    }
    if (identity.addonId) {
      identity.addonId = id(objectId(identity.addonId, "addonId"));
    }
    if (identity.addonPlanId) {
      identity.addonPlanId = id(objectId(identity.addonPlanId, "addonPlanId"));
    }
  }

  const canonical = {
    userId: id(userId),
    containerSubscriptionId: id(containerSubscriptionId),
    reservationKey,
    sourceKey,
    businessDate,
    kind,
    quantity,
    identity,
  };
  return {
    ...canonical,
    userId,
    containerSubscriptionId,
    requestHash: stableHash(canonical),
  };
}

function normalizeReservationScope(input = {}) {
  const userId = objectId(input.userId, "userId");
  const containerSubscriptionId = objectId(
    input.containerSubscriptionId,
    "containerSubscriptionId"
  );
  const reservationKey = normalizeText(input.reservationKey);
  if (!reservationKey || reservationKey.length > 200) {
    throw allocationError(
      "STACKING_EXTRA_RESERVATION_KEY_INVALID",
      "reservationKey is required and cannot exceed 200 characters",
      422
    );
  }
  return { userId, containerSubscriptionId, reservationKey };
}

function conservationExpression() {
  return {
    $eq: [
      "$purchasedQty",
      {
        $add: [
          "$remainingQty",
          "$reservedQty",
          "$consumedQty",
          "$forfeitedQty",
        ],
      },
    ],
  };
}

function validCounterFilter() {
  return {
    purchasedQty: { $gte: 0 },
    remainingQty: { $gte: 0 },
    reservedQty: { $gte: 0 },
    consumedQty: { $gte: 0 },
    forfeitedQty: { $gte: 0 },
  };
}

function bucketMatchesIdentity(bucket, request) {
  if (!bucket || normalizeKey(bucket.kind) !== request.kind) return false;
  if (request.kind === "premium") {
    return normalizeKey(bucket.premiumKey) === request.identity.premiumKey;
  }
  if (normalizeKey(bucket.entitlementKey) !== request.identity.entitlementKey) return false;
  if (request.identity.addonId && id(bucket.addonId) !== request.identity.addonId) return false;
  if (
    request.identity.addonPlanId
    && id(bucket.addonPlanId) !== request.identity.addonPlanId
  ) return false;
  if (request.identity.category && normalizeKey(bucket.category) !== request.identity.category) {
    return false;
  }
  return true;
}

function defaultRuntime() {
  return {
    findReservationAllocations({ userId, containerSubscriptionId, reservationKey, session }) {
      return SubscriptionExtraEntitlementAllocation.find({
        userId,
        containerSubscriptionId,
        reservationKey,
      }).sort({ fundingSequence: 1, _id: 1 }).session(session).lean();
    },
    async findEligibleBuckets({ request, session }) {
      const window = dateWindow(request.businessDate);
      const filter = {
        userId: request.userId,
        containerSubscriptionId: request.containerSubscriptionId,
        kind: request.kind,
        applicationState: "applied",
        effectiveStartDate: { $lte: window.end },
        validityEndDate: { $gte: window.start },
        remainingQty: { $gt: 0 },
      };
      if (request.kind === "premium") {
        filter.premiumKey = request.identity.premiumKey;
      } else if (request.identity.addonId) {
        filter.addonId = objectId(request.identity.addonId, "addonId");
        if (request.identity.addonPlanId) {
          filter.addonPlanId = objectId(request.identity.addonPlanId, "addonPlanId");
        }
      } else {
        filter.addonPlanId = objectId(request.identity.addonPlanId, "addonPlanId");
      }
      const rows = await SubscriptionExtraEntitlementBucket.find(filter)
        .sort({ validityEndDate: 1, effectiveStartDate: 1, _id: 1 })
        .session(session)
        .lean();
      return rows.filter((row) => bucketMatchesIdentity(row, request));
    },
    reserveBucket({ bucket, request, quantity, session }) {
      const window = dateWindow(request.businessDate);
      return SubscriptionExtraEntitlementBucket.findOneAndUpdate(
        {
          _id: bucket._id,
          userId: request.userId,
          containerSubscriptionId: request.containerSubscriptionId,
          entitlementBatchId: bucket.entitlementBatchId,
          kind: request.kind,
          applicationState: "applied",
          effectiveStartDate: { $lte: window.end },
          validityEndDate: { $gte: window.start },
          ...validCounterFilter(),
          remainingQty: { $gte: quantity },
          $expr: conservationExpression(),
        },
        { $inc: { remainingQty: -quantity, reservedQty: quantity } },
        { new: true, session, runValidators: true }
      ).lean();
    },
    async createAllocation({ payload, session }) {
      const rows = await SubscriptionExtraEntitlementAllocation.create([payload], { session });
      return rows[0];
    },
    findAllocationById({ allocationId, session }) {
      return SubscriptionExtraEntitlementAllocation.findById(allocationId)
        .session(session)
        .lean();
    },
    transitionAllocation({ allocationId, toState, now, session }) {
      return SubscriptionExtraEntitlementAllocation.findOneAndUpdate(
        { _id: allocationId, state: "reserved" },
        {
          $set: {
            state: toState,
            [`${toState}At`]: now,
          },
        },
        { new: true, session, runValidators: true }
      ).lean();
    },
    transitionBucket({ allocation, toState, session }) {
      const quantity = positiveInteger(allocation.quantity, "allocation.quantity");
      const increment = { reservedQty: -quantity };
      if (toState === "consumed") increment.consumedQty = quantity;
      if (toState === "released") increment.remainingQty = quantity;
      const expressions = [conservationExpression()];
      if (toState === "released") {
        expressions.push({
          $lte: [{ $add: ["$remainingQty", quantity] }, "$purchasedQty"],
        });
      }
      return SubscriptionExtraEntitlementBucket.findOneAndUpdate(
        {
          _id: allocation.extraEntitlementBucketId,
          userId: allocation.userId,
          containerSubscriptionId: allocation.containerSubscriptionId,
          entitlementBatchId: allocation.entitlementBatchId,
          kind: allocation.kind,
          ...validCounterFilter(),
          reservedQty: { $gte: quantity },
          $expr: expressions.length === 1 ? expressions[0] : { $and: expressions },
        },
        { $inc: increment },
        { new: true, session, runValidators: true }
      ).lean();
    },
    async afterBucketReserved() {},
    async afterAllocationCreated() {},
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

function assertCompleteAllocationGroup(allocationsInput, request = null) {
  const allocations = (Array.isArray(allocationsInput) ? allocationsInput : [])
    .map((row) => plain(row));
  if (!allocations.length) return null;
  const first = allocations[0];
  const expectedCount = positiveInteger(
    first.fundingAllocationCount,
    "fundingAllocationCount"
  );
  const expectedQuantity = positiveInteger(first.requestedQuantity, "requestedQuantity");
  const sequences = allocations.map((row) => Number(row.fundingSequence)).sort((a, b) => a - b);
  const states = new Set(allocations.map((row) => String(row.state || "")));
  const exactSequences = sequences.length === expectedCount
    && sequences.every((sequence, index) => sequence === index + 1);
  const exactQuantity = allocations.reduce(
    (sum, row) => sum + positiveInteger(row.quantity, "allocation.quantity"),
    0
  ) === expectedQuantity;
  const immutableGroupMatches = allocations.every((row) => (
    String(row.requestHash || "") === String(first.requestHash || "")
    && String(row.reservationKey || "") === String(first.reservationKey || "")
    && Number(row.fundingAllocationCount) === expectedCount
    && Number(row.requestedQuantity) === expectedQuantity
    && id(row.userId) === id(first.userId)
    && id(row.containerSubscriptionId) === id(first.containerSubscriptionId)
  ));
  if (!exactSequences || !exactQuantity || !immutableGroupMatches || states.size !== 1) {
    throw allocationError(
      "STACKING_EXTRA_ALLOCATION_GROUP_CORRUPT",
      "Persisted extra entitlement allocation group is incomplete or inconsistent",
      409,
      { reservationKey: String(first.reservationKey || "") }
    );
  }
  if (request && first.requestHash !== request.requestHash) {
    throw allocationError(
      "STACKING_EXTRA_RESERVATION_IDEMPOTENCY_CONFLICT",
      "reservationKey was already used with a different request payload",
      409,
      { reservationKey: request.reservationKey }
    );
  }
  return {
    allocations,
    state: String(first.state),
    requestHash: String(first.requestHash),
    requestedQuantity: expectedQuantity,
  };
}

function buildFundingPlan(candidates, quantity) {
  let outstanding = quantity;
  const plan = [];
  for (const bucket of candidates) {
    const counters = assertPersistedBucketConservation(bucket);
    if (outstanding <= 0) break;
    const fundedQty = Math.min(outstanding, counters.remainingQty);
    if (fundedQty > 0) {
      plan.push({ bucket, quantity: fundedQty });
      outstanding -= fundedQty;
    }
  }
  if (outstanding > 0) {
    throw allocationError(
      "STACKING_EXTRA_ENTITLEMENT_INSUFFICIENT",
      "Eligible extra entitlement buckets do not have enough remaining quantity",
      422,
      {
        requestedQuantity: quantity,
        availableQuantity: quantity - outstanding,
      }
    );
  }
  return plan;
}

function buildAllocationPayload({ request, bucket, quantity, sequence, allocationCount, now }) {
  const sourceBalanceBucketId = normalizeText(
    bucket && bucket.metadata && bucket.metadata.sourceBalanceBucketId
  );
  const allocationKey = stableHash({
    userId: id(request.userId),
    containerSubscriptionId: id(request.containerSubscriptionId),
    reservationKey: request.reservationKey,
    requestHash: request.requestHash,
    extraEntitlementBucketId: id(bucket._id),
    fundingSequence: sequence,
  });
  return {
    allocationKey,
    reservationKey: request.reservationKey,
    requestHash: request.requestHash,
    sourceKey: request.sourceKey,
    userId: request.userId,
    containerSubscriptionId: request.containerSubscriptionId,
    entitlementBatchId: bucket.entitlementBatchId,
    extraEntitlementBucketId: bucket._id,
    kind: request.kind,
    walletKey: String(bucket.walletKey),
    entitlementKey: request.kind === "premium"
      ? request.identity.premiumKey
      : normalizeKey(bucket.entitlementKey),
    premiumKey: request.kind === "premium" ? normalizeKey(bucket.premiumKey) : "",
    configId: request.kind === "premium" ? bucket.configId || null : null,
    revision: request.kind === "premium" ? Number(bucket.revision || 0) : 0,
    proteinId: request.kind === "premium" ? bucket.proteinId || null : null,
    addonId: request.kind === "addon" ? bucket.addonId || null : null,
    addonPlanId: request.kind === "addon" ? bucket.addonPlanId || null : null,
    category: request.kind === "addon" ? normalizeKey(bucket.category) : "",
    sourceBalanceBucketId,
    businessDate: request.businessDate,
    quantity,
    requestedQuantity: request.quantity,
    fundingSequence: sequence,
    fundingAllocationCount: allocationCount,
    state: "reserved",
    reservedAt: now,
    consumedAt: null,
    releasedAt: null,
  };
}

async function reserveExtraEntitlementsTransactional(input = {}) {
  assertTransactionalSession(input.session);
  const request = normalizeReservationRequest(input);
  const runtime = resolveRuntime(input.runtime);
  const existing = await runtime.findReservationAllocations({
    userId: request.userId,
    containerSubscriptionId: request.containerSubscriptionId,
    reservationKey: request.reservationKey,
    session: input.session,
  });
  if (existing.length) {
    const group = assertCompleteAllocationGroup(existing, request);
    return {
      allocationCount: group.allocations.length,
      newlyReservedCount: 0,
      idempotent: true,
      state: group.state,
      requestHash: group.requestHash,
      allocations: group.allocations,
    };
  }

  const candidates = await runtime.findEligibleBuckets({
    request,
    session: input.session,
  });
  const plan = buildFundingPlan(candidates, request.quantity);
  const now = input.now instanceof Date ? input.now : new Date();
  const results = [];

  for (let index = 0; index < plan.length; index += 1) {
    const entry = plan[index];
    const updatedBucket = await runtime.reserveBucket({
      bucket: entry.bucket,
      request,
      quantity: entry.quantity,
      session: input.session,
    });
    if (!updatedBucket) {
      throw allocationError(
        "STACKING_EXTRA_BUCKET_RESERVATION_CONFLICT",
        "An extra entitlement funding bucket changed during reservation",
        409,
        { bucketId: id(entry.bucket._id) }
      );
    }
    assertPersistedBucketConservation(updatedBucket);
    await runtime.afterBucketReserved({
      request,
      bucket: updatedBucket,
      fundingSequence: index + 1,
      session: input.session,
    });
    const created = await runtime.createAllocation({
      payload: buildAllocationPayload({
        request,
        bucket: entry.bucket,
        quantity: entry.quantity,
        sequence: index + 1,
        allocationCount: plan.length,
        now,
      }),
      session: input.session,
    });
    await runtime.afterAllocationCreated({
      request,
      allocation: created,
      bucket: updatedBucket,
      fundingSequence: index + 1,
      session: input.session,
    });
    results.push({
      allocation: plain(created),
      bucket: updatedBucket,
    });
  }

  return {
    allocationCount: results.length,
    newlyReservedCount: results.length,
    idempotent: false,
    state: "reserved",
    requestHash: request.requestHash,
    allocations: results.map((entry) => entry.allocation),
    fundingBuckets: results.map((entry) => entry.bucket),
  };
}

async function transitionReservedExtraEntitlementsTransactional(input = {}, toState) {
  assertTransactionalSession(input.session);
  if (!TERMINAL_STATES.has(toState)) {
    throw allocationError(
      "STACKING_EXTRA_ALLOCATION_TRANSITION_INVALID",
      "Extra entitlement target state must be consumed or released",
      422
    );
  }
  const scope = normalizeReservationScope(input);
  const runtime = resolveRuntime(input.runtime);
  const allocations = await runtime.findReservationAllocations({
    ...scope,
    session: input.session,
  });
  if (!allocations.length) {
    throw allocationError(
      "STACKING_EXTRA_ALLOCATION_NOT_FOUND",
      "Extra entitlement reservation was not found",
      404,
      { reservationKey: scope.reservationKey }
    );
  }
  const group = assertCompleteAllocationGroup(allocations);
  if (group.state === toState) {
    return {
      allocationCount: allocations.length,
      changedCount: 0,
      idempotent: true,
      state: toState,
      allocations,
    };
  }
  if (group.state !== "reserved") {
    throw allocationError(
      "STACKING_EXTRA_ALLOCATION_STATE_CONFLICT",
      "Only reserved extra entitlement allocations can transition",
      409,
      { fromState: group.state, toState }
    );
  }

  const now = input.now instanceof Date ? input.now : new Date();
  const results = [];
  for (const allocation of allocations) {
    const transitioned = await runtime.transitionAllocation({
      allocationId: allocation._id,
      toState,
      now,
      session: input.session,
    });
    if (!transitioned) {
      throw allocationError(
        "STACKING_EXTRA_ALLOCATION_TRANSITION_CONFLICT",
        "Extra entitlement allocation changed during transition",
        409,
        { allocationKey: String(allocation.allocationKey || ""), toState }
      );
    }
    const bucket = await runtime.transitionBucket({
      allocation,
      toState,
      session: input.session,
    });
    if (!bucket) {
      throw allocationError(
        "STACKING_EXTRA_BUCKET_TRANSITION_CONFLICT",
        "Funding bucket reserved balance is inconsistent with allocation state",
        409,
        {
          allocationKey: String(allocation.allocationKey || ""),
          bucketId: id(allocation.extraEntitlementBucketId),
          toState,
        }
      );
    }
    assertPersistedBucketConservation(bucket);
    results.push({ allocation: transitioned, bucket });
  }
  return {
    allocationCount: results.length,
    changedCount: results.length,
    idempotent: false,
    state: toState,
    allocations: results.map((entry) => entry.allocation),
    fundingBuckets: results.map((entry) => entry.bucket),
  };
}

function consumeReservedExtraEntitlementsTransactional(input = {}) {
  return transitionReservedExtraEntitlementsTransactional(input, "consumed");
}

function releaseReservedExtraEntitlementsTransactional(input = {}) {
  return transitionReservedExtraEntitlementsTransactional(input, "released");
}

function isDuplicateKeyError(err) {
  return Boolean(err && [11000, 11001].includes(Number(err.code)));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runExtraEntitlementTransaction(work, options = {}) {
  const maxRetries = Number.isInteger(options.maxRetries)
    ? Math.max(0, options.maxRetries)
    : DEFAULT_TRANSACTION_RETRIES;
  const baseDelayMs = Number.isInteger(options.baseDelayMs)
    ? Math.max(1, options.baseDelayMs)
    : 5;
  const startSession = typeof options.startSession === "function"
    ? options.startSession
    : startSafeSession;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const session = await startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        assertTransactionalSession(session);
        result = await work(session, { attempt });
      });
      return result;
    } catch (err) {
      const retryable = isRetryableMongoTransactionError(err) || isDuplicateKeyError(err);
      if (!retryable || attempt >= maxRetries) throw err;
      await delay(baseDelayMs * Math.pow(2, Math.min(attempt, 6)));
    } finally {
      await session.endSession();
    }
  }
  throw allocationError(
    "STACKING_EXTRA_TRANSACTION_RETRIES_EXHAUSTED",
    "Extra entitlement transaction retry budget was exhausted",
    503
  );
}

function reserveExtraEntitlements(input = {}) {
  return runExtraEntitlementTransaction(
    (session) => reserveExtraEntitlementsTransactional({ ...input, session }),
    input.transactionOptions
  );
}

function consumeReservedExtraEntitlements(input = {}) {
  return runExtraEntitlementTransaction(
    (session) => consumeReservedExtraEntitlementsTransactional({ ...input, session }),
    input.transactionOptions
  );
}

function releaseReservedExtraEntitlements(input = {}) {
  return runExtraEntitlementTransaction(
    (session) => releaseReservedExtraEntitlementsTransactional({ ...input, session }),
    input.transactionOptions
  );
}

module.exports = {
  assertCompleteAllocationGroup,
  assertPersistedBucketConservation,
  consumeReservedExtraEntitlements,
  consumeReservedExtraEntitlementsTransactional,
  normalizeReservationRequest,
  releaseReservedExtraEntitlements,
  releaseReservedExtraEntitlementsTransactional,
  reserveExtraEntitlements,
  reserveExtraEntitlementsTransactional,
  runExtraEntitlementTransaction,
};
