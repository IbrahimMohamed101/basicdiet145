const crypto = require("node:crypto");
const mongoose = require("mongoose");
const SubscriptionDay = require("../../models/SubscriptionDay");
const Order = require("../../models/Order");
const Delivery = require("../../models/Delivery");
const Subscription = require("../../models/Subscription");
const SubscriptionAuditLog = require("../../models/SubscriptionAuditLog");
const { fulfillSubscriptionDay } = require("../fulfillmentService");
const { canTransition } = require("../../utils/state");
const { canOrderTransition } = require("../../utils/orderState");
const { writeLog } = require("../../utils/log");
const { notifyUser } = require("../../utils/notify");
const { notifyOrderUser } = require("../orderNotificationService");
const { logger } = require("../../utils/logger");

/**
 * Unified Operations Transition Service.
 * Handles state changes for both SubscriptionDays and Orders.
 */

async function executeAction(actionId, { entityId, entityType, userId, role, payload = {} }) {
  const normalizedEntityType = entityType === "subscription_day" || entityType === "pickup_day"
    ? "subscription"
    : entityType;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    let result;
    switch (actionId) {
      case "prepare":
        result = await handlePrepare({ entityId, entityType: normalizedEntityType, userId, role, payload, session });
        break;
      case "dispatch":
        result = await handleDispatch({ entityId, entityType: normalizedEntityType, userId, role, payload, session });
        break;
      case "ready_for_pickup":
        result = await handleReadyForPickup({ entityId, entityType: normalizedEntityType, userId, role, payload, session });
        break;
      case "fulfill":
        result = await handleFulfill({ entityId, entityType: normalizedEntityType, userId, role, payload, session });
        break;
      case "cancel":
        result = await handleCancel({ entityId, entityType: normalizedEntityType, userId, role, payload, session });
        break;
      case "reopen":
        result = await handleReopen({ entityId, entityType: normalizedEntityType, userId, role, payload, session });
        break;
      case "notify_arrival":
        result = await handleNotifyArrival({ entityId, entityType: normalizedEntityType, userId, role, payload, session });
        break;
      default:
        throw new Error(`Unsupported action: ${actionId}`);
    }

    await session.commitTransaction();
    session.endSession();

    // Trigger post-transaction side effects (notifications/logs)
    if (result.sideEffects) {
      await triggerSideEffects(result.sideEffects, { userId, role });
    }

    return result.data;
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

function appendOperationAudit(doc, action, userId, role) {
  if (!doc || doc.constructor.modelName !== "SubscriptionDay") return;
  doc.operationAuditLog = Array.isArray(doc.operationAuditLog) ? doc.operationAuditLog : [];
  doc.operationAuditLog.push({
    action,
    by: [role, userId].filter(Boolean).join(":"),
    at: new Date(),
  });
}

async function writeSubscriptionDayAudit({ day, action, fromStatus, toStatus, userId, role, payload, session }) {
  if (!day || !day._id) return;
  await SubscriptionAuditLog.create([{
    entityType: "subscription_day",
    entityId: day._id,
    action: `dashboard_${action}`,
    fromStatus,
    toStatus,
    actorType: role || "admin",
    actorId: userId || undefined,
    note: payload && (payload.reason || payload.notes || payload.note) ? String(payload.reason || payload.notes || payload.note) : undefined,
    meta: {
      subscriptionId: day.subscriptionId ? String(day.subscriptionId) : null,
      reason: payload && payload.reason ? String(payload.reason) : null,
      notes: payload && (payload.notes || payload.note) ? String(payload.notes || payload.note) : null,
    },
  }], { session });
}

async function handlePrepare({ entityId, entityType, userId, role, payload, session }) {
  const Model = entityType === "subscription" ? SubscriptionDay : Order;
  const doc = await Model.findById(entityId).session(session);
  if (!doc) throw new Error("Entity not found");

  const toStatus = entityType === "subscription" ? "in_preparation" : "preparing";
  if (doc.status === toStatus) {
    return { data: doc, idempotent: true };
  }

  if (entityType === "subscription") {
    const sub = await Subscription.findById(doc.subscriptionId).session(session).lean();
    if (!sub) throw new Error("Subscription not found");
    if (sub.deliveryMode === "pickup" && !doc.pickupRequested) {
      throw new Error("PICKUP_PREPARE_REQUIRED");
    }
  }

  const fromStatus = doc.status;
  validateTransition(entityType, fromStatus, toStatus);

  doc.status = toStatus;
  if (entityType === "subscription" && !doc.pickupPreparationStartedAt) {
    doc.pickupPreparationStartedAt = new Date();
  }
  if (entityType === "order" && !doc.confirmedAt) doc.confirmedAt = new Date();
  appendOperationAudit(doc, "prepare", userId, role);
  await doc.save({ session });
  if (entityType === "subscription") {
    await writeSubscriptionDayAudit({ day: doc, action: "prepare", fromStatus, toStatus, userId, role, payload, session });
  }

  return {
    data: doc,
    sideEffects: {
      action: "prepare",
      entityType,
      entityId,
      toStatus,
    },
  };
}

async function handleDispatch({ entityId, entityType, userId, role, payload, session }) {
  const Model = entityType === "subscription" ? SubscriptionDay : Order;
  const doc = await Model.findById(entityId).session(session);
  if (!doc) throw new Error("Entity not found");

  const toStatus = "out_for_delivery";
  if (doc.status === toStatus) {
    return { data: doc, idempotent: true };
  }

  const fromStatus = doc.status;
  validateTransition(entityType, fromStatus, toStatus);

  doc.status = toStatus;
  appendOperationAudit(doc, "dispatch", userId, role);
  await doc.save({ session });

  // Sync Delivery SoT
  const deliveryData = {
    status: "out_for_delivery",
    etaAt: payload.etaAt ? new Date(payload.etaAt) : undefined,
  };

  if (entityType === "subscription") {
    const sub = await Subscription.findById(doc.subscriptionId).session(session).lean();
    if (sub && sub.deliveryMode === "pickup") throw new Error("INVALID_STATE_TRANSITION");
    await Delivery.updateOne(
      { dayId: doc._id },
      {
        $set: {
          ...deliveryData,
          address: doc.deliveryAddressOverride || sub.deliveryAddress,
          window: doc.deliveryWindowOverride || sub.deliveryWindow,
        },
        $setOnInsert: { subscriptionId: sub._id, dayId: doc._id },
      },
      { upsert: true, session }
    );
  } else {
    await Delivery.updateOne(
      { orderId: doc._id },
      {
        $set: {
          ...deliveryData,
          address: doc.deliveryAddress,
          window: doc.deliveryWindow,
        },
        $setOnInsert: { orderId: doc._id },
      },
      { upsert: true, session }
    );
  }
  if (entityType === "subscription") {
    await writeSubscriptionDayAudit({
      day: doc,
      action: "dispatch",
      fromStatus,
      toStatus,
      userId,
      role,
      payload,
      session,
    });
  }

  return {
    data: doc,
    sideEffects: {
      action: "dispatch",
      entityType,
      entityId,
      toStatus,
    },
  };
}

async function handleFulfill({ entityId, entityType, payload, userId, role, session }) {
  if (entityType === "subscription") {
    const day = await SubscriptionDay.findById(entityId).session(session);
    if (!day) throw new Error("Subscription day not found");
    if (day.status === "fulfilled") {
      return { data: day, idempotent: true };
    }

    // If pickup, verify code if provided or required
    if (payload.pickupCode && !day.pickupVerifiedAt) {
      await verifyPickupCode(entityId, payload.pickupCode, userId, session);
    }

    const fromStatus = day.status;
    const result = await fulfillSubscriptionDay({ dayId: entityId, session });
    if (!result.ok) throw new Error(result.message || "Fulfillment failed");
    appendOperationAudit(result.day || day, "fulfill", userId, role);
    if (result.day && typeof result.day.save === "function") {
      await result.day.save({ session });
    }
    await writeSubscriptionDayAudit({
      day: result.day || day,
      action: "fulfill",
      fromStatus,
      toStatus: "fulfilled",
      userId,
      role,
      payload,
      session,
    });
    
    // Sync Delivery status
    await Delivery.updateOne(
      { dayId: entityId },
      { $set: { status: "delivered", deliveredAt: new Date() } },
      { session }
    );

    return {
      data: result.day,
      sideEffects: {
        action: "fulfill",
        entityType,
        entityId,
        toStatus: "fulfilled",
      },
    };
  } else {
    const order = await Order.findById(entityId).session(session);
    if (!order) throw new Error("Order not found");
    
    if (order.status === "fulfilled") {
      return { data: order, idempotent: true };
    }

    order.status = "fulfilled";
    order.fulfilledAt = new Date();
    await order.save({ session });

    await Delivery.updateOne(
      { orderId: order._id },
      { $set: { status: "delivered", deliveredAt: new Date() } },
      { session }
    );

    return {
      data: order,
      sideEffects: {
        action: "fulfill",
        entityType,
        entityId,
        toStatus: "fulfilled",
      },
    };
  }
}

async function handleReadyForPickup({ entityId, entityType, userId, role, payload, session }) {
  const Model = entityType === "subscription" ? SubscriptionDay : Order;
  const doc = await Model.findById(entityId).session(session);
  if (!doc) throw new Error("Entity not found");

  const toStatus = "ready_for_pickup";
  if (entityType === "subscription") {
    const sub = await Subscription.findById(doc.subscriptionId).session(session).lean();
    if (!sub) throw new Error("Subscription not found");
    if (sub.deliveryMode === "pickup" && (!doc.pickupRequested || doc.status !== "in_preparation")) {
      throw new Error("PICKUP_PREPARE_REQUIRED");
    }
  }
  const fromStatus = doc.status;
  validateTransition(entityType, fromStatus, toStatus);

  doc.status = toStatus;
  if (entityType === "subscription") {
    doc.pickupPreparedAt = new Date();
    doc.pickupCode = String(crypto.randomInt(100000, 999999));
    doc.pickupCodeIssuedAt = new Date();
  }
  appendOperationAudit(doc, "ready_for_pickup", userId, role);
  await doc.save({ session });
  if (entityType === "subscription") {
    await writeSubscriptionDayAudit({ day: doc, action: "ready_for_pickup", fromStatus, toStatus, userId, role, payload, session });
  }

  return {
    data: doc,
    sideEffects: {
      action: "ready_for_pickup",
      entityType,
      entityId,
      toStatus,
      pickupCode: doc.pickupCode,
    },
  };
}

async function verifyPickupCode(dayId, code, userId, session) {
  const day = await SubscriptionDay.findById(dayId).session(session);
  if (!day) throw new Error("Day not found");
  if (day.pickupCode !== String(code).trim()) {
    throw new Error("INVALID_PICKUP_CODE");
  }
  day.pickupVerifiedAt = new Date();
  day.pickupVerifiedByDashboardUserId = userId;
  await day.save({ session });
}

async function handleCancel({ entityId, entityType, payload, userId, role, session }) {
  const Model = entityType === "subscription" ? SubscriptionDay : Order;
  const doc = await Model.findById(entityId).session(session);
  if (!doc) throw new Error("Entity not found");

  let toStatus = entityType === "subscription" ? "delivery_canceled" : "canceled";
  if (entityType === "subscription") {
    const sub = await Subscription.findById(doc.subscriptionId).session(session).lean();
    if (sub && sub.deliveryMode === "pickup") {
      toStatus = payload && payload.noShow ? "no_show" : "canceled_at_branch";
    }
  }
  if (doc.status === toStatus) {
    return { data: doc, idempotent: true };
  }

  const fromStatus = doc.status;
  validateTransition(entityType, fromStatus, toStatus);
  doc.status = toStatus;
  doc.canceledAt = new Date();
  doc.canceledBy = String(userId || "");
  doc.cancellationReason = payload.reason;
  doc.cancellationNote = payload.notes || payload.note;
  appendOperationAudit(doc, "cancel", userId, role);
  await doc.save({ session });
  if (entityType === "subscription") {
    await writeSubscriptionDayAudit({ day: doc, action: "cancel", fromStatus, toStatus, userId, role, payload, session });
  }

  // Sync Delivery
  await Delivery.updateOne(
    { [entityType === "subscription" ? "dayId" : "orderId"]: entityId },
    { 
      $set: { 
        status: "canceled", 
        canceledAt: new Date(),
        cancellationReason: payload.reason,
        cancellationNote: payload.note,
        canceledByUserId: userId
      } 
    },
    { session }
  );

  return {
    data: doc,
    sideEffects: {
      action: "cancel",
      entityType,
      entityId,
      toStatus,
    },
  };
}

async function handleReopen({ entityId, entityType, userId, role, payload, session }) {
  const Model = entityType === "subscription" ? SubscriptionDay : Order;
  const doc = await Model.findById(entityId).session(session);
  if (!doc) throw new Error("Entity not found");

  const fromStatus = doc.status;
  const toStatus = entityType === "subscription" ? "open" : "confirmed";
  if (fromStatus === toStatus) {
    return { data: doc, idempotent: true };
  }
  validateTransition(entityType, fromStatus, toStatus);

  doc.status = toStatus;
  if (entityType === "subscription") {
    doc.canceledAt = null;
    doc.canceledBy = null;
    doc.cancellationReason = null;
    doc.cancellationNote = null;
    doc.pickupNoShowAt = null;
    appendOperationAudit(doc, "reopen", userId, role);
  }
  await doc.save({ session });

  if (entityType === "subscription") {
    await writeSubscriptionDayAudit({ day: doc, action: "reopen", fromStatus, toStatus, userId, role, payload, session });
  }

  return {
    data: doc,
    sideEffects: { action: "reopen", entityType, entityId, toStatus },
  };
}

async function handleNotifyArrival({ entityId, entityType, session }) {
  const query = entityType === "subscription" ? { dayId: entityId } : { orderId: entityId };
  const delivery = await Delivery.findOne(query).session(session);
  if (!delivery) throw new Error("Delivery record not found");

  delivery.arrivingSoonReminderSentAt = new Date();
  await delivery.save({ session });

  return {
    data: { deliveryId: delivery._id, sentAt: delivery.arrivingSoonReminderSentAt },
    sideEffects: {
      action: "notify_arrival",
      entityType,
      entityId,
    },
  };
}

// Utility Helpers
function validateTransition(type, from, to) {
  const allowed = type === "subscription" ? canTransition(from, to) : canOrderTransition(from, to);
  if (!allowed) {
    throw new Error("INVALID_STATE_TRANSITION");
  }
}

async function triggerSideEffects(effects, { userId, role }) {
  try {
    const { action, entityType, entityId, toStatus } = effects;

    // 1. Logging
    await writeLog({
      entityType,
      entityId,
      action: `dashboard_${action}`,
      byUserId: userId,
      byRole: role,
      meta: { toStatus },
    });

    // 2. Notifications
    if (entityType === "subscription") {
      const day = await SubscriptionDay.findById(entityId).lean();
      const sub = await Subscription.findById(day.subscriptionId).lean();
      if (sub && action === "dispatch") {
        await notifyUser(sub.userId, {
          title: "الطلب في الطريق",
          body: "طلبك سيصل خلال وقت قصير",
        });
      }
    } else {
      const order = await Order.findById(entityId).lean();
      if (["dispatch", "fulfill"].includes(action)) {
        await notifyOrderUser({ order, type: toStatus });
      }
    }
  } catch (err) {
    logger.error("Side effect failed", { error: err.message, effects });
  }
}

module.exports = {
  executeAction,
};
