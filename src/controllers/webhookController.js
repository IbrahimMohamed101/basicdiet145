const mongoose = require("mongoose");
const { addDays } = require("date-fns");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const Payment = require("../models/Payment");
const Plan = require("../models/Plan");
const Order = require("../models/Order");
const { writeLog } = require("../utils/log");
const { logger } = require("../utils/logger");
const { toKSADateString } = require("../utils/date");
const errorResponse = require("../utils/errorResponse");

function normalizePaymentStatus(payload, eventType) {
  if (payload && payload.status) return payload.status;
  if (!eventType) return undefined;
  const normalized = String(eventType).toLowerCase();
  if (normalized.includes("paid")) return "paid";
  if (normalized.includes("failed")) return "failed";
  if (normalized.includes("canceled") || normalized.includes("cancelled")) return "canceled";
  return undefined;
}

async function handleMoyasarWebhook(req, res) {
  const payload = req.body || {};
  const secret = process.env.MOYASAR_WEBHOOK_SECRET;
  // SECURITY FIX: Fail closed when webhook secret is missing or mismatched.
  if (!secret || payload.secret_token !== secret) {
    return errorResponse(res, 401, "UNAUTHORIZED", "Invalid webhook token" );
  }

  const eventType = payload.type || payload.event;
  const data = payload.data || payload.payment || payload;
  const paymentStatus = normalizePaymentStatus(data, eventType);
  const isPaid = paymentStatus === "paid";

  const paymentId = data.id;
  const invoiceId = data.invoice_id || data.invoiceId;

  if (!paymentId && !invoiceId) {
    return errorResponse(res, 400, "INVALID", "Missing payment identifiers" );
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    let payment = await Payment.findOne({
      provider: "moyasar",
      $or: [
        paymentId ? { providerPaymentId: paymentId } : null,
        invoiceId ? { providerInvoiceId: invoiceId } : null,
      ].filter(Boolean),
    }).session(session);

    // SECURITY FIX: Reject unknown payment references instead of creating new records from webhook payload.
    if (!payment) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Payment not found" );
    }

    if (payment.applied) {
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({ ok: true });
    }

    // SECURITY FIX: Only initiated payments are eligible for first-time webhook application.
    if (payment.status !== "initiated") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_STATE", "Payment is not in initiated state" );
    }

    if (paymentId && payment.providerPaymentId && payment.providerPaymentId !== paymentId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Payment ID mismatch" );
    }
    if (invoiceId && payment.providerInvoiceId && payment.providerInvoiceId !== invoiceId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Invoice ID mismatch" );
    }
    if (paymentId && !payment.providerPaymentId) payment.providerPaymentId = paymentId;
    if (invoiceId && !payment.providerInvoiceId) payment.providerInvoiceId = invoiceId;

    // SECURITY FIX: Verify amount/currency consistency with checkout-time payment record.
    if (data.amount !== undefined && Number(data.amount) !== Number(payment.amount)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Amount mismatch" );
    }
    if (data.currency && String(data.currency).toUpperCase() !== String(payment.currency || "").toUpperCase()) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Currency mismatch" );
    }

    if (isPaid && !payment.paidAt) payment.paidAt = new Date();
    await payment.save({ session });

    if (!isPaid) {
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({ ok: true, message: "Ignored non-paid status" });
    }

    // SECURITY FIX: Use only stored metadata created at checkout/initiation; never trust webhook payload metadata.
    const metadata = payment.metadata || {};
    const type = payment.type;
    let applied = false;
    let unappliedReason;

    const claim = await Payment.findOneAndUpdate(
      { _id: payment._id, applied: false },
      { $set: { applied: true, status: "paid" } },
      { new: true, session }
    );
    if (!claim) {
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({ ok: true });
    }

    if (type === "premium_topup") {
      const count = parseInt(metadata.premiumCount || metadata.count || 0, 10);
      if (count > 0 && metadata.subscriptionId) {
        const update = await Subscription.updateOne(
          { _id: metadata.subscriptionId },
          { $inc: { premiumRemaining: count } },
          { session }
        );
        if (update.modifiedCount) {
          applied = true;
          await writeLog({
            entityType: "subscription",
            entityId: metadata.subscriptionId,
            action: "premium_topup_webhook",
            byRole: "system",
            meta: { count, paymentId },
          });
        } else {
          unappliedReason = "subscription_not_found";
        }
      } else {
        unappliedReason = "invalid_metadata";
      }
    } else if (type === "one_time_addon") {
      if (metadata.subscriptionId && metadata.addonId && metadata.date) {
        const updatedDay = await SubscriptionDay.findOneAndUpdate(
          { subscriptionId: metadata.subscriptionId, date: metadata.date, status: "open" },
          { $addToSet: { addonsOneTime: metadata.addonId } },
          { new: true, session }
        );
        if (updatedDay) {
          applied = true;
          await writeLog({
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
          await writeLog({
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
    } else if (type === "subscription_activation") {
      if (metadata.subscriptionId) {
        const sub = await Subscription.findById(metadata.subscriptionId).session(session);
        if (!sub) {
          unappliedReason = "subscription_not_found";
        } else if (sub.status !== "pending_payment") {
          unappliedReason = `subscription_not_pending:${sub.status}`;
        } else {
          const plan = await Plan.findById(sub.planId).lean();
          const start = sub.startDate ? new Date(sub.startDate) : new Date();
          const end = plan ? addDays(start, plan.daysCount - 1) : sub.endDate || start;
          sub.status = "active";
          sub.endDate = end;
          sub.validityEndDate = end;
          await sub.save({ session });

          const existingDays = await SubscriptionDay.countDocuments({ subscriptionId: sub._id }).session(session);
          if (!existingDays && plan) {
            const dayEntries = [];
            for (let i = 0; i < plan.daysCount; i++) {
              const currentDate = addDays(start, i);
              dayEntries.push({
                subscriptionId: sub._id,
                date: toKSADateString(currentDate),
                status: "open",
              });
            }
            await SubscriptionDay.insertMany(dayEntries, { session });
          }
          applied = true;
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
          if (order.status === "created") {
            order.status = "confirmed";
            order.confirmedAt = new Date();
          }
          order.paymentStatus = "paid";
          order.paymentId = payment._id;
          if (payment.providerInvoiceId) order.providerInvoiceId = payment.providerInvoiceId;
          if (payment.providerPaymentId) order.providerPaymentId = payment.providerPaymentId;
          await order.save({ session });
          applied = true;
          await writeLog({
            entityType: "order",
            entityId: order._id,
            action: "order_payment_webhook",
            byRole: "system",
            meta: { orderId: String(order._id), paymentId },
          });
        }
      } else {
        unappliedReason = "invalid_metadata";
      }
    } else {
      unappliedReason = "unsupported_payment_type";
    }

    if (!applied) {
      if (unappliedReason) {
        const mergedMetadata = Object.assign({}, payment.metadata || {}, { unappliedReason });
        await Payment.updateOne(
          { _id: payment._id },
          { $set: { applied: true, status: "paid", metadata: mergedMetadata } },
          { session }
        );
        await writeLog({
          entityType: "payment",
          entityId: payment._id,
          action: "payment_unapplied",
          byRole: "system",
          meta: { reason: unappliedReason, paymentId },
        });
      } else {
        await Payment.updateOne({ _id: payment._id }, { $set: { applied: false } }, { session });
      }
    }

    await session.commitTransaction();
    session.endSession();
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    logger.error("webhookController.handleMoyasarWebhook failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Webhook processing failed");
  }
}

module.exports = { handleMoyasarWebhook };
