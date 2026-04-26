"use strict";

const { t } = require("../../utils/i18n");

function resolvePickupLang(lang) {
  return lang === "ar" ? "ar" : "en";
}

function translatePickup(key, lang, params = {}) {
  return t(`read.pickupPreparation.${key}`, resolvePickupLang(lang), params);
}

function buildLocalizedValue(key, params = {}) {
  const messageAr = translatePickup(key, "ar", params);
  const messageEn = translatePickup(key, "en", params);
  return { messageAr, messageEn };
}

function pickPreferred({ messageAr, messageEn }, lang) {
  return resolvePickupLang(lang) === "ar" ? messageAr : messageEn;
}

function buildPickupLocalizedMessage(key, lang, params = {}) {
  const bundle = buildLocalizedValue(key, params);
  return {
    ...bundle,
    message: pickPreferred(bundle, lang),
  };
}

function buildPickupBlockReasonMessage(code, lang, params = {}) {
  return buildPickupLocalizedMessage(
    `blockReasons.${code || "DEFAULT"}`,
    lang,
    params
  );
}

function buildPickupStatusMessage(status, lang, params = {}) {
  return buildPickupLocalizedMessage(`statusMessages.${status}`, lang, params);
}

function buildPickupStatusLabel(status, lang, params = {}) {
  const bundle = buildLocalizedValue(`statusLabels.${status}`, params);
  return {
    ...bundle,
    label: pickPreferred(bundle, lang),
  };
}

function buildPickupPrepareLockedCopy(lang, params = {}) {
  const statusBundle = buildLocalizedValue(
    "prepareResponse.lockedStatusLabel",
    params
  );
  const messageBundle = buildLocalizedValue(
    "prepareResponse.lockedMessage",
    params
  );

  return {
    statusLabel: pickPreferred(statusBundle, lang),
    statusLabelAr: statusBundle.messageAr,
    statusLabelEn: statusBundle.messageEn,
    message: pickPreferred(messageBundle, lang),
    messageAr: messageBundle.messageAr,
    messageEn: messageBundle.messageEn,
  };
}

module.exports = {
  buildPickupBlockReasonMessage,
  buildPickupLocalizedMessage,
  buildPickupPrepareLockedCopy,
  buildPickupStatusLabel,
  buildPickupStatusMessage,
  resolvePickupLang,
};
