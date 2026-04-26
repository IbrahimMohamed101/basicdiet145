const {
  normalizeProviderPaymentStatus,
  pickProviderInvoicePayment,
  attachRedirectContext,
} = require("../paymentProviderMetadataService");
const {
  applyCommercialStateToDay,
} = require("./subscriptionDayCommercialStateService");

const {
  getPaymentMetadata,
} = require("./subscriptionCheckoutHelpers");

const SYSTEM_CURRENCY = "SAR";
const FINAL_PAYMENT_STATUSES = new Set(["paid", "failed", "canceled", "expired", "refunded"]);

function serializeCheckoutPayment(payment) {
  if (!payment) return null;
  return {
    id: String(payment._id),
    provider: payment.provider,
    type: payment.type,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    providerInvoiceId: payment.providerInvoiceId || null,
    providerPaymentId: payment.providerPaymentId || null,
    applied: Boolean(payment.applied),
    paidAt: payment.paidAt || null,
    createdAt: payment.createdAt || null,
    updatedAt: payment.updatedAt || null,
  };
}

function buildPaymentMetadataWithInitiationFields(
  baseMetadata,
  { paymentUrl, responseShape, totalHalala, redirectContext }
) {
  const metadata = Object.assign({}, baseMetadata || {});
  metadata.paymentUrl = paymentUrl || "";
  metadata.initiationResponseShape = responseShape;
  if (totalHalala !== undefined) {
    metadata.totalHalala = Number(totalHalala || 0);
  }
  return attachRedirectContext(metadata, redirectContext);
}

function buildProviderInvoicePayload(providerInvoice, payment = null, fallbackUrl = "") {
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

function buildPremiumOveragePaymentStatusPayload({ subscription, day, payment, providerInvoice = null }) {
  return {
    subscriptionId: String(subscription._id),
    dayId: day && day._id ? String(day._id) : null,
    date: day && day.date ? day.date : null,
    premiumOverageCount: Number(day && day.premiumOverageCount ? day.premiumOverageCount : 0),
    premiumOverageStatus: day && day.premiumOverageStatus ? day.premiumOverageStatus : null,
    paymentId: String(payment._id),
    paymentStatus: payment.status,
    isFinal: FINAL_PAYMENT_STATUSES.has(payment.status),
    amount: Number(payment.amount || 0),
    currency: payment.currency || SYSTEM_CURRENCY,
    applied: Boolean(payment.applied),
    providerInvoiceId: payment.providerInvoiceId || null,
    providerPaymentId: payment.providerPaymentId || null,
    createdAt: payment.createdAt || null,
    updatedAt: payment.updatedAt || null,
    payment: serializeCheckoutPayment(payment),
    providerInvoice: buildProviderInvoicePayload(providerInvoice, payment, getPaymentMetadata(payment).paymentUrl || ""),
  };
}

function buildOneTimeAddonDayPaymentStatusPayload({ subscription, day, payment, providerInvoice = null }) {
  const selections = Array.isArray(day && day.addonSelections) ? day.addonSelections : [];
  const pendingCount = selections.filter(s => s.source === "pending_payment").length;

  return {
    subscriptionId: String(subscription._id),
    dayId: day && day._id ? String(day._id) : null,
    date: day && day.date ? day.date : null,
    addonSelections: selections,
    pendingCount: Number(pendingCount || 0),
    paymentId: String(payment._id),
    paymentStatus: payment.status,
    isFinal: FINAL_PAYMENT_STATUSES.has(payment.status),
    amount: Number(payment.amount || 0),
    currency: payment.currency || SYSTEM_CURRENCY,
    applied: Boolean(payment.applied),
    providerInvoiceId: payment.providerInvoiceId || null,
    providerPaymentId: payment.providerPaymentId || null,
    createdAt: payment.createdAt || null,
    updatedAt: payment.updatedAt || null,
    payment: serializeCheckoutPayment(payment),
    providerInvoice: buildProviderInvoicePayload(providerInvoice, payment, getPaymentMetadata(payment).paymentUrl || ""),
  };
}

function buildPremiumExtraDayPaymentStatusPayload({ subscription, day, payment, providerInvoice = null }) {
  const derivedDay = applyCommercialStateToDay(day || {});

  return {
    subscriptionId: String(subscription._id),
    dayId: day && day._id ? String(day._id) : null,
    date: day && day.date ? day.date : null,
    plannerState: day && day.plannerState ? day.plannerState : null,
    plannerRevisionHash: derivedDay.plannerRevisionHash,
    premiumPendingPaymentCount: Number(derivedDay.premiumSummary.pendingPaymentCount || 0),
    premiumSummary: derivedDay.premiumSummary,
    premiumExtraPayment: derivedDay.premiumExtraPayment,
    paymentRequirement: derivedDay.paymentRequirement,
    commercialState: derivedDay.commercialState,
    isFulfillable: derivedDay.isFulfillable,
    canBePrepared: derivedDay.canBePrepared,
    paymentId: String(payment._id),
    paymentStatus: payment.status,
    isFinal: FINAL_PAYMENT_STATUSES.has(payment.status),
    amount: Number(payment.amount || 0),
    currency: payment.currency || SYSTEM_CURRENCY,
    applied: Boolean(payment.applied),
    providerInvoiceId: payment.providerInvoiceId || null,
    providerPaymentId: payment.providerPaymentId || null,
    createdAt: payment.createdAt || null,
    updatedAt: payment.updatedAt || null,
    payment: serializeCheckoutPayment(payment),
    providerInvoice: buildProviderInvoicePayload(providerInvoice, payment, getPaymentMetadata(payment).paymentUrl || ""),
  };
}

module.exports = {
  buildPaymentMetadataWithInitiationFields,
  buildProviderInvoicePayload,
  buildPremiumOveragePaymentStatusPayload,
  buildOneTimeAddonDayPaymentStatusPayload,
  buildPremiumExtraDayPaymentStatusPayload,
  serializeCheckoutPayment,
};
