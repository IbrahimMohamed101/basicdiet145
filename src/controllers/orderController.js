const crypto = require("crypto");
const mongoose = require("mongoose");
const { addDays } = require("date-fns");
const Order = require("../models/Order");
const Meal = require("../models/Meal");
const Payment = require("../models/Payment");
const Delivery = require("../models/Delivery");
const Setting = require("../models/Setting");
const { createInvoice, getInvoice } = require("../services/moyasarService");
const { notifyOrderUser } = require("../services/orderNotificationService");
const { buildCustomSaladSnapshot } = require("../services/customSaladService");
const { buildCustomMealSnapshot } = require("../services/customMealService");
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

const SYSTEM_CURRENCY = "SAR";
const TERMINAL_PAYMENT_FAILURE_STATUSES = new Set(["failed", "canceled", "expired"]);

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

function addDaysToKSADateString(dateStr, days) {
  const base = new Date(`${dateStr}T00:00:00+03:00`);
  return toKSADateString(addDays(base, days));
}

function normalizeCurrencyValue(value) {
  return String(value || SYSTEM_CURRENCY).trim().toUpperCase();
}

function assertSystemCurrencyOrThrow(value, fieldName) {
  const currency = normalizeCurrencyValue(value);
  if (currency !== SYSTEM_CURRENCY) {
    const err = new Error(`${fieldName} must be ${SYSTEM_CURRENCY}`);
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  return currency;
}

function parseIdempotencyKey(rawValue) {
  if (rawValue === undefined || rawValue === null) return "";
  const value = String(rawValue).trim();
  if (!value) return "";
  if (value.length > 128) {
    const err = new Error("idempotencyKey must be at most 128 characters");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  return value;
}

function normalizeProviderPaymentStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "cancelled" || normalized === "voided") return "canceled";
  if (normalized === "captured") return "paid";
  if (["authorized", "verified", "on_hold"].includes(normalized)) return "initiated";
  if (["initiated", "paid", "failed", "canceled", "expired", "refunded"].includes(normalized)) {
    return normalized;
  }
  return null;
}

function pickProviderInvoicePayment(invoice, payment) {
  const attempts = Array.isArray(invoice && invoice.payments)
    ? invoice.payments.filter((item) => item && typeof item === "object")
    : [];
  if (!attempts.length) return null;

  if (payment && payment.providerPaymentId) {
    const matched = attempts.find((item) => String(item.id || "") === String(payment.providerPaymentId));
    if (matched) return matched;
  }

  const paidAttempts = attempts.filter((item) => normalizeProviderPaymentStatus(item.status) === "paid");
  if (paidAttempts.length) {
    return paidAttempts[paidAttempts.length - 1];
  }

  return attempts[attempts.length - 1];
}

function canonicalizeAddress(address) {
  if (!address || typeof address !== "object") return null;
  return {
    line1: String(address.line1 || "").trim(),
    line2: String(address.line2 || "").trim(),
    city: String(address.city || "").trim(),
    notes: String(address.notes || "").trim(),
  };
}

function canonicalizeIngredientItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      ingredientId: String(item && item.ingredientId ? item.ingredientId : "").trim(),
      quantity: Number(item && item.quantity ? item.quantity : 1),
    }))
    .filter((item) => item.ingredientId)
    .sort((a, b) => (
      a.ingredientId.localeCompare(b.ingredientId)
      || a.quantity - b.quantity
    ));
}

function canonicalizeCustomSalads(customSalads) {
  return (Array.isArray(customSalads) ? customSalads : [])
    .map((salad) => canonicalizeIngredientItems(salad && (salad.ingredients || salad.items)))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function canonicalizeCustomMeals(customMeals) {
  return (Array.isArray(customMeals) ? customMeals : [])
    .map((meal) => canonicalizeIngredientItems(meal && (meal.ingredients || meal.items)))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function buildOrderCheckoutRequestHash({
  userId,
  meals,
  customSalads,
  customMeals,
  deliveryMode,
  deliveryAddress,
  deliveryWindow,
  requestedDeliveryDate,
  effectiveDeliveryDate,
}) {
  const canonicalMeals = (Array.isArray(meals) ? meals : [])
    .map((meal) => ({
      mealId: String(meal && meal.mealId ? meal.mealId : "").trim(),
      quantity: Number(meal && meal.quantity ? meal.quantity : 1),
    }))
    .filter((meal) => meal.mealId)
    .sort((a, b) => (
      a.mealId.localeCompare(b.mealId)
      || a.quantity - b.quantity
    ));

  const canonicalPayload = {
    userId: String(userId),
    deliveryMode: String(deliveryMode || "").trim(),
    deliveryWindow: String(deliveryWindow || "").trim(),
    requestedDeliveryDate: String(requestedDeliveryDate || "").trim(),
    effectiveDeliveryDate: String(effectiveDeliveryDate || "").trim(),
    deliveryAddress: canonicalizeAddress(deliveryAddress),
    meals: canonicalMeals,
    customSalads: canonicalizeCustomSalads(customSalads),
    customMeals: canonicalizeCustomMeals(customMeals),
  };

  return crypto.createHash("sha256").update(JSON.stringify(canonicalPayload)).digest("hex");
}

function resolveOrderPaymentUrl(order, payment) {
  const metadata = payment && payment.metadata && typeof payment.metadata === "object"
    ? payment.metadata
    : {};
  return String(
    (order && order.paymentUrl)
    || metadata.paymentUrl
    || ""
  ).trim();
}

function buildProviderInvoicePayload(providerInvoice, payment, fallbackUrl) {
  if (!providerInvoice) return null;
  const providerPayment = pickProviderInvoicePayment(providerInvoice, payment);
  const providerStatus = normalizeProviderPaymentStatus(
    providerPayment && providerPayment.status ? providerPayment.status : providerInvoice.status
  );

  return {
    id: providerInvoice.id || null,
    status: providerStatus || String(providerInvoice.status || "").trim().toLowerCase() || null,
    amount: Number.isFinite(Number(providerInvoice.amount)) ? Number(providerInvoice.amount) : null,
    currency: providerInvoice.currency || null,
    url: providerInvoice.url || fallbackUrl || "",
    updatedAt: providerInvoice.updated_at || providerInvoice.updatedAt || null,
    attemptsCount: Array.isArray(providerInvoice.payments) ? providerInvoice.payments.length : 0,
  };
}

function serializePaymentStatus(order, payment, { providerInvoice = null, checkedProvider = false, synchronized = false } = {}) {
  const effectiveStatus = payment && payment.status ? payment.status : order.paymentStatus || null;
  const paymentUrl = resolveOrderPaymentUrl(order, payment);

  return {
    orderId: String(order._id),
    orderStatus: order.status,
    paymentStatus: effectiveStatus,
    orderPaymentStatus: order.paymentStatus || null,
    paymentUrl,
    providerInvoiceId:
      order.providerInvoiceId
      || (payment && payment.providerInvoiceId)
      || null,
    providerPaymentId:
      order.providerPaymentId
      || (payment && payment.providerPaymentId)
      || null,
    checkedProvider: Boolean(checkedProvider),
    synchronized: Boolean(synchronized),
    providerInvoice: buildProviderInvoicePayload(providerInvoice, payment, paymentUrl),
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

function buildOrderCheckoutPayload(order, payment, { reused = false } = {}) {
  return {
    orderId: String(order._id),
    paymentId: payment ? String(payment._id) : (order.paymentId ? String(order.paymentId) : null),
    requestedDeliveryDate: order.requestedDeliveryDate,
    deliveryDate: order.deliveryDate,
    dateAdjusted: Boolean(order.deliveryDateAdjusted),
    payment_url: resolveOrderPaymentUrl(order, payment),
    invoice_id:
      order.providerInvoiceId
      || (payment && payment.providerInvoiceId)
      || null,
    pricing: order.pricing,
    ...(reused ? { reused: true } : {}),
  };
}

function isPendingOrderCheckoutReusable(order, payment) {
  const hasPaymentUrl = Boolean(resolveOrderPaymentUrl(order, payment));
  const paymentIsReusable = !payment || (
    payment.status === "initiated"
    && payment.applied !== true
  );

  return Boolean(
    order
    && order.status === "created"
    && order.paymentStatus === "initiated"
    && hasPaymentUrl
    && paymentIsReusable
  );
}

async function findOrderPayment(order, userId) {
  if (!order) return null;
  if (order.paymentId) {
    const paymentById = await Payment.findOne({
      _id: order.paymentId,
      ...(userId ? { userId } : {}),
    }).lean();
    if (paymentById) return paymentById;
  }

  return Payment.findOne({
    orderId: order._id,
    ...(userId ? { userId } : {}),
  })
    .sort({ createdAt: -1 })
    .lean();
}

async function synchronizeOrderWithPaymentStatus({
  order,
  payment,
  status,
  paymentUrl = "",
  providerInvoiceId = "",
  providerPaymentId = "",
  session,
}) {
  if (payment && payment._id) {
    order.paymentId = payment._id;
  }
  if (providerInvoiceId) {
    order.providerInvoiceId = providerInvoiceId;
  }
  if (providerPaymentId) {
    order.providerPaymentId = providerPaymentId;
  }
  if (paymentUrl) {
    order.paymentUrl = paymentUrl;
  }
  order.paymentStatus = status;

  if (status === "paid") {
    if (order.status === "created" || order.status === "canceled") {
      order.status = "confirmed";
    }
    order.confirmedAt = order.confirmedAt || new Date();
    if (order.status !== "fulfilled") {
      order.canceledAt = undefined;
    }
  } else if (TERMINAL_PAYMENT_FAILURE_STATUSES.has(status) && order.status === "created") {
    order.status = "canceled";
    order.canceledAt = order.canceledAt || new Date();
  }

  await order.save({ session });
  return order;
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
  let createdOrder = null;
  let createdPayment = null;
  let idempotencyKey = "";
  let requestHash = "";

  try {
    const body = req.body || {};
    const {
      meals = [],
      customSalads = [],
      customMeals = [],
      deliveryMode,
      deliveryAddress,
      deliveryWindow,
      deliveryDate,
      successUrl,
      backUrl,
    } = body;

    idempotencyKey = parseIdempotencyKey(
      req.get("Idempotency-Key")
      || req.get("X-Idempotency-Key")
      || body.idempotencyKey
    );

    if (
      (!Array.isArray(meals) || meals.length === 0)
      && (!Array.isArray(customSalads) || customSalads.length === 0)
      && (!Array.isArray(customMeals) || customMeals.length === 0)
    ) {
      return errorResponse(res, 400, "INVALID", "Meals, Custom Salads, or Custom Meals are required");
    }
    if (!deliveryMode) {
      return errorResponse(res, 400, "INVALID", "Missing deliveryMode");
    }
    if (deliveryMode === "delivery" && !deliveryAddress) {
      return errorResponse(res, 400, "INVALID", "Missing deliveryAddress");
    }
    if (deliveryMode !== "delivery" && deliveryMode !== "pickup") {
      return errorResponse(res, 400, "INVALID", "Invalid deliveryMode");
    }

    const windows = await getSettingValue("delivery_windows", []);
    if (deliveryWindow && windows.length && !windows.includes(deliveryWindow)) {
      return errorResponse(res, 400, "INVALID", "Invalid delivery window");
    }

    let requestedDate = deliveryDate || getTomorrowKSADate();
    if (!isValidKSADateString(requestedDate)) {
      return errorResponse(res, 400, "INVALID_DATE", "Invalid deliveryDate");
    }
    const tomorrow = getTomorrowKSADate();
    if (!isOnOrAfterKSADate(requestedDate, tomorrow)) {
      return errorResponse(res, 400, "INVALID_DATE", "deliveryDate must be from tomorrow onward");
    }

    const cutoffTime = await getSettingValue("cutoff_time", "00:00");
    let effectiveDate = requestedDate;
    let dateAdjusted = false;
    if (requestedDate === tomorrow && !isBeforeCutoff(cutoffTime)) {
      effectiveDate = addDaysToKSADateString(tomorrow, 1);
      dateAdjusted = true;
    }

    const mealIds = meals.map((meal) => (meal && meal.mealId ? String(meal.mealId) : null)).filter(Boolean);
    if (mealIds.length !== meals.length) {
      return errorResponse(res, 400, "INVALID", "Each meal must include mealId");
    }

    const uniqueIds = Array.from(new Set(mealIds));
    const mealDocs = await Meal.find({ _id: { $in: uniqueIds }, isActive: true }).lean();
    if (mealDocs.length !== uniqueIds.length) {
      return errorResponse(res, 404, "NOT_FOUND", "One or more meals not found");
    }

    const unavailableMeals = mealDocs.filter((meal) => meal.availableForOrder === false);
    if (unavailableMeals.length) {
      return errorResponse(res, 409, "INVALID_SELECTION", "One or more meals are not available for one-time orders");
    }

    requestHash = buildOrderCheckoutRequestHash({
      userId: req.userId,
      meals,
      customSalads,
      customMeals,
      deliveryMode,
      deliveryAddress,
      deliveryWindow,
      requestedDeliveryDate: requestedDate,
      effectiveDeliveryDate: effectiveDate,
    });

    if (idempotencyKey) {
      const existingByKey = await Order.findOne({
        userId: req.userId,
        idempotencyKey,
      })
        .sort({ createdAt: -1 })
        .lean();

      if (existingByKey) {
        if (existingByKey.requestHash && existingByKey.requestHash !== requestHash) {
          return errorResponse(
            res,
            409,
            "IDEMPOTENCY_CONFLICT",
            "idempotencyKey is already used with a different checkout payload"
          );
        }

        const existingPayment = await findOrderPayment(existingByKey, req.userId);
        if (isPendingOrderCheckoutReusable(existingByKey, existingPayment) || existingByKey.paymentStatus === "paid") {
          return res.status(200).json({
            ok: true,
            data: buildOrderCheckoutPayload(existingByKey, existingPayment, { reused: true }),
          });
        }

        if (existingByKey.paymentStatus === "initiated") {
          return errorResponse(
            res,
            409,
            "CHECKOUT_IN_PROGRESS",
            "Checkout initialization is still in progress. Retry with the same idempotency key.",
            { orderId: String(existingByKey._id) }
          );
        }

        return errorResponse(
          res,
          409,
          "IDEMPOTENCY_CONFLICT",
          `idempotencyKey is already finalized with status ${existingByKey.paymentStatus}`
        );
      }
    }

    const existingByHash = await Order.findOne({
      userId: req.userId,
      requestHash,
      paymentStatus: "initiated",
    })
      .sort({ createdAt: -1 })
      .lean();

    if (existingByHash) {
      const existingPayment = await findOrderPayment(existingByHash, req.userId);
      if (isPendingOrderCheckoutReusable(existingByHash, existingPayment)) {
        return res.status(200).json({
          ok: true,
          data: buildOrderCheckoutPayload(existingByHash, existingPayment, { reused: true }),
        });
      }

      return errorResponse(
        res,
        409,
        "CHECKOUT_IN_PROGRESS",
        "Checkout initialization is still in progress. Retry with the same order request.",
        { orderId: String(existingByHash._id) }
      );
    }

    const mealMap = mealDocs.reduce((acc, meal) => {
      acc[String(meal._id)] = meal;
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
    const items = meals.map((mealSelection) => {
      const meal = mealMap[String(mealSelection.mealId)];
      const rawQty = parseInt(mealSelection.quantity || 1, 10);
      const qty = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;
      const unitPrice = meal.type === "premium" ? premiumUnit : regularUnit;

      quantity += qty;
      subtotal += unitPrice * qty;

      return {
        mealId: meal._id,
        name: pickLang(meal.name, lang),
        type: meal.type,
        quantity: qty,
        unitPrice,
      };
    });

    const customSaladSnapshots = [];
    for (const saladData of customSalads) {
      const snapshot = await buildCustomSaladSnapshot(saladData.ingredients || saladData.items || []);
      customSaladSnapshots.push(snapshot);
      subtotal += snapshot.totalPrice;
    }

    const customMealSnapshots = [];
    for (const mealData of customMeals) {
      const snapshot = await buildCustomMealSnapshot(mealData.ingredients || mealData.items || []);
      customMealSnapshots.push(snapshot);
      subtotal += snapshot.totalPrice;
    }

    const total = subtotal + deliveryFee;
    const paymentMetadata = {
      type: "one_time_order",
      userId: String(req.userId),
      requestedDeliveryDate: requestedDate,
      deliveryDate: effectiveDate,
      deliveryDateAdjusted: dateAdjusted,
      paymentUrl: "",
    };

    createdOrder = await Order.create({
      userId: req.userId,
      status: "created",
      deliveryMode,
      requestedDeliveryDate: requestedDate,
      deliveryDate: effectiveDate,
      deliveryDateAdjusted: dateAdjusted,
      items,
      customSalads: customSaladSnapshots,
      customMeals: customMealSnapshots,
      pricing: {
        unitPrice: regularUnit,
        premiumUnitPrice: premiumUnit,
        quantity,
        subtotal,
        deliveryFee,
        total,
        currency: SYSTEM_CURRENCY,
      },
      deliveryAddress: deliveryMode === "delivery" ? deliveryAddress : undefined,
      deliveryWindow: deliveryMode === "delivery" ? deliveryWindow : undefined,
      paymentStatus: "initiated",
      paymentUrl: "",
      idempotencyKey,
      requestHash,
    });

    const appUrl = process.env.APP_URL || "https://example.com";
    const invoice = await createInvoice({
      amount: total,
      currency: SYSTEM_CURRENCY,
      description: `One-time order (${quantity + customSaladSnapshots.length + customMealSnapshots.length} items)`,
      callbackUrl: `${appUrl}/api/webhooks/moyasar`,
      successUrl: successUrl || `${appUrl}/payments/success`,
      backUrl: backUrl || `${appUrl}/payments/cancel`,
      metadata: {
        ...paymentMetadata,
        orderId: String(createdOrder._id),
      },
    });
    const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || SYSTEM_CURRENCY, "Invoice currency");
    if (Number.isFinite(Number(invoice.amount)) && Number(invoice.amount) !== total) {
      return errorResponse(res, 502, "PAYMENT_PROVIDER_ERROR", "Invoice amount mismatch");
    }

    createdPayment = await Payment.create({
      provider: "moyasar",
      type: "one_time_order",
      status: "initiated",
      amount: total,
      currency: invoiceCurrency,
      userId: req.userId,
      orderId: createdOrder._id,
      providerInvoiceId: invoice.id,
      metadata: {
        ...paymentMetadata,
        orderId: String(createdOrder._id),
        paymentUrl: invoice.url || "",
      },
    });

    createdOrder.paymentId = createdPayment._id;
    createdOrder.providerInvoiceId = invoice.id;
    createdOrder.paymentUrl = invoice.url || "";
    await createdOrder.save();

    await writeLog({
      entityType: "order",
      entityId: createdOrder._id,
      action: "order_created",
      byUserId: req.userId,
      byRole: "client",
      meta: { deliveryDate: effectiveDate, total, dateAdjusted },
    });

    return res.status(201).json({
      ok: true,
      data: buildOrderCheckoutPayload(createdOrder, createdPayment),
    });
  } catch (err) {
    if (err.code === "VALIDATION_ERROR") {
      return errorResponse(res, 400, "INVALID", err.message);
    }
    if (err.code === "CONFIG") {
      return errorResponse(res, 500, "CONFIG", err.message);
    }
    if (err && err.code === 11000) {
      const existingOrder = await Order.findOne({
        userId: req.userId,
        $or: [
          idempotencyKey ? { idempotencyKey } : null,
          requestHash ? { requestHash, paymentStatus: "initiated" } : null,
        ].filter(Boolean),
      })
        .sort({ createdAt: -1 })
        .lean();

      if (existingOrder) {
        const existingPayment = await findOrderPayment(existingOrder, req.userId);
        if (isPendingOrderCheckoutReusable(existingOrder, existingPayment) || existingOrder.paymentStatus === "paid") {
          return res.status(200).json({
            ok: true,
            data: buildOrderCheckoutPayload(existingOrder, existingPayment, { reused: true }),
          });
        }

        if (existingOrder.paymentStatus === "initiated") {
          return errorResponse(
            res,
            409,
            "CHECKOUT_IN_PROGRESS",
            "Checkout initialization is still in progress. Retry with the same order request.",
            { orderId: String(existingOrder._id) }
          );
        }

        return errorResponse(
          res,
          409,
          "IDEMPOTENCY_CONFLICT",
          `Order request is already finalized with payment status ${existingOrder.paymentStatus}`
        );
      }
    }

    if (createdOrder) {
      try {
        if (createdPayment) {
          await Order.updateOne(
            { _id: createdOrder._id },
            {
              $set: {
                paymentId: createdPayment._id,
                providerInvoiceId: createdPayment.providerInvoiceId || "",
                paymentUrl: resolveOrderPaymentUrl(createdOrder, createdPayment),
              },
            }
          );
        } else {
          await Order.updateOne(
            { _id: createdOrder._id, paymentStatus: "initiated" },
            {
              $set: {
                paymentStatus: "failed",
                status: "canceled",
                canceledAt: new Date(),
              },
            }
          );
        }
      } catch (recoveryErr) {
        logger.error("orderController.checkoutOrder recovery failed", {
          orderId: String(createdOrder._id),
          error: recoveryErr.message,
          stack: recoveryErr.stack,
        });
      }
    }

    logger.error("orderController.checkoutOrder failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Order checkout failed");
  }
}

async function confirmOrder(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "orderId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

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
      return errorResponse(res, 404, "NOT_FOUND", "Order not found");
    }

    if (order.status === "canceled" || order.status === "fulfilled") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Order cannot be confirmed");
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

    await notifyOrderUser({ order, type: "paid", paymentId: order.paymentId });

    return res.status(200).json({ ok: true, data: order });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("orderController.confirmOrder failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Order confirmation failed");
  }
}

async function listOrders(req, res) {
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
  try {
    validateObjectId(id, "orderId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const order = await Order.findOne({ _id: id, userId: req.userId }).lean();
  if (!order) {
    return errorResponse(res, 404, "NOT_FOUND", "Order not found");
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

  const payment = await findOrderPayment(order, req.userId);

  return res.status(200).json({
    ok: true,
    data: serializePaymentStatus(order, payment),
  });
}

async function verifyOrderPayment(req, res) {
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

  let payment = await findOrderPayment(order, req.userId);
  if (payment && payment.type !== "one_time_order") {
    return errorResponse(res, 409, "INVALID", "Payment does not belong to a one-time order checkout");
  }

  const invoiceId = payment && payment.providerInvoiceId
    ? payment.providerInvoiceId
    : order.providerInvoiceId;
  if (!invoiceId) {
    return errorResponse(res, 409, "CHECKOUT_IN_PROGRESS", "Checkout invoice is not initialized yet");
  }

  let providerInvoice;
  try {
    providerInvoice = await getInvoice(invoiceId);
  } catch (err) {
    if (err.code === "CONFIG") {
      return errorResponse(res, 500, "CONFIG", err.message);
    }
    if (err.code === "NOT_FOUND") {
      return errorResponse(res, 502, "PAYMENT_PROVIDER_ERROR", "Invoice not found at payment provider");
    }
    logger.error("orderController.verifyOrderPayment failed to fetch invoice", {
      orderId: id,
      paymentId: payment ? String(payment._id) : null,
      error: err.message,
      stack: err.stack,
    });
    return errorResponse(res, 502, "PAYMENT_PROVIDER_ERROR", "Failed to fetch payment status from provider");
  }

  const providerPayment = pickProviderInvoicePayment(providerInvoice, payment);
  const normalizedStatus = normalizeProviderPaymentStatus(
    providerPayment && providerPayment.status ? providerPayment.status : providerInvoice.status
  );
  if (!normalizedStatus) {
    return errorResponse(res, 409, "PAYMENT_PROVIDER_ERROR", "Unsupported provider payment status");
  }

  const providerInvoiceId = providerInvoice && providerInvoice.id ? String(providerInvoice.id) : "";
  const providerPaymentId = providerPayment && providerPayment.id ? String(providerPayment.id) : "";
  const providerAmount = Number(
    providerPayment && providerPayment.amount !== undefined ? providerPayment.amount : providerInvoice.amount
  );
  const providerCurrency = normalizeCurrencyValue(
    providerPayment && providerPayment.currency ? providerPayment.currency : providerInvoice.currency
  );
  const invoiceUrl = providerInvoice && providerInvoice.url ? String(providerInvoice.url) : resolveOrderPaymentUrl(order, payment);

  if (order.providerInvoiceId && providerInvoiceId && String(order.providerInvoiceId) !== providerInvoiceId) {
    return errorResponse(res, 409, "MISMATCH", "Invoice ID mismatch");
  }

  const session = await mongoose.startSession();
  let synchronized = false;
  try {
    session.startTransaction();

    const orderInSession = await Order.findOne({ _id: id, userId: req.userId }).session(session);
    if (!orderInSession) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Order not found");
    }

    let paymentInSession = null;
    if (payment && payment._id) {
      paymentInSession = await Payment.findOne({ _id: payment._id, userId: req.userId }).session(session);
    }
    if (!paymentInSession && orderInSession.paymentId) {
      paymentInSession = await Payment.findOne({ _id: orderInSession.paymentId, userId: req.userId }).session(session);
    }
    if (!paymentInSession) {
      paymentInSession = await Payment.findOne({
        orderId: orderInSession._id,
        userId: req.userId,
        provider: "moyasar",
      })
        .sort({ createdAt: -1 })
        .session(session);
    }

    if (!Number.isFinite(providerAmount) || providerAmount < 0) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "PAYMENT_PROVIDER_ERROR", "Invalid provider payment amount");
    }
    if (Number(orderInSession.pricing && orderInSession.pricing.total) !== providerAmount) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Amount mismatch");
    }
    assertSystemCurrencyOrThrow(providerCurrency, "Invoice currency");

    if (paymentInSession) {
      if (paymentInSession.type !== "one_time_order") {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 409, "INVALID", "Payment does not belong to a one-time order checkout");
      }
      if (
        paymentInSession.providerInvoiceId
        && providerInvoiceId
        && String(paymentInSession.providerInvoiceId) !== providerInvoiceId
      ) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 409, "MISMATCH", "Invoice ID mismatch");
      }
      if (
        paymentInSession.providerPaymentId
        && providerPaymentId
        && String(paymentInSession.providerPaymentId) !== providerPaymentId
      ) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 409, "MISMATCH", "Payment ID mismatch");
      }
      if (Number(paymentInSession.amount) !== providerAmount) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 409, "MISMATCH", "Amount mismatch");
      }
      if (normalizeCurrencyValue(paymentInSession.currency) !== providerCurrency) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 409, "MISMATCH", "Currency mismatch");
      }
    } else {
      const createdPayments = await Payment.create(
        [
          {
            provider: "moyasar",
            type: "one_time_order",
            status: "initiated",
            amount: providerAmount,
            currency: providerCurrency,
            userId: req.userId,
            orderId: orderInSession._id,
            providerInvoiceId,
            ...(providerPaymentId ? { providerPaymentId } : {}),
            metadata: {
              type: "one_time_order",
              orderId: String(orderInSession._id),
              userId: String(req.userId),
              requestedDeliveryDate: orderInSession.requestedDeliveryDate,
              deliveryDate: orderInSession.deliveryDate,
              deliveryDateAdjusted: Boolean(orderInSession.deliveryDateAdjusted),
              paymentUrl: invoiceUrl,
            },
          },
        ],
        { session }
      );
      paymentInSession = createdPayments[0];
      synchronized = true;
    }

    if (providerInvoiceId && !paymentInSession.providerInvoiceId) {
      paymentInSession.providerInvoiceId = providerInvoiceId;
    }
    if (providerPaymentId && !paymentInSession.providerPaymentId) {
      paymentInSession.providerPaymentId = providerPaymentId;
    }
    paymentInSession.status = normalizedStatus;
    if (normalizedStatus === "paid" && !paymentInSession.paidAt) {
      paymentInSession.paidAt = new Date();
    }
    await paymentInSession.save({ session });

    await synchronizeOrderWithPaymentStatus({
      order: orderInSession,
      payment: paymentInSession,
      status: normalizedStatus,
      paymentUrl: invoiceUrl,
      providerInvoiceId,
      providerPaymentId,
      session,
    });
    synchronized = true;

    if (normalizedStatus === "paid" && !paymentInSession.applied) {
      const claimedPayment = await Payment.findOneAndUpdate(
        { _id: paymentInSession._id, applied: false },
        { $set: { applied: true, status: "paid" } },
        { new: true, session }
      );

      if (claimedPayment) {
        synchronized = true;
      }
    }

    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    logger.error("orderController.verifyOrderPayment failed", {
      orderId: id,
      error: err.message,
      stack: err.stack,
    });
    return errorResponse(res, 500, "INTERNAL", "Order payment verification failed");
  }

  const [latestOrder, latestPayment] = await Promise.all([
    Order.findOne({ _id: id, userId: req.userId }).lean(),
    Payment.findOne({
      orderId: id,
      userId: req.userId,
      provider: "moyasar",
    })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  if (normalizedStatus === "paid" && latestOrder) {
    await notifyOrderUser({ order: latestOrder, type: "paid", paymentId: latestPayment && latestPayment._id });
  }

  return res.status(200).json({
    ok: true,
    data: serializePaymentStatus(latestOrder, latestPayment, {
      providerInvoice,
      checkedProvider: true,
      synchronized,
    }),
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
  verifyOrderPayment,
};
