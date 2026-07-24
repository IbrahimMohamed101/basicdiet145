"use strict";

const ActivityLog = require("../../models/ActivityLog");
const Payment = require("../../models/Payment");
const subscriptionCreationController = require("./subscriptionCreationController");

const PAYMENT_METHODS = Object.freeze(["cash", "visa"]);

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim().toLowerCase();
}

function normalizeDashboardPaymentMethod(body = {}) {
  const payment = body && body.payment && typeof body.payment === "object" && !Array.isArray(body.payment)
    ? body.payment
    : {};
  const raw = clean(payment.method || body.paymentMethod || body.payment_method);
  if (!raw) {
    return { method: "cash", defaulted: true };
  }
  if (raw === "cash") return { method: "cash", defaulted: false };
  if (["visa", "card", "credit_card", "credit-card", "mada"].includes(raw)) {
    return { method: "visa", defaulted: false };
  }
  const err = new Error("payment method must be cash or visa");
  err.code = "INVALID_PAYMENT_METHOD";
  err.status = 400;
  throw err;
}

function paymentMethodOptions() {
  return [
    {
      method: "cash",
      key: "cash",
      label: "Cash",
      labelAr: "كاش",
      gatewayRequired: false,
    },
    {
      method: "visa",
      key: "visa",
      label: "Visa / Card",
      labelAr: "فيزا",
      gatewayRequired: false,
    },
  ];
}

function decorateQuotePayload(payload) {
  if (!payload || payload.status !== true || !payload.data || typeof payload.data !== "object") {
    return payload;
  }
  return {
    ...payload,
    data: {
      ...payload.data,
      allowedPaymentMethods: [...PAYMENT_METHODS],
      paymentMethodOptions: paymentMethodOptions(),
      paymentGatewayRequired: false,
      paymentRecordingMode: "dashboard_manual",
    },
  };
}

function createCaptureResponse() {
  let statusCode = 200;
  let payload;
  let sent = false;
  const headers = {};
  const res = {
    statusCode,
    status(code) {
      statusCode = Number(code || 200);
      this.statusCode = statusCode;
      return this;
    },
    json(value) {
      payload = value;
      sent = true;
      return this;
    },
    send(value) {
      payload = value;
      sent = true;
      return this;
    },
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
      return this;
    },
    getHeader(name) {
      return headers[String(name).toLowerCase()];
    },
  };
  return {
    res,
    result() {
      return { statusCode, payload, sent, headers };
    },
  };
}

async function invokeCaptured(handler, req, next) {
  const capture = createCaptureResponse();
  await handler(req, capture.res, next);
  return capture.result();
}

function extractQuoteTotalHalala(payload) {
  const data = payload && payload.data && typeof payload.data === "object" ? payload.data : {};
  const candidates = [
    data.pricing && data.pricing.totalHalala,
    data.breakdown && data.breakdown.totalHalala,
    data.pricingSummary && data.pricingSummary.totalPriceHalala,
    data.totalHalala,
    data.totalPriceHalala,
  ];
  for (const value of candidates) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed);
  }
  return null;
}

function extractSubscriptionId(payload) {
  const data = payload && payload.data && typeof payload.data === "object" ? payload.data : {};
  const subscription = data.subscription && typeof data.subscription === "object" ? data.subscription : {};
  return String(data.id || data._id || data.subscriptionId || subscription.id || subscription._id || "").trim();
}

async function persistRecordedPayment({ subscriptionId, userId, method, amountHalala, currency, req }) {
  let payment = await Payment.findOne({
    subscriptionId,
    type: "subscription_activation",
  }).sort({ createdAt: -1 });

  if (!payment) {
    payment = new Payment({
      provider: method === "visa" ? "manual" : "cash",
      type: "subscription_activation",
      status: "paid",
      amount: amountHalala,
      currency: currency || "SAR",
      userId,
      subscriptionId,
      paidAt: new Date(),
      applied: true,
    });
  }

  payment.provider = method === "visa" ? "manual" : "cash";
  payment.method = method;
  payment.status = "paid";
  payment.amount = amountHalala;
  payment.currency = currency || payment.currency || "SAR";
  payment.source = "dashboard_subscription_creation";
  payment.collectedBy = req.dashboardUserId || payment.collectedBy;
  payment.applied = true;
  payment.paidAt = payment.paidAt || new Date();
  payment.metadata = {
    ...(payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {}),
    paymentMethod: method,
    recordingMode: "dashboard_manual",
    gatewayUsed: false,
    dashboardUserRole: req.dashboardUserRole || null,
  };
  await payment.save();

  const desiredAction = method === "visa"
    ? "subscription_visa_payment_recorded"
    : "subscription_cash_payment_collected";
  await ActivityLog.findOneAndUpdate(
    {
      entityType: "subscription",
      entityId: subscriptionId,
      action: "subscription_cash_payment_collected",
    },
    {
      $set: {
        action: desiredAction,
        "meta.paymentMethod": method,
        "meta.paymentId": String(payment._id),
        "meta.collectedAmount": amountHalala,
        "meta.gatewayUsed": false,
        "meta.recordingMode": "dashboard_manual",
      },
    },
    { sort: { createdAt: -1 } }
  );

  return payment;
}

function buildPaymentResponse(payment, method, defaulted) {
  return {
    id: payment && payment._id ? String(payment._id) : null,
    method,
    provider: payment && payment.provider ? payment.provider : method === "visa" ? "manual" : "cash",
    status: "paid",
    amountHalala: Number(payment && payment.amount || 0),
    currency: String(payment && payment.currency || "SAR"),
    gatewayUsed: false,
    recordingMode: "dashboard_manual",
    defaultedFromLegacyRequest: Boolean(defaulted),
    paidAt: payment && payment.paidAt ? new Date(payment.paidAt).toISOString() : null,
  };
}

async function quoteSubscriptionAdmin(req, res, next) {
  const captured = await invokeCaptured(subscriptionCreationController.quoteSubscriptionAdmin, req, next);
  const payload = decorateQuotePayload(captured.payload);
  return res.status(captured.statusCode).json(payload);
}

async function createSubscriptionAdmin(req, res, next) {
  let selection;
  try {
    selection = normalizeDashboardPaymentMethod(req.body || {});
  } catch (err) {
    return res.status(err.status || 400).json({
      status: false,
      message: err.message,
      messageAr: "طريقة الدفع يجب أن تكون كاش أو فيزا",
      error: { code: err.code || "INVALID_PAYMENT_METHOD", message: err.message },
    });
  }

  const quoteRequest = {
    ...req,
    body: { ...(req.body || {}) },
  };
  const quoteCaptured = await invokeCaptured(subscriptionCreationController.quoteSubscriptionAdmin, quoteRequest, next);
  if (quoteCaptured.statusCode >= 400 || !quoteCaptured.payload || quoteCaptured.payload.status !== true) {
    return res.status(quoteCaptured.statusCode).json(quoteCaptured.payload);
  }

  const totalHalala = extractQuoteTotalHalala(quoteCaptured.payload);
  if (totalHalala === null) {
    return res.status(500).json({
      status: false,
      message: "Unable to resolve subscription total for payment recording",
      messageAr: "تعذر تحديد إجمالي الاشتراك لتسجيل طريقة الدفع",
      error: { code: "PAYMENT_TOTAL_UNAVAILABLE" },
    });
  }
  const quoteData = quoteCaptured.payload.data || {};
  const currency = String(
    quoteData.currency
      || quoteData.pricing && quoteData.pricing.currency
      || quoteData.breakdown && quoteData.breakdown.currency
      || "SAR"
  ).toUpperCase();

  const originalPayment = req.body && req.body.payment && typeof req.body.payment === "object"
    ? req.body.payment
    : {};
  const coreRequest = {
    ...req,
    body: {
      ...(req.body || {}),
      payment: {
        ...originalPayment,
        method: "cash",
        status: "paid",
        collectedAmountHalala: totalHalala,
        paidAt: originalPayment.paidAt || new Date().toISOString(),
      },
      source: req.body && req.body.source || "dashboard_subscription_creation",
    },
  };

  const createCaptured = await invokeCaptured(subscriptionCreationController.createSubscriptionAdmin, coreRequest, next);
  if (createCaptured.statusCode >= 400 || !createCaptured.payload || createCaptured.payload.status !== true) {
    return res.status(createCaptured.statusCode).json(createCaptured.payload);
  }

  const subscriptionId = extractSubscriptionId(createCaptured.payload);
  if (!subscriptionId) {
    return res.status(500).json({
      status: false,
      message: "Subscription was created but its identifier was not returned",
      messageAr: "تم إنشاء الاشتراك لكن لم يتم إرجاع معرّف الاشتراك",
      error: { code: "SUBSCRIPTION_ID_MISSING" },
    });
  }

  try {
    const payment = await persistRecordedPayment({
      subscriptionId,
      userId: coreRequest.body.userId,
      method: selection.method,
      amountHalala: totalHalala,
      currency,
      req,
    });
    const paymentResponse = buildPaymentResponse(payment, selection.method, selection.defaulted);
    const payload = {
      ...createCaptured.payload,
      data: {
        ...createCaptured.payload.data,
        payment: paymentResponse,
        paymentMethod: selection.method,
      },
      meta: {
        ...(createCaptured.payload.meta || {}),
        payment: paymentResponse,
        paymentMethod: selection.method,
        paymentGatewayUsed: false,
      },
    };
    return res.status(createCaptured.statusCode).json(payload);
  } catch (err) {
    return res.status(500).json({
      status: false,
      message: "Subscription was created but payment method recording failed",
      messageAr: "تم إنشاء الاشتراك لكن تعذر تسجيل طريقة الدفع",
      error: { code: "PAYMENT_RECORDING_FAILED", message: err.message },
      data: { subscriptionId },
    });
  }
}

module.exports = {
  PAYMENT_METHODS,
  buildPaymentResponse,
  createSubscriptionAdmin,
  decorateQuotePayload,
  extractQuoteTotalHalala,
  normalizeDashboardPaymentMethod,
  paymentMethodOptions,
  quoteSubscriptionAdmin,
};
