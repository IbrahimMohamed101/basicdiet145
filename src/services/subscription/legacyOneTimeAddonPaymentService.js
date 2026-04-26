const Addon = require("../../models/Addon");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const { pickLang } = require("../../utils/i18n");
const { buildPaymentDescription } = require("../../utils/subscription/subscriptionWriteLocalization");
const { buildPaymentMetadataWithInitiationFields } = require("./subscriptionPaymentPayloadService");
const {
  buildErrorResult,
  buildSuccessResult,
  resolveNonCheckoutIdempotency,
} = require("./subscriptionNonCheckoutPaymentService");

const SYSTEM_CURRENCY = "SAR";
const LEGACY_ONE_TIME_ADDON_PAYMENT_TYPE = "one_time_addon";

function buildAddonUnitFromDoc(doc) {
  if (!doc) return 0;
  return Number.isInteger(doc.priceHalala)
    ? doc.priceHalala
    : Math.max(0, Math.round(Number(doc.price || 0) * 100));
}

function normalizeCurrencyValue(value) {
  return String(value || SYSTEM_CURRENCY).trim().toUpperCase();
}

function assertSystemCurrencyOrThrow(value, fieldName) {
  const currency = normalizeCurrencyValue(value);
  if (currency !== SYSTEM_CURRENCY) {
    const err = new Error(`${fieldName} must use ${SYSTEM_CURRENCY}`);
    err.code = "CONFIG";
    err.status = 500;
    throw err;
  }
  return currency;
}

async function createLegacyOneTimeAddonPaymentFlow({
  subscriptionId,
  addonId,
  date,
  userId,
  lang,
  successUrl,
  backUrl,
  headers = {},
  body = {},
  runtime,
  ensureActiveFn,
  validateFutureDateOrThrowFn,
  assertTomorrowCutoffAllowedFn,
  cutoffAction,
  validateRedirectUrlFn,
}) {
  if (!addonId || !date) {
    return buildErrorResult(400, "INVALID", "Missing addonId or date");
  }

  const sub = await Subscription.findById(subscriptionId).populate("planId");
  if (!sub) {
    return buildErrorResult(404, "NOT_FOUND", "Subscription not found");
  }
  if (String(sub.userId) !== String(userId)) {
    return buildErrorResult(403, "FORBIDDEN", "Forbidden");
  }

  try {
    ensureActiveFn(sub, date);
    await validateFutureDateOrThrowFn(date, sub);
  } catch (err) {
    const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
    return buildErrorResult(status, err.code || "INVALID_DATE", err.message);
  }

  try {
    await assertTomorrowCutoffAllowedFn({
      action: cutoffAction,
      date,
    });
  } catch (err) {
    return buildErrorResult(400, err.code || "CUTOFF_PASSED_FOR_TOMORROW", err.message);
  }

  const addon = await Addon.findById(addonId).lean();
  if (!addon || addon.type !== "one_time" || addon.isActive === false) {
    return buildErrorResult(404, "NOT_FOUND", "Addon not found");
  }
  assertSystemCurrencyOrThrow(addon.currency || SYSTEM_CURRENCY, `Addon ${addonId} currency`);

  const day = await SubscriptionDay.findOne({ subscriptionId, date }).lean();
  if (day && day.status !== "open") {
    return buildErrorResult(409, "LOCKED", "Day is locked");
  }

  const idempotency = await resolveNonCheckoutIdempotency({
    headers,
    body,
    userId,
    operationScope: LEGACY_ONE_TIME_ADDON_PAYMENT_TYPE,
    effectivePayload: {
      subscriptionId: String(sub._id),
      addonId: String(addon._id),
      date,
    },
    fallbackResponseShape: LEGACY_ONE_TIME_ADDON_PAYMENT_TYPE,
    runtime,
  });
  if (!idempotency.ok) {
    return idempotency;
  }
  if (!idempotency.shouldContinue) {
    return idempotency;
  }

  const amount = buildAddonUnitFromDoc(addon);
  const appUrl = process.env.APP_URL || "https://example.com";
  const addonDisplayName = pickLang(addon.name, lang);

  const invoice = await runtime.createInvoice({
    amount,
    description: buildPaymentDescription("oneTimeAddon", lang, {
      name: addonDisplayName,
    }),
    callbackUrl: `${appUrl}/api/webhooks/moyasar`,
    successUrl: validateRedirectUrlFn(successUrl, `${appUrl}/payments/success`),
    backUrl: validateRedirectUrlFn(backUrl, `${appUrl}/payments/cancel`),
    metadata: {
      type: LEGACY_ONE_TIME_ADDON_PAYMENT_TYPE,
      subscriptionId: String(sub._id),
      userId: String(userId),
      addonId: String(addon._id),
      date,
    },
  });
  const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || SYSTEM_CURRENCY, "Invoice currency");

  const payment = await runtime.createPayment({
    provider: "moyasar",
    type: LEGACY_ONE_TIME_ADDON_PAYMENT_TYPE,
    status: "initiated",
    amount,
    currency: invoiceCurrency,
    userId,
    subscriptionId: sub._id,
    providerInvoiceId: invoice.id,
    metadata: buildPaymentMetadataWithInitiationFields(invoice.metadata || {}, {
      paymentUrl: invoice.url,
      responseShape: LEGACY_ONE_TIME_ADDON_PAYMENT_TYPE,
    }),
    ...(idempotency.idempotencyKey
      ? {
        operationScope: LEGACY_ONE_TIME_ADDON_PAYMENT_TYPE,
        operationIdempotencyKey: idempotency.idempotencyKey,
        operationRequestHash: idempotency.operationRequestHash,
      }
      : {}),
  });

  return buildSuccessResult(200, {
    payment_url: invoice.url,
    invoice_id: invoice.id,
    payment_id: payment.id,
  });
}

module.exports = {
  createLegacyOneTimeAddonPaymentFlow,
};
