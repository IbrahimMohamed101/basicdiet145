const mongoose = require("mongoose");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const Order = require("../models/Order");
const Payment = require("../models/Payment");
const { buildCustomSaladSnapshot } = require("../services/customSaladService");
const { createInvoice } = require("../services/moyasarService");
const {
  isInSubscriptionRange,
  isOnOrAfterKSADate,
  isValidKSADateString,
  toKSADateString,
} = require("../utils/date");
const {
  CUTOFF_ACTIONS,
  assertTomorrowCutoffAllowed,
} = require("../services/subscription/subscriptionCutoffPolicyService");
const { writeLog } = require("../utils/log");
const { logger } = require("../utils/logger");
const { getRequestLang } = require("../utils/i18n");
const { buildPaymentDescription } = require("../utils/subscription/subscriptionWriteLocalization");
const errorResponse = require("../utils/errorResponse");
const { validateRedirectUrl } = require("../utils/security");
const { computeVatBreakdown, buildMoneySummary } = require("../utils/pricing");
const { getRestaurantBusinessDate, getRestaurantBusinessTomorrow } = require("../services/restaurantHoursService");

async function getSettingValue(key, fallback) {
  const setting = await require("../models/Setting").findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

async function ensureActive(subscription, dateStr) {
  if (subscription.status !== "active") {
    const err = new Error("Subscription not active");
    err.code = "SUB_INACTIVE";
    throw err;
  }
  const endDate = subscription.validityEndDate || subscription.endDate;
  if (endDate) {
    const endStr = toKSADateString(endDate);
    const compareTo = dateStr || await getRestaurantBusinessTomorrow();
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
    return res.status(200).json({ status: true, data: snapshot });
  } catch (err) {
    const status = err.code === "NOT_FOUND" ? 404 : 400;
    return errorResponse(res, status, err.code || "INVALID", err.message);
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
      return errorResponse(res, 404, "NOT_FOUND", "Order not found");
    }
    if (order.status !== "created" || order.paymentStatus !== "initiated") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "LOCKED", "Order is locked for edits");
    }

    let snapshot;
    try {
      snapshot = await buildCustomSaladSnapshot(ingredients);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      const status = err.code === "NOT_FOUND" ? 404 : 400;
      return errorResponse(res, status, err.code || "INVALID", err.message);
    }

    order.customSalads = order.customSalads || [];
    order.customSalads.push(snapshot);
    if (!order.pricing) {
      order.pricing = {
        unitPrice: 0,
        premiumUnitPrice: 0,
        quantity: 0,
        subtotal: 0,
        basePrice: 0,
        deliveryFee: 0,
        vatPercentage: 0,
        vatAmount: 0,
        total: 0,
        totalPrice: 0,
        currency: "SAR",
      };
    }
    order.pricing.subtotal += snapshot.totalPrice;
    const vatPercentage = Number(await getSettingValue("vat_percentage", order.pricing.vatPercentage || 0));
    const vatBreakdown = computeVatBreakdown({
      basePriceHalala: order.pricing.subtotal,
      vatPercentage,
    });
    order.pricing.basePrice = vatBreakdown.basePriceHalala;
    order.pricing.vatPercentage = vatBreakdown.vatPercentage;
    order.pricing.vatAmount = vatBreakdown.vatHalala;
    order.pricing.total = vatBreakdown.totalHalala;
    order.pricing.totalPrice = vatBreakdown.totalPriceHalala;

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

    return res.status(200).json({ status: true, data: order });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("customSaladController.addCustomSaladToOrder failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Failed to add custom salad");
  }
}

async function addCustomSaladToSubscriptionDay(req, res) {
  const { id, date } = req.params;
  const { ingredients, successUrl, backUrl } = req.body || {};

  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  // SECURITY FIX: Enforce ownership before any business logic for subscription-day mutation/payment.
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  try {
    await ensureActive(sub, date);
    if (!isValidKSADateString(date)) {
      const err = new Error("Invalid date format");
      err.code = "INVALID_DATE";
      throw err;
    }
    
    // CR-09 FIX: Add lower bound validation - date must be >= today
    const businessDate = await getRestaurantBusinessDate();
    if (!isOnOrAfterKSADate(date, businessDate)) {
      const err = new Error("Date cannot be in the past");
      err.code = "INVALID_DATE";
      throw err;
    }

    const tomorrow = await getRestaurantBusinessTomorrow();
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

  try {
    await assertTomorrowCutoffAllowed({
      action: CUTOFF_ACTIONS.CUSTOM_SALAD_LOGISTICS_CHANGE,
      date,
    });
  } catch (err) {
    return errorResponse(res, err.status || 400, err.code || "CUTOFF_PASSED_FOR_TOMORROW", err.message);
  }

  try {
    const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).lean();
    if (day && day.status !== "open") {
      return errorResponse(res, 409, "LOCKED", "Day is locked");
    }

    const snapshot = await buildCustomSaladSnapshot(ingredients);
    const vatPercentage = Number(await getSettingValue("vat_percentage", 0));
    const pricing = computeVatBreakdown({
      basePriceHalala: snapshot.totalPrice,
      vatPercentage,
    });
    const appUrl = process.env.APP_URL || "https://example.com";
    const lang = getRequestLang(req);

    const checkoutMetadata = {
      type: "custom_salad_day",
      subscriptionId: String(id),
      userId: String(req.userId),
      date,
      pricing,
    };

    const invoice = await createInvoice({
      amount: pricing.totalPriceHalala,
      description: buildPaymentDescription("customSalad", lang, { date }),
      callbackUrl: `${appUrl}/api/webhooks/moyasar`,
      successUrl: validateRedirectUrl(successUrl, `${appUrl}/payments/success`),
      backUrl: validateRedirectUrl(backUrl, `${appUrl}/payments/cancel`),
      metadata: checkoutMetadata,
    });

    // SECURITY FIX: Do not apply custom salad before payment; persist snapshot for webhook-only application.
    const payment = await Payment.create({
      provider: "moyasar",
      type: "custom_salad_day",
      status: "initiated",
      applied: false,
      amount: pricing.totalPriceHalala,
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
      action: "custom_salad_payment_initiated",
      byUserId: req.userId,
      byRole: "client",
      meta: { date, totalPrice: pricing.totalPriceHalala, subscriptionId: String(id) },
    });

    return res.status(200).json({
      status: true,
      data: {
        payment_url: invoice.url,
        invoice_id: invoice.id,
        payment_id: payment.id,
        total: pricing.totalPriceHalala,
        pricingSummary: buildMoneySummary({
          basePriceHalala: pricing.basePriceHalala,
          vatPercentage: pricing.vatPercentage,
          vatHalala: pricing.vatHalala,
          totalPriceHalala: pricing.totalPriceHalala,
          currency: payment.currency,
        }),
        currency: payment.currency,
      },
    });
  } catch (err) {
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "MAX_EXCEEDED" || err.code === "INVALID" ? 400 : 500;
    logger.error("customSaladController.addCustomSaladToSubscriptionDay failed", { error: err.message, stack: err.stack });
    return errorResponse(
      res,
      status,
      status === 500 ? "INTERNAL" : err.code || "INVALID",
      status === 500 ? "Failed to add custom salad" : err.message
    );
  }
}

module.exports = {
  previewCustomSaladPrice,
  addCustomSaladToOrder,
  addCustomSaladToSubscriptionDay,
};
