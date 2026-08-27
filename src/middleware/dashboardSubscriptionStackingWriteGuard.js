"use strict";

const SubscriptionEntitlementBatch = require("../models/SubscriptionEntitlementBatch");

const STACKING_DASHBOARD_MUTATION_CODE =
  "STACKING_DASHBOARD_MUTATION_NOT_READY";

function requestPath(req = {}) {
  return String(req.originalUrl || req.url || "").split("?")[0];
}

function isCreateRequest(req = {}) {
  return String(req.method || "").toUpperCase() === "POST"
    && /\/dashboard\/subscriptions\/?$/i.test(requestPath(req));
}

function isSafeRequest(req = {}) {
  const method = String(req.method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  const path = requestPath(req);
  if (/\/dashboard\/subscriptions\/quote\/?$/i.test(path)) return true;

  // Dashboard creation is now routed through the additive stacking adapter.
  // It is safe for both first-time subscriptions and customers that already
  // own one or more entitlement batches.
  if (isCreateRequest(req)) return true;

  if (method !== "POST") return false;

  // Both deduction actions are now stacking-aware. Quick-day deduction is
  // explicitly batch-scoped, while manual deduction distributes the requested
  // balance across entitlement batches under the same lease/idempotency model.
  return /\/dashboard\/subscriptions\/[a-f0-9]{24}\/(?:quick-day-deduction|manual-deduction)\/?$/i.test(path);
}

function targetSubscriptionId(req = {}) {
  const match = /\/dashboard\/subscriptions\/([a-f0-9]{24})(?:\/|$)/i.exec(
    requestPath(req)
  );
  return match ? match[1] : "";
}

function defaultRuntime() {
  return {
    findBatchOwner(subscriptionId) {
      return SubscriptionEntitlementBatch.findOne({
        containerSubscriptionId: subscriptionId,
      })
        .select("userId containerSubscriptionId")
        .lean();
    },
  };
}

function blockedResponse(res, details = {}) {
  return res.status(503).json({
    status: false,
    message:
      "Dashboard changes are temporarily unavailable for combined packages",
    error: {
      code: STACKING_DASHBOARD_MUTATION_CODE,
      retryable: false,
      ...details,
    },
  });
}

function createDashboardSubscriptionStackingWriteGuard(runtimeOverrides = null) {
  const runtime = {
    ...defaultRuntime(),
    ...(runtimeOverrides && typeof runtimeOverrides === "object"
      ? runtimeOverrides
      : {}),
  };

  return async function dashboardSubscriptionStackingWriteGuard(req, res, next) {
    try {
      if (isSafeRequest(req)) return next();

      const subscriptionId = targetSubscriptionId(req);
      if (subscriptionId) {
        const batch = await runtime.findBatchOwner(subscriptionId);
        // Persisted batches outlive rollout flags. Never expose a legacy
        // parent-level mutation merely because the kill switch was closed.
        if (!batch) return next();
        return blockedResponse(res, {
          subscriptionId: String(
            batch.containerSubscriptionId || subscriptionId
          ),
        });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

const dashboardSubscriptionStackingWriteGuard =
  createDashboardSubscriptionStackingWriteGuard();

module.exports = {
  STACKING_DASHBOARD_MUTATION_CODE,
  createDashboardSubscriptionStackingWriteGuard,
  dashboardSubscriptionStackingWriteGuard,
  isCreateRequest,
  isSafeRequest,
  requestPath,
  targetSubscriptionId,
};
