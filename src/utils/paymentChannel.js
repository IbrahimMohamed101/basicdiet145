const PAYMENT_CHANNELS = Object.freeze({
  ELECTRONIC_GATEWAY: "electronic_gateway",
  CASH: "cash",
});

const DASHBOARD_SUBSCRIPTION_CASH_SOURCE = "dashboard_subscription_cash";

function normalizePaymentToken(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Dashboard accounting intentionally exposes only two commercial payment
 * channels. Cash must always be explicit; every non-cash provider or method is
 * treated as an electronic gateway payment so unknown gateway values can never
 * silently fall back to cash.
 */
function resolveDashboardPaymentChannel(payment = {}) {
  const metadata = payment && payment.metadata && typeof payment.metadata === "object"
    ? payment.metadata
    : {};

  const candidates = [
    payment.paymentChannel,
    payment.paymentMethod,
    payment.method,
    metadata.paymentChannel,
    metadata.paymentMethod,
  ].map(normalizePaymentToken);

  const provider = normalizePaymentToken(payment.paymentProvider || payment.provider);
  const source = normalizePaymentToken(payment.source);

  if (
    provider === PAYMENT_CHANNELS.CASH
    || candidates.includes(PAYMENT_CHANNELS.CASH)
    || source === DASHBOARD_SUBSCRIPTION_CASH_SOURCE
  ) {
    return PAYMENT_CHANNELS.CASH;
  }

  return PAYMENT_CHANNELS.ELECTRONIC_GATEWAY;
}

function getPaymentChannelLabel(paymentChannel) {
  if (paymentChannel === PAYMENT_CHANNELS.CASH) {
    return { ar: "كاش", en: "Cash" };
  }
  return { ar: "بوابة دفع إلكتروني", en: "Electronic payment gateway" };
}

function decorateDashboardPaymentRecord(payment) {
  if (!payment || typeof payment !== "object" || Array.isArray(payment)) {
    return payment;
  }

  const paymentChannel = resolveDashboardPaymentChannel(payment);

  return {
    ...payment,
    method: paymentChannel,
    paymentMethod: paymentChannel,
    paymentChannel,
    paymentMethodLabel: getPaymentChannelLabel(paymentChannel),
  };
}

function normalizeDashboardPaymentResponse(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload.data)) {
    return {
      ...payload,
      data: payload.data.map(decorateDashboardPaymentRecord),
    };
  }

  if (payload.data && typeof payload.data === "object") {
    return {
      ...payload,
      data: decorateDashboardPaymentRecord(payload.data),
    };
  }

  return payload;
}

module.exports = {
  PAYMENT_CHANNELS,
  resolveDashboardPaymentChannel,
  decorateDashboardPaymentRecord,
  normalizeDashboardPaymentResponse,
};
