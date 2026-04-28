const Subscription = require("../../models/Subscription");
const { writeLog } = require("../../utils/log");
const { logger } = require("../../utils/logger");
const { cancelSubscriptionDomain } = require("./subscriptionCancellationService");
const { serializeSubscriptionForClientWithGuard } = require("./subscriptionClientSerializationService");

async function writeLogSafely(payload, context = {}) {
  try {
    await writeLog(payload);
  } catch (err) {
    logger.error("Activity log write failed", {
      error: err.message,
      stack: err.stack,
      action: payload && payload.action ? payload.action : undefined,
      entityType: payload && payload.entityType ? payload.entityType : undefined,
      entityId: payload && payload.entityId ? String(payload.entityId) : undefined,
      ...context,
    });
  }
}

function defaultRuntime() {
  return {
    cancelSubscriptionDomain: (...args) => cancelSubscriptionDomain(...args),
    findSubscriptionById(subscriptionId) {
      return Subscription.findById(subscriptionId).lean();
    },
    serializeSubscriptionForClient: (...args) => serializeSubscriptionForClientWithGuard(...args),
    writeLogSafely: (...args) => writeLogSafely(...args),
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

async function performClientSubscriptionCancellation({ subscriptionId, userId, lang, runtime: runtimeOverrides = null }) {
  const runtime = resolveRuntime(runtimeOverrides);

  let result;
  try {
    result = await runtime.cancelSubscriptionDomain({
      subscriptionId,
      actor: { kind: "client", userId },
    });
  } catch (err) {
    logger.error("subscriptionController.cancelSubscription failed", {
      error: err.message,
      stack: err.stack,
      subscriptionId,
      userId: userId ? String(userId) : undefined,
    });
    return { kind: "error", status: 500, code: "INTERNAL", message: "Subscription cancellation failed" };
  }

  if (result.outcome === "not_found") {
    return { kind: "error", status: 404, code: "NOT_FOUND", message: "Subscription not found" };
  }

  if (result.outcome === "forbidden") {
    return { kind: "error", status: 403, code: "FORBIDDEN", message: "Forbidden" };
  }

  if (result.outcome === "invalid_transition") {
    return {
      kind: "error",
      status: 409,
      code: "INVALID_TRANSITION",
      message: "Only pending_payment or active subscriptions can be canceled",
    };
  }

  if (!["canceled", "already_canceled"].includes(result.outcome)) {
    logger.error("subscriptionController.cancelSubscription received unsupported outcome", {
      outcome: result.outcome,
      subscriptionId,
      userId: userId ? String(userId) : undefined,
    });
    return { kind: "error", status: 500, code: "INTERNAL", message: "Subscription cancellation failed" };
  }

  let subscription;
  try {
    subscription = await runtime.findSubscriptionById(result.subscriptionId || subscriptionId);
  } catch (err) {
    logger.error("subscriptionController.cancelSubscription findSubscriptionById failed", {
      error: err.message,
      stack: err.stack,
      subscriptionId: result.subscriptionId || subscriptionId,
      userId: userId ? String(userId) : undefined,
    });
    return { kind: "error", status: 500, code: "INTERNAL", message: "Subscription cancellation failed" };
  }

  if (!subscription) {
    return { kind: "error", status: 404, code: "NOT_FOUND", message: "Subscription not found" };
  }

  let serialized;
  try {
    serialized = await runtime.serializeSubscriptionForClient(subscription, lang);
  } catch (err) {
    logger.error("subscriptionController.cancelSubscription serializeSubscriptionForClient failed", {
      error: err.message,
      stack: err.stack,
      subscriptionId: result.subscriptionId || subscriptionId,
      userId: userId ? String(userId) : undefined,
      planId: subscription && subscription.planId ? String(subscription.planId) : null,
    });
    serialized = {
      _id: subscription && subscription._id ? String(subscription._id) : String(result.subscriptionId || subscriptionId),
      userId: subscription && subscription.userId ? String(subscription.userId) : null,
      status: subscription && subscription.status ? subscription.status : null,
      planId: subscription && subscription.planId ? String(subscription.planId) : null,
    };
  }

  if (result.outcome === "already_canceled") {
    return {
      kind: "success",
      status: 200,
      body: {
        status: true,
        data: serialized,
        idempotent: true,
      },
    };
  }

  await runtime.writeLogSafely({
    entityType: "subscription",
    entityId: result.subscriptionId || subscriptionId,
    action: "subscription_canceled_by_client",
    byUserId: userId,
    byRole: "client",
    meta: result.mutation,
  }, {
    subscriptionId,
    userId: userId ? String(userId) : undefined,
  });

  return {
    kind: "success",
    status: 200,
    body: {
      status: true,
      data: serialized,
    },
  };
}

module.exports = {
  performClientSubscriptionCancellation,
};
