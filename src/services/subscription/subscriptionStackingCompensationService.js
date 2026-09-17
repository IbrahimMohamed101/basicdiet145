"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const SubscriptionEntitlementCompensation = require("../../models/SubscriptionEntitlementCompensation");
const SubscriptionEntitlementAllocation = require("../../models/SubscriptionEntitlementAllocation");
const SubscriptionEntitlementDayBlueprint = require("../../models/SubscriptionEntitlementDayBlueprint");
const dateUtils = require("../../utils/date");
const {
  assertTransactionalSession,
} = require("./subscriptionEntitlementLedgerService");
const {
  buildDayFulfillmentFields,
} = require("./subscriptionStackingDayMaterializationService");
const {
  reconcileSubscriptionStackingLifecycleTransactional,
} = require("./subscriptionStackingLifecycleService");

const COMPENSATION_ACTIONS = new Set(["skip", "freeze"]);
const CONTRIBUTING_STATUSES = new Set(["paid_scheduled", "active", "exhausted"]);
const SHRINK_BLOCKING_ALLOCATION_STATES = ["reserved", "consumed", "forfeited"];

function compensationError(code, message, status = 409, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function normalizeDateString(value, fieldName) {
  const raw = String(value || "").trim();
  if (dateUtils.isValidKSADateString(raw)) return raw;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw compensationError(
      "INVALID_STACKING_COMPENSATION_DATE",
      `${fieldName} must be a valid date`,
      400,
      { fieldName, value }
    );
  }
  return dateUtils.toKSADateString(parsed);
}

function normalizeActionType(value) {
  const actionType = String(value || "").trim().toLowerCase();
  if (!COMPENSATION_ACTIONS.has(actionType)) {
    throw compensationError(
      "INVALID_STACKING_COMPENSATION_ACTION",
      "Compensation action must be skip or freeze",
      400,
      { actionType: value }
    );
  }
  return actionType;
}

function buildCompensationSourceKey({ entitlementBatchId, actionType, sourceDate }) {
  if (!entitlementBatchId) {
    throw compensationError(
      "STACKING_COMPENSATION_BATCH_REQUIRED",
      "entitlementBatchId is required",
      422
    );
  }
  return [
    "stack-comp",
    String(entitlementBatchId),
    normalizeActionType(actionType),
    normalizeDateString(sourceDate, "sourceDate"),
  ].join(":");
}

function batchContributesOnDate(batch, sourceDate) {
  if (!batch || !CONTRIBUTING_STATUSES.has(String(batch.status || ""))) return false;
  const target = normalizeDateString(sourceDate, "sourceDate");
  const start = normalizeDateString(batch.effectiveStartDate, "effectiveStartDate");
  const end = normalizeDateString(
    batch.validityEndDate || batch.endDate,
    "validityEndDate"
  );
  return start <= target && target <= end;
}

function computeCompensatedValidityDate(batch, activeCompensationCount) {
  const base = normalizeDateString(
    batch.baseValidityEndDate || batch.validityEndDate || batch.endDate,
    "baseValidityEndDate"
  );
  const count = Math.max(0, Number(activeCompensationCount || 0));
  return dateUtils.addDaysToKSADateString(base, count);
}

function buildExtensionDayEntries({ container, batch, fromExclusive, toInclusive }) {
  const startExclusive = normalizeDateString(fromExclusive, "fromExclusive");
  const endInclusive = normalizeDateString(toInclusive, "toInclusive");
  if (endInclusive <= startExclusive) return [];
  const fulfillment = buildDayFulfillmentFields({ container, batch });
  const entries = [];
  let date = dateUtils.addDaysToKSADateString(startExclusive, 1);
  while (date <= endInclusive) {
    entries.push({
      subscriptionId: container._id,
      date,
      status: "open",
      fulfillmentModeOverride: fulfillment.fulfillmentModeOverride,
      pickupLocationIdOverride: fulfillment.pickupLocationIdOverride,
      ...(fulfillment.deliveryAddressOverride !== undefined
        ? { deliveryAddressOverride: fulfillment.deliveryAddressOverride }
        : {}),
      ...(fulfillment.deliveryWindowOverride !== undefined
        ? { deliveryWindowOverride: fulfillment.deliveryWindowOverride }
        : {}),
    });
    date = dateUtils.addDaysToKSADateString(date, 1);
  }
  return entries;
}

function defaultRuntime() {
  return {
    findContainer({ containerSubscriptionId, session }) {
      return Subscription.findById(containerSubscriptionId).session(session);
    },
    findBatches({ containerSubscriptionId, session }) {
      return SubscriptionEntitlementBatch.find({ containerSubscriptionId })
        .sort({ effectiveStartDate: 1, createdAt: 1, _id: 1 })
        .session(session)
        .lean();
    },
    async activateToken({ payload, now, session }) {
      let existing = await SubscriptionEntitlementCompensation.findOne({
        sourceKey: payload.sourceKey,
      }).session(session);
      if (existing && existing.state === "active") {
        return { token: existing, changed: false, created: false };
      }
      if (existing && existing.state === "revoked") {
        existing = await SubscriptionEntitlementCompensation.findOneAndUpdate(
          { _id: existing._id, state: "revoked" },
          {
            $set: {
              state: "active",
              appliedAt: now,
              revokedAt: null,
              sourceDayId: payload.sourceDayId || existing.sourceDayId || null,
              metadata: payload.metadata || existing.metadata || null,
            },
          },
          { new: true, session }
        );
        if (!existing) {
          throw compensationError(
            "STACKING_COMPENSATION_TOKEN_CONFLICT",
            "Compensation token changed concurrently",
            409,
            { sourceKey: payload.sourceKey }
          );
        }
        return { token: existing, changed: true, created: false };
      }

      try {
        const created = await SubscriptionEntitlementCompensation.create([
          { ...payload, state: "active", appliedAt: now, revokedAt: null },
        ], { session });
        return { token: created[0], changed: true, created: true };
      } catch (err) {
        if (Number(err && err.code) !== 11000 && Number(err && err.code) !== 11001) {
          throw err;
        }
        const duplicate = await SubscriptionEntitlementCompensation.findOne({
          sourceKey: payload.sourceKey,
        }).session(session);
        if (!duplicate) throw err;
        return {
          token: duplicate,
          changed: duplicate.state !== "active",
          created: false,
        };
      }
    },
    findActiveTokensForSource({ containerSubscriptionId, sourceDate, actionType, session }) {
      return SubscriptionEntitlementCompensation.find({
        containerSubscriptionId,
        sourceDate,
        actionType,
        state: "active",
      }).sort({ entitlementBatchId: 1, _id: 1 }).session(session).lean();
    },
    countActiveTokens({ entitlementBatchId, session }) {
      return SubscriptionEntitlementCompensation.countDocuments({
        entitlementBatchId,
        state: "active",
      }).session(session);
    },
    revokeToken({ token, now, session }) {
      return SubscriptionEntitlementCompensation.findOneAndUpdate(
        { _id: token._id, state: "active" },
        { $set: { state: "revoked", revokedAt: now } },
        { new: true, session }
      ).lean();
    },
    updateBatchCompensation({ batch, baseValidityEndDate, compensationDays, validityEndDate, session }) {
      return SubscriptionEntitlementBatch.findOneAndUpdate(
        {
          _id: batch._id,
          stackVersion: Number(batch.stackVersion || 1),
          compensationRevision: Number(batch.compensationRevision || 0),
        },
        {
          $set: {
            baseValidityEndDate,
            compensationDays,
            validityEndDate: new Date(`${validityEndDate}T00:00:00+03:00`),
          },
          $inc: {
            stackVersion: 1,
            compensationRevision: 1,
          },
        },
        { new: true, session }
      ).lean();
    },
    upsertExtensionDays({ entries, session }) {
      if (!entries.length) {
        return Promise.resolve({ matchedCount: 0, modifiedCount: 0, upsertedCount: 0 });
      }
      return SubscriptionDay.bulkWrite(
        entries.map((entry) => ({
          updateOne: {
            filter: { subscriptionId: entry.subscriptionId, date: entry.date },
            update: { $setOnInsert: entry },
            upsert: true,
          },
        })),
        { ordered: false, session }
      );
    },
    countBlockingAllocations({ entitlementBatchId, afterDate, session }) {
      return SubscriptionEntitlementAllocation.countDocuments({
        entitlementBatchId,
        date: { $gt: afterDate },
        state: { $in: SHRINK_BLOCKING_ALLOCATION_STATES },
      }).session(session);
    },
    countBlockingBlueprints({ entitlementBatchId, afterDate, session }) {
      return SubscriptionEntitlementDayBlueprint.countDocuments({
        date: { $gt: afterDate },
        "slots.entitlementBatchId": entitlementBatchId,
      }).session(session);
    },
    reconcileLifecycle: (args) => (
      reconcileSubscriptionStackingLifecycleTransactional(args)
    ),
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

async function updateBatchForActiveTokenCount({
  container,
  batch,
  activeTokenCount,
  allowShrink,
  session,
  runtime,
} = {}) {
  const oldValidity = normalizeDateString(batch.validityEndDate, "validityEndDate");
  const baseValidity = normalizeDateString(
    batch.baseValidityEndDate || batch.validityEndDate,
    "baseValidityEndDate"
  );
  const newValidity = computeCompensatedValidityDate(
    { ...batch, baseValidityEndDate: baseValidity },
    activeTokenCount
  );

  if (newValidity < oldValidity && allowShrink) {
    const [blockingAllocations, blockingBlueprints] = await Promise.all([
      runtime.countBlockingAllocations({
        entitlementBatchId: batch._id,
        afterDate: newValidity,
        session,
      }),
      runtime.countBlockingBlueprints({
        entitlementBatchId: batch._id,
        afterDate: newValidity,
        session,
      }),
    ]);
    if (Number(blockingAllocations || 0) > 0 || Number(blockingBlueprints || 0) > 0) {
      throw compensationError(
        "STACKING_COMPENSATION_SHRINK_CONFLICT",
        "Compensation cannot be removed because later planning or consumption exists",
        409,
        {
          entitlementBatchId: String(batch._id),
          newValidityEndDate: newValidity,
          blockingAllocations: Number(blockingAllocations || 0),
          blockingBlueprints: Number(blockingBlueprints || 0),
        }
      );
    }
  }

  const updated = await runtime.updateBatchCompensation({
    batch,
    baseValidityEndDate: new Date(`${baseValidity}T00:00:00+03:00`),
    compensationDays: activeTokenCount,
    validityEndDate: newValidity,
    session,
  });
  if (!updated) {
    throw compensationError(
      "STACKING_COMPENSATION_BATCH_CONFLICT",
      "Entitlement batch changed during compensation",
      409,
      { entitlementBatchId: String(batch._id) }
    );
  }

  const extensionEntries = buildExtensionDayEntries({
    container,
    batch: updated,
    fromExclusive: oldValidity,
    toInclusive: newValidity,
  });
  const dayResult = await runtime.upsertExtensionDays({
    entries: extensionEntries,
    session,
  });

  return {
    batch: updated,
    previousValidityEndDate: oldValidity,
    validityEndDate: newValidity,
    compensationDays: activeTokenCount,
    extensionDaysRequested: extensionEntries.length,
    extensionDaysInserted: Number(dayResult && dayResult.upsertedCount || 0),
  };
}

async function applyStackingCompensationTransactional({
  containerSubscriptionId,
  userId,
  sourceDate,
  actionType,
  sourceDayId = null,
  businessDate,
  session,
  now = new Date(),
  metadata = null,
  runtime: runtimeOverrides = null,
} = {}) {
  assertTransactionalSession(session);
  const runtime = resolveRuntime(runtimeOverrides);
  const normalizedDate = normalizeDateString(sourceDate, "sourceDate");
  const normalizedAction = normalizeActionType(actionType);
  const container = await runtime.findContainer({ containerSubscriptionId, session });
  if (!container) {
    throw compensationError(
      "STACKING_CONTAINER_NOT_FOUND",
      "Subscription container was not found",
      404
    );
  }
  if (userId && String(container.userId || "") !== String(userId)) {
    throw compensationError("FORBIDDEN", "Subscription does not belong to the user", 403);
  }

  const allBatches = await runtime.findBatches({ containerSubscriptionId, session });
  const contributing = (Array.isArray(allBatches) ? allBatches : [])
    .filter((batch) => batchContributesOnDate(batch, normalizedDate));
  if (!contributing.length) {
    throw compensationError(
      "STACKING_COMPENSATION_NO_CONTRIBUTING_BATCH",
      "No entitlement batch contributes to the selected date",
      422,
      { sourceDate: normalizedDate, actionType: normalizedAction }
    );
  }

  const tokenResults = [];
  const batchResults = [];
  for (const batch of contributing) {
    const sourceKey = buildCompensationSourceKey({
      entitlementBatchId: batch._id,
      actionType: normalizedAction,
      sourceDate: normalizedDate,
    });
    const tokenResult = await runtime.activateToken({
      payload: {
        userId: container.userId,
        containerSubscriptionId: container._id,
        entitlementBatchId: batch._id,
        sourceDayId,
        sourceDate: normalizedDate,
        actionType: normalizedAction,
        sourceKey,
        metadata,
      },
      now,
      session,
    });
    const activeCount = await runtime.countActiveTokens({
      entitlementBatchId: batch._id,
      session,
    });
    const batchResult = await updateBatchForActiveTokenCount({
      container,
      batch,
      activeTokenCount: Number(activeCount || 0),
      allowShrink: false,
      session,
      runtime,
    });
    tokenResults.push({
      sourceKey,
      changed: Boolean(tokenResult.changed),
      created: Boolean(tokenResult.created),
      token: tokenResult.token,
    });
    batchResults.push(batchResult);
  }

  const lifecycle = await runtime.reconcileLifecycle({
    containerSubscriptionId: container._id,
    businessDate,
    session,
  });
  return {
    applied: true,
    idempotent: tokenResults.every((entry) => !entry.changed),
    actionType: normalizedAction,
    sourceDate: normalizedDate,
    tokenResults,
    batchResults,
    lifecycle,
  };
}

async function revokeStackingCompensationTransactional({
  containerSubscriptionId,
  userId,
  sourceDate,
  actionType,
  businessDate,
  session,
  now = new Date(),
  runtime: runtimeOverrides = null,
} = {}) {
  assertTransactionalSession(session);
  const runtime = resolveRuntime(runtimeOverrides);
  const normalizedDate = normalizeDateString(sourceDate, "sourceDate");
  const normalizedAction = normalizeActionType(actionType);
  const container = await runtime.findContainer({ containerSubscriptionId, session });
  if (!container) {
    throw compensationError(
      "STACKING_CONTAINER_NOT_FOUND",
      "Subscription container was not found",
      404
    );
  }
  if (userId && String(container.userId || "") !== String(userId)) {
    throw compensationError("FORBIDDEN", "Subscription does not belong to the user", 403);
  }

  const tokens = await runtime.findActiveTokensForSource({
    containerSubscriptionId,
    sourceDate: normalizedDate,
    actionType: normalizedAction,
    session,
  });
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return {
      revoked: true,
      idempotent: true,
      actionType: normalizedAction,
      sourceDate: normalizedDate,
      tokenResults: [],
      batchResults: [],
      lifecycle: null,
    };
  }

  const allBatches = await runtime.findBatches({ containerSubscriptionId, session });
  const batchById = new Map(
    (Array.isArray(allBatches) ? allBatches : [])
      .map((batch) => [String(batch._id), batch])
  );
  const tokenResults = [];
  const batchResults = [];

  for (const token of tokens) {
    const batch = batchById.get(String(token.entitlementBatchId));
    if (!batch) {
      throw compensationError(
        "STACKING_COMPENSATION_BATCH_MISSING",
        "Compensation references a missing entitlement batch",
        409,
        { sourceKey: token.sourceKey }
      );
    }
    const activeCountBefore = Number(await runtime.countActiveTokens({
      entitlementBatchId: batch._id,
      session,
    }) || 0);
    const activeCountAfter = Math.max(0, activeCountBefore - 1);

    // Verify shrink safety before changing either token or batch. The enclosing
    // transaction guarantees all batch/token mutations commit or roll back together.
    const batchResult = await updateBatchForActiveTokenCount({
      container,
      batch,
      activeTokenCount: activeCountAfter,
      allowShrink: true,
      session,
      runtime,
    });
    const revoked = await runtime.revokeToken({ token, now, session });
    if (!revoked) {
      throw compensationError(
        "STACKING_COMPENSATION_TOKEN_CONFLICT",
        "Compensation token changed during revocation",
        409,
        { sourceKey: token.sourceKey }
      );
    }
    tokenResults.push({ sourceKey: token.sourceKey, token: revoked });
    batchResults.push(batchResult);
    batchById.set(String(batch._id), batchResult.batch);
  }

  const lifecycle = await runtime.reconcileLifecycle({
    containerSubscriptionId: container._id,
    businessDate,
    session,
  });
  return {
    revoked: true,
    idempotent: false,
    actionType: normalizedAction,
    sourceDate: normalizedDate,
    tokenResults,
    batchResults,
    lifecycle,
  };
}

module.exports = {
  COMPENSATION_ACTIONS,
  CONTRIBUTING_STATUSES,
  SHRINK_BLOCKING_ALLOCATION_STATES,
  applyStackingCompensationTransactional,
  batchContributesOnDate,
  buildCompensationSourceKey,
  buildExtensionDayEntries,
  computeCompensatedValidityDate,
  revokeStackingCompensationTransactional,
  updateBatchForActiveTokenCount,
};
