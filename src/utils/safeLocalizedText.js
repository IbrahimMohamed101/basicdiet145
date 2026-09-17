"use strict";

const INVALID_DISPLAY_TEXT = new Set([
  "",
  "[object object]",
  "object object",
  "undefined",
  "null",
  "nan",
]);

const LOCALIZED_PAIR_KEYS = new Set([
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

const AR_KEYS = ["ar", "arSA", "ar_SA", "nameAr", "titleAr", "labelAr", "arabic"];
const EN_KEYS = ["en", "enUS", "en_US", "nameEn", "titleEn", "labelEn", "english"];
const WRAPPER_KEYS = [
  "nameI18n",
  "titleI18n",
  "labelI18n",
  "displayNameI18n",
  "localized",
  "localization",
  "translation",
  "translations",
  "name",
  "title",
  "label",
  "displayName",
  "text",
  "value",
];

function cleanScalar(value) {
  if (value === undefined || value === null) return "";
  if (!["string", "number", "boolean", "bigint"].includes(typeof value)) return "";
  const text = String(value).trim();
  if (INVALID_DISPLAY_TEXT.has(text.toLowerCase())) return "";
  if (/^\[object\s+[^\]]+\]$/i.test(text)) return "";
  return text;
}

function isInvalidDisplayText(value) {
  if (typeof value !== "string") return false;
  return cleanScalar(value) === "" && String(value).trim() !== "";
}

function localizedPair(value, fallback = "", state = null, depth = 0) {
  const scalar = cleanScalar(value);
  if (scalar) return { ar: scalar, en: scalar };
  if (!value || typeof value !== "object" || depth > 10) {
    const fallbackText = cleanScalar(fallback);
    return { ar: fallbackText, en: fallbackText };
  }

  const context = state || { visited: new WeakSet() };
  if (context.visited.has(value)) return { ar: "", en: "" };
  context.visited.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = localizedPair(entry, "", context, depth + 1);
      if (candidate.ar || candidate.en) return candidate;
    }
    const fallbackText = cleanScalar(fallback);
    return { ar: fallbackText, en: fallbackText };
  }

  const localeValue = (keys, locale) => {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const direct = cleanScalar(value[key]);
      if (direct) return direct;
      if (value[key] && typeof value[key] === "object") {
        const nested = localizedPair(value[key], "", context, depth + 1);
        const picked = locale === "ar" ? (nested.ar || nested.en) : (nested.en || nested.ar);
        if (picked) return picked;
      }
    }
    return "";
  };

  const ar = localeValue(AR_KEYS, "ar");
  const en = localeValue(EN_KEYS, "en");
  if (ar || en) return { ar: ar || en, en: en || ar };

  for (const key of WRAPPER_KEYS) {
    const nestedValue = value[key];
    if (!nestedValue || nestedValue === value) continue;
    const nested = localizedPair(nestedValue, "", context, depth + 1);
    if (nested.ar || nested.en) return nested;
  }

  // Historical Mixed snapshots can wrap the localized value inside arbitrary
  // container keys. Only recurse into nested objects so ids/prices are never
  // mistaken for display text.
  for (const nestedValue of Object.values(value)) {
    if (!nestedValue || typeof nestedValue !== "object" || nestedValue === value) continue;
    const nested = localizedPair(nestedValue, "", context, depth + 1);
    if (nested.ar || nested.en) return nested;
  }

  const fallbackText = cleanScalar(fallback);
  return { ar: fallbackText, en: fallbackText };
}

function isOpaqueRuntimeObject(value) {
  return value instanceof Date
    || value instanceof Map
    || value instanceof Set
    || (typeof Buffer !== "undefined" && Buffer.isBuffer(value));
}

function normalizeLocalizedFields(value, state = null) {
  if (value === undefined || value === null || typeof value !== "object") return value;
  if (isOpaqueRuntimeObject(value)) return value;
  const context = state || { completed: new WeakMap() };
  if (context.completed.has(value)) return context.completed.get(value);

  if (Array.isArray(value)) {
    const output = [];
    context.completed.set(value, output);
    for (const entry of value) output.push(normalizeLocalizedFields(entry, context));
    return output;
  }

  const output = {};
  context.completed.set(value, output);
  for (const [key, entry] of Object.entries(value)) {
    if (LOCALIZED_PAIR_KEYS.has(key)) {
      const pair = localizedPair(entry);
      output[key] = pair.ar || pair.en ? pair : normalizeLocalizedFields(entry, context);
      continue;
    }

    if (TEXT_KEYS.has(key)) {
      if (entry && typeof entry === "object") {
        const pair = localizedPair(entry);
        output[key] = pair.ar || pair.en ? pair : "";
      } else {
        output[key] = isInvalidDisplayText(entry) ? "" : entry;
      }
      continue;
    }

    if (AR_KEYS.includes(key) || EN_KEYS.includes(key)) {
      if (entry && typeof entry === "object") {
        const pair = localizedPair(entry);
        output[key] = AR_KEYS.includes(key) ? (pair.ar || pair.en) : (pair.en || pair.ar);
      } else {
        output[key] = isInvalidDisplayText(entry) ? "" : entry;
      }
      continue;
    }

    output[key] = normalizeLocalizedFields(entry, context);
  }
  return output;
}

function sanitizeInvalidDisplayStrings(value, state = null) {
  if (value === undefined || value === null || typeof value !== "object") return value;
  if (isOpaqueRuntimeObject(value)) return value;
  const context = state || { completed: new WeakMap() };
  if (context.completed.has(value)) return context.completed.get(value);

  if (Array.isArray(value)) {
    const output = [];
    context.completed.set(value, output);
    for (const entry of value) output.push(sanitizeInvalidDisplayStrings(entry, context));
    return output;
  }

  const output = {};
  context.completed.set(value, output);
  for (const [key, entry] of Object.entries(value)) {
    if ((TEXT_KEYS.has(key) || LOCALIZED_PAIR_KEYS.has(key) || AR_KEYS.includes(key) || EN_KEYS.includes(key)) && isInvalidDisplayText(entry)) {
      output[key] = "";
    } else {
      output[key] = sanitizeInvalidDisplayStrings(entry, context);
    }
  }
  return output;
}

module.exports = {
  cleanScalar,
  isInvalidDisplayText,
  localizedPair,
  normalizeLocalizedFields,
  sanitizeInvalidDisplayStrings,
};
