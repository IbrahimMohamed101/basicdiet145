const crypto = require("crypto");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Meal = require("../models/Meal");
const Payment = require("../models/Payment");
const Delivery = require("../models/Delivery");
const Setting = require("../models/Setting");
const moyasarService = require("../services/moyasarService");
const { createInvoice, getInvoice } = require("../services/moyasarService");
const { notifyOrderUser } = require("../services/orderNotificationService");
const { buildCustomSaladSnapshot } = require("../services/customSaladService");
const { buildCustomMealSnapshot } = require("../services/customMealService");
const {
  getTodayKSADate,
  getTomorrowKSADate,
  isOnOrAfterKSADate,
  isValidKSADateString,
  toKSADateString,
} = require("../utils/date");
const {
  CUTOFF_ACTIONS,
  assertTomorrowCutoffAllowed,
} = require("../services/subscription/subscriptionCutoffPolicyService");
const { getRequestLang, pickLang } = require("../utils/i18n");
const { writeLog } = require("../utils/log");
const { logger } = require("../utils/logger");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");
const { validateRedirectUrl } = require("../utils/security");
const {
  computeVatBreakdown,
  normalizeStoredVatBreakdown,
  buildMoneySummary,
} = require("../utils/pricing");
const { getOneTimeOrderMenu } = require("../services/orders/orderMenuService");
const { buildRequestHash, priceOrderCart } = require("../services/orders/orderPricingService");
const { expireOrderIfNeeded } = require("../services/orders/orderExpiryService");
const orderPaymentService = require("../services/orders/orderPaymentService");
const {
  serializeOrderForClient: serializeFinalOrderForClient,
  serializeOrderSummaryForClient,
} = require("../services/orders/orderSerializationService");
const { ORDER_STATUSES, normalizeLegacyOrderStatus } = require("../utils/orderState");

const SYSTEM_CURRENCY = "SAR";
const TERMINAL_PAYMENT_FAILURE_STATUSES = new Set(["failed", "canceled", "expired"]);

async function getOrderMenu(req, res) {
  const lang = getRequestLang(req);
  const menu = await getOneTimeOrderMenu({
    lang,
    fulfillmentMethod: req.query && req.query.fulfillmentMethod,
  });

  return res.status(200).json({ status: true, data: menu });
}

async function quoteOrder(req, res) {
  try {
    const body = req.body || {};
    const quote = await priceOrderCart({
      userId: req.userId,
      items: body.items,
      fulfillmentMethod: body.fulfillmentMethod,
      delivery: body.delivery || {},
      pickup: body.pickup || {},
      promoCode: body.promoCode,
      lang: getRequestLang(req),
    });

    return res.status(200).json({
      status: true,
      data: {
        currency: quote.currency,
        items: quote.items,
        pricing: quote.pricing,
        appliedPromo: quote.appliedPromo,
      },
    });
  } catch (err) {
    if (err && err.code && err.status) {
      return errorResponse(res, err.status, err.code, err.message, err.details);
    }
    logger.error("orderController.quoteOrder failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Order quote failed");
  }
}

function buildFinalOrderRequestHash({ userId, quote, body }) {
  const canonicalItems = (quote.items || []).map((item) => ({
    itemType: item.itemType,
    catalogRef: {
      model: item.catalogRef && item.catalogRef.model,
      id: item.catalogRef && item.catalogRef.id ? String(item.catalogRef.id) : "",
    },
    qty: Number(item.qty || 1),
    selections: item.selections || {},
  }));

  return buildRequestHash({
    userId: String(userId),
    fulfillmentMethod: quote.fulfillmentMethod,
    fulfillmentDate: String(body.fulfillmentDate || body.requestedFulfillmentDate || body.deliveryDate || ""),
    delivery: quote.delivery
      ? {
        zoneId: quote.delivery.zoneId || "",
        deliveryWindow: quote.delivery.deliveryWindow || "",
      }
      : null,
    pickup: quote.pickup
      ? {
        branchId: quote.pickup.branchId || "",
        pickupWindow: quote.pickup.pickupWindow || "",
      }
      : null,
    items: canonicalItems,
    promoCode: body.promoCode ? String(body.promoCode).trim().toUpperCase() : "",
  });
}

function buildFinalOrderCheckoutPayload(order, payment, { reused = false } = {}) {
  return {
    orderId: String(order._id),
    paymentId: payment ? String(payment._id) : (order.paymentId ? String(order.paymentId) : null),
    paymentUrl: order.paymentUrl || (payment && payment.metadata && payment.metadata.paymentUrl) || "",
    invoiceId: order.providerInvoiceId || (payment && payment.providerInvoiceId) || null,
    status: order.status,
    paymentStatus: payment && payment.status ? payment.status : order.paymentStatus,
    expiresAt: order.expiresAt || null,
    pricing: order.pricing || {},
    items: order.items || [],
    ...(reused ? { reused: true } : {}),
  };
}

function normalizeFulfillmentDate(body = {}) {
  const date = String(
    body.fulfillmentDate
    || body.requestedFulfillmentDate
    || body.deliveryDate
    || ""
  ).trim() || getTodayKSADate();

  if (!isValidKSADateString(date)) {
    const err = new Error("fulfillmentDate must be YYYY-MM-DD");
    err.code = "INVALID_REQUEST";
    err.status = 400;
    throw err;
  }
  return date;
}

function normalizeOrderDeliveryAddress(address = {}) {
  return {
    label: String(address.label || "").trim(),
    line1: String(address.line1 || "").trim(),
    line2: String(address.line2 || "").trim(),
    district: String(address.district || "").trim(),
    city: String(address.city || "").trim(),
    phone: String(address.phone || "").trim(),
    notes: String(address.notes || "").trim(),
  };
}

async function findFinalOrderPayment(order, userId) {
  if (!order) return null;
  if (order.paymentId) {
    const byId = await Payment.findOne({
      _id: order.paymentId,
      ...(userId ? { userId } : {}),
    }).lean();
    if (byId) return byId;
  }
  return Payment.findOne({
    orderId: order._id,
    ...(userId ? { userId } : {}),
    type: "one_time_order",
  }).sort({ createdAt: -1 }).lean();
}

async function createOrder(req, res) {
  let order = null;
  let payment = null;
  let idempotencyKey = "";
  let requestHash = "";

  try {
    const body = req.body || {};
    idempotencyKey = parseIdempotencyKey(
      req.get("Idempotency-Key")
      || req.get("X-Idempotency-Key")
      || body.idempotencyKey
    );

    const quote = await priceOrderCart({
      userId: req.userId,
      items: body.items,
      fulfillmentMethod: body.fulfillmentMethod,
      delivery: body.delivery || {},
      pickup: body.pickup || {},
      promoCode: body.promoCode,
      lang: getRequestLang(req),
    });
    const fulfillmentDate = normalizeFulfillmentDate(body);
    requestHash = buildFinalOrderRequestHash({ userId: req.userId, quote, body: { ...body, fulfillmentDate } });

    if (idempotencyKey) {
      const existingByKey = await Order.findOne({ userId: req.userId, idempotencyKey })
        .sort({ createdAt: -1 })
        .lean();
      if (existingByKey) {
        if (existingByKey.requestHash && existingByKey.requestHash !== requestHash) {
          return errorResponse(
            res,
            409,
            "IDEMPOTENCY_CONFLICT",
            "idempotencyKey is already used with a different order payload"
          );
        }
        if (
          existingByKey.status === ORDER_STATUSES.PENDING_PAYMENT
          && existingByKey.paymentStatus === "initiated"
          && existingByKey.paymentUrl
        ) {
          const existingPayment = await findFinalOrderPayment(existingByKey, req.userId);
          return res.status(200).json({
            status: true,
            data: buildFinalOrderCheckoutPayload(existingByKey, existingPayment, { reused: true }),
          });
        }
        return errorResponse(res, 409, "IDEMPOTENCY_CONFLICT", "idempotencyKey is already finalized");
      }
    }

    const existingByHash = await Order.findOne({
      userId: req.userId,
      requestHash,
      status: ORDER_STATUSES.PENDING_PAYMENT,
      paymentStatus: "initiated",
    }).sort({ createdAt: -1 }).lean();
    if (existingByHash) {
      const existingPayment = await findFinalOrderPayment(existingByHash, req.userId);
      if (existingByHash.paymentUrl) {
        return res.status(200).json({
          status: true,
          data: buildFinalOrderCheckoutPayload(existingByHash, existingPayment, { reused: true }),
        });
      }
      return errorResponse(res, 409, "CHECKOUT_IN_PROGRESS", "Checkout initialization is still in progress");
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
    order = await Order.create({
      orderNumber: `ORD-${String(new mongoose.Types.ObjectId()).slice(-8).toUpperCase()}`,
      userId: req.userId,
      status: ORDER_STATUSES.PENDING_PAYMENT,
      paymentStatus: "initiated",
      fulfillmentMethod: quote.fulfillmentMethod,
      fulfillmentDate,
      requestedFulfillmentDate: fulfillmentDate,
      deliveryMode: quote.fulfillmentMethod,
      deliveryDate: fulfillmentDate,
      requestedDeliveryDate: fulfillmentDate,
      items: quote.items,
      pricing: {
        ...quote.pricing,
        appliedPromo: quote.appliedPromo,
        subtotal: quote.pricing.subtotalHalala,
        deliveryFee: quote.pricing.deliveryFeeHalala,
        vatAmount: quote.pricing.vatHalala,
        total: quote.pricing.totalHalala,
        totalPrice: quote.pricing.totalHalala,
      },
      pickup: quote.fulfillmentMethod === "pickup"
        ? {
          branchId: quote.pickup && quote.pickup.branchId ? quote.pickup.branchId : "main",
          pickupWindow: quote.pickup && quote.pickup.pickupWindow ? quote.pickup.pickupWindow : "",
        }
        : undefined,
      delivery: quote.fulfillmentMethod === "delivery"
        ? {
          zoneId: quote.delivery && quote.delivery.zoneId ? quote.delivery.zoneId : undefined,
          zoneName: quote.delivery && quote.delivery.zoneName ? quote.delivery.zoneName : undefined,
          deliveryFeeHalala: quote.pricing.deliveryFeeHalala,
          address: normalizeOrderDeliveryAddress(body.delivery && body.delivery.address),
        }
        : undefined,
      deliveryAddress: quote.fulfillmentMethod === "delivery"
        ? normalizeOrderDeliveryAddress(body.delivery && body.delivery.address)
        : undefined,
      deliveryWindow: quote.delivery && quote.delivery.deliveryWindow ? quote.delivery.deliveryWindow : "",
      paymentUrl: "",
      idempotencyKey,
      requestHash,
      expiresAt,
    });

    payment = await Payment.create({
      provider: "moyasar",
      type: "one_time_order",
      status: "initiated",
      amount: quote.pricing.totalHalala,
      currency: quote.pricing.currency || SYSTEM_CURRENCY,
      userId: req.userId,
      orderId: order._id,
      metadata: {
        source: "one_time_order",
        type: "one_time_order",
        orderId: String(order._id),
        userId: String(req.userId),
        expiresAt: expiresAt.toISOString(),
        requestHash,
        paymentUrl: "",
      },
    });

    const appUrl = process.env.APP_URL || "https://example.com";
    const invoice = await moyasarService.createInvoice({
      amount: quote.pricing.totalHalala,
      currency: quote.pricing.currency || SYSTEM_CURRENCY,
      description: `One-time order ${order.orderNumber || String(order._id)}`,
      callbackUrl: `${appUrl}/api/webhooks/moyasar`,
      successUrl: validateRedirectUrl(body.successUrl, `${appUrl}/payments/success`),
      backUrl: validateRedirectUrl(body.backUrl, `${appUrl}/payments/cancel`),
      metadata: {
        source: "one_time_order",
        type: "one_time_order",
        orderId: String(order._id),
        userId: String(req.userId),
        paymentId: String(payment._id),
        expiresAt: expiresAt.toISOString(),
      },
    });

    if (Number.isFinite(Number(invoice.amount)) && Number(invoice.amount) !== Number(quote.pricing.totalHalala)) {
      const err = new Error("Invoice amount mismatch");
      err.code = "PAYMENT_PROVIDER_ERROR";
      err.status = 502;
      throw err;
    }
    const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || quote.pricing.currency || SYSTEM_CURRENCY, "Invoice currency");

    payment.providerInvoiceId = invoice.id;
    payment.providerPaymentId = invoice.payment_id || invoice.paymentId || undefined;
    payment.currency = invoiceCurrency;
    payment.metadata = {
      ...(payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {}),
      providerInvoiceId: invoice.id,
      paymentUrl: invoice.url || "",
    };
    await payment.save();

    order.paymentId = payment._id;
    order.providerInvoiceId = invoice.id;
    order.providerPaymentId = payment.providerPaymentId;
    order.paymentUrl = invoice.url || "";
    await order.save();

    await writeLog({
      entityType: "order",
      entityId: order._id,
      action: "order_created",
      byUserId: req.userId,
      byRole: "client",
      meta: {
        source: "one_time_order",
        totalHalala: quote.pricing.totalHalala,
        fulfillmentMethod: quote.fulfillmentMethod,
        fulfillmentDate,
      },
    });

    return res.status(201).json({
      status: true,
      data: buildFinalOrderCheckoutPayload(order.toObject ? order.toObject() : order, payment.toObject ? payment.toObject() : payment),
    });
  } catch (err) {
    if (order && (!order.paymentUrl || !order.providerInvoiceId)) {
      try {
        await Order.updateOne(
          { _id: order._id, status: ORDER_STATUSES.PENDING_PAYMENT },
          {
            $set: {
              status: ORDER_STATUSES.CANCELLED,
              paymentStatus: "failed",
              cancelledAt: new Date(),
              cancellationReason: "payment_initialization_failed",
            },
          }
        );
        if (payment) {
          await Payment.updateOne(
            { _id: payment._id, status: "initiated" },
            { $set: { status: "failed" } }
          );
        }
      } catch (recoveryErr) {
        logger.error("orderController.createOrder recovery failed", {
          orderId: String(order._id),
          error: recoveryErr.message,
        });
      }
    }

    if (err && err.code && err.status) {
      return errorResponse(res, err.status, err.code, err.message, err.details);
    }
    if (err && err.code === "CONFIG") {
      return errorResponse(res, 500, "CONFIG_MISSING", err.message);
    }
    if (err && err.code === 11000) {
      return errorResponse(res, 409, "CHECKOUT_IN_PROGRESS", "A matching pending order already exists");
    }
    logger.error("orderController.createOrder failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 502, "PAYMENT_INIT_ERROR", "Order payment initialization failed");
  }
}

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
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

function normalizeOrderPricing(pricing = {}, fallbackCurrency = SYSTEM_CURRENCY) {
  const normalized = normalizeStoredVatBreakdown({
    basePriceHalala:
      pricing.basePrice !== undefined
        ? pricing.basePrice
        : pricing.subtotal,
    vatPercentage: pricing.vatPercentage,
    vatHalala: pricing.vatAmount,
    totalPriceHalala:
      pricing.totalPrice !== undefined
        ? pricing.totalPrice
        : pricing.total,
  });

  return {
    ...pricing,
    subtotal: normalized.subtotalHalala,
    basePrice: normalized.basePriceHalala,
    vatPercentage: normalized.vatPercentage,
    vatAmount: normalized.vatHalala,
    total: normalized.totalHalala,
    totalPrice: normalized.totalPriceHalala,
    currency: normalizeCurrencyValue(pricing.currency || fallbackCurrency),
  };
}

function serializeOrderForClient(order) {
  if (!order || typeof order !== "object") return order;
  const pricing = normalizeOrderPricing(order.pricing || {}, order.pricing && order.pricing.currency);
  return {
    ...order,
    pricing,
    pricingSummary: buildMoneySummary({
      basePriceHalala: pricing.basePrice,
      vatPercentage: pricing.vatPercentage,
      vatHalala: pricing.vatAmount,
      totalPriceHalala: pricing.total,
      currency: pricing.currency,
    }),
  };
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
  const pricing = normalizeOrderPricing(order && order.pricing ? order.pricing : {});

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
    pricing,
    pricingSummary: buildMoneySummary({
      basePriceHalala: pricing.basePrice,
      vatPercentage: pricing.vatPercentage,
      vatHalala: pricing.vatAmount,
      totalPriceHalala: pricing.total,
      currency: pricing.currency,
    }),
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
  const pricing = normalizeOrderPricing(order && order.pricing ? order.pricing : {});
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
    pricing,
    pricingSummary: buildMoneySummary({
      basePriceHalala: pricing.basePrice,
      vatPercentage: pricing.vatPercentage,
      vatHalala: pricing.vatAmount,
      totalPriceHalala: pricing.total,
      currency: pricing.currency,
    }),
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
      promoCode,
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

    if (promoCode !== undefined && promoCode !== null && String(promoCode).trim() !== "") {
      return errorResponse(
        res,
        400,
        "PROMO_NOT_APPLICABLE_TO_ORDER_TYPE",
        "Promo codes are available for subscription checkout only"
      );
    }

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

    let effectiveDate = requestedDate;
    let dateAdjusted = false;
    try {
      await assertTomorrowCutoffAllowed({
        action: CUTOFF_ACTIONS.ORDER_DELIVERY_DATE_CHANGE,
        date: requestedDate,
      });
    } catch (err) {
      return errorResponse(res, err.status || 400, err.code || "CUTOFF_PASSED_FOR_TOMORROW", err.message);
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
            status: true,
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
          status: true,
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
    const vatPercentage = Number(await getSettingValue("vat_percentage", 0));

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

    const basePrice = subtotal + deliveryFee;
    const vatBreakdown = computeVatBreakdown({
      basePriceHalala: basePrice,
      vatPercentage,
    });
    const total = vatBreakdown.totalHalala;
    const paymentMetadata = {
      type: "one_time_order",
      userId: String(req.userId),
      requestedDeliveryDate: requestedDate,
      deliveryDate: effectiveDate,
      deliveryDateAdjusted: dateAdjusted,
      paymentUrl: "",
      pricing: {
        basePriceHalala: vatBreakdown.basePriceHalala,
        vatPercentage: vatBreakdown.vatPercentage,
        vatHalala: vatBreakdown.vatHalala,
        totalPriceHalala: vatBreakdown.totalPriceHalala,
      },
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
        subtotal: vatBreakdown.subtotalHalala,
        basePrice: vatBreakdown.basePriceHalala,
        deliveryFee,
        vatPercentage: vatBreakdown.vatPercentage,
        vatAmount: vatBreakdown.vatHalala,
        total,
        totalPrice: vatBreakdown.totalPriceHalala,
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
      successUrl: validateRedirectUrl(successUrl, `${appUrl}/payments/success`),
      backUrl: validateRedirectUrl(backUrl, `${appUrl}/payments/cancel`),
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
      status: true,
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
            status: true,
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

    return res.status(200).json({ status: true, data: serializeOrderForClient(order.toObject ? order.toObject() : order) });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("orderController.confirmOrder failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Order confirmation failed");
  }
}

function buildOrderOwnerLookup(id, userId) {
  const value = String(id || "").trim();
  if (!value) return null;
  if (mongoose.Types.ObjectId.isValid(value)) {
    return { _id: value, userId };
  }
  return { orderNumber: value, userId };
}

function parsePositiveInteger(value, fallback, { max = null } = {}) {
  const parsed = Number(value);
  const normalized = Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  return max ? Math.min(normalized, max) : normalized;
}

async function listOrders(req, res) {
  const page = parsePositiveInteger(req.query && req.query.page, 1);
  const limit = parsePositiveInteger(req.query && req.query.limit, 10, { max: 50 });
  const query = { userId: req.userId };

  const statusFilter = String((req.query && req.query.status) || "").trim();
  if (statusFilter) {
    const statuses = statusFilter.split(",").map((item) => normalizeLegacyOrderStatus(item.trim())).filter(Boolean);
    query.status = { $in: statuses };
  }

  const paymentStatus = String((req.query && req.query.paymentStatus) || "").trim();
  if (paymentStatus) {
    query.paymentStatus = paymentStatus;
  }

  const from = req.query && req.query.from ? new Date(req.query.from) : null;
  const to = req.query && req.query.to ? new Date(req.query.to) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    return errorResponse(res, 400, "INVALID_QUERY", "Invalid date range");
  }
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = from;
    if (to) query.createdAt.$lte = to;
  }

  const [items, total] = await Promise.all([
    Order.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Order.countDocuments(query),
  ]);

  return res.status(200).json({
    status: true,
    data: {
      items: items.map((order) => serializeOrderSummaryForClient(order)),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
}

async function getOrder(req, res) {
  const lookup = buildOrderOwnerLookup(req.params && req.params.id, req.userId);
  if (!lookup) {
    return errorResponse(res, 400, "INVALID_OBJECT_ID", "Invalid orderId");
  }

  const order = await Order.findOne(lookup);
  if (!order) {
    return errorResponse(res, 404, "NOT_FOUND", "Order not found");
  }

  const result = await expireOrderIfNeeded(order, { byUserId: req.userId });
  return res.status(200).json({
    status: true,
    data: serializeFinalOrderForClient(result.order),
  });
}

async function cancelOrder(req, res) {
  const lookup = buildOrderOwnerLookup(req.params && req.params.id, req.userId);
  if (!lookup) {
    return errorResponse(res, 400, "INVALID_OBJECT_ID", "Invalid orderId");
  }

  try {
    const order = await Order.findOne(lookup);
    if (!order) {
      return errorResponse(res, 404, "NOT_FOUND", "Order not found");
    }

    await expireOrderIfNeeded(order, { byUserId: req.userId });
    if (String(order.status || "") !== ORDER_STATUSES.PENDING_PAYMENT) {
      return errorResponse(res, 409, "INVALID_TRANSITION", "Only pending payment orders can be cancelled by the client");
    }

    const payment = await (order.paymentId
      ? Payment.findById(order.paymentId)
      : Payment.findOne({ orderId: order._id, type: "one_time_order" }).sort({ createdAt: -1 }));
    if ((payment && payment.status === "paid") || order.paymentStatus === "paid") {
      return errorResponse(res, 409, "PAYMENT_ALREADY_PAID", "Paid orders cannot be cancelled from mobile");
    }

    const now = new Date();
    order.status = ORDER_STATUSES.CANCELLED;
    if (order.paymentStatus === "initiated") {
      order.paymentStatus = "canceled";
    }
    order.cancelledAt = now;
    order.canceledAt = now;
    order.cancellationReason = String((req.body && req.body.reason) || "client_cancelled_pending_payment").trim();
    order.cancelledBy = "client";
    order.canceledBy = "client";
    await order.save();

    if (payment && payment.status === "initiated") {
      payment.status = "canceled";
      await payment.save();
    }

    await writeLog({
      entityType: "order",
      entityId: order._id,
      action: "order_cancelled",
      byUserId: req.userId,
      byRole: "client",
      meta: {
        source: "one_time_order",
        orderId: String(order._id),
        reason: order.cancellationReason,
      },
    });

    return res.status(200).json({
      status: true,
      data: {
        orderId: String(order._id),
        status: order.status,
        paymentStatus: order.paymentStatus,
      },
    });
  } catch (err) {
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
      status: true,
      data: {
        order: serializeOrderForClient(result.order.toObject ? result.order.toObject() : result.order),
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
    status: true,
    data: serializePaymentStatus(order, payment),
  });
}

async function verifyOrderPayment(req, res) {
  const orderId = req.params && (req.params.orderId || req.params.id);
  const paymentId = req.params && req.params.paymentId;
  const body = req.body || {};
  try {
    const result = await orderPaymentService.verifyOrderPayment({
      orderId,
      paymentId,
      userId: req.userId,
      providerPaymentId: body.providerPaymentId,
      providerInvoiceId: body.providerInvoiceId,
    });

    if (result.paymentStatus === "paid" && result.applied && !result.idempotent) {
      await notifyOrderUser({
        order: { _id: result.orderId, userId: req.userId },
        type: "paid",
        paymentId: result.paymentId,
      });
    }

    return res.status(200).json({ status: true, data: result });
  } catch (err) {
    if (err && err.code && err.status) {
      return errorResponse(res, err.status, err.code, err.message, err.details);
    }
    logger.error("orderController.verifyOrderPayment failed", {
      orderId,
      paymentId,
      error: err.message,
      stack: err.stack,
    });
    return errorResponse(res, 500, "INTERNAL", "Order payment verification failed");
  }
}

module.exports = {
  getOrderMenu,
  quoteOrder,
  createOrder,
  checkoutOrder,
  confirmOrder,
  listOrders,
  getOrder,
  cancelOrder,
  rejectAdjustedDeliveryDate,
  getOrderPaymentStatus,
  verifyOrderPayment,
};
