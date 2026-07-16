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
  sandwich: { ar: "السندوتشات", en: "Sandwiches" },
  addon: { ar: "الإضافات", en: "Add-ons" },
});

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function pairFrom(value, fallbacks = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const scalar = typeof value === "string" ? cleanText(value) : "";
  const ar = cleanText(source.ar || source.arabic || source.nameAr || source.titleAr || fallbacks.ar || scalar);
  const en = cleanText(source.en || source.english || source.nameEn || source.titleEn || fallbacks.en || scalar);
  return {
    ar: ar || en,
    en: en || ar,
  };
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

  // These two mobile contracts historically defaulted to English. Arabic is now
  // the compatibility default while both languages remain present in the payload.
  return "ar";
}

function selected(pair, lang) {
  return lang === "en" ? (pair.en || pair.ar) : (pair.ar || pair.en);
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
    const pair = pairFrom(null, { ar: target.titleAr, en: target.titleEn });
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
  }

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
      if (child && !Array.isArray(child) && Array.isArray(child.choices)) {
        normalizeCategoryGroup(child, key, lang);
      }
      walk(child, lang, key);
    }
  }
  return value;
}

function isSupportedSubscriptionBilingualPath(url = "") {
  const path = String(url).split("?")[0];
  return path === "/api/subscriptions/addon-choices"
    || /^\/api\/subscriptions\/[^/]+\/pickup-availability$/.test(path);
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
