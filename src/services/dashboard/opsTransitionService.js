const crypto = require("node:crypto");
const mongoose = require("mongoose");
const SubscriptionDay = require("../../models/SubscriptionDay");
const Order = require("../../models/Order");
const Delivery = require("../../models/Delivery");
const Subscription = require("../../models/Subscription");
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
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    let result;
    switch (actionId) {
      case "prepare":
        result = await handlePrepare({ entityId, entityType, userId, role, session });
        break;
      case "dispatch":
        result = await handleDispatch({ entityId, entityType, userId, role, payload, session });
        break;
      case "ready_for_pickup":
        result = await handleReadyForPickup({ entityId, entityType, userId, role, session });
        break;
      case "fulfill":
        result = await handleFulfill({ entityId, entityType, userId, role, payload, session });
        break;
      case "cancel":
        result = await handleCancel({ entityId, entityType, userId, role, payload, session });
        break;
      case "reopen":
        result = await handleReopen({ entityId, entityType, userId, role, session });
        break;
      case "notify_arrival":
        result = await handleNotifyArrival({ entityId, entityType, userId, role, session });
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

async function handlePrepare({ entityId, entityType, session }) {
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

  validateTransition(entityType, doc.status, toStatus);

  doc.status = toStatus;
  if (entityType === "subscription" && !doc.pickupPreparationStartedAt) {
    doc.pickupPreparationStartedAt = new Date();
  }
  if (entityType === "order" && !doc.confirmedAt) doc.confirmedAt = new Date();
  await doc.save({ session });

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

async function handleDispatch({ entityId, entityType, payload, session }) {
  const Model = entityType === "subscription" ? SubscriptionDay : Order;
  const doc = await Model.findById(entityId).session(session);
  if (!doc) throw new Error("Entity not found");

  const toStatus = "out_for_delivery";
  if (doc.status === toStatus) {
    return { data: doc, idempotent: true };
  }

  validateTransition(entityType, doc.status, toStatus);

  doc.status = toStatus;
  await doc.save({ session });

  // Sync Delivery SoT
  const deliveryData = {
    status: "out_for_delivery",
    etaAt: payload.etaAt ? new Date(payload.etaAt) : undefined,
  };

  if (entityType === "subscription") {
    const sub = await Subscription.findById(doc.subscriptionId).session(session).lean();
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

async function handleFulfill({ entityId, entityType, payload, userId, session }) {
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

    const result = await fulfillSubscriptionDay({ dayId: entityId, session });
    if (!result.ok) throw new Error(result.message || "Fulfillment failed");
    
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

async function handleReadyForPickup({ entityId, entityType, session }) {
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
  validateTransition(entityType, doc.status, toStatus);

  doc.status = toStatus;
  if (entityType === "subscription") {
    doc.pickupPreparedAt = new Date();
    doc.pickupCode = String(crypto.randomInt(100000, 999999));
    doc.pickupCodeIssuedAt = new Date();
  }
  await doc.save({ session });

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

async function handleCancel({ entityId, entityType, payload, userId, session }) {
  const Model = entityType === "subscription" ? SubscriptionDay : Order;
  const doc = await Model.findById(entityId).session(session);
  if (!doc) throw new Error("Entity not found");

  const toStatus = entityType === "subscription" ? "delivery_canceled" : "canceled";
  if (doc.status === toStatus) {
    return { data: doc, idempotent: true };
  }

  doc.status = toStatus;
  doc.canceledAt = new Date();
  doc.canceledBy = String(userId || "");
  doc.cancellationReason = payload.reason;
  doc.cancellationNote = payload.note;
  await doc.save({ session });

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
    throw new Error(`Invalid state transition from ${from} to ${to}`);
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
