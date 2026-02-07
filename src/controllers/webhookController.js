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
  if (secret && payload.secret_token !== secret) {
    return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Invalid webhook token" } });
  }

  const eventType = payload.type || payload.event;
  const data = payload.data || payload.payment || payload;
  const paymentStatus = normalizePaymentStatus(data, eventType);
  const isPaid = paymentStatus === "paid";

  const paymentId = data.id;
  const invoiceId = data.invoice_id || data.invoiceId;
  const metadata = data.metadata || {};

  if (!paymentId && !invoiceId) {
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Missing payment identifiers" } });
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

    if (!payment) {
      try {
        const created = await Payment.create([
          {
            provider: "moyasar",
            type: metadata.type || "premium_topup",
            status: isPaid ? "paid" : "initiated",
            amount: data.amount || 0,
            currency: data.currency || "SAR",
            userId: metadata.userId,
            subscriptionId: metadata.subscriptionId,
            providerInvoiceId: invoiceId,
            providerPaymentId: paymentId,
            metadata,
            paidAt: isPaid ? new Date() : undefined,
          },
        ], { session });
        payment = created[0];
      } catch (err) {
        if (err && err.code === 11000) {
          payment = await Payment.findOne({
            provider: "moyasar",
            $or: [
              paymentId ? { providerPaymentId: paymentId } : null,
              invoiceId ? { providerInvoiceId: invoiceId } : null,
            ].filter(Boolean),
          }).session(session);
        } else {
          throw err;
        }
      }
    } else {
      if (paymentId && payment.providerPaymentId !== paymentId) payment.providerPaymentId = paymentId;
      if (invoiceId && payment.providerInvoiceId !== invoiceId) payment.providerInvoiceId = invoiceId;
      if (data.amount) payment.amount = data.amount;
      if (data.currency) payment.currency = data.currency;
      if (metadata && Object.keys(metadata).length) payment.metadata = metadata;
      if (paymentStatus && payment.status !== paymentStatus) payment.status = paymentStatus;
      if (isPaid && !payment.paidAt) payment.paidAt = new Date();
      await payment.save({ session });
    }

    if (!isPaid) {
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({ ok: true, message: "Ignored non-paid status" });
    }

    if (payment.applied) {
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({ ok: true });
    }

    const type = payment.type || metadata.type;
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
    await session.abortTransaction();
    session.endSession();
    logger.error("Webhook error", { error: err.message, stack: err.stack });
    return res.status(500).json({ ok: false });
  }
}

module.exports = { handleMoyasarWebhook };
