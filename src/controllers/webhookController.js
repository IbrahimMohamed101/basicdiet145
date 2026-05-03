const mongoose = require("mongoose");
const { addDays } = require("date-fns");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const CheckoutDraft = require("../models/CheckoutDraft");
const Payment = require("../models/Payment");
const Plan = require("../models/Plan");
const Order = require("../models/Order");
const { notifyOrderUser } = require("../services/orderNotificationService");
const {
  applyPaymentSideEffects,
  SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES,
} = require("../services/paymentApplicationService");
const { applyOrderWebhookInvoice } = require("../services/orders/orderPaymentService");
const { releasePromoCodeUsageReservation } = require("../services/promoCodeService");
const { runMongoTransactionWithRetry } = require("../services/mongoTransactionRetryService");
const { writeLog } = require("../utils/log");
const { logger } = require("../utils/logger");
const { toKSADateString } = require("../utils/date");
const { isPhase1SharedPaymentDispatcherEnabled } = require("../utils/featureFlags");
const errorResponse = require("../utils/errorResponse");

function normalizePaymentStatus(payload, eventType) {
  if (payload && payload.status) {
    const normalizedPayloadStatus = String(payload.status).toLowerCase();
    if (normalizedPayloadStatus === "cancelled") return "canceled";
    if (["initiated", "paid", "failed", "canceled", "expired", "refunded"].includes(normalizedPayloadStatus)) {
      return normalizedPayloadStatus;
    }
  }
  if (!eventType) return undefined;
  const normalized = String(eventType).toLowerCase();
  if (normalized.includes("paid")) return "paid";
  if (normalized.includes("failed")) return "failed";
  if (normalized.includes("canceled") || normalized.includes("cancelled")) return "canceled";
  if (normalized.includes("expired")) return "expired";
  return undefined;
}

function redactId(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value);
  if (text.length <= 8) return text;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

async function handleMoyasarWebhook(req, res, runtimeOverrides = null) {
  const startSessionFn = runtimeOverrides && runtimeOverrides.startSession
    ? runtimeOverrides.startSession
    : () => mongoose.startSession();
  const applyPaymentSideEffectsFn = runtimeOverrides && runtimeOverrides.applyPaymentSideEffects
    ? runtimeOverrides.applyPaymentSideEffects
    : applyPaymentSideEffects;
  const writeLogFn = runtimeOverrides && runtimeOverrides.writeLog
    ? runtimeOverrides.writeLog
    : writeLog;
  const notifyOrderUserFn = runtimeOverrides && runtimeOverrides.notifyOrderUser
    ? runtimeOverrides.notifyOrderUser
    : notifyOrderUser;
  const isSharedPaymentDispatcherEnabledFn = runtimeOverrides && runtimeOverrides.isPhase1SharedPaymentDispatcherEnabled
    ? runtimeOverrides.isPhase1SharedPaymentDispatcherEnabled
    : isPhase1SharedPaymentDispatcherEnabled;
  const supportedSharedPaymentTypes = runtimeOverrides && runtimeOverrides.supportedPaymentTypes
    ? runtimeOverrides.supportedPaymentTypes
    : SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES;

  const payload = req.body || {};
  const eventType = payload.type || payload.event;
  const data = payload.data || payload.payment || payload;
  const metadata = data && data.metadata && typeof data.metadata === "object" ? data.metadata : {};
  const paymentStatus = normalizePaymentStatus(data, eventType);
  const isPaid = paymentStatus === "paid";
  const paymentId = data.id;
  const invoiceId = data.invoice_id || data.invoiceId;
  const metadataOrderId = metadata.orderId;
  const logContext = {
    eventType: eventType || null,
    paymentStatus: paymentStatus || null,
    paymentId: redactId(paymentId),
    invoiceId: redactId(invoiceId),
    hasSecretToken: Boolean(payload.secret_token),
  };

  const secret = process.env.MOYASAR_WEBHOOK_SECRET;
  // SECURITY FIX: Fail closed when webhook secret is missing or mismatched.
  if (!secret || payload.secret_token !== secret) {
    logger.warn("Moyasar webhook rejected: invalid token", {
      ...logContext,
      hasConfiguredSecret: Boolean(secret),
    });
    return errorResponse(res, 401, "UNAUTHORIZED", "Invalid webhook token" );
  }

  if (!paymentId && !invoiceId && !metadataOrderId) {
    if (!paymentStatus) {
      logger.info("Moyasar webhook ignored: unknown event without payment identifiers", logContext);
      return res.status(200).json({ status: true, ignored: true });
    }
    logger.warn("Moyasar webhook rejected: missing payment identifiers", logContext);
    return errorResponse(res, 400, "INVALID", "Missing payment identifiers" );
  }

  try {
    let orderWebhookResult;
    try {
      orderWebhookResult = await applyOrderWebhookInvoice({ providerInvoice: data, eventType });
    } catch (err) {
      if (err && err.code && err.status) {
        logger.warn("Moyasar order webhook rejected", {
          ...logContext,
          code: err.code,
          error: err.message,
        });
        return errorResponse(res, err.status, err.code, err.message, err.details);
      }
      throw err;
    }
    if (orderWebhookResult && orderWebhookResult.handled) {
      logger.info("Moyasar webhook processed by one-time order branch", {
        ...logContext,
        alreadyProcessed: Boolean(orderWebhookResult.alreadyProcessed),
        ignored: Boolean(orderWebhookResult.ignored),
        reason: orderWebhookResult.reason || null,
      });
      return res.status(200).json({ status: true });
    }

    const payment = await Payment.findOne({
      provider: "moyasar",
      $or: [
        paymentId ? { providerPaymentId: paymentId } : null,
        invoiceId ? { providerInvoiceId: invoiceId } : null,
      ].filter(Boolean),
    }).lean();

    if (!payment) {
      logger.warn("Moyasar webhook rejected: payment not found", logContext);
      return errorResponse(res, 404, "NOT_FOUND", "Payment not found" );
    }

    if (paymentId && payment.providerPaymentId && payment.providerPaymentId !== paymentId) {
      logger.warn("Moyasar webhook rejected: payment id mismatch", {
        ...logContext,
        expectedPaymentId: redactId(payment.providerPaymentId),
      });
      return errorResponse(res, 409, "MISMATCH", "Payment ID mismatch" );
    }
    if (invoiceId && payment.providerInvoiceId && payment.providerInvoiceId !== invoiceId) {
      logger.warn("Moyasar webhook rejected: invoice id mismatch", {
        ...logContext,
        expectedInvoiceId: redactId(payment.providerInvoiceId),
      });
      return errorResponse(res, 409, "MISMATCH", "Invoice ID mismatch" );
    }

    if (data.amount !== undefined && Number(data.amount) !== Number(payment.amount)) {
      logger.warn("Moyasar webhook rejected: amount mismatch", {
        ...logContext,
        receivedAmount: Number(data.amount),
        expectedAmount: Number(payment.amount),
      });
      return errorResponse(res, 409, "MISMATCH", "Amount mismatch" );
    }
    if (data.currency && String(data.currency).toUpperCase() !== String(payment.currency || "").toUpperCase()) {
      logger.warn("Moyasar webhook rejected: currency mismatch", {
        ...logContext,
        receivedCurrency: String(data.currency).toUpperCase(),
        expectedCurrency: String(payment.currency || "").toUpperCase(),
      });
      return errorResponse(res, 409, "MISMATCH", "Currency mismatch" );
    }

    if (payment.applied === true && payment.status === "paid" && isPaid) {
      logger.info("Moyasar webhook ignored before transaction: payment already applied", {
        ...logContext,
        internalPaymentId: String(payment._id),
        paymentType: payment.type,
      });
      return res.status(200).json({ status: true });
    }

    const result = await runMongoTransactionWithRetry(async (session, { attempt }) => {
      const paymentInSession = await Payment.findById(payment._id).session(session);
      if (!paymentInSession) {
        const err = new Error("Payment not found");
        err.code = "NOT_FOUND";
        err.status = 404;
        throw err;
      }

      if (paymentId && !paymentInSession.providerPaymentId) paymentInSession.providerPaymentId = paymentId;
      if (invoiceId && !paymentInSession.providerInvoiceId) paymentInSession.providerInvoiceId = invoiceId;

      if (paymentInSession.applied === true && paymentInSession.status === "paid" && isPaid) {
        logger.info("Moyasar webhook ignored in transaction: payment already applied", {
          ...logContext,
          internalPaymentId: String(paymentInSession._id),
          paymentType: paymentInSession.type,
          attempt: attempt + 1,
        });
        return { alreadyProcessed: true };
      }

      if (!isPaid) {
        const nonPaidUpdate = {};
        if (paymentStatus) nonPaidUpdate.status = paymentStatus;
        if (paymentId && !paymentInSession.providerPaymentId) nonPaidUpdate.providerPaymentId = paymentId;
        if (invoiceId && !paymentInSession.providerInvoiceId) nonPaidUpdate.providerInvoiceId = invoiceId;
        if (Object.keys(nonPaidUpdate).length) {
          await Payment.updateOne({ _id: paymentInSession._id }, { $set: nonPaidUpdate }, { session });
        }

        const latestPayment = await Payment.findById(paymentInSession._id).session(session);
        const terminalFailureStatuses = new Set(["failed", "canceled", "expired"]);
        if (latestPayment.type === "subscription_activation" && terminalFailureStatuses.has(latestPayment.status)) {
          const nonPaidMetadata = latestPayment.metadata || {};
          if (nonPaidMetadata.draftId && mongoose.Types.ObjectId.isValid(nonPaidMetadata.draftId)) {
            const draft = await CheckoutDraft.findById(nonPaidMetadata.draftId).session(session);
            const canMarkNonPaid =
              draft
              && !draft.subscriptionId
              && ["pending_payment", "failed", "canceled", "expired"].includes(draft.status);
            if (canMarkNonPaid) {
              draft.status = latestPayment.status === "canceled" ? "canceled" : latestPayment.status === "expired" ? "expired" : "failed";
              draft.failedAt = new Date();
              draft.failureReason = `payment_${draft.status}`;
              await draft.save({ session });
              await releasePromoCodeUsageReservation({
                checkoutDraftId: draft._id,
                session,
                reason: `payment_${draft.status}`,
              });
            }
          }
        }
        if (latestPayment.type === "one_time_order" && terminalFailureStatuses.has(latestPayment.status)) {
          const nonPaidMetadata = latestPayment.metadata || {};
          if (nonPaidMetadata.orderId && mongoose.Types.ObjectId.isValid(String(nonPaidMetadata.orderId))) {
            const order = await Order.findById(nonPaidMetadata.orderId).session(session);
            const isCurrentAttempt = order && (!order.paymentId || String(order.paymentId) === String(latestPayment._id));
            if (order && isCurrentAttempt) {
              order.paymentStatus = latestPayment.status;
              order.paymentId = latestPayment._id;
              if (latestPayment.providerInvoiceId) order.providerInvoiceId = latestPayment.providerInvoiceId;
              if (latestPayment.providerPaymentId) order.providerPaymentId = latestPayment.providerPaymentId;
              if (order.status === "created") {
                order.status = "canceled";
                order.canceledAt = order.canceledAt || new Date();
              }
              await order.save({ session });
            }
          }
        }

        return {
          nonPaid: true,
          paymentId: String(latestPayment._id),
          paymentType: latestPayment.type,
          status: latestPayment.status,
        };
      }

      const metadata = paymentInSession.metadata || {};
      const type = paymentInSession.type;
      let applied = false;
      let unappliedReason;
      let orderNotification = null;

      const claimUpdate = {
        applied: true,
        status: "paid",
        paidAt: paymentInSession.paidAt || new Date(),
      };
      if (paymentId && !paymentInSession.providerPaymentId) {
        claimUpdate.providerPaymentId = paymentId;
      }
      if (invoiceId && !paymentInSession.providerInvoiceId) {
        claimUpdate.providerInvoiceId = invoiceId;
      }

      const claim = await Payment.findOneAndUpdate(
        { _id: paymentInSession._id, applied: false },
        { $set: claimUpdate },
        { new: true, session }
      );
      if (!claim) {
        logger.info("Moyasar webhook ignored: already claimed by another request", {
          ...logContext,
          internalPaymentId: String(paymentInSession._id),
          paymentType: paymentInSession.type,
          attempt: attempt + 1,
        });
        return { alreadyProcessed: true };
      }

      const useSharedDispatcher =
        supportedSharedPaymentTypes.has(String(type || ""))
        && (
          isSharedPaymentDispatcherEnabledFn()
          || String(type || "") === "premium_overage_day"
          || String(type || "") === "premium_extra_day"
          || String(type || "") === "one_time_addon_day_planning"
        );

      if (useSharedDispatcher) {
        const sharedResult = await applyPaymentSideEffectsFn({
          payment: claim,
          session,
          source: "webhook",
        });
        applied = Boolean(sharedResult && sharedResult.applied);
        unappliedReason = applied ? undefined : sharedResult.reason;
      } else if (type === "one_time_addon") {
        if (metadata.subscriptionId && metadata.addonId && metadata.date) {
          const updatedDay = await SubscriptionDay.findOneAndUpdate(
            { subscriptionId: metadata.subscriptionId, date: metadata.date, status: "open" },
            { $addToSet: { addonsOneTime: metadata.addonId } },
            { new: true, session }
        );
        if (updatedDay) {
          applied = true;
            await writeLogFn({
              entityType: "subscription_day",
              entityId: updatedDay._id,
              action: "one_time_addon_webhook",
            byRole: "system",
              meta: { addonId: metadata.addonId, date: metadata.date, paymentId },
          });
        } else {
          const dayCheck = await SubscriptionDay.findOne(
            { subscriptionId: metadata.subscriptionId, date: metadata.date },
            { status: 1 }
          ).session(session).lean();
          if (!dayCheck) {
            unappliedReason = "day_not_found";
          } else {
            unappliedReason = `day_not_open:${dayCheck.status}`;
          }
        }
      } else {
        unappliedReason = "invalid_metadata";
      }
    } else if (type === "custom_salad_day") {
      const snapshot = metadata.snapshot;
      if (metadata.subscriptionId && metadata.date && snapshot) {
        const existingDay = await SubscriptionDay.findOne(
          { subscriptionId: metadata.subscriptionId, date: metadata.date }
        ).session(session);

        let updatedDay;
        if (!existingDay) {
          const createdDay = await SubscriptionDay.create(
            [
              {
                subscriptionId: metadata.subscriptionId,
                date: metadata.date,
                status: "open",
                customSalads: [snapshot],
              },
            ],
            { session }
          );
          updatedDay = createdDay[0];
        } else if (existingDay.status === "open") {
          existingDay.customSalads = existingDay.customSalads || [];
          existingDay.customSalads.push(snapshot);
          await existingDay.save({ session });
          updatedDay = existingDay;
        } else {
          unappliedReason = `day_not_open:${existingDay.status}`;
        }

        if (updatedDay) {
          applied = true;
          await writeLogFn({
            entityType: "subscription_day",
            entityId: updatedDay._id,
            action: "custom_salad_day_webhook",
            byRole: "system",
            meta: { date: metadata.date, paymentId },
          });
        }
      } else {
        unappliedReason = "invalid_metadata";
      }
    } else if (type === "custom_meal_day") {
      const snapshot = metadata.snapshot;
      if (metadata.subscriptionId && metadata.date && snapshot) {
        const existingDay = await SubscriptionDay.findOne(
          { subscriptionId: metadata.subscriptionId, date: metadata.date }
        ).session(session);

        let updatedDay;
        if (!existingDay) {
          const createdDay = await SubscriptionDay.create(
            [
              {
                subscriptionId: metadata.subscriptionId,
                date: metadata.date,
                status: "open",
                customMeals: [snapshot],
              },
            ],
            { session }
          );
          updatedDay = createdDay[0];
        } else if (existingDay.status === "open") {
          existingDay.customMeals = existingDay.customMeals || [];
          existingDay.customMeals.push(snapshot);
          await existingDay.save({ session });
          updatedDay = existingDay;
        } else {
          unappliedReason = `day_not_open:${existingDay.status}`;
        }

        if (updatedDay) {
          applied = true;
          await writeLogFn({
            entityType: "subscription_day",
            entityId: updatedDay._id,
            action: "custom_meal_day_webhook",
            byRole: "system",
            meta: { date: metadata.date, paymentId },
          });
        }
      } else {
        unappliedReason = "invalid_metadata";
      }
    } else if (type === "one_time_order") {

      if (metadata.orderId) {
        const order = await Order.findById(metadata.orderId).session(session);
        if (!order) {
          unappliedReason = "order_not_found";
        } else {
          const isCurrentAttempt = !order.paymentId || String(order.paymentId) === String(claim._id);
          if (!isCurrentAttempt && order.paymentStatus === "paid") {
            unappliedReason = "stale_order_payment_attempt";
          } else {
            if (order.status === "created" || order.status === "canceled") {
              order.status = "confirmed";
              order.confirmedAt = order.confirmedAt || new Date();
              order.canceledAt = undefined;
            }
            order.paymentStatus = "paid";
            order.paymentId = claim._id;
            if (claim.providerInvoiceId) order.providerInvoiceId = claim.providerInvoiceId;
            if (claim.providerPaymentId) order.providerPaymentId = claim.providerPaymentId;
            if (metadata.paymentUrl && !order.paymentUrl) order.paymentUrl = String(metadata.paymentUrl);
            await order.save({ session });
            applied = true;
            orderNotification = {
              orderId: order._id,
              userId: order.userId,
              paymentId: claim._id,
            };
            await writeLogFn({
              entityType: "order",
              entityId: order._id,
              action: "order_payment_webhook",
              byRole: "system",
              meta: { orderId: String(order._id), paymentId },
            });
          }
        }
      } else {
        unappliedReason = "invalid_metadata";
      }
    } else {
      unappliedReason = "unsupported_payment_type";
    }

      if (!applied) {
        if (unappliedReason) {
          const mergedMetadata = Object.assign({}, claim.metadata || {}, { unappliedReason });
          await Payment.updateOne(
            { _id: claim._id },
          { $set: { applied: false, status: "paid", metadata: mergedMetadata } },
          { session }
        );
        await writeLogFn({
          entityType: "payment",
          entityId: claim._id,
          action: "payment_unapplied",
          byRole: "system",
          meta: { reason: unappliedReason, paymentId },
        });
      } else {
        await Payment.updateOne({ _id: claim._id }, { $set: { applied: true } }, { session });
      }

        return {
          applied,
          unappliedReason: unappliedReason || null,
          internalPaymentId: String(claim._id),
          paymentType: claim.type,
          orderNotification,
        };
      }

      return {
        applied,
        unappliedReason: null,
        internalPaymentId: String(claim._id),
        paymentType: claim.type,
        orderNotification,
      };
    }, {
      label: "moyasar_webhook",
      context: {
        paymentId: redactId(paymentId),
        invoiceId: redactId(invoiceId),
        eventType: eventType || null,
        source: "webhook",
      },
    });

    if (result && result.nonPaid) {
      logger.info("Moyasar webhook processed: non-paid status", {
        ...logContext,
        internalPaymentId: result.paymentId,
        paymentType: result.paymentType,
        status: result.status,
      });
      return res.status(200).json({ status: true, message: "Ignored non-paid status" });
    }

    if (result && result.orderNotification) {
      await notifyOrderUserFn({
        order: { _id: result.orderNotification.orderId, userId: result.orderNotification.userId },
        type: "paid",
        paymentId: result.orderNotification.paymentId,
      });
    }

    logger.info("Moyasar webhook processed", {
      ...logContext,
      internalPaymentId: result && result.internalPaymentId ? result.internalPaymentId : String(payment._id),
      paymentType: result && result.paymentType ? result.paymentType : payment.type,
      applied: result && Object.prototype.hasOwnProperty.call(result, "applied") ? result.applied : true,
      unappliedReason: result && result.unappliedReason ? result.unappliedReason : null,
    });
    return res.status(200).json({ status: true });
  } catch (err) {
    logger.error("webhookController.handleMoyasarWebhook failed", {
      error: err.message,
      stack: err.stack,
      ...logContext,
    });
    return errorResponse(res, 500, "INTERNAL", "Webhook processing failed");
  }
}

module.exports = { handleMoyasarWebhook };
