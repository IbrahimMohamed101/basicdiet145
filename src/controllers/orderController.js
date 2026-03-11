const mongoose = require("mongoose");
const { addDays } = require("date-fns");
const Order = require("../models/Order");
const Meal = require("../models/Meal");
const Payment = require("../models/Payment");
const Delivery = require("../models/Delivery");
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

function serializePaymentStatus(order, payment) {
  const effectiveStatus = payment && payment.status ? payment.status : order.paymentStatus || null;
  return {
    orderId: String(order._id),
    orderStatus: order.status,
    paymentStatus: effectiveStatus,
    orderPaymentStatus: order.paymentStatus || null,
    payment: payment
      ? {
        id: String(payment._id),
        provider: payment.provider,
        type: payment.type,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        providerInvoiceId: payment.providerInvoiceId || null,
        providerPaymentId: payment.providerPaymentId || null,
        paidAt: payment.paidAt || null,
        createdAt: payment.createdAt || null,
        updatedAt: payment.updatedAt || null,
      }
      : null,
  };
}

async function cancelOrderForClient({ order, session, requireUnpaid = false }) {
  if (order.status === "canceled") {
    return { order, payment: null, idempotent: true };
  }

  if (!["created", "confirmed"].includes(order.status)) {
    const err = new Error("Order cannot be canceled after preparation starts");
    err.status = 409;
    err.code = "INVALID_TRANSITION";
    throw err;
  }

  let payment = null;
  if (order.paymentId) {
    payment = await Payment.findById(order.paymentId).session(session);
  }
  if (!payment) {
    payment = await Payment.findOne({ orderId: order._id }).sort({ createdAt: -1 }).session(session);
  }

  const effectivePaymentStatus = payment && payment.status ? payment.status : order.paymentStatus || null;
  if (requireUnpaid && effectivePaymentStatus && effectivePaymentStatus !== "initiated") {
    const err = new Error("Adjusted delivery date can only be rejected before payment completes");
    err.status = 409;
    err.code = "INVALID_TRANSITION";
    throw err;
  }

  order.status = "canceled";
  order.canceledAt = new Date();
  if (order.paymentStatus === "initiated") {
    order.paymentStatus = "canceled";
  }
  await order.save({ session });

  if (payment && payment.status === "initiated") {
    payment.status = "canceled";
    await payment.save({ session });
  }

  await Delivery.updateOne(
    { orderId: order._id, status: { $ne: "delivered" } },
    { $set: { status: "canceled" } },
    { session }
  );

  return { order, payment, idempotent: false };
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
            requestedDeliveryDate: requestedDate,
            deliveryDate: effectiveDate,
            deliveryDateAdjusted: dateAdjusted,
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
              requestedDeliveryDate: requestedDate,
              deliveryDate: effectiveDate,
              deliveryDateAdjusted: dateAdjusted,
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
          requestedDeliveryDate: requestedDate,
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

async function cancelOrder(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "orderId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const order = await Order.findOne({ _id: id, userId: req.userId }).session(session);
    if (!order) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Order not found");
    }

    const result = await cancelOrderForClient({ order, session });

    await session.commitTransaction();
    session.endSession();

    await writeLog({
      entityType: "order",
      entityId: order._id,
      action: "order_canceled_by_client",
      byUserId: req.userId,
      byRole: "client",
      meta: { orderId: String(order._id) },
    });

    return res.status(200).json({ ok: true, data: result.order, ...(result.idempotent ? { idempotent: true } : {}) });
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    if (err && err.code && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    logger.error("orderController.cancelOrder failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Order cancellation failed");
  }
}

async function rejectAdjustedDeliveryDate(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "orderId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const order = await Order.findOne({ _id: id, userId: req.userId }).session(session);
    if (!order) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Order not found");
    }

    const requestedDeliveryDate = String(order.requestedDeliveryDate || "").trim();
    if (!order.deliveryDateAdjusted || !requestedDeliveryDate || requestedDeliveryDate === String(order.deliveryDate)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Order does not have an adjusted delivery date");
    }

    const result = await cancelOrderForClient({ order, session, requireUnpaid: true });

    await session.commitTransaction();
    session.endSession();

    await writeLog({
      entityType: "order",
      entityId: order._id,
      action: "order_adjusted_date_rejected_by_client",
      byUserId: req.userId,
      byRole: "client",
      meta: {
        orderId: String(order._id),
        requestedDeliveryDate,
        adjustedDeliveryDate: order.deliveryDate,
      },
    });

    return res.status(200).json({
      ok: true,
      data: {
        order: result.order,
        requestedDeliveryDate,
        adjustedDeliveryDate: order.deliveryDate,
        rejected: true,
      },
      ...(result.idempotent ? { idempotent: true } : {}),
    });
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    if (err && err.code && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    logger.error("orderController.rejectAdjustedDeliveryDate failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Adjusted delivery date rejection failed");
  }
}

async function getOrderPaymentStatus(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "orderId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const order = await Order.findOne({ _id: id, userId: req.userId }).lean();
  if (!order) {
    return errorResponse(res, 404, "NOT_FOUND", "Order not found");
  }

  let payment = null;
  if (order.paymentId) {
    payment = await Payment.findById(order.paymentId).lean();
  }
  if (!payment) {
    payment = await Payment.findOne({ orderId: order._id }).sort({ createdAt: -1 }).lean();
  }

  return res.status(200).json({
    ok: true,
    data: serializePaymentStatus(order, payment),
  });
}

module.exports = {
  checkoutOrder,
  confirmOrder,
  listOrders,
  getOrder,
  cancelOrder,
  rejectAdjustedDeliveryDate,
  getOrderPaymentStatus,
};
