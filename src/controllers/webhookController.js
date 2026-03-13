const mongoose = require("mongoose");
const { addDays } = require("date-fns");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const CheckoutDraft = require("../models/CheckoutDraft");
const Payment = require("../models/Payment");
const Plan = require("../models/Plan");
const Order = require("../models/Order");
const { notifyOrderUser } = require("../services/orderNotificationService");
const { writeLog } = require("../utils/log");
const { logger } = require("../utils/logger");
const { toKSADateString } = require("../utils/date");
const {
  LEGACY_PREMIUM_MEAL_BUCKET_ID,
  sumPremiumRemainingFromBalance,
  syncPremiumRemainingFromBalance,
  ensureLegacyPremiumBalanceFromRemaining,
} = require("../utils/premiumWallet");
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

async function handleMoyasarWebhook(req, res) {
  const payload = req.body || {};
  const eventType = payload.type || payload.event;
  const data = payload.data || payload.payment || payload;
  const paymentStatus = normalizePaymentStatus(data, eventType);
  const isPaid = paymentStatus === "paid";
  const paymentId = data.id;
  const invoiceId = data.invoice_id || data.invoiceId;
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

  if (!paymentId && !invoiceId) {
    logger.warn("Moyasar webhook rejected: missing payment identifiers", logContext);
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
      logger.warn("Moyasar webhook rejected: payment not found", logContext);
      return errorResponse(res, 404, "NOT_FOUND", "Payment not found" );
    }

    if (paymentId && payment.providerPaymentId && payment.providerPaymentId !== paymentId) {
      await session.abortTransaction();
      session.endSession();
      logger.warn("Moyasar webhook rejected: payment id mismatch", {
        ...logContext,
        expectedPaymentId: redactId(payment.providerPaymentId),
      });
      return errorResponse(res, 409, "MISMATCH", "Payment ID mismatch" );
    }
    if (invoiceId && payment.providerInvoiceId && payment.providerInvoiceId !== invoiceId) {
      await session.abortTransaction();
      session.endSession();
      logger.warn("Moyasar webhook rejected: invoice id mismatch", {
        ...logContext,
        expectedInvoiceId: redactId(payment.providerInvoiceId),
      });
      return errorResponse(res, 409, "MISMATCH", "Invoice ID mismatch" );
    }
    if (paymentId && !payment.providerPaymentId) payment.providerPaymentId = paymentId;
    if (invoiceId && !payment.providerInvoiceId) payment.providerInvoiceId = invoiceId;

    // SECURITY FIX: Verify amount/currency consistency with checkout-time payment record.
    if (data.amount !== undefined && Number(data.amount) !== Number(payment.amount)) {
      await session.abortTransaction();
      session.endSession();
      logger.warn("Moyasar webhook rejected: amount mismatch", {
        ...logContext,
        receivedAmount: Number(data.amount),
        expectedAmount: Number(payment.amount),
      });
      return errorResponse(res, 409, "MISMATCH", "Amount mismatch" );
    }
    if (data.currency && String(data.currency).toUpperCase() !== String(payment.currency || "").toUpperCase()) {
      await session.abortTransaction();
      session.endSession();
      logger.warn("Moyasar webhook rejected: currency mismatch", {
        ...logContext,
        receivedCurrency: String(data.currency).toUpperCase(),
        expectedCurrency: String(payment.currency || "").toUpperCase(),
      });
      return errorResponse(res, 409, "MISMATCH", "Currency mismatch" );
    }

    const wasApplied = Boolean(payment.applied);
    if (paymentStatus) payment.status = paymentStatus;
    if (isPaid && !payment.paidAt) payment.paidAt = new Date();
    await payment.save({ session });

    // Idempotency guard: never re-apply side effects once already applied.
    if (wasApplied) {
      await session.commitTransaction();
      session.endSession();
      logger.info("Moyasar webhook ignored: payment already applied", {
        ...logContext,
        internalPaymentId: String(payment._id),
        paymentType: payment.type,
      });
      return res.status(200).json({ ok: true });
    }

    if (!isPaid) {
      const terminalFailureStatuses = new Set(["failed", "canceled", "expired"]);
      if (payment.type === "subscription_activation" && terminalFailureStatuses.has(payment.status)) {
        const nonPaidMetadata = payment.metadata || {};
        if (nonPaidMetadata.draftId && mongoose.Types.ObjectId.isValid(nonPaidMetadata.draftId)) {
          const draft = await CheckoutDraft.findById(nonPaidMetadata.draftId).session(session);
          const canMarkNonPaid =
            draft
            && !draft.subscriptionId
            && ["pending_payment", "failed", "canceled", "expired"].includes(draft.status);
          if (canMarkNonPaid) {
            draft.status = payment.status === "canceled" ? "canceled" : payment.status === "expired" ? "expired" : "failed";
            draft.failedAt = new Date();
            draft.failureReason = `payment_${draft.status}`;
            await draft.save({ session });
          }
        }
      }
      if (payment.type === "one_time_order" && terminalFailureStatuses.has(payment.status)) {
        const nonPaidMetadata = payment.metadata || {};
        if (nonPaidMetadata.orderId && mongoose.Types.ObjectId.isValid(String(nonPaidMetadata.orderId))) {
          const order = await Order.findById(nonPaidMetadata.orderId).session(session);
          const isCurrentAttempt = order && (!order.paymentId || String(order.paymentId) === String(payment._id));
          if (order && isCurrentAttempt) {
            order.paymentStatus = payment.status;
            order.paymentId = payment._id;
            if (payment.providerInvoiceId) order.providerInvoiceId = payment.providerInvoiceId;
            if (payment.providerPaymentId) order.providerPaymentId = payment.providerPaymentId;
            if (order.status === "created") {
              order.status = "canceled";
              order.canceledAt = order.canceledAt || new Date();
            }
            await order.save({ session });
          }
        }
      }
      await session.commitTransaction();
      session.endSession();
      logger.info("Moyasar webhook processed: non-paid status", {
        ...logContext,
        internalPaymentId: String(payment._id),
        paymentType: payment.type,
        status: payment.status,
      });
      return res.status(200).json({ ok: true, message: "Ignored non-paid status" });
    }

    // SECURITY FIX: Use only stored metadata created at checkout/initiation; never trust webhook payload metadata.
    const metadata = payment.metadata || {};
    const type = payment.type;
    let applied = false;
    let unappliedReason;
    let orderNotification = null;

    const claim = await Payment.findOneAndUpdate(
      { _id: payment._id, applied: false },
      { $set: { applied: true, status: "paid" } },
      { new: true, session }
    );
    if (!claim) {
      await session.commitTransaction();
      session.endSession();
      logger.info("Moyasar webhook ignored: already claimed by another request", {
        ...logContext,
        internalPaymentId: String(payment._id),
        paymentType: payment.type,
      });
      return res.status(200).json({ ok: true });
    }

    if (type === "premium_topup") {
      if (metadata.subscriptionId && Array.isArray(metadata.items) && metadata.items.length) {
        const sub = await Subscription.findById(metadata.subscriptionId).session(session);
        if (!sub) {
          unappliedReason = "subscription_not_found";
        } else {
          let addedCount = 0;
          sub.premiumBalance = sub.premiumBalance || [];
          for (const item of metadata.items) {
            const qty = parseInt(item.qty, 10);
            const unitExtraFeeHalala = Number(item.unitExtraFeeHalala || 0);
            if (!item.premiumMealId || !qty || qty <= 0) continue;
            sub.premiumBalance.push({
              premiumMealId: item.premiumMealId,
              purchasedQty: qty,
              remainingQty: qty,
              unitExtraFeeHalala,
              currency: item.currency || "SAR",
            });
            addedCount += qty;
          }
          if (addedCount > 0) {
            syncPremiumRemainingFromBalance(sub);
            await sub.save({ session });
            applied = true;
            await writeLog({
              entityType: "subscription",
              entityId: metadata.subscriptionId,
              action: "premium_topup_webhook",
              byRole: "system",
              meta: { count: addedCount, paymentId },
            });
          } else {
            unappliedReason = "invalid_items";
          }
        }
      } else {
        const count = parseInt(metadata.premiumCount || metadata.count || 0, 10);
        if (count > 0 && metadata.subscriptionId) {
          const sub = await Subscription.findById(metadata.subscriptionId).session(session);
          if (sub) {
            const configuredUnit = Number(metadata.unitExtraFeeHalala);
            const fallbackUnit = Math.round(Number(payment.amount || 0) / count);
            const unitExtraFeeHalala = Number.isInteger(configuredUnit) && configuredUnit >= 0
              ? configuredUnit
              : Number.isFinite(fallbackUnit) && fallbackUnit >= 0
                ? fallbackUnit
                : 0;

            // Legacy compatibility: migrate old numeric credits into wallet rows once.
            ensureLegacyPremiumBalanceFromRemaining(sub, {
              unitExtraFeeHalala,
              currency: payment.currency || "SAR",
            });

            sub.premiumBalance = sub.premiumBalance || [];
            sub.premiumBalance.push({
              premiumMealId: LEGACY_PREMIUM_MEAL_BUCKET_ID,
              purchasedQty: count,
              remainingQty: count,
              unitExtraFeeHalala,
              currency: payment.currency || "SAR",
            });
            syncPremiumRemainingFromBalance(sub);
            await sub.save({ session });
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
      }
    } else if (type === "addon_topup") {
      if (metadata.subscriptionId && Array.isArray(metadata.items) && metadata.items.length) {
        const sub = await Subscription.findById(metadata.subscriptionId).session(session);
        if (!sub) {
          unappliedReason = "subscription_not_found";
        } else {
          let addedCount = 0;
          sub.addonBalance = sub.addonBalance || [];
          for (const item of metadata.items) {
            const qty = parseInt(item.qty, 10);
            const unitPriceHalala = Number(item.unitPriceHalala || 0);
            if (!item.addonId || !qty || qty <= 0) continue;
            sub.addonBalance.push({
              addonId: item.addonId,
              purchasedQty: qty,
              remainingQty: qty,
              unitPriceHalala,
              currency: item.currency || "SAR",
            });
            addedCount += qty;
          }
          if (addedCount > 0) {
            await sub.save({ session });
            applied = true;
            await writeLog({
              entityType: "subscription",
              entityId: metadata.subscriptionId,
              action: "addon_topup_webhook",
              byRole: "system",
              meta: { count: addedCount, paymentId },
            });
          } else {
            unappliedReason = "invalid_items";
          }
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
          await writeLog({
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
    } else if (type === "subscription_activation") {
      if (metadata.draftId && mongoose.Types.ObjectId.isValid(metadata.draftId)) {
        const draft = await CheckoutDraft.findById(metadata.draftId).session(session);
        if (!draft) {
          unappliedReason = "draft_not_found";
        } else if (String(draft.userId) !== String(payment.userId)) {
          unappliedReason = "draft_user_mismatch";
        } else if (draft.subscriptionId) {
          const existingSub = await Subscription.findById(draft.subscriptionId).session(session).lean();
          if (existingSub) {
            applied = true;
          } else {
            unappliedReason = "draft_subscription_missing";
          }
        } else if (!["pending_payment", "failed", "canceled", "expired"].includes(draft.status)) {
          unappliedReason = `draft_not_recoverable:${draft.status}`;
        } else {
          const daysCount = Number(draft.daysCount);
          const mealsPerDay = Number(draft.mealsPerDay);
          if (!Number.isInteger(daysCount) || daysCount < 1 || !Number.isInteger(mealsPerDay) || mealsPerDay < 1) {
            unappliedReason = "invalid_draft_dimensions";
          } else {
            const start = draft.startDate ? new Date(draft.startDate) : new Date();
            const end = addDays(start, daysCount - 1);
            const totalMeals = daysCount * mealsPerDay;

            const premiumBalanceRows = (draft.premiumItems || []).map((item) => ({
              premiumMealId: item.premiumMealId,
              purchasedQty: Number(item.qty || 0),
              remainingQty: Number(item.qty || 0),
              unitExtraFeeHalala: Number(item.unitExtraFeeHalala || 0),
              currency: item.currency || "SAR",
            }));
            const addonBalanceRows = (draft.addonItems || []).map((item) => ({
              addonId: item.addonId,
              purchasedQty: Number(item.qty || 0),
              remainingQty: Number(item.qty || 0),
              unitPriceHalala: Number(item.unitPriceHalala || 0),
              currency: item.currency || "SAR",
            }));
            const premiumRemaining = sumPremiumRemainingFromBalance(premiumBalanceRows);

            const created = await Subscription.create(
              [
                {
                  userId: draft.userId,
                  planId: draft.planId,
                  status: "active",
                  startDate: start,
                  endDate: end,
                  validityEndDate: end,
                  totalMeals,
                  remainingMeals: totalMeals,
                  premiumRemaining,
                  selectedGrams: draft.grams,
                  selectedMealsPerDay: mealsPerDay,
                  basePlanPriceHalala:
                    draft.breakdown && Number.isFinite(Number(draft.breakdown.basePlanPriceHalala))
                      ? Number(draft.breakdown.basePlanPriceHalala)
                      : 0,
                  checkoutCurrency:
                    draft.breakdown && draft.breakdown.currency
                      ? String(draft.breakdown.currency)
                      : "SAR",
                  premiumBalance: premiumBalanceRows,
                  addonBalance: addonBalanceRows,
                  addonSubscriptions: Array.isArray(draft.addonSubscriptions) ? draft.addonSubscriptions : [],
                  deliveryMode: draft.delivery && draft.delivery.type ? draft.delivery.type : "delivery",
                  deliveryAddress:
                    draft.delivery && Object.prototype.hasOwnProperty.call(draft.delivery, "address")
                      ? draft.delivery.address || undefined
                      : undefined,
                  deliveryWindow:
                    draft.delivery && draft.delivery.slot && draft.delivery.slot.window
                      ? draft.delivery.slot.window
                      : undefined,
                  deliverySlot:
                    draft.delivery && draft.delivery.slot
                      ? draft.delivery.slot
                      : { type: draft.delivery && draft.delivery.type ? draft.delivery.type : "delivery", window: "", slotId: "" },
                },
              ],
              { session }
            );
            const sub = created[0];

            const existingDays = await SubscriptionDay.countDocuments({ subscriptionId: sub._id }).session(session);
            if (!existingDays) {
              const dayEntries = [];
              for (let i = 0; i < daysCount; i++) {
                const currentDate = addDays(start, i);
                dayEntries.push({
                  subscriptionId: sub._id,
                  date: toKSADateString(currentDate),
                  status: "open",
                });
              }
              await SubscriptionDay.insertMany(dayEntries, { session });
            }

            draft.status = "completed";
            draft.completedAt = new Date();
            draft.paymentId = payment._id;
            draft.providerInvoiceId = payment.providerInvoiceId || draft.providerInvoiceId;
            draft.subscriptionId = sub._id;
            draft.failureReason = "";
            draft.failedAt = undefined;
            await draft.save({ session });
            applied = true;
          }
        }
      } else if (metadata.subscriptionId) {
        // Legacy compatibility path for old initiated payments that were created with a pending subscription.
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
          const isCurrentAttempt = !order.paymentId || String(order.paymentId) === String(payment._id);
          if (!isCurrentAttempt && order.paymentStatus === "paid") {
            unappliedReason = "stale_order_payment_attempt";
          } else {
            if (order.status === "created" || order.status === "canceled") {
              order.status = "confirmed";
              order.confirmedAt = order.confirmedAt || new Date();
              order.canceledAt = undefined;
            }
            order.paymentStatus = "paid";
            order.paymentId = payment._id;
            if (payment.providerInvoiceId) order.providerInvoiceId = payment.providerInvoiceId;
            if (payment.providerPaymentId) order.providerPaymentId = payment.providerPaymentId;
            if (metadata.paymentUrl && !order.paymentUrl) order.paymentUrl = String(metadata.paymentUrl);
            await order.save({ session });
            applied = true;
            orderNotification = {
              orderId: order._id,
              userId: order.userId,
              paymentId: payment._id,
            };
            await writeLog({
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
    if (orderNotification) {
      await notifyOrderUser({
        order: { _id: orderNotification.orderId, userId: orderNotification.userId },
        type: "paid",
        paymentId: orderNotification.paymentId,
      });
    }
    logger.info("Moyasar webhook processed", {
      ...logContext,
      internalPaymentId: String(payment._id),
      paymentType: payment.type,
      applied,
      unappliedReason: unappliedReason || null,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    logger.error("webhookController.handleMoyasarWebhook failed", {
      error: err.message,
      stack: err.stack,
      ...logContext,
    });
    return errorResponse(res, 500, "INTERNAL", "Webhook processing failed");
  }
}

module.exports = { handleMoyasarWebhook };
