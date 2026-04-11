"use strict";

const Subscription = require("../../models/Subscription");
const User = require("../../models/User");
const { logger } = require("../../utils/logger");
const { writeLog } = require("../../utils/log");
const { cancelSubscriptionDomain } = require("./subscriptionCancellationService");
const {
  loadSubscriptionSummaryCatalog,
  serializeSubscriptionAdminFromCatalog,
} = require("./subscriptionOperationsReadService");

async function writeActivityLogSafely(payload, context = {}) {
  try {
    await writeLog(payload);
  } catch (err) {
    logger.error("SubscriptionLifecycleService activity log write failed", {
      error: err.message,
      stack: err.stack,
      action: payload && payload.action ? payload.action : undefined,
      entityType: payload && payload.entityType ? payload.entityType : undefined,
      entityId: payload && payload.entityId ? String(payload.entityId) : undefined,
      ...context,
    });
  }
}

async function serializeSubscriptionAdmin(subscription, lang, userDoc) {
  const catalog = await loadSubscriptionSummaryCatalog([subscription], lang);
  return serializeSubscriptionAdminFromCatalog(subscription, userDoc, catalog);
}

/**
 * Orchestrates the admin-initiated cancellation of a subscription.
 * Preserves exact behavior from adminController.js legacy implementation.
 */
async function performCancelSubscriptionAdmin({ subscriptionId, actor, lang }) {
  try {
    const result = await cancelSubscriptionDomain({
      subscriptionId,
      actor: {
        kind: "admin",
        dashboardUserId: actor.dashboardUserId,
        dashboardUserRole: actor.dashboardUserRole,
      },
    });

    if (result.outcome === "not_found") {
      return { outcome: "not_found" };
    }

    if (result.outcome === "invalid_transition") {
      return { outcome: "invalid_transition" };
    }

    if (result.outcome === "forbidden") {
      return { outcome: "forbidden" };
    }

    if (!["canceled", "already_canceled"].includes(result.outcome)) {
      logger.error("SubscriptionLifecycleService.performCancelSubscriptionAdmin received unsupported outcome", {
        outcome: result.outcome,
        subscriptionId,
      });
      return { outcome: "error", message: "Subscription cancellation failed" };
    }

    const subscription = await Subscription.findById(result.subscriptionId || subscriptionId).lean();
    if (!subscription) {
      return { outcome: "not_found" };
    }
    const user = subscription.userId ? await User.findById(subscription.userId).lean() : null;

    if (result.outcome === "already_canceled") {
      return {
        outcome: "already_canceled",
        data: await serializeSubscriptionAdmin(subscription, lang, user),
        idempotent: true,
      };
    }

    // Exact legacy side-effect ordering
    await writeActivityLogSafely({
      entityType: "subscription",
      entityId: result.subscriptionId || subscriptionId,
      action: "subscription_canceled_by_admin",
      byUserId: actor.dashboardUserId,
      byRole: actor.dashboardUserRole,
      meta: result.mutation,
    }, { subscriptionId });

    return {
      outcome: "canceled",
      data: await serializeSubscriptionAdmin(subscription, lang, user),
    };
  } catch (err) {
    logger.error("SubscriptionLifecycleService.performCancelSubscriptionAdmin failed", {
      error: err.message,
      stack: err.stack,
      subscriptionId,
    });
    throw err;
  }
}

module.exports = {
  performCancelSubscriptionAdmin,
};
