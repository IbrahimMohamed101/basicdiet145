const mongoose = require("mongoose");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const Order = require("../models/Order");
const Payment = require("../models/Payment");
const Setting = require("../models/Setting");
const { buildCustomSaladSnapshot } = require("../services/customSaladService");
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

async function previewCustomSaladPrice(req, res) {
  try {
    const { ingredients } = req.body || {};
    const snapshot = await buildCustomSaladSnapshot(ingredients);
    return res.status(200).json({ ok: true, data: snapshot });
  } catch (err) {
    const status = err.code === "NOT_FOUND" ? 404 : 400;
    return res.status(status).json({ ok: false, error: { code: err.code || "INVALID", message: err.message } });
  }
}

async function addCustomSaladToOrder(req, res) {
  const { id } = req.params;
  const { ingredients } = req.body || {};
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const order = await Order.findOne({ _id: id, userId: req.userId }).session(session);
    if (!order) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Order not found" } });
    }
    if (order.status !== "created" || order.paymentStatus !== "initiated") {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({ ok: false, error: { code: "LOCKED", message: "Order is locked for edits" } });
    }

    let snapshot;
    try {
      snapshot = await buildCustomSaladSnapshot(ingredients);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      const status = err.code === "NOT_FOUND" ? 404 : 400;
      return res.status(status).json({ ok: false, error: { code: err.code || "INVALID", message: err.message } });
    }

    order.customSalads = order.customSalads || [];
    order.customSalads.push(snapshot);
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
      action: "custom_salad_added",
      byUserId: req.userId,
      byRole: "client",
      meta: { orderId: String(order._id), totalPrice: snapshot.totalPrice },
    });

    return res.status(200).json({ ok: true, data: order });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("Add custom salad to order failed", { error: err.message, stack: err.stack });
    return res.status(500).json({ ok: false, error: { code: "INTERNAL", message: "Failed to add custom salad" } });
  }
}

async function addCustomSaladToSubscriptionDay(req, res) {
  const { id, date } = req.params;
  const { ingredients } = req.body || {};

  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Subscription not found" } });
  try {
    ensureActive(sub, date);
    if (!isValidKSADateString(date)) {
      const err = new Error("Invalid date format");
      err.code = "INVALID_DATE";
      throw err;
    }
    
    // CR-09 FIX: Add lower bound validation - date must be >= today
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
    return res.status(status).json({ ok: false, error: { code: err.code || "INVALID_DATE", message: err.message } });
  }

  const cutoffTime = await getSettingValue("cutoff_time", "00:00");
  const tomorrow = getTomorrowKSADate();
  if (date === tomorrow && !isBeforeCutoff(cutoffTime)) {
    return res.status(400).json({ ok: false, error: { code: "LOCKED", message: "Cutoff time passed for tomorrow" } });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).session(session);
    if (day && day.status !== "open") {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({ ok: false, error: { code: "LOCKED", message: "Day is locked" } });
    }

    let snapshot;
    try {
      snapshot = await buildCustomSaladSnapshot(ingredients);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      const status = err.code === "NOT_FOUND" ? 404 : 400;
      return res.status(status).json({ ok: false, error: { code: err.code || "INVALID", message: err.message } });
    }

    let updatedDay;
    if (!day) {
      const created = await SubscriptionDay.create(
        [
          {
            subscriptionId: id,
            date,
            status: "open",
            customSalads: [snapshot],
          },
        ],
        { session }
      );
      updatedDay = created[0];
    } else {
      updatedDay = await SubscriptionDay.findOneAndUpdate(
        { _id: day._id, status: "open" },
        { $push: { customSalads: snapshot } },
        { new: true, session }
      );
      if (!updatedDay) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({ ok: false, error: { code: "LOCKED", message: "Day already locked" } });
      }
    }

    const payment = await Payment.create(
      [
        {
          provider: "moyasar",
          type: "custom_salad_day",
          status: "initiated",
          applied: false,
          amount: snapshot.totalPrice,
          currency: snapshot.currency || "SAR",
          userId: req.userId,
          subscriptionId: id,
          metadata: {
            type: "custom_salad_day",
            subscriptionId: String(id),
            date,
            totalPrice: snapshot.totalPrice,
          },
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    await writeLog({
      entityType: "subscription_day",
      entityId: updatedDay._id,
      action: "custom_salad_added",
      byUserId: req.userId,
      byRole: "client",
      meta: { date, paymentId: String(payment[0]._id), totalPrice: snapshot.totalPrice },
    });

    return res.status(200).json({ ok: true, data: updatedDay });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("Add custom salad to subscription day failed", { error: err.message, stack: err.stack });
    return res.status(500).json({ ok: false, error: { code: "INTERNAL", message: "Failed to add custom salad" } });
  }
}

module.exports = {
  previewCustomSaladPrice,
  addCustomSaladToOrder,
  addCustomSaladToSubscriptionDay,
};
