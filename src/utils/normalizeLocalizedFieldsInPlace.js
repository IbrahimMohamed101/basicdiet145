"use strict";

const {
  isInvalidDisplayText,
  localizedPair,
} = require("./safeLocalizedText");

const PAIR_KEYS = new Set([
  "nameI18n",
  "titleI18n",
  "labelI18n",
  "displayNameI18n",
  "groupNameI18n",
  "productNameI18n",
  "sandwichNameI18n",
  "proteinNameI18n",
  "optionNameI18n",
]);
const TEXT_KEYS = new Set([
  "name",
  "title",
  "label",
  "displayName",
  "productName",
  "sandwichName",
  "proteinName",
  "optionName",
  "groupName",
]);
const AR_KEYS = new Set(["ar", "arSA", "ar_SA", "nameAr", "titleAr", "labelAr", "arabic"]);
const EN_KEYS = new Set(["en", "enUS", "en_US", "nameEn", "titleEn", "labelEn", "english"]);

function isOpaque(value) {
  return value instanceof Date
    || value instanceof Map
    || value instanceof Set
    || (typeof Buffer !== "undefined" && Buffer.isBuffer(value));
}

function normalizeLocalizedFieldsInPlace(value, visited = null) {
  if (!value || typeof value !== "object" || isOpaque(value)) return value;
  const seen = visited || new WeakSet();
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry) => normalizeLocalizedFieldsInPlace(entry, seen));
    return value;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (PAIR_KEYS.has(key)) {
      const pair = localizedPair(entry);
      if (pair.ar || pair.en) value[key] = pair;
      else normalizeLocalizedFieldsInPlace(entry, seen);
      continue;
    }

    if (TEXT_KEYS.has(key)) {
      if (entry && typeof entry === "object") {
        const pair = localizedPair(entry);
        value[key] = pair.ar || pair.en ? pair : "";
      } else if (isInvalidDisplayText(entry)) {
        value[key] = "";
      }
      continue;
    }

    if (AR_KEYS.has(key) || EN_KEYS.has(key)) {
      if (entry && typeof entry === "object") {
        const pair = localizedPair(entry);
        value[key] = AR_KEYS.has(key) ? (pair.ar || pair.en) : (pair.en || pair.ar);
      } else if (isInvalidDisplayText(entry)) {
        value[key] = "";
      }
      continue;
    }

    normalizeLocalizedFieldsInPlace(entry, seen);
  }
  return value;
}

module.exports = {
  normalizeLocalizedFieldsInPlace,
};
