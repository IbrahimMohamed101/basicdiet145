const mongoose = require("mongoose");
const Delivery = require("../models/Delivery");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const Order = require("../models/Order");
const User = require("../models/User");
const { getTodayKSADate } = require("../utils/date");
const { writeLog } = require("../utils/log");
const { mapSubscriptionDelivery, mapOneTimeOrderDelivery } = require("../mappers/deliveryMapper");
const { notifyUser } = require("../utils/notify");
const { sendUserNotificationWithDedupe } = require("../services/notificationService");
const { fulfillSubscriptionDay } = require("../services/fulfillmentService");
const {
  canSendArrivingSoonReminder,
  isDeliveryCanceledStatus,
  isDeliveryDeliveredStatus,
  normalizeDeliveryStatus,
  parseDeliveryCancellationInput,
} = require("../services/deliveryWorkflowService");
const { logger } = require("../utils/logger");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");
const { resolveOptionalPagination, buildPaginationMeta } = require("../utils/optionalPagination");
const opsTransitionService = require("../services/dashboard/opsTransitionService");
const { ACTION_REGISTRY } = require("../services/dashboard/opsActionPolicy");
const { resolveEffectiveFulfillmentMode } = require("../services/subscription/subscriptionFulfillmentPolicyService");

async function executeCanonicalDeliveryAction(req, res, action, payload = {}) {
  if (!req.userRole) {
    return res.status(403).json({
      ok: false,
      status: false,
      message: "Forbidden",
      messageAr: "غير مصرح بتنفيذ هذا الإجراء",
      error: { code: "FORBIDDEN", message: "Forbidden" }
    });
  }
  const allowedRoles = (ACTION_REGISTRY[action] && ACTION_REGISTRY[action].roles) || ["superadmin", "admin", "courier"];
  if (!allowedRoles.includes(req.userRole)) {
    return res.status(403).json({
      ok: false,
      status: false,
      message: "Forbidden",
      messageAr: "غير مصرح بتنفيذ هذا الإجراء",
      error: { code: "FORBIDDEN", message: "Forbidden" }
    });
  }
  const delivery = await Delivery.findById(req.params.id);
  if (!delivery) return errorResponse(res, 404, "NOT_FOUND", "Delivery not found");
  try {
    await opsTransitionService.executeAction(action, {
      entityId: delivery.dayId,
      entityType: "subscription",
      userId: req.dashboardUserId || req.userId,
      role: req.userRole,
      payload,
    });
    const updatedDelivery = await Delivery.findById(delivery._id);
    const sub = await Subscription.findById(delivery.subscriptionId).lean();
    const user = sub && sub.userId ? await User.findById(sub.userId).select("name phone").lean() : null;
    return res.status(200).json({ status: true, data: mapSubscriptionDelivery(updatedDelivery || delivery, user) });
  } catch (err) {
    return errorResponse(res, err.status || 409, err.code || "INVALID_TRANSITION", err.message || "Invalid state transition");
  }
}

function appendDeliveryCancellationAudit(day, actorId) {
  if (!day) return;
  if (!Array.isArray(day.operationAuditLog)) {
    day.operationAuditLog = [];
  }
  day.operationAuditLog.push({
    action: "delivery_canceled",
    by: String(actorId || ""),
    at: new Date(),
  });
}

async function listTodayDeliveries(req, res) {
  if (!req.userRole) {
    return res.status(403).json({
      ok: false,
      status: false,
      message: "Forbidden",
      messageAr: "غير مصرح بتنفيذ هذا الإجراء",
      error: { code: "FORBIDDEN", message: "Forbidden" }
    });
  }
  try {
    const today = getTodayKSADate();

    // 1. Get Delivery Subscriptions
    const deliverySubs = await Subscription.find({ deliveryMode: "delivery" }).lean();
    const deliverySubIds = deliverySubs.map(s => s._id);
    const subMap = new Map(deliverySubs.map(s => [String(s._id), s]));

    // 2. Get Subscription Days
    const allDayDocs = await SubscriptionDay.find({
      date: today,
      subscriptionId: { $in: deliverySubIds }
    }).lean();
    const dayDocs = allDayDocs.filter((day) => {
      const sub = subMap.get(String(day.subscriptionId));
      return resolveEffectiveFulfillmentMode({ subscription: sub || {}, day, date: day.date }) === "delivery";
    });
    const dayIds = dayDocs.map(d => d._id);

    // 3. Get One-Time Orders
    const orders = await Order.find({
      $or: [{ fulfillmentDate: today }, { deliveryDate: today }],
      $or: [{ fulfillmentMethod: "delivery" }, { deliveryMode: "delivery" }],
      paymentStatus: "paid",
      status: { $nin: ["pending_payment", "failed_payment", "expired", "refunded"] }
    }).lean();
    const orderIds = orders.map(o => o._id);

    // 4. Gather Users
    const subUserIds = deliverySubs.map(s => String(s.userId));
    const orderUserIds = orders.map(o => String(o.userId));
    const userIds = [...new Set([...subUserIds, ...orderUserIds].filter(Boolean))];
    const users = userIds.length ? await User.find({ _id: { $in: userIds } }).select("name phone").lean() : [];
    const userMap = new Map(users.map(u => [String(u._id), u]));

    // 5. Get existing Delivery records
    const deliveries = await Delivery.find({
      $or: [
        { dayId: { $in: dayIds } },
        { orderId: { $in: orderIds } }
      ]
    }).lean();
    const deliveryByDayId = new Map(deliveries.filter(d => d.dayId).map(d => [String(d.dayId), d]));
    const deliveryByOrderId = new Map(deliveries.filter(d => d.orderId).map(d => [String(d.orderId), d]));

    // 6. Map Subscription Days
    const mappedDays = dayDocs.map(day => {
      const sub = subMap.get(String(day.subscriptionId));
      let deliveryRecord = deliveryByDayId.get(String(day._id));
      if (!deliveryRecord) {
        deliveryRecord = {
          _id: day._id,
          subscriptionId: sub._id,
          dayId: day,
          date: day.date,
          address: (day.lockedSnapshot && day.lockedSnapshot.address) || day.deliveryAddressOverride || (sub && sub.deliveryAddress),
          window: (day.lockedSnapshot && day.lockedSnapshot.deliveryWindow) || day.deliveryWindowOverride || (sub && sub.deliveryWindow),
          zoneName: (day.lockedSnapshot && day.lockedSnapshot.zoneName) || null,
          status: "preparing",
          cancellationReason: day.cancellationReason,
          cancellationNote: day.cancellationNote,
          canceledAt: day.canceledAt,
          deliveredAt: day.fulfilledAt
        };
      } else {
        deliveryRecord.dayId = day;
      }
      const user = userMap.get(String(sub && sub.userId));
      return mapSubscriptionDelivery(deliveryRecord, user);
    });

    // 7. Map Orders
    const mappedOrders = orders.map(order => {
      const user = userMap.get(String(order.userId));
      const deliveryRecord = deliveryByOrderId.get(String(order._id));
      return mapOneTimeOrderDelivery(order, user, deliveryRecord);
    });

    const allMapped = [...mappedDays, ...mappedOrders];
    allMapped.sort((a, b) => {
      const dateA = a.timestamps && a.timestamps.scheduledAt ? new Date(a.timestamps.scheduledAt).getTime() : 0;
      const dateB = b.timestamps && b.timestamps.scheduledAt ? new Date(b.timestamps.scheduledAt).getTime() : 0;
      return dateB - dateA;
    });

    const pagination = resolveOptionalPagination(req.query, 300, 50);
    if (!pagination) {
      return res.status(200).json({ status: true, data: allMapped });
    }

    const skip = (pagination.page - 1) * pagination.limit;
    const paginatedData = allMapped.slice(skip, skip + pagination.limit);

    return res.status(200).json({
      status: true,
      data: paginatedData,
      meta: buildPaginationMeta(pagination.page, pagination.limit, allMapped.length),
    });
  } catch (err) {
    // MEDIUM AUDIT FIX: Express 4 does not catch async errors automatically; return controlled 500.
    logger.error("courierController.listTodayDeliveries failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Failed to list deliveries");
  }
}

async function markArrivingSoon(req, res) {
  return executeCanonicalDeliveryAction(req, res, "notify_arrival");
  /* Historical implementation retained below for reference. */
  try {
    const { id } = req.params;
    try {
      validateObjectId(id, "id");
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }

    const delivery = await Delivery.findById(id);
    if (!delivery) {
      return errorResponse(res, 404, "NOT_FOUND", "Delivery not found");
    }
    if (!canSendArrivingSoonReminder(delivery.status) || isDeliveryCanceledStatus(delivery.status) || isDeliveryDeliveredStatus(delivery.status)) {
      return errorResponse(res, 409, "INVALID_TRANSITION", "Invalid state transition");
    }

    if (delivery.arrivingSoonReminderSentAt) {
      return res.status(200).json({
        status: true,
        deduped: true,
        data: {
          deliveryId: String(delivery._id),
          status: normalizeDeliveryStatus(delivery.status),
          reminderSentAt: delivery.arrivingSoonReminderSentAt,
        },
      });
    }
    const reminderSentAt = new Date();
    const updated = await Delivery.findOneAndUpdate(
      {
        _id: id,
        arrivingSoonReminderSentAt: null,
        status: { $nin: ["delivered", "canceled"] },
      },
      { $set: { arrivingSoonReminderSentAt: reminderSentAt } },
      { new: true }
    );
    const targetDelivery = updated || delivery;
    const sub = await Subscription.findById(targetDelivery.subscriptionId).lean();
    let user = null;
    if (sub && sub.userId) {
      user = await User.findById(sub.userId).select("name phone").lean();
    }

    if (!updated) {
      return res.status(200).json({
        status: true,
        deduped: true,
        data: mapSubscriptionDelivery(targetDelivery, user),
      });
    }

    await writeLog({
      entityType: "delivery",
      entityId: updated._id,
      action: "arriving_soon",
      byUserId: req.userId,
      byRole: req.userRole,
      meta: { deliveryId: updated._id },
    });
    if (sub) {
      await notifyUser(sub.userId, {
        title: "الطلب في الطريق",
        body: "طلبك سيصل خلال وقت قصير",
        data: { deliveryId: String(updated._id) },
      });
    }
    return res.status(200).json({
      status: true,
      data: mapSubscriptionDelivery(targetDelivery, user),
    });
  } catch (err) {
    // MEDIUM AUDIT FIX: Express 4 does not catch async errors automatically; return controlled 500.
    logger.error("courierController.markArrivingSoon failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Arriving soon update failed");
  }
}

async function markDelivered(req, res) {
  return executeCanonicalDeliveryAction(req, res, "fulfill");
  /* Historical implementation retained below for reference. */
  try {
    const { id } = req.params;
    try {
      validateObjectId(id, "id");
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }

    const delivery = await Delivery.findById(id);
    if (!delivery) {
      return errorResponse(res, 404, "NOT_FOUND", "Delivery not found");
    }

    if (isDeliveryDeliveredStatus(delivery.status)) {
      const sub = await Subscription.findById(delivery.subscriptionId).lean();
      let user = null;
      if (sub && sub.userId) {
        user = await User.findById(sub.userId).select("name phone").lean();
      }
      return res.status(200).json({
        status: true,
        idempotent: true,
        data: mapSubscriptionDelivery(delivery, user),
      });
    }
    if (isDeliveryCanceledStatus(delivery.status)) {
      return errorResponse(res, 409, "ALREADY_CANCELED", "Cannot deliver a canceled delivery");
    }

    const session = await mongoose.startSession();
    let result;
    let deliveredAt = null;
    try {
      session.startTransaction();
      result = await fulfillSubscriptionDay({ dayId: delivery.dayId, session });
      if (!result.ok) {
        await session.abortTransaction();
        session.endSession();
        const status =
          result.code === "NOT_FOUND" ? 404 :
            result.code === "INSUFFICIENT_CREDITS" ? 400 :
              result.code === "INVALID_TRANSITION" ? 409 :
                400;
        return errorResponse(res, status, result.code, result.message);
      }

      delivery.status = "delivered";
      deliveredAt = new Date();
      delivery.deliveredAt = deliveredAt;
      await delivery.save({ session });

      await session.commitTransaction();
      session.endSession();
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }

    // MEDIUM AUDIT FIX: Keep non-transactional side effects strictly after commit, never inside transaction rollback paths.
    try {
      await writeLog({
        entityType: "delivery",
        entityId: delivery._id,
        action: "delivered",
        byUserId: req.userId,
        byRole: req.userRole,
        meta: { deductedCredits: result.deductedCredits, subscriptionId: delivery.subscriptionId },
      });
    } catch (err) {
      logger.error("Delivery log write failed", { error: err.message, stack: err.stack, deliveryId: String(delivery._id) });
    }

    try {
      const sub = await Subscription.findById(delivery.subscriptionId).lean();
      if (sub) {
        const dispatch = await sendUserNotificationWithDedupe({
          userId: sub.userId,
          title: "Delivery Update",
          body: "Your order has been delivered successfully.",
          data: { deliveryId: String(delivery._id) },
          type: "delivered",
          dedupeKey: `delivery:${delivery._id}:delivered`,
          entityType: "delivery",
          entityId: delivery._id,
          scheduledFor: new Date(),
        });

        if (dispatch.status === "sent" || dispatch.status === "no_tokens" || dispatch.status === "duplicate") {
          await Delivery.updateOne(
            { _id: delivery._id, status: "delivered", deliveredNotificationSentAt: null },
            { $set: { deliveredNotificationSentAt: new Date() } }
          );
        }
      }
    } catch (err) {
      logger.error("Delivery notification failed", { error: err.message, stack: err.stack, deliveryId: String(delivery._id) });
    }

    const subDoc = await Subscription.findById(delivery.subscriptionId).lean();
    let userDoc = null;
    if (subDoc && subDoc.userId) {
      userDoc = await User.findById(subDoc.userId).select("name phone").lean();
    }

    return res.status(200).json({
      status: true,
      data: mapSubscriptionDelivery(delivery, userDoc),
      alreadyFulfilled: Boolean(result && result.alreadyFulfilled),
    });
  } catch (err) {
    // MEDIUM AUDIT FIX: Express 4 does not catch async errors automatically; return controlled 500.
    logger.error("courierController.markDelivered failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Delivery confirmation failed");
  }
}

async function markCancelled(req, res) {
  if (!req.userRole) {
    return res.status(403).json({
      ok: false,
      status: false,
      message: "Forbidden",
      messageAr: "غير مصرح بتنفيذ هذا الإجراء",
      error: { code: "FORBIDDEN", message: "Forbidden" }
    });
  }
  let canonicalCancellation;
  try {
    canonicalCancellation = parseDeliveryCancellationInput(req.body || {});
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  return executeCanonicalDeliveryAction(req, res, "cancel", {
    reason: canonicalCancellation.reason,
    note: canonicalCancellation.note,
    cancellationCategory: canonicalCancellation.category,
  });
  /* Historical implementation retained below for reference. */
  try {
    const { id } = req.params;
    try {
      validateObjectId(id, "id");
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }

    const delivery = await Delivery.findById(id);
    if (!delivery) {
      return errorResponse(res, 404, "NOT_FOUND", "Delivery not found");
    }

    if (isDeliveryCanceledStatus(delivery.status)) {
      const sub = await Subscription.findById(delivery.subscriptionId).lean();
      let user = null;
      if (sub && sub.userId) {
        user = await User.findById(sub.userId).select("name phone").lean();
      }
      return res.status(200).json({
        status: true,
        idempotent: true,
        data: mapSubscriptionDelivery(delivery, user),
      });
    }
    if (isDeliveryDeliveredStatus(delivery.status)) {
      return errorResponse(res, 400, "ALREADY_DELIVERED", "Cannot cancel delivered order");
    }

    let cancellation;
    try {
      cancellation = parseDeliveryCancellationInput(req.body || {});
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }

    const session = await mongoose.startSession();
    let sub;
    let day;
    let canceledAt = null;
    try {
      session.startTransaction();
      sub = await Subscription.findById(delivery.subscriptionId).session(session).lean();
      if (!sub) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
      }

      day = await SubscriptionDay.findById(delivery.dayId).session(session);
      if (!day) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 404, "NOT_FOUND", "Day not found");
      }
      if (day.status === "fulfilled") {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 400, "ALREADY_FULFILLED", "Cannot cancel fulfilled order");
      }
      if (day.status === "delivery_canceled") {
        await session.commitTransaction();
        session.endSession();
        
        let user = null;
        if (sub && sub.userId) {
          user = await User.findById(sub.userId).select("name phone").lean();
        }
        return res.status(200).json({
          status: true,
          idempotent: true,
          data: mapSubscriptionDelivery(delivery, user),
        });
      }
      if (day.status !== "out_for_delivery" && day.status !== "ready_for_delivery") {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 409, "INVALID_TRANSITION", "Only ready or dispatched deliveries can be canceled");
      }

      day.status = "delivery_canceled";
      day.pickupRequested = false;
      day.cancellationReason = cancellation.reason;
      day.cancellationCategory = cancellation.category;
      day.cancellationNote = cancellation.note;
      day.canceledAt = new Date();
      day.canceledBy = String(req.dashboardUserId || req.userId || "");
      appendDeliveryCancellationAudit(day, req.dashboardUserId || req.userId);
      await day.save({ session });

      canceledAt = day.canceledAt;
      delivery.status = "canceled";
      delivery.canceledAt = canceledAt;
      delivery.cancellationReason = cancellation.reason;
      delivery.cancellationCategory = cancellation.category;
      delivery.cancellationNote = cancellation.note;
      delivery.canceledByRole = req.userRole || null;
      delivery.canceledByUserId = req.dashboardUserId || req.userId || null;
      await delivery.save({ session });

      await session.commitTransaction();
      session.endSession();
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }

    // MEDIUM AUDIT FIX: Keep non-transactional side effects strictly after commit, never inside transaction rollback paths.
    try {
      await writeLog({
        entityType: "delivery",
        entityId: delivery._id,
        action: "canceled",
        byUserId: req.userId,
        byRole: req.userRole,
        meta: {
          subscriptionId: delivery.subscriptionId,
          subscriptionDayId: day ? String(day._id) : null,
          reason: cancellation.reason,
          category: cancellation.category,
          note: cancellation.note,
          canceledAt,
          canceledBy: day ? day.canceledBy : String(req.dashboardUserId || req.userId || ""),
        },
      });
    } catch (err) {
      logger.error("Delivery cancellation log write failed", { error: err.message, stack: err.stack, deliveryId: String(delivery._id) });
    }

    try {
      if (sub) {
        await notifyUser(sub.userId, {
          title: "Delivery Update",
          body: "Your delivery has been canceled.",
          data: {
            deliveryId: String(delivery._id),
            type: "canceled",
          },
        });
      }
    } catch (err) {
      logger.error("Delivery cancellation notification failed", { error: err.message, stack: err.stack, deliveryId: String(delivery._id) });
    }

    let userDoc = null;
    if (sub && sub.userId) {
      userDoc = await User.findById(sub.userId).select("name phone").lean();
    }
    return res.status(200).json({
      status: true,
      data: mapSubscriptionDelivery(delivery, userDoc),
    });
  } catch (err) {
    // MEDIUM AUDIT FIX: Express 4 does not catch async errors automatically; return controlled 500.
    logger.error("courierController.markCancelled failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Delivery cancellation failed");
  }
}

async function markPickup(req, res) {
  if (!req.userRole) {
    return res.status(403).json({
      ok: false,
      status: false,
      message: "Forbidden",
      messageAr: "غير مصرح بتنفيذ هذا الإجراء",
      error: { code: "FORBIDDEN", message: "Forbidden" }
    });
  }
  const allowedRoles = (ACTION_REGISTRY["pickup"] && ACTION_REGISTRY["pickup"].roles) || ["superadmin", "admin", "courier"];
  if (!allowedRoles.includes(req.userRole)) {
    return res.status(403).json({
      ok: false,
      status: false,
      message: "Forbidden",
      messageAr: "غير مصرح بتنفيذ هذا الإجراء",
      error: { code: "FORBIDDEN", message: "Forbidden" }
    });
  }
  try {
    const { id } = req.params;
    try {
      validateObjectId(id, "id");
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }

    const delivery = await Delivery.findById(id);
    if (!delivery) {
      return errorResponse(res, 404, "NOT_FOUND", "Delivery not found");
    }

    if (delivery.status === "out_for_delivery") {
      const sub = await Subscription.findById(delivery.subscriptionId).lean();
      let user = null;
      if (sub && sub.userId) {
        user = await User.findById(sub.userId).select("name phone").lean();
      }
      return res.status(200).json({
        status: true,
        idempotent: true,
        data: mapSubscriptionDelivery(delivery, user),
      });
    }

    if (delivery.status === "canceled") {
      return errorResponse(res, 409, "ALREADY_CANCELED", "Cannot pickup a canceled delivery");
    }
    if (delivery.status === "delivered") {
      return errorResponse(res, 409, "ALREADY_DELIVERED", "Cannot pickup a delivered delivery");
    }

    if (delivery.status !== "ready_for_delivery") {
      return errorResponse(res, 409, "INVALID_STATE", "Delivery is not ready for collection yet");
    }

    const opsTransitionService = require("../services/dashboard/opsTransitionService");
    await opsTransitionService.executeAction("dispatch", {
      entityId: String(delivery.dayId),
      entityType: "subscription",
      userId: req.userId,
      role: req.userRole,
      payload: {},
    });

    const updatedDelivery = await Delivery.findById(id);
    const sub = await Subscription.findById(updatedDelivery.subscriptionId).lean();
    let user = null;
    if (sub && sub.userId) {
      user = await User.findById(sub.userId).select("name phone").lean();
    }

    return res.status(200).json({
      status: true,
      data: mapSubscriptionDelivery(updatedDelivery, user),
    });
  } catch (err) {
    if (err.message === "INVALID_STATE_TRANSITION") {
      return errorResponse(res, 409, "INVALID_TRANSITION", "Invalid state transition");
    }
    logger.error("courierController.markPickup failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Pickup update failed");
  }
}

module.exports = {
  listTodayDeliveries,
  markArrivingSoon,
  markDelivered,
  markCancelled,
  markPickup,
  markCollect: markPickup,
};
