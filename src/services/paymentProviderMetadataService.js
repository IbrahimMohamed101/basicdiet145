const crypto = require("crypto");
const { validateRedirectUrl } = require("../utils/security");

function generateRedirectToken() {
  return crypto.randomBytes(18).toString("hex");
}

function buildPaymentRedirectContext({
  appUrl,
  paymentType,
  draftId,
  subscriptionId,
  dayId,
  date,
  successUrl,
  backUrl,
}) {
  const safeAppUrl = String(appUrl || "https://example.com").trim() || "https://example.com";
  const token = generateRedirectToken();
  const normalizedSuccessUrl = validateRedirectUrl(successUrl, `${safeAppUrl}/payments/success`);
  const normalizedBackUrl = validateRedirectUrl(backUrl, `${safeAppUrl}/payments/cancel`);

  const successParams = new URLSearchParams({
    payment_type: String(paymentType || "").trim(),
    token,
  });
  const cancelParams = new URLSearchParams({
    payment_type: String(paymentType || "").trim(),
    token,
  });

  if (draftId) {
    successParams.set("draft_id", String(draftId));
    cancelParams.set("draft_id", String(draftId));
  }
  if (subscriptionId) {
    successParams.set("subscription_id", String(subscriptionId));
    cancelParams.set("subscription_id", String(subscriptionId));
  }
  if (dayId) {
    successParams.set("day_id", String(dayId));
    cancelParams.set("day_id", String(dayId));
  }
  if (date) {
    successParams.set("date", String(date));
    cancelParams.set("date", String(date));
  }

  return {
    token,
    paymentType: String(paymentType || "").trim(),
    draftId: draftId ? String(draftId) : "",
    subscriptionId: subscriptionId ? String(subscriptionId) : "",
    dayId: dayId ? String(dayId) : "",
    date: date ? String(date) : "",
    successRedirectUrl: normalizedSuccessUrl,
    cancelRedirectUrl: normalizedBackUrl,
    providerSuccessUrl: `${safeAppUrl}/payments/success?${successParams.toString()}`,
    providerCancelUrl: `${safeAppUrl}/payments/cancel?${cancelParams.toString()}`,
  };
}

function attachRedirectContext(metadata, redirectContext) {
  if (!redirectContext || typeof redirectContext !== "object") {
    return Object.assign({}, metadata || {});
  }

  return Object.assign({}, metadata || {}, {
    redirectContext: {
      token: String(redirectContext.token || "").trim(),
      paymentType: String(redirectContext.paymentType || "").trim(),
      draftId: String(redirectContext.draftId || "").trim(),
      subscriptionId: String(redirectContext.subscriptionId || "").trim(),
      dayId: String(redirectContext.dayId || "").trim(),
      date: String(redirectContext.date || "").trim(),
      successRedirectUrl: String(redirectContext.successRedirectUrl || "").trim(),
      cancelRedirectUrl: String(redirectContext.cancelRedirectUrl || "").trim(),
    },
  });
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

module.exports = {
  attachRedirectContext,
  buildPaymentRedirectContext,
  normalizeProviderPaymentStatus,
  pickProviderInvoicePayment,
};
