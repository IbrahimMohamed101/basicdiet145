"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const dateUtils = require("../../utils/date");
const {
  assertTransactionalSession,
} = require("./subscriptionEntitlementLedgerService");
const {
  buildContainerMirror,
} = require("./subscriptionStackingActivationService");

const LIVE_CONTAINER_BATCH_STATUSES = new Set([
  "paid_scheduled",
  "active",
  "exhausted",
]);

function lifecycleError(code, message, status = 409, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function normalizeDateString(value, fieldName = "date") {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw lifecycleError(
      "INVALID_STACKING_LIFECYCLE_DATE",
      `${fieldName} must be a valid date`,
      400,
      { fieldName, value }
    );
  }
  return dateUtils.toKSADateString(parsed);
}

function normalizeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function resolveBatchLifecycleState(batch, businessDate, now = new Date()) {
  if (!batch) {
    throw lifecycleError(
      "STACKING_BATCH_REQUIRED",
      "Entitlement batch is required",
      422
    );
  }

  const currentStatus = String(batch.status || "");
  if (currentStatus === "canceled") {
    return {
      changed: false,
      status: "canceled",
      set: {},
      reason: "canceled_terminal",
    };
  }

  const targetDate = normalizeDateString(businessDate, "businessDate");
  const startDate = normalizeDateString(batch.effectiveStartDate, "effectiveStartDate");
  const validityEndDate = normalizeDateString(
    batch.validityEndDate || batch.endDate,
    "validityEndDate"
  );
  const remainingMeals = normalizeCount(batch.remainingMeals);
  const reservedMeals = normalizeCount(batch.reservedMeals);

  let desiredStatus;
  let reason;
  if (targetDate < startDate) {
    desiredStatus = "paid_scheduled";
    reason = "before_effective_start";
  } else if (targetDate > validityEndDate) {
    desiredStatus = "expired";
    reason = "validity_ended";
  } else if (remainingMeals === 0 && reservedMeals === 0) {
    desiredStatus = "exhausted";
    reason = "balance_exhausted";
  } else {
    desiredStatus = "active";
    reason = currentStatus === "exhausted"
      ? "released_credit_reactivated"
      : "inside_active_window";
  }

  const set = {};
  if (desiredStatus !== currentStatus) set.status = desiredStatus;
  if (desiredStatus === "active" && !batch.activatedAt) set.activatedAt = now;
  if (desiredStatus === "exhausted" && !batch.exhaustedAt) set.exhaustedAt = now;
  // Do not invent an expiration timestamp for historical rows that are already
  // expired. The timestamp is authoritative only when this reconciliation
  // performs the actual transition into the expired state.
  if (
    desiredStatus === "expired"
    && currentStatus !== "expired"
    && !batch.expiredAt
  ) {
    set.expiredAt = now;
  }

  // Clear stale terminal timestamps only when a reversible state legitimately
  // becomes live again. Historical audit remains in metadata/logs, while the
  // canonical timestamp fields describe the current lifecycle transition.
  if (desiredStatus === "active" && batch.exhaustedAt) set.exhaustedAt = null;
  if (desiredStatus !== "expired" && batch.expiredAt) set.expiredAt = null;

  return {
    changed: Object.keys(set).length > 0,
    status: desiredStatus,
    set,
    reason,
  };
}

function resolveContainerLifecycleStatus({ container, batches, businessDate } = {}) {
  if (!container) {
    throw lifecycleError(
      "STACKING_CONTAINER_REQUIRED",
      "Subscription container is required",
      404
    );
  }
  if (String(container.status || "") === "canceled") return "canceled";

  const targetDate = normalizeDateString(businessDate, "businessDate");
  const rows = Array.isArray(batches) ? batches : [];
  const hasLiveOrFutureBatch = rows.some((batch) => {
    const status = String(batch && batch.status || "");
    if (!LIVE_CONTAINER_BATCH_STATUSES.has(status)) return false;
    const validityEndDate = normalizeDateString(
      batch.validityEndDate || batch.endDate,
      "validityEndDate"
    );
    return validityEndDate >= targetDate;
  });

  return hasLiveOrFutureBatch ? "active" : "expired";
}

function defaultRuntime() {
  return {
    findContainer({ containerSubscriptionId, session }) {
      return Subscription.findById(containerSubscriptionId).session(session);
    },
    findBatches({ containerSubscriptionId, session }) {
      return SubscriptionEntitlementBatch.find({
        containerSubscriptionId,
      }).sort({ effectiveStartDate: 1, createdAt: 1, _id: 1 }).session(session).lean();
    },
    transitionBatch({ batch, transition, session }) {
      return SubscriptionEntitlementBatch.findOneAndUpdate(
        {
          _id: batch._id,
          status: batch.status,
          stackVersion: Number(batch.stackVersion || 1),
        },
        {
          $set: transition.set,
          $inc: { stackVersion: 1 },
        },
        { new: true, session }
      ).lean();
    },
    updateContainer({ container, update, session }) {
      return Subscription.findOneAndUpdate(
        {
          _id: container._id,
          status: container.status,
        },
        { $set: update },
        { new: true, session }
      );
    },
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

async function reconcileSubscriptionStackingLifecycleTransactional({
  containerSubscriptionId,
  businessDate,
  now = new Date(),
  session,
  runtime: runtimeOverrides = null,
} = {}) {
  assertTransactionalSession(session);
  const runtime = resolveRuntime(runtimeOverrides);
  const container = await runtime.findContainer({
    containerSubscriptionId,
    session,
  });
  if (!container) {
    throw lifecycleError(
      "STACKING_CONTAINER_NOT_FOUND",
      "Subscription container was not found",
      404,
      { containerSubscriptionId: String(containerSubscriptionId || "") }
    );
  }
  if (String(container.status || "") === "canceled") {
    return {
      outcome: "container_canceled",
      container,
      batches: [],
      transitions: [],
      idempotent: true,
    };
  }

  const originalBatches = await runtime.findBatches({
    containerSubscriptionId: container._id,
    session,
  });
  if (!Array.isArray(originalBatches) || originalBatches.length === 0) {
    return {
      outcome: "no_batches",
      container,
      batches: [],
      transitions: [],
      idempotent: true,
    };
  }

  const reconciledBatches = [];
  const transitions = [];
  for (const batch of originalBatches) {
    const transition = resolveBatchLifecycleState(batch, businessDate, now);
    if (!transition.changed) {
      reconciledBatches.push(batch);
      continue;
    }

    const updated = await runtime.transitionBatch({
      batch,
      transition,
      session,
    });
    if (!updated) {
      throw lifecycleError(
        "STACKING_BATCH_LIFECYCLE_CONFLICT",
        "Entitlement batch changed during lifecycle reconciliation",
        409,
        {
          entitlementBatchId: String(batch._id || ""),
          fromStatus: batch.status,
          toStatus: transition.status,
        }
      );
    }
    reconciledBatches.push(updated);
    transitions.push({
      entitlementBatchId: String(batch._id || ""),
      fromStatus: String(batch.status || ""),
      toStatus: transition.status,
      reason: transition.reason,
    });
  }

  const containerStatus = resolveContainerLifecycleStatus({
    container,
    batches: reconciledBatches,
    businessDate,
  });
  const mirror = buildContainerMirror({
    container,
    batches: reconciledBatches,
    businessDate,
  });
  const containerUpdate = {
    ...mirror,
    status: containerStatus,
  };
  const containerChanged = [
    "status",
    "totalMeals",
    "remainingMeals",
    "reservedMeals",
    "consumedMeals",
    "forfeitedMeals",
    "selectedMealsPerDay",
  ].some((field) => Number.isFinite(Number(containerUpdate[field]))
    ? Number(container[field] || 0) !== Number(containerUpdate[field] || 0)
    : String(container[field] || "") !== String(containerUpdate[field] || ""))
    || dateUtils.toKSADateString(container.endDate) !== dateUtils.toKSADateString(containerUpdate.endDate)
    || dateUtils.toKSADateString(container.validityEndDate || container.endDate)
      !== dateUtils.toKSADateString(containerUpdate.validityEndDate);

  let updatedContainer = container;
  if (containerChanged) {
    updatedContainer = await runtime.updateContainer({
      container,
      update: containerUpdate,
      session,
    });
    if (!updatedContainer) {
      throw lifecycleError(
        "STACKING_CONTAINER_LIFECYCLE_CONFLICT",
        "Subscription container changed during lifecycle reconciliation",
        409,
        { containerSubscriptionId: String(container._id) }
      );
    }
  }

  return {
    outcome: transitions.length || containerChanged ? "reconciled" : "unchanged",
    container: updatedContainer,
    batches: reconciledBatches,
    transitions,
    idempotent: transitions.length === 0 && !containerChanged,
  };
}

module.exports = {
  LIVE_CONTAINER_BATCH_STATUSES,
  reconcileSubscriptionStackingLifecycleTransactional,
  resolveBatchLifecycleState,
  resolveContainerLifecycleStatus,
};
