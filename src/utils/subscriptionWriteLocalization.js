const { t } = require("./i18n");
const {
  localizeAddonRows,
  localizeStatusObject,
  mapRawDayStatusToClientStatus,
  resolveReadLabel,
  resolveScopedText,
} = require("./subscriptionLocalizationCommon");
const {
  localizeCheckoutDraftStatusReadPayload,
  localizeSubscriptionDayReadPayload,
  localizeSubscriptionReadPayload,
  localizeWalletTopupStatusReadPayload,
} = require("./subscriptionReadLocalization");

function buildPaymentDescription(key, lang, params = {}) {
  const translated = resolveScopedText("write", "paymentDescriptions", key, lang, params);
  return translated || t(`write.paymentDescriptions.${key}`, "en", params);
}

function localizeWriteDayPayload(day, { lang, addonNames = new Map() } = {}) {
  if (!day || typeof day !== "object") return day;

  const originalStatus = day.status;
  const statusForLabels = mapRawDayStatusToClientStatus(originalStatus);
  const localized = localizeSubscriptionDayReadPayload(
    { ...day, status: statusForLabels },
    { lang, addonNames }
  );

  localized.status = originalStatus;
  const statusLabel = resolveReadLabel("dayStatuses", statusForLabels, lang);
  if (statusLabel) {
    localized.statusLabel = statusLabel;
  }

  return localized;
}

function localizeWriteSubscriptionPayload(subscription, { lang, addonNames = new Map(), planName = "" } = {}) {
  if (!subscription || typeof subscription !== "object") return subscription;
  return localizeSubscriptionReadPayload(subscription, { lang, addonNames, planName });
}

function localizeWriteCheckoutStatusPayload(payload, { lang, draft = null } = {}) {
  if (!payload || typeof payload !== "object") return payload;

  const localized = localizeCheckoutDraftStatusReadPayload(payload, { lang, draft });
  if (payload.payment) {
    localized.payment = localizeStatusObject(payload.payment, { lang });
  }
  if (payload.providerInvoice) {
    localized.providerInvoice = localizeStatusObject(payload.providerInvoice, { lang });
  }
  return localized;
}

function localizeWriteWalletTopupStatusPayload(payload, { lang } = {}) {
  if (!payload || typeof payload !== "object") return payload;

  const localized = localizeWalletTopupStatusReadPayload(payload, lang);
  if (payload.payment) {
    localized.payment = localizeStatusObject(payload.payment, { lang });
  }
  if (payload.providerInvoice) {
    localized.providerInvoice = localizeStatusObject(payload.providerInvoice, { lang });
  }
  return localized;
}

function localizeWritePremiumOverageStatusPayload(payload, { lang } = {}) {
  if (!payload || typeof payload !== "object") return payload;

  const localized = {
    ...payload,
    paymentStatusLabel: resolveReadLabel("paymentStatuses", payload.paymentStatus, lang),
    premiumOverageStatusLabel: resolveReadLabel("paymentStatuses", payload.premiumOverageStatus, lang),
  };

  if (payload.payment) {
    localized.payment = localizeStatusObject(payload.payment, { lang });
  }
  if (payload.providerInvoice) {
    localized.providerInvoice = localizeStatusObject(payload.providerInvoice, { lang });
  }

  return localized;
}

function localizeWriteOneTimeAddonPaymentStatusPayload(payload, { lang, addonNames = new Map() } = {}) {
  if (!payload || typeof payload !== "object") return payload;

  const localized = {
    ...payload,
    paymentStatusLabel: resolveReadLabel("paymentStatuses", payload.paymentStatus, lang),
    oneTimeAddonPaymentStatusLabel: resolveReadLabel("paymentStatuses", payload.oneTimeAddonPaymentStatus, lang),
  };

  if (Array.isArray(payload.oneTimeAddonSelections)) {
    localized.oneTimeAddonSelections = localizeAddonRows(payload.oneTimeAddonSelections, {
      lang,
      addonNames,
      preferStoredName: true,
      alwaysSetName: false,
    });
  }

  if (payload.payment) {
    localized.payment = localizeStatusObject(payload.payment, { lang });
  }
  if (payload.providerInvoice) {
    localized.providerInvoice = localizeStatusObject(payload.providerInvoice, { lang });
  }

  return localized;
}

function localizeSkipRangeSummary(summary, { lang } = {}) {
  if (!summary || typeof summary !== "object") return summary;

  const localized = { ...summary };
  if (Array.isArray(summary.rejected)) {
    localized.rejected = summary.rejected.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const reasonLabel = resolveScopedText("write", "skipRangeReasons", entry.reason, lang);
      return reasonLabel ? { ...entry, reasonLabel } : entry;
    });
  }

  return localized;
}

module.exports = {
  buildPaymentDescription,
  localizeSkipRangeSummary,
  localizeWriteCheckoutStatusPayload,
  localizeWriteDayPayload,
  localizeWriteOneTimeAddonPaymentStatusPayload,
  localizeWritePremiumOverageStatusPayload,
  localizeWriteSubscriptionPayload,
  localizeWriteWalletTopupStatusPayload,
};
