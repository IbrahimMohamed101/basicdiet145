"use strict";

const Subscription = require("../models/Subscription");
const SubscriptionEntitlementBatch = require("../models/SubscriptionEntitlementBatch");
const {
  isSubscriptionStackingWriteEnabled,
} = require("../utils/featureFlags");
const {
  isWriteStackingEnabledForUser,
} = require("../services/subscription/subscriptionStackingRolloutPolicyService");

const STACKING_DASHBOARD_MUTATION_CODE =
  "STACKING_DASHBOARD_MUTATION_NOT_READY";

function requestPath(req = {}) {
  return String(req.originalUrl || req.url || "").split("?")[0];
}

function isSafeRequest(req = {}) {
  const method = String(req.method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
  return /\/dashboard\/subscriptions\/quote\/?$/i.test(requestPath(req));
}

function targetSubscriptionId(req = {}) {
  const match = /\/dashboard\/subscriptions\/([a-f0-9]{24})(?:\/|$)/i.exec(
    requestPath(req)
  );
  return match ? match[1] : "";
}

function isCreateRequest(req = {}) {
  return String(req.method || "").toUpperCase() === "POST"
    && /\/dashboard\/subscriptions\/?$/i.test(requestPath(req));
}

function defaultRuntime() {
  return {
    globallyEnabled: () => isSubscriptionStackingWriteEnabled(),
    writeEnabledForUser: (userId) => isWriteStackingEnabledForUser(userId),
    findBatchOwner(subscriptionId) {
      return SubscriptionEntitlementBatch.findOne({
        containerSubscriptionId: subscriptionId,
      })
        .select("userId containerSubscriptionId")
        .lean();
    },
    findActiveSubscriptionForUser(userId) {
      return Subscription.findOne({ userId, status: "active" })
        .select("_id userId")
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

      if (isCreateRequest(req)) {
        const userId = String(req.body && req.body.userId || "");
        if (!/^[a-f0-9]{24}$/i.test(userId)) return next();
        const activeSubscription = await runtime.findActiveSubscriptionForUser(
          userId
        );
        if (!activeSubscription) return next();
        const persistedBatch = await runtime.findBatchOwner(
          activeSubscription._id
        );
        // A kill switch stops new stacking writes; it does not turn a
        // batch-backed parent into a legacy subscription again.
        if (persistedBatch) {
          return blockedResponse(res, {
            subscriptionId: String(activeSubscription._id || ""),
          });
        }
        if (!runtime.globallyEnabled() || !runtime.writeEnabledForUser(userId)) {
          return next();
        }
        return blockedResponse(res, {
          subscriptionId: String(activeSubscription._id || ""),
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
