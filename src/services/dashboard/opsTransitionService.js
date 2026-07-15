const crypto = require("node:crypto");
const mongoose = require("mongoose");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const Order = require("../../models/Order");
const Delivery = require("../../models/Delivery");
const Subscription = require("../../models/Subscription");
const SubscriptionAuditLog = require("../../models/SubscriptionAuditLog");
const { fulfillSubscriptionDay, fulfillSubscriptionPickupRequest } = require("../fulfillmentService");
const { ORDER_STATUSES } = require("../../utils/orderState");
const { canTransitionStatus } = require("./opsTransitionPolicy");
const { writeLog } = require("../../utils/log");
const { notifyUser } = require("../../utils/notify");
const { notifyOrderUser } = require("../orderNotificationService");
const { logger } = require("../../utils/logger");
const {
  shouldBlockOneTimeOrderDelivery,
  createOneTimeOrderDeliveryDisabledError,
} = require("../../utils/oneTimeOrderDeliveryGate");
const {
  consumeReservedPickupMeals,
  releaseReservedPickupMeals,
} = require("../subscription/subscriptionPickupRequestBalanceService");
const {
  assertAdminSubscriptionAccess,
} = require("../subscription/subscriptionAccessGuardService");
const { lockDaySnapshot } = require("../subscription/subscriptionDayOperationalSnapshotService");
const { validateDayBeforeLockOrPrepare } = require("../subscription/subscriptionDayExecutionValidationService");
const dateUtils = require("../../utils/date");
const { runMongoTransactionWithRetry } = require("../mongoTransactionRetryService");
const { resolveEffectiveFulfillmentMode } = require("../subscription/subscriptionFulfillmentPolicyService");
const {
  releaseAddonBalanceAtomically,
  assertAddonBalanceReleaseSucceeded,
  consumeAddonBalanceAtomically,
  releasePremiumBalanceAtomically,
  consumePremiumBalanceAtomically,
} = require("../subscription/subscriptionSelectionService");

/**
 * Unified Operations Transition Service.
 * Handles state changes for both SubscriptionDays and Orders.
 */

async function executeAction(actionId, { entityId, entityType, userId, role, payload = {} }) {
  // Phase 5: Admin role check for admin-specific operations only
  // Courier role is allowed for dispatch operations
  const adminOnlyActions = ["lock", "reopen"];
  const normalizedActionId = actionId === "start_preparation"
    ? "prepare"
    : actionId === "ready-for-pickup"
      ? "ready_for_pickup"
      : actionId === "ready-for-delivery"
        ? "ready_for_delivery"
        : (actionId === "pickup" || actionId === "collect")
          ? "dispatch"
          : actionId;

  if (adminOnlyActions.includes(normalizedActionId) && !["admin", "superadmin"].includes(String(role || ""))) {
    const err = new Error("Dashboard admin permission is required");
    err.code = "FORBIDDEN";
    err.status = 403;
    throw err;
  }

  const normalizedEntityType = entityType === "subscription_day" || entityType === "pickup_day"
    ? "subscription"
    : entityType;

  const result = await runMongoTransactionWithRetry(async (session, { attempt }) => {
    const Model = normalizedEntityType === "subscription_pickup_request"
      ? SubscriptionPickupRequest
      : normalizedEntityType === "subscription"
        ? SubscriptionDay
        : Order;

    const targetDoc = await Model.findById(entityId).session(session).lean();
    if (!targetDoc) throw new Error("Entity not found");

    const targetBusinessDate = targetDoc.date || targetDoc.fulfillmentDate || targetDoc.deliveryDate || targetDoc.scheduledDate || targetDoc.pickupDate || targetDoc.serviceDate;
    if (!targetBusinessDate) {
      logger.warn("Target operational document has no date field; not eligible for historical mutation guard", { entityId, entityType, actionId });
    } else {
      const currentKSABusinessDate = dateUtils.getTodayKSADate();
      if (targetBusinessDate < currentKSABusinessDate) {
        let isIdempotentReplay = false;
        if (normalizedActionId === "fulfill" && targetDoc.status === "fulfilled") isIdempotentReplay = true;
        if (normalizedActionId === "no_show" && targetDoc.status === "no_show") isIdempotentReplay = true;
        if (normalizedActionId === "cancel" && ["canceled", "cancelled", "delivery_canceled", "canceled_at_branch", "no_show"].includes(targetDoc.status)) isIdempotentReplay = true;

        const isPrivilegedNoShow = normalizedActionId === "no_show" && ["admin", "superadmin", "kitchen"].includes(String(role || ""));

        if (!isIdempotentReplay && !isPrivilegedNoShow) {
          const err = new Error("Historical operational records cannot be modified");
          err.code = "HISTORICAL_MUTATION_FORBIDDEN";
          err.status = 409;
          throw err;
        }
      }
    }

    if (normalizedEntityType === "order") {
      const order = targetDoc;
      if (shouldBlockOneTimeOrderDelivery(order)) {
        throw createOneTimeOrderDeliveryDisabledError();
      }
    }
    let resObj;
    switch (normalizedActionId) {
      case "lock":
        resObj = await handleLock({ entityId, entityType: normalizedEntityType, userId, role, payload, session });
        break;
      case "prepare":
        resObj = await handlePrepare({ entityId, entityType: normalizedEntityType, userId, role, payload, session });
        break;
      case "ready_for_delivery":
        resObj = await handleReadyForDelivery({ entityId, entityType: normalizedEntityType, userId, role, payload, session });
        break;
      case "dispatch":
        resObj = await handleDispatch({ entityId, entityType: normalizedEntityType, userId, role, payload, session });
        break;
      case "ready_for_pickup":
        resObj = await handleReadyForPickup({ entityId, entityType: normalizedEntityType, userId, role, payload, session });
        break;
      case "fulfill":
        resObj = await handleFulfill({ entityId, entityType: normalizedEntityType, userId, role, payload, session });
        break;
      case "cancel":
        resObj = await handleCancel({ entityId, entityType: normalizedEntityType, userId, role, payload, session });
        break;
      case "no_show":
        resObj = await handleNoShow({ entityId, entityType: normalizedEntityType, userId, role, payload, session });
        break;
      case "reopen":
        resObj = await handleReopen({ entityId, entityType: normalizedEntityType, userId, role, payload, session });
        break;
      case "notify_arrival":
        resObj = await handleNotifyArrival({ entityId, entityType: normalizedEntityType, userId, role, payload, session });
        break;
      default:
        throw new Error(`Unsupported action: ${actionId}`);
    }
    return resObj;
  }, {
    label: `ops_transition_${normalizedActionId}`,
    context: { action: normalizedActionId, entityType: normalizedEntityType, entityId: String(entityId), role: String(role || "") },
  });

  // Trigger post-transaction side effects (notifications/logs)
  if (result.sideEffects) {
    await triggerSideEffects(result.sideEffects, { userId, role });
  }

  return result.data;
}

function getEffectiveMode(subscription, day) {
  return resolveEffectiveFulfillmentMode({
    subscription: subscription || {},
    day,
    date: day && day.date,
  });
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

function appendPickupRequestAudit(doc, action, userId, role) {
  if (!doc || doc.constructor.modelName !== "SubscriptionPickupRequest") return;
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

async function handleLock({ entityId, entityType, userId, role, payload, session }) {
  if (entityType !== "subscription") {
    throw new Error("INVALID_STATE_TRANSITION");
  }

  const doc = await SubscriptionDay.findById(entityId).session(session);
  if (!doc) throw new Error("Entity not found");

  if (doc.status === "locked") {
    return { data: doc, idempotent: true };
  }

  const fromStatus = doc.status;
  const toStatus = "locked";
  validateTransition(entityType, fromStatus, toStatus);

  const subscription = await Subscription.findById(doc.subscriptionId).session(session);
  if (!subscription) throw new Error("Subscription not found");
  validateDayBeforeLockOrPrepare({ subscription, day: doc });
  await lockDaySnapshot(subscription, doc, session);

  doc.status = toStatus;
  doc.lockedAt = doc.lockedAt || new Date();
  appendOperationAudit(doc, "lock", userId, role);
  await doc.save({ session });
  await writeSubscriptionDayAudit({ day: doc, action: "lock", fromStatus, toStatus, userId, role, payload, session });

  return {
    data: doc,
    sideEffects: {
      action: "lock",
      entityType,
      entityId,
      toStatus,
    },
  };
}

async function handlePrepare({ entityId, entityType, userId, role, payload, session }) {
  if (entityType === "subscription_pickup_request") {
    const doc = await SubscriptionPickupRequest.findById(entityId).session(session);
    if (!doc) throw new Error("Entity not found");
    if (doc.status === "in_preparation") {
      return { data: doc, idempotent: true };
    }
    const fromStatus = doc.status;
    validateTransition(entityType, fromStatus, "in_preparation");
    doc.status = "in_preparation";
    const preparedAt = doc.preparationStartedAt || doc.pickupPreparedAt || new Date();
    doc.preparationStartedAt = doc.preparationStartedAt || preparedAt;
    doc.pickupPreparedAt = doc.pickupPreparedAt || preparedAt;
    appendPickupRequestAudit(doc, "prepare", userId, role);
    await doc.save({ session });
    return {
      data: doc,
      sideEffects: { action: "prepare", entityType, entityId, toStatus: "in_preparation" },
    };
  }

  const Model = entityType === "subscription" ? SubscriptionDay : Order;
  const doc = await Model.findById(entityId).session(session);
  if (!doc) throw new Error("Entity not found");

  const toStatus = entityType === "subscription" ? "in_preparation" : ORDER_STATUSES.IN_PREPARATION;
  if (doc.status === toStatus) {
    return { data: doc, idempotent: true };
  }

  if (entityType === "subscription") {
    await assertBranchPickupRequestExists(doc, session);
  } else {
    ensurePaidOrder(doc);
  }

  const fromStatus = doc.status;
  validateTransition(entityType, fromStatus, toStatus);
  if (entityType === "order") {
    ensurePaidOrder(doc);
  }

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

async function handleReadyForDelivery({ entityId, entityType, userId, role, payload, session }) {
  if (entityType !== "subscription") {
    throw new Error("INVALID_STATE_TRANSITION");
  }

  const doc = await SubscriptionDay.findById(entityId).session(session);
  if (!doc) throw new Error("Entity not found");

  const sub = await Subscription.findById(doc.subscriptionId).session(session).lean();
  if (!sub || getEffectiveMode(sub, doc) !== "delivery") {
    const err = new Error("Only applies to delivery subscriptions");
    err.code = "DELIVERY_MODE_REQUIRED";
    err.status = 400;
    throw err;
  }

  const toStatus = "ready_for_delivery";
  if (doc.status === toStatus) {
    return { data: doc, idempotent: true };
  }

  const fromStatus = doc.status;
  validateTransition(entityType, fromStatus, toStatus);

  doc.status = toStatus;
  appendOperationAudit(doc, "ready_for_delivery", userId, role);
  await doc.save({ session });

  // Sync Delivery SoT
  const deliveryData = {
    status: "ready_for_delivery",
  };

  await Delivery.updateOne(
    {
      $or: [
        { dayId: doc._id },
        { subscriptionId: sub._id, date: doc.date },
      ],
    },
    {
      $set: {
        ...deliveryData,
        subscriptionId: sub._id,
        dayId: doc._id,
        date: doc.date,
        address: doc.deliveryAddressOverride || sub.deliveryAddress,
        window: doc.deliveryWindowOverride || sub.deliveryWindow,
      },
    },
    { upsert: true, session }
  );

  await writeSubscriptionDayAudit({
    day: doc,
    action: "ready_for_delivery",
    fromStatus,
    toStatus,
    userId,
    role,
    payload,
    session,
  });

  return {
    data: doc,
    sideEffects: {
      action: "ready_for_delivery",
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

  if (entityType === "order") {
    const mode = String(doc.fulfillmentMethod || doc.deliveryMode || "").trim().toLowerCase();
    if (mode !== "delivery") {
      const err = new Error("Action requires delivery order");
      err.code = "INVALID_FULFILLMENT_METHOD";
      err.status = 409;
      throw err;
    }
  }

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
    if (!sub || getEffectiveMode(sub, doc) !== "delivery") throw new Error("INVALID_STATE_TRANSITION");
    await Delivery.updateOne(
      {
        $or: [
          { dayId: doc._id },
          { subscriptionId: sub._id, date: doc.date },
        ],
      },
      {
        $set: {
          ...deliveryData,
          subscriptionId: sub._id,
          dayId: doc._id,
          date: doc.date,
          address: doc.deliveryAddressOverride || sub.deliveryAddress,
          window: doc.deliveryWindowOverride || sub.deliveryWindow,
        },
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
  if (entityType === "subscription_pickup_request") {
    const doc = await SubscriptionPickupRequest.findById(entityId).session(session);
    if (!doc) throw new Error("Pickup request not found");
    if (doc.status === "fulfilled") {
      return { data: doc, idempotent: true };
    }
    if (doc.status !== "ready_for_pickup") {
      const err = new Error("Only ready pickup requests can be fulfilled");
      err.code = "INVALID_TRANSITION";
      err.status = 409;
      throw err;
    }
    const fromStatus = doc.status;
    validateTransition(entityType, fromStatus, "fulfilled");
    const result = await fulfillSubscriptionPickupRequest({ requestId: entityId, actorId: userId, session });
    if (!result.ok) {
      const err = new Error(result.message || "Fulfillment failed");
      err.code = result.code;
      throw err;
    }
    appendPickupRequestAudit(result.pickupRequest || doc, "fulfill", userId, role);
    if (result.pickupRequest && typeof result.pickupRequest.save === "function") {
      await result.pickupRequest.save({ session });
    }
    return {
      data: result.pickupRequest || doc,
      sideEffects: { action: "fulfill", entityType, entityId, toStatus: "fulfilled" },
    };
  }

  if (entityType === "subscription") {
    const day = await SubscriptionDay.findById(entityId).session(session);
    if (!day) throw new Error("Subscription day not found");
    if (day.status === "fulfilled") {
      return { data: day, idempotent: true };
    }

    const sub = await Subscription.findById(day.subscriptionId).session(session).lean();
    if (!sub) throw new Error("Subscription not found");
    if (getEffectiveMode(sub, day) === "pickup") {
      await assertBranchPickupRequestExists(day, session);
      if (!day.pickupVerifiedAt) {
        if (day.pickupCode) {
          if (!payload.pickupCode && !payload.code) {
            const err = new Error("Pickup verification is required before fulfillment");
            err.code = "PICKUP_VERIFICATION_REQUIRED";
            err.status = 409;
            throw err;
          }
          await verifyPickupCode(day._id, payload.pickupCode || payload.code, userId, session);
        } else {
          day.pickupVerifiedAt = new Date();
          day.pickupVerifiedByDashboardUserId = userId || null;
          await day.save({ session });
        }
      }
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

    ensurePaidOrder(order);
    validateTransition(entityType, order.status, "fulfilled");

    order.status = "fulfilled";
    order.fulfilledAt = new Date();
    if (order.deliveryMode === "pickup" && order.pickupCode && !order.pickupVerifiedAt) {
      order.pickupVerifiedAt = new Date();
      order.pickupVerifiedByDashboardUserId = userId;
    }
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
  if (entityType === "subscription_pickup_request") {
    const doc = await SubscriptionPickupRequest.findById(entityId).session(session);
    if (!doc) throw new Error("Entity not found");

    const toStatus = "ready_for_pickup";
    if (doc.status === toStatus) {
      return { data: doc, idempotent: true };
    }
    const fromStatus = doc.status;
    validateTransition(entityType, fromStatus, toStatus);
    doc.status = toStatus;
    doc.pickupCode = doc.pickupCode || String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    doc.pickupCodeIssuedAt = doc.pickupCodeIssuedAt || new Date();
    appendPickupRequestAudit(doc, "ready_for_pickup", userId, role);
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

  const Model = entityType === "subscription" ? SubscriptionDay : Order;
  const doc = await Model.findById(entityId).session(session);
  if (!doc) throw new Error("Entity not found");

  const toStatus = "ready_for_pickup";
  if (entityType === "subscription") {
    await assertBranchPickupRequestExists(doc, session);
  }
  const fromStatus = doc.status;
  if (entityType === "order") {
    ensurePaidOrder(doc);
  }
  validateTransition(entityType, fromStatus, toStatus);

  doc.status = toStatus;
  if (entityType === "subscription") {
    doc.pickupPreparedAt = new Date();
    doc.pickupCode = String(crypto.randomInt(100000, 999999));
    doc.pickupCodeIssuedAt = new Date();
  } else if (doc.deliveryMode === "pickup" || doc.fulfillmentMethod === "pickup") {
    const pickupCode = payload.pickupCode
      ? String(payload.pickupCode).trim()
      : (doc.pickupCode || (doc.pickup && doc.pickup.pickupCode) || String(crypto.randomInt(100000, 999999)));
    doc.pickupCode = pickupCode;
    doc.pickupCodeIssuedAt = doc.pickupCodeIssuedAt || new Date();
    doc.pickup = doc.pickup || {};
    doc.pickup.pickupCode = pickupCode;
    doc.pickup.readyAt = doc.pickup.readyAt || new Date();
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
  if (entityType === "subscription_pickup_request") {
    const doc = await SubscriptionPickupRequest.findById(entityId).session(session);
    if (!doc) throw new Error("Entity not found");
    if (doc.status === "canceled") {
      return { data: doc, idempotent: true };
    }
    const fromStatus = doc.status;
    validateTransition(entityType, fromStatus, "canceled");
    await releaseReservedPickupMeals({
      subscriptionId: doc.subscriptionId,
      pickupRequestId: doc._id,
      session,
    });

    doc.status = "canceled";
    doc.canceledAt = new Date();
    doc.canceledBy = String(userId || "");
    doc.cancellationReason = payload.reason;
    doc.cancellationNote = payload.notes || payload.note;
    appendPickupRequestAudit(doc, "cancel", userId, role);
    await doc.save({ session });
    return {
      data: doc,
      sideEffects: { action: "cancel", entityType, entityId, toStatus: "canceled" },
    };
  }

  const Model = entityType === "subscription" ? SubscriptionDay : Order;
  const doc = await Model.findById(entityId).session(session);
  if (!doc) throw new Error("Entity not found");

  let toStatus = entityType === "subscription" ? "delivery_canceled" : ORDER_STATUSES.CANCELLED;
  if (entityType === "subscription") {
    const sub = await Subscription.findById(doc.subscriptionId).session(session).lean();
    if (sub && getEffectiveMode(sub, doc) === "pickup") {
      toStatus = "canceled_at_branch";
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

  if (entityType === "order") {
    const roleStr = String(role || "").toLowerCase();
    const inputReason = String(payload.reason || "").trim();
    const reason = inputReason || "admin_cancelled";

    let cancellationReason = reason;
    let actorType = "admin";

    if (reason === "restaurant_rejected" || reason === "restaurant_cancelled") {
      actorType = "restaurant";
      cancellationReason = reason;
    } else if (roleStr === "kitchen") {
      actorType = "restaurant";
      cancellationReason = reason === "admin_cancelled" ? "restaurant_cancelled" : reason;
    } else {
      actorType = "admin";
      cancellationReason = reason === "stock_out" ? "restaurant_rejected" : reason;
    }

    doc.cancellationReason = cancellationReason;
    doc.cancellationActorType = actorType;
    doc.cancellationSource = "dashboard";
    doc.cancellationNote = payload.notes || payload.note || "";
  } else {
    doc.cancellationReason = payload.reason;
    doc.cancellationNote = payload.notes || payload.note;
  }

  if (entityType === "subscription") {
    // Only load subscription once for both addon + premium release
    const needsAddonRelease = !doc.addonCreditsReleased;
    const needsPremiumRelease = !doc.premiumCreditsReleased;

    if (needsAddonRelease || needsPremiumRelease) {
      const sub = await Subscription.findById(doc.subscriptionId).session(session);
      if (sub) {
        // --- Addon balance rollback ---
        if (needsAddonRelease && Array.isArray(doc.addonSelections)) {
          for (const sel of doc.addonSelections) {
            if (sel.source === "subscription") {
              const releaseResult = await releaseAddonBalanceAtomically({
                subscription: sub,
                addonId: sel.addonId,
                addonPlanId: sel.addonPlanId,
                category: sel.category,
                unitPriceHalala: Object.prototype.hasOwnProperty.call(sel, "unitPriceHalala") ? sel.unitPriceHalala : null,
                currency: sel.currency || null,
                session,
              });
              assertAddonBalanceReleaseSucceeded(releaseResult, sel);
              // Mark as pending_payment to prevent double-release if reopened
              sel.source = "pending_payment";
            }
          }
          doc.addonCreditsReleased = true;
        }

        // --- Premium balance rollback ---
        if (needsPremiumRelease && Array.isArray(doc.premiumUpgradeSelections)) {
          for (const sel of doc.premiumUpgradeSelections) {
            if (sel.premiumSource === "balance") {
              await releasePremiumBalanceAtomically({
                subscription: sub,
                premiumKey: sel.premiumKey,
                session,
              });
              // Mark as pending_payment to prevent double-release if reopened
              sel.premiumSource = "pending_payment";
            }
          }
          doc.premiumCreditsReleased = true;
        }
      }
    }
  }

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

async function handleNoShow({ entityId, entityType, payload, userId, role, session }) {
  if (entityType === "subscription_pickup_request") {
    const doc = await SubscriptionPickupRequest.findById(entityId).session(session);
    if (!doc) throw new Error("Entity not found");
    if (doc.status === "no_show") {
      return { data: doc, idempotent: true };
    }
    const fromStatus = doc.status;
    validateTransition(entityType, fromStatus, "no_show");
    doc.status = "no_show";
    doc.pickupNoShowAt = new Date();
    doc.canceledAt = doc.canceledAt || new Date();
    doc.cancellationReason = payload.reason || "no_show";
    doc.cancellationNote = payload.notes || payload.note;
    appendPickupRequestAudit(doc, "no_show", userId, role);
    await doc.save({ session });
    await consumeReservedPickupMeals({
      pickupRequestId: doc._id,
      session,
    });
    const updated = await SubscriptionPickupRequest.findById(entityId).session(session);
    return {
      data: updated || doc,
      sideEffects: { action: "no_show", entityType, entityId, toStatus: "no_show" },
    };
  }

  if (entityType === "subscription") {
    const doc = await SubscriptionDay.findById(entityId).session(session);
    if (!doc) throw new Error("Entity not found");
    await assertBranchPickupRequestExists(doc, session);
    
    if (doc.status === "no_show") {
      return { data: doc, idempotent: true };
    }
    const fromStatus = doc.status;
    validateTransition(entityType, fromStatus, "no_show");
    
    doc.status = "no_show";
    doc.pickupNoShowAt = new Date();
    doc.canceledAt = doc.canceledAt || new Date();
    doc.canceledBy = String(userId || "");
    doc.cancellationReason = payload.reason || "no_show";
    doc.cancellationNote = payload.notes || payload.note;
    
    // Policy Fix: no_show forfeits meals AND balances. 
    // We explicitly DO NOT call releaseAddonBalanceAtomically or releasePremiumBalanceAtomically here.

    appendOperationAudit(doc, "no_show", userId, role);
    await doc.save({ session });
    await writeSubscriptionDayAudit({ day: doc, action: "no_show", fromStatus, toStatus: "no_show", userId, role, payload, session });

    // Sync Delivery if one exists (rare for pickup, but safe to include)
    if (doc.deliveryRecord) {
      const { updateDeliveryByDayId } = require("./deliverySyncService");
      await updateDeliveryByDayId({
        dayId: doc._id,
        updates: {
          status: "canceled",
          canceledAt: new Date(),
          cancellationReason: payload.reason || "no_show",
        },
        session,
      });
    }

    return {
      data: doc,
      sideEffects: { action: "no_show", entityType, entityId, toStatus: "no_show" },
    };
  }

  throw new Error(`no_show not supported for entityType: ${entityType}`);
}

async function handleReopen({ entityId, entityType, userId, role, payload, session }) {
  if (entityType === "order") {
    const err = new Error("Reopen is not supported for one-time orders");
    err.code = "REOPEN_NOT_SUPPORTED";
    err.status = 409;
    throw err;
  }
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

    if (doc.addonCreditsReleased || doc.premiumCreditsReleased) {
      const sub = await Subscription.findById(doc.subscriptionId).session(session);
      if (sub) {
        if (doc.addonCreditsReleased && Array.isArray(doc.addonSelections)) {
          for (const sel of doc.addonSelections) {
            if (sel.source === "pending_payment") {
              const walletResult = await consumeAddonBalanceAtomically({
                subscription: sub,
                dayId: doc._id,
                date: doc.date,
                addonId: sel.addonId,
                addonPlanId: sel.addonPlanId || null,
                category: sel.category || null,
                session
              });
              if (walletResult.consumed) {
                sel.source = "subscription";
              }
            }
          }
        }
        
        if (doc.premiumCreditsReleased && Array.isArray(doc.premiumUpgradeSelections)) {
          for (const sel of doc.premiumUpgradeSelections) {
            if (sel.premiumSource === "pending_payment") {
              const walletResult = await consumePremiumBalanceAtomically({
                subscription: sub,
                dayId: doc._id,
                date: doc.date,
                premiumKey: sel.premiumKey,
                session
              });
              if (walletResult.consumed) {
                sel.premiumSource = "balance";
              }
            }
          }
        }
      }
      doc.addonCreditsReleased = false;
      doc.premiumCreditsReleased = false;
    }

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
  if (!canTransitionStatus(type, from, to)) {
    const err = new Error("INVALID_STATE_TRANSITION");
    err.code = "INVALID_STATE_TRANSITION";
    err.status = 409;
    throw err;
  }
}

function ensurePaidOrder(order) {
  if (!order || order.paymentStatus !== "paid") {
    const err = new Error("ORDER_PAYMENT_REQUIRED");
    err.code = "ORDER_PAYMENT_REQUIRED";
    err.status = 409;
    throw err;
  }
}

async function assertBranchPickupRequestExists(doc, session) {
  if (!doc || doc.constructor.modelName !== "SubscriptionDay") return;
  const sub = await Subscription.findById(doc.subscriptionId).session(session).lean();
  if (!sub || getEffectiveMode(sub, doc) !== "pickup") return;

  const request = await SubscriptionPickupRequest.findOne({
    subscriptionId: sub._id,
    date: doc.date,
    status: { $ne: "canceled" },
  }).session(session).lean();

  if (!request) {
    const err = new Error("Pickup preparation requires an explicit client request");
    err.code = "PICKUP_REQUEST_REQUIRED";
    err.status = 422;
    throw err;
  }
}

async function triggerSideEffects(effects, { userId, role }) {
  try {
    const { action, entityType, entityId, toStatus } = effects;

    const logAction = entityType === "order"
      ? `dashboard_order_${action}`
      : `dashboard_${action}`;

    // 1. Logging
    await writeLog({
      entityType,
      entityId,
      action: logAction,
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
    } else if (entityType === "subscription_pickup_request") {
      return;
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
