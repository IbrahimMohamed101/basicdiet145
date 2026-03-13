const mongoose = require("mongoose");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const Order = require("../models/Order");
const Payment = require("../models/Payment");
const Setting = require("../models/Setting");
const { buildCustomMealSnapshot } = require("../services/customMealService");
const { createInvoice } = require("../services/moyasarService");
const {
  getTomorrowKSADate,
  isBeforeCutoff,
  isInSubscriptionRange,
  isOnOrAfterKSADate,
  isOnOrAfterTodayKSADate,
  isValidKSADateString,
  toKSADateString,
} = require("../utils/date");
const { writeLog } = require("../utils/log");
const { logger } = require("../utils/logger");
const errorResponse = require("../utils/errorResponse");

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

function ensureActive(subscription, dateStr) {
  if (subscription.status !== "active") {
    const err = new Error("Subscription not active");
    err.code = "SUB_INACTIVE";
    throw err;
  }
  const endDate = subscription.validityEndDate || subscription.endDate;
  if (endDate) {
    const endStr = toKSADateString(endDate);
    const compareTo = dateStr || getTomorrowKSADate();
    if (compareTo > endStr) {
      const err = new Error("Subscription expired");
      err.code = "SUB_EXPIRED";
      throw err;
    }
  }
}

async function previewCustomMealPrice(req, res) {
  try {
    const { ingredients } = req.body || {};
    const snapshot = await buildCustomMealSnapshot(ingredients);
    return res.status(200).json({ ok: true, data: snapshot });
  } catch (err) {
    const status = err.code === "NOT_FOUND" ? 404 : 400;
    return errorResponse(res, status, err.code || "INVALID", err.message);
  }
}

async function addCustomMealToOrder(req, res) {
  const { id } = req.params;
  const { ingredients } = req.body || {};
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const order = await Order.findOne({ _id: id, userId: req.userId }).session(session);
    if (!order) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Order not found");
    }
    if (order.status !== "created" || order.paymentStatus !== "initiated") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "LOCKED", "Order is locked for edits");
    }

    let snapshot;
    try {
      snapshot = await buildCustomMealSnapshot(ingredients);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      const status = err.code === "NOT_FOUND" ? 404 : 400;
      return errorResponse(res, status, err.code || "INVALID", err.message);
    }

    order.customMeals = order.customMeals || [];
    order.customMeals.push(snapshot);
    if (!order.pricing) {
      order.pricing = {
        unitPrice: 0,
        premiumUnitPrice: 0,
        quantity: 0,
        subtotal: 0,
        deliveryFee: 0,
        total: 0,
        currency: "SAR",
      };
    }
    order.pricing.subtotal += snapshot.totalPrice;
    order.pricing.total += snapshot.totalPrice;

    await order.save({ session });

    if (order.paymentId) {
      await Payment.updateOne(
        { _id: order.paymentId, status: "initiated", applied: false },
        { $set: { amount: order.pricing.total } },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    await writeLog({
      entityType: "order",
      entityId: order._id,
      action: "custom_meal_added",
      byUserId: req.userId,
      byRole: "client",
      meta: { orderId: String(order._id), totalPrice: snapshot.totalPrice },
    });

    return res.status(200).json({ ok: true, data: order });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("customMealController.addCustomMealToOrder failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Failed to add custom meal");
  }
}

async function addCustomMealToSubscriptionDay(req, res) {
  const { id, date } = req.params;
  const { ingredients, successUrl, backUrl } = req.body || {};

  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }

  try {
    ensureActive(sub, date);
    if (!isValidKSADateString(date)) {
      const err = new Error("Invalid date format");
      err.code = "INVALID_DATE";
      throw err;
    }
    if (!isOnOrAfterTodayKSADate(date)) {
      const err = new Error("Date cannot be in the past");
      err.code = "INVALID_DATE";
      throw err;
    }
    const tomorrow = getTomorrowKSADate();
    if (!isOnOrAfterKSADate(date, tomorrow)) {
      const err = new Error("Date must be from tomorrow onward");
      err.code = "INVALID_DATE";
      throw err;
    }
    const endDate = sub.validityEndDate || sub.endDate;
    if (!isInSubscriptionRange(date, endDate)) {
      const err = new Error("Date outside subscription validity");
      err.code = "INVALID_DATE";
      throw err;
    }
  } catch (err) {
    const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
    return errorResponse(res, status, err.code || "INVALID_DATE", err.message);
  }

  const cutoffTime = await getSettingValue("cutoff_time", "00:00");
  const tomorrow = getTomorrowKSADate();
  if (date === tomorrow && !isBeforeCutoff(cutoffTime)) {
    return errorResponse(res, 400, "LOCKED", "Cutoff time passed for tomorrow");
  }

  try {
    const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).lean();
    if (day && day.status !== "open") {
      return errorResponse(res, 409, "LOCKED", "Day is locked");
    }

    const snapshot = await buildCustomMealSnapshot(ingredients);
    const appUrl = process.env.APP_URL || "https://example.com";

    const checkoutMetadata = {
      type: "custom_meal_day",
      subscriptionId: String(id),
      userId: String(req.userId),
      date,
    };

    const invoice = await createInvoice({
      amount: snapshot.totalPrice,
      description: `Custom meal (${date})`,
      callbackUrl: `${appUrl}/api/webhooks/moyasar`,
      successUrl: successUrl || `${appUrl}/payments/success`,
      backUrl: backUrl || `${appUrl}/payments/cancel`,
      metadata: checkoutMetadata,
    });

    const payment = await Payment.create({
      provider: "moyasar",
      type: "custom_meal_day",
      status: "initiated",
      applied: false,
      amount: snapshot.totalPrice,
      currency: invoice.currency || snapshot.currency || "SAR",
      userId: req.userId,
      subscriptionId: id,
      providerInvoiceId: invoice.id,
      metadata: {
        ...checkoutMetadata,
        snapshot,
      },
    });

    await writeLog({
      entityType: "payment",
      entityId: payment._id,
      action: "custom_meal_payment_initiated",
      byUserId: req.userId,
      byRole: "client",
      meta: { date, totalPrice: snapshot.totalPrice, subscriptionId: String(id) },
    });

    return res.status(200).json({
      ok: true,
      data: {
        payment_url: invoice.url,
        invoice_id: invoice.id,
        payment_id: payment.id,
        total: snapshot.totalPrice,
        currency: payment.currency,
      },
    });
  } catch (err) {
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "MAX_EXCEEDED" || err.code === "INVALID" ? 400 : 500;
    logger.error("customMealController.addCustomMealToSubscriptionDay failed", { error: err.message, stack: err.stack });
    return errorResponse(
      res,
      status,
      status === 500 ? "INTERNAL" : err.code || "INVALID",
      status === 500 ? "Failed to add custom meal" : err.message
    );
  }
}

module.exports = {
  previewCustomMealPrice,
  addCustomMealToOrder,
  addCustomMealToSubscriptionDay,
};
