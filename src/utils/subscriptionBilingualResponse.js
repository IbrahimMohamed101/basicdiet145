const { normalizeLanguageCandidate } = require("./i18n");

const CATEGORY_LABELS = Object.freeze({
  juice: { ar: "العصائر", en: "Juices" },
  snack: { ar: "السناك", en: "Snacks" },
  dessert: { ar: "الحلويات", en: "Desserts" },
  ice_cream: { ar: "الآيس كريم", en: "Ice Cream" },
  small_salad: { ar: "سلطة صغيرة", en: "Small Salad" },
  salad: { ar: "السلطات", en: "Salads" },
  meal: { ar: "الوجبات", en: "Meals" },
  premium_meal: { ar: "الوجبات المميزة", en: "Premium Meals" },
  premium_large_salad: { ar: "السلطات المميزة", en: "Premium Salads" },
  large_salad: { ar: "السلطات الكبيرة", en: "Large Salads" },
  protein_extra: { ar: "إضافات البروتين", en: "Protein Extras" },
  sandwich: { ar: "السندوتشات", en: "Sandwiches" },
  addon: { ar: "الإضافات", en: "Add-ons" },
});

const FLAT_TEXT_BASES = Object.freeze([
  "statusText", "selectionText", "unavailableText", "emptyText", "message",
  "statusLabel", "reasonLabel", "commercialStateLabel", "paymentStatusLabel",
  "availabilityLabel", "sectionLabel", "label", "nextAction", "lockedMessage",
]);

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function pairFrom(value, fallbacks = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const scalar = typeof value === "string" ? cleanText(value) : "";
  const ar = cleanText(source.ar || source.arabic || source.nameAr || source.titleAr || fallbacks.ar || scalar);
  const en = cleanText(source.en || source.english || source.nameEn || source.titleEn || fallbacks.en || scalar);
  return { ar: ar || en, en: en || ar };
}

function requestedLanguage(req) {
  const queryLanguage = normalizeLanguageCandidate(req && req.query && req.query.lang);
  if (queryLanguage) return queryLanguage;
  const header = req && req.headers && req.headers["accept-language"];
  if (typeof header === "string" && header.trim()) {
    const first = header.split(",")[0].split(";")[0].trim();
    const normalized = normalizeLanguageCandidate(first);
    if (normalized) return normalized;
  }
  return "ar";
}

function selected(pair, lang) {
  return lang === "en" ? (pair.en || pair.ar) : (pair.ar || pair.en);
}

function normalizeFlatTextPair(target, base, lang) {
  const arKey = `${base}Ar`;
  const enKey = `${base}En`;
  const i18nKey = `${base}I18n`;
  const textKey = `${base}Text`;
  const hasPair = Object.prototype.hasOwnProperty.call(target, arKey)
    || Object.prototype.hasOwnProperty.call(target, enKey)
    || Object.prototype.hasOwnProperty.call(target, i18nKey);
  if (!hasPair) return;
  const pair = pairFrom(target[i18nKey], {
    ar: target[arKey] || (lang === "ar" && typeof target[base] === "string" ? target[base] : ""),
    en: target[enKey] || (lang === "en" && typeof target[base] === "string" ? target[base] : ""),
  });
  target[i18nKey] = pair;
  target[arKey] = pair.ar;
  target[enKey] = pair.en;
  target[textKey] = selected(pair, lang);
  if (!Object.prototype.hasOwnProperty.call(target, base) || typeof target[base] === "string") {
    target[base] = selected(pair, lang);
  }
}

function normalizeArrayPair(target, base, lang) {
  const arKey = `${base}Ar`;
  const enKey = `${base}En`;
  const i18nKey = `${base}I18n`;
  const hasArrays = Array.isArray(target[arKey]) || Array.isArray(target[enKey]);
  if (!hasArrays) return;
  const ar = Array.isArray(target[arKey]) ? target[arKey].map(cleanText).filter(Boolean) : [];
  const en = Array.isArray(target[enKey]) ? target[enKey].map(cleanText).filter(Boolean) : [];
  const length = Math.max(ar.length, en.length);
  const pairs = [];
  for (let index = 0; index < length; index += 1) {
    pairs.push({ ar: ar[index] || en[index] || "", en: en[index] || ar[index] || "" });
  }
  target[arKey] = pairs.map((pair) => pair.ar);
  target[enKey] = pairs.map((pair) => pair.en);
  target[i18nKey] = pairs;
  target[base] = pairs.map((pair) => selected(pair, lang));
}

function normalizeNamedObject(target, lang) {
  if (!target || typeof target !== "object" || Array.isArray(target)) return target;
  const hasNameContract = Object.prototype.hasOwnProperty.call(target, "nameI18n")
    || Object.prototype.hasOwnProperty.call(target, "nameAr")
    || Object.prototype.hasOwnProperty.call(target, "nameEn");
  if (hasNameContract) {
    const pair = pairFrom(target.nameI18n, {
      ar: target.nameAr || (lang === "ar" ? target.name : ""),
      en: target.nameEn || (lang === "en" ? target.name : ""),
    });
    target.nameI18n = pair;
    target.nameAr = pair.ar;
    target.nameEn = pair.en;
    target.name = selected(pair, lang);
  }
  const hasDescriptionContract = Object.prototype.hasOwnProperty.call(target, "descriptionI18n")
    || Object.prototype.hasOwnProperty.call(target, "descriptionAr")
    || Object.prototype.hasOwnProperty.call(target, "descriptionEn");
  if (hasDescriptionContract) {
    const pair = pairFrom(target.descriptionI18n, {
      ar: target.descriptionAr || (lang === "ar" ? target.description : ""),
      en: target.descriptionEn || (lang === "en" ? target.description : ""),
    });
    target.descriptionI18n = pair;
    target.descriptionAr = pair.ar;
    target.descriptionEn = pair.en;
    target.description = selected(pair, lang);
  }
  if (target.title && typeof target.title === "object" && !Array.isArray(target.title)) {
    const pair = pairFrom(target.title, { ar: target.titleAr, en: target.titleEn });
    target.title = pair;
    target.titleAr = pair.ar;
    target.titleEn = pair.en;
    target.titleText = selected(pair, lang);
  } else if (target.titleAr || target.titleEn) {
    const pair = pairFrom(target.titleI18n, { ar: target.titleAr, en: target.titleEn });
    target.titleI18n = pair;
    target.titleAr = pair.ar;
    target.titleEn = pair.en;
    target.titleText = selected(pair, lang);
  }
  if (target.subtitle && typeof target.subtitle === "object" && !Array.isArray(target.subtitle)) {
    const pair = pairFrom(target.subtitle, { ar: target.subtitleAr, en: target.subtitleEn });
    target.subtitle = pair;
    target.subtitleAr = pair.ar;
    target.subtitleEn = pair.en;
    target.subtitleText = selected(pair, lang);
  } else if (target.subtitleAr || target.subtitleEn) {
    const pair = pairFrom(target.subtitleI18n, { ar: target.subtitleAr, en: target.subtitleEn });
    target.subtitleI18n = pair;
    target.subtitleAr = pair.ar;
    target.subtitleEn = pair.en;
    target.subtitleText = selected(pair, lang);
  }
  for (const base of FLAT_TEXT_BASES) normalizeFlatTextPair(target, base, lang);
  normalizeArrayPair(target, "badges", lang);
  return target;
}

function normalizeCategoryGroup(group, categoryKey, lang) {
  if (!group || typeof group !== "object" || Array.isArray(group)) return group;
  const key = cleanText(group.category || categoryKey).toLowerCase();
  const known = CATEGORY_LABELS[key] || null;
  const pair = pairFrom(group.labelI18n, {
    ar: group.labelAr || (known && known.ar) || key,
    en: group.labelEn || (known && known.en) || key,
  });
  group.category = key || categoryKey;
  group.labelI18n = pair;
  group.labelAr = pair.ar;
  group.labelEn = pair.en;
  group.label = selected(pair, lang);
  return group;
}

function walk(value, lang, parentKey = "") {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, lang, parentKey));
    return value;
  }
  if (!value || typeof value !== "object") return value;
  normalizeNamedObject(value, lang);
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object") {
      if (!Array.isArray(child) && Array.isArray(child.choices)) normalizeCategoryGroup(child, key, lang);
      walk(child, lang, key);
    }
  }
  return value;
}

function isSupportedSubscriptionBilingualPath(url = "") {
  const path = String(url).split("?")[0];
  return /^\/api\/subscriptions\/addon-choices?$/.test(path)
    || /^\/api\/subscriptions\/[^/]+\/pickup-availability$/.test(path)
    || /^\/api\/subscriptions\/[^/]+\/days\/[^/]+\/fulfillment\/status$/.test(path);
}

function normalizeSubscriptionBilingualResponse(payload, req) {
  if (!isSupportedSubscriptionBilingualPath(req && (req.originalUrl || req.path))) return payload;
  if (!payload || typeof payload !== "object") return payload;
  return walk(payload, requestedLanguage(req));
}

module.exports = {
  CATEGORY_LABELS,
  isSupportedSubscriptionBilingualPath,
  normalizeSubscriptionBilingualResponse,
  pairFrom,
  requestedLanguage,
};
