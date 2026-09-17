const PAYMENT_CHANNELS = Object.freeze({
  MOYASAR: "moyasar",
  ELECTRONIC_GATEWAY: "electronic_gateway",
  CASH: "cash",
});

const PAYMENT_SOURCES = Object.freeze({
  MOBILE_APP_SUBSCRIPTION: "mobile_app_subscription",
  DASHBOARD_SUBSCRIPTION_CASH: "dashboard_subscription_cash",
  DASHBOARD_SUBSCRIPTION_VISA: "dashboard_subscription_visa",
});

const DASHBOARD_SUBSCRIPTION_CASH_SOURCE = PAYMENT_SOURCES.DASHBOARD_SUBSCRIPTION_CASH;
const DASHBOARD_SUBSCRIPTION_VISA_SOURCE = PAYMENT_SOURCES.DASHBOARD_SUBSCRIPTION_VISA;

function normalizePaymentToken(value) {
  return String(value || "").trim().toLowerCase();
}

function buildMobileAppSubscriptionMetadata(metadata = {}) {
  return {
    ...(metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}),
    paymentMethod: PAYMENT_CHANNELS.MOYASAR,
    paymentChannel: PAYMENT_CHANNELS.MOYASAR,
    paymentOrigin: "mobile_app",
    recordingMode: "moyasar_gateway",
    gatewayUsed: true,
  };
}

function buildMobileAppSubscriptionPaymentRecord(payment = {}) {
  return {
    ...(payment && typeof payment === "object" && !Array.isArray(payment) ? payment : {}),
    provider: PAYMENT_CHANNELS.MOYASAR,
    method: PAYMENT_CHANNELS.MOYASAR,
    source: PAYMENT_SOURCES.MOBILE_APP_SUBSCRIPTION,
    metadata: buildMobileAppSubscriptionMetadata(payment && payment.metadata),
  };
}

/**
 * Dashboard payment presentation exposes the actual commercial source:
 * Moyasar for app/provider payments, electronic gateway for manually recorded
 * dashboard card payments, and cash for explicitly recorded cash payments.
 * Unknown non-cash values remain electronic so they can never silently fall
 * back to cash.
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

  if (source === DASHBOARD_SUBSCRIPTION_VISA_SOURCE) {
    return PAYMENT_CHANNELS.ELECTRONIC_GATEWAY;
  }

  if (
    provider === PAYMENT_CHANNELS.MOYASAR
    || candidates.includes(PAYMENT_CHANNELS.MOYASAR)
  ) {
    return PAYMENT_CHANNELS.MOYASAR;
  }

  return PAYMENT_CHANNELS.ELECTRONIC_GATEWAY;
}

function getPaymentChannelLabel(paymentChannel) {
  if (paymentChannel === PAYMENT_CHANNELS.CASH) {
    return { ar: "كاش", en: "Cash" };
  }
  if (paymentChannel === PAYMENT_CHANNELS.MOYASAR) {
    return { ar: "ميسر", en: "Moyasar" };
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
  PAYMENT_SOURCES,
  buildMobileAppSubscriptionMetadata,
  buildMobileAppSubscriptionPaymentRecord,
  resolveDashboardPaymentChannel,
  decorateDashboardPaymentRecord,
  normalizeDashboardPaymentResponse,
};
