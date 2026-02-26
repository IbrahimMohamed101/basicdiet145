const mongoose = require("mongoose");
const { addDays } = require("date-fns");
const Order = require("../models/Order");
const Meal = require("../models/Meal");
const Payment = require("../models/Payment");
const Setting = require("../models/Setting");
const {
  getTomorrowKSADate,
  isBeforeCutoff,
  isOnOrAfterKSADate,
  isValidKSADateString,
  toKSADateString,
} = require("../utils/date");
const { getRequestLang, pickLang } = require("../utils/i18n");
const { writeLog } = require("../utils/log");
const { logger } = require("../utils/logger");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

function addDaysToKSADateString(dateStr, days) {
  const base = new Date(`${dateStr}T00:00:00+03:00`);
  return toKSADateString(addDays(base, days));
}

async function checkoutOrder(req, res) {
  try {
    const {
      meals = [],
      customSalads = [],
      deliveryMode,
      deliveryAddress,
      deliveryWindow,
      deliveryDate,
    } = req.body || {};

    if ((!Array.isArray(meals) || meals.length === 0) && (!Array.isArray(customSalads) || customSalads.length === 0)) {
      return errorResponse(res, 400, "INVALID", "Meals or Custom Salads are required" );
    }
    if (!deliveryMode) {
      return errorResponse(res, 400, "INVALID", "Missing deliveryMode" );
    }
    if (deliveryMode === "delivery" && !deliveryAddress) {
      return errorResponse(res, 400, "INVALID", "Missing deliveryAddress" );
    }
    if (deliveryMode !== "delivery" && deliveryMode !== "pickup") {
      return errorResponse(res, 400, "INVALID", "Invalid deliveryMode" );
    }

    const windows = await getSettingValue("delivery_windows", []);
    if (deliveryWindow && windows.length && !windows.includes(deliveryWindow)) {
      return errorResponse(res, 400, "INVALID", "Invalid delivery window" );
    }

    let requestedDate = deliveryDate || getTomorrowKSADate();
    if (!isValidKSADateString(requestedDate)) {
      return errorResponse(res, 400, "INVALID_DATE", "Invalid deliveryDate" );
    }
    const tomorrow = getTomorrowKSADate();
    if (!isOnOrAfterKSADate(requestedDate, tomorrow)) {
      return errorResponse(res, 400, "INVALID_DATE", "deliveryDate must be from tomorrow onward" );
    }

    const cutoffTime = await getSettingValue("cutoff_time", "00:00");
    let effectiveDate = requestedDate;
    let dateAdjusted = false;
    if (requestedDate === tomorrow && !isBeforeCutoff(cutoffTime)) {
      effectiveDate = addDaysToKSADateString(tomorrow, 1);
      dateAdjusted = true;
    }

    const mealIds = meals.map((m) => (m && m.mealId ? String(m.mealId) : null)).filter(Boolean);
    if (mealIds.length !== meals.length) {
      return errorResponse(res, 400, "INVALID", "Each meal must include mealId" );
    }
    const uniqueIds = Array.from(new Set(mealIds));
    const mealDocs = await Meal.find({ _id: { $in: uniqueIds }, isActive: true }).lean();
    if (mealDocs.length !== uniqueIds.length) {
      return errorResponse(res, 404, "NOT_FOUND", "One or more meals not found" );
    }
    const mealMap = mealDocs.reduce((acc, m) => {
      acc[String(m._id)] = m;
      return acc;
    }, {});

    const regularPriceSar = Number(await getSettingValue("one_time_meal_price", 25));
    const premiumPriceSar = Number(await getSettingValue("one_time_premium_price", regularPriceSar));
    const deliveryFeeSar = Number(await getSettingValue("one_time_delivery_fee", 0));

    const regularUnit = Math.round(regularPriceSar * 100);
    const premiumUnit = Math.round(premiumPriceSar * 100);
    const deliveryFee = deliveryMode === "delivery" ? Math.round(deliveryFeeSar * 100) : 0;
    const lang = getRequestLang(req);

    let quantity = 0;
    let subtotal = 0;
    const items = meals.map((m) => {
      const meal = mealMap[String(m.mealId)];
      const rawQty = parseInt(m.quantity || 1, 10);
      const qty = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;
      const unitPrice = meal.type === "premium" ? premiumUnit : regularUnit;
      quantity += qty;
      subtotal += unitPrice * qty;
      return {
        mealId: meal._id,
        // Fix: keep Order.items[].name as plain string to match schema and avoid CastError.
        name: pickLang(meal.name, lang),
        type: meal.type,
        quantity: qty,
        unitPrice,
      };
    });

    // Process custom salads
    const { buildCustomSaladSnapshot } = require("../services/customSaladService");
    const customSaladSnapshots = [];
    for (const saladData of customSalads) {
      const snapshot = await buildCustomSaladSnapshot(saladData.ingredients || saladData.items || []);
      customSaladSnapshots.push(snapshot);
      subtotal += snapshot.totalPrice;
    }

    const total = subtotal + deliveryFee;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const createdOrders = await Order.create(
        [
          {
            userId: req.userId,
            status: "created",
            deliveryMode,
            deliveryDate: effectiveDate,
            items,
            customSalads: customSaladSnapshots,
            pricing: {
              unitPrice: regularUnit,
              premiumUnitPrice: premiumUnit,
              quantity,
              subtotal,
              deliveryFee,
              total,
              currency: "SAR",
            },
            deliveryAddress: deliveryMode === "delivery" ? deliveryAddress : undefined,
            deliveryWindow: deliveryMode === "delivery" ? deliveryWindow : undefined,
            paymentStatus: "initiated",
          },
        ],
        { session }
      );
      const order = createdOrders[0];

      const payment = await Payment.create(
        [
          {
            provider: "moyasar",
            type: "one_time_order",
            status: "initiated",
            amount: total,
            currency: "SAR",
            userId: req.userId,
            orderId: order._id,
            metadata: {
              type: "one_time_order",
              orderId: String(order._id),
              userId: String(req.userId),
              deliveryDate: effectiveDate,
            },
          },
        ],
        { session }
      );

      order.paymentId = payment[0]._id;
      await order.save({ session });

      await session.commitTransaction();
      session.endSession();

      await writeLog({
        entityType: "order",
        entityId: order._id,
        action: "order_created",
        byUserId: req.userId,
        byRole: "client",
        meta: { deliveryDate: effectiveDate, total, dateAdjusted },
      });

      return res.status(200).json({
        ok: true,
        data: {
          orderId: order._id,
          deliveryDate: effectiveDate,
          dateAdjusted,
          payment_url: `https://mock-payment.com/orders/${order._id}`,
          pricing: order.pricing,
        },
      });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  } catch (err) {
    logger.error("orderController.checkoutOrder failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Order checkout failed");
  }
}

async function confirmOrder(req, res) {
  const { id } = req.params;
  // MEDIUM AUDIT FIX: Validate path id before DB access to avoid cast failures.
  try {
    validateObjectId(id, "orderId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  // SECURITY FIX: Mock confirmation endpoint must be disabled in production.
  if (process.env.NODE_ENV === "production") {
    return errorResponse(res, 403, "FORBIDDEN", "Mock confirmation is disabled in production");
  }
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const order = await Order.findOne({ _id: id, userId: req.userId }).session(session);
    if (!order) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Order not found" );
    }

    if (order.status === "canceled" || order.status === "fulfilled") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Order cannot be confirmed" );
    }

    if (order.status === "created") {
      order.status = "confirmed";
      order.confirmedAt = new Date();
    }
    order.paymentStatus = "paid";
    await order.save({ session });

    if (order.paymentId) {
      await Payment.updateOne(
        { _id: order.paymentId },
        { $set: { status: "paid", applied: true, paidAt: new Date() } },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    await writeLog({
      entityType: "order",
      entityId: order._id,
      action: "order_confirmed_mock",
      byUserId: req.userId,
      byRole: "client",
      meta: { orderId: String(order._id) },
    });

    return res.status(200).json({ ok: true, data: order });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("orderController.confirmOrder failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Order confirmation failed");
  }
}

async function listOrders(req, res) {
  // MEDIUM AUDIT FIX: Guard optional route id if this handler is ever mounted under a parameterized parent path.
  if (req.params && req.params.id) {
    try {
      validateObjectId(req.params.id, "orderId");
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }
  }
  const orders = await Order.find({ userId: req.userId }).sort({ createdAt: -1 }).lean();
  return res.status(200).json({ ok: true, data: orders });
}

async function getOrder(req, res) {
  const { id } = req.params;
  // MEDIUM AUDIT FIX: Validate path id before DB access to avoid cast failures.
  try {
    validateObjectId(id, "orderId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const order = await Order.findOne({ _id: id, userId: req.userId }).lean();
  if (!order) {
    return errorResponse(res, 404, "NOT_FOUND", "Order not found" );
  }
  return res.status(200).json({ ok: true, data: order });
}

module.exports = {
  checkoutOrder,
  confirmOrder,
  listOrders,
  getOrder,
};
