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

const GENERIC_PICKUP_TITLES = new Set([
  "وجبة",
  "وجبة عادية",
  "وجبة مميزة",
  "سلطة مميزة",
  "ساندويتش",
  "ساندوتش",
  "إضافة",
  "عنصر",
  "meal",
  "standard meal",
  "premium meal",
  "premium salad",
  "sandwich",
  "add-on",
  "addon",
  "item",
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
  // requestLanguageMiddleware is the single authority for language negotiation.
  // Reuse its resolved value instead of reparsing headers with a different fallback.
  const attachedLanguage = normalizeLanguageCandidate(req && req.language);
  if (attachedLanguage) return attachedLanguage;

  const attachedLang = normalizeLanguageCandidate(req && req.lang);
  if (attachedLang) return attachedLang;

  const queryLanguage = normalizeLanguageCandidate(req && req.query && req.query.lang);
  if (queryLanguage) return queryLanguage;

  const header = req && req.headers && req.headers["accept-language"];
  if (typeof header === "string" && header.trim()) {
    const first = header.split(",")[0].split(";")[0].trim();
    const normalized = normalizeLanguageCandidate(first);
    if (normalized) return normalized;
  }
  return "en";
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

function isGenericPickupTitle(value) {
  return GENERIC_PICKUP_TITLES.has(cleanText(value).toLowerCase());
}

function usefulPair(...values) {
  for (const value of values) {
    const pair = pairFrom(value);
    if ((!pair.ar || isGenericPickupTitle(pair.ar)) && (!pair.en || isGenericPickupTitle(pair.en))) continue;
    return pair;
  }
  return { ar: "", en: "" };
}

function joinPairs(parts, separator = " + ") {
  const pairs = (Array.isArray(parts) ? parts : []).filter((pair) => pair && (pair.ar || pair.en));
  if (!pairs.length) return { ar: "", en: "" };
  return {
    ar: pairs.map((pair) => pair.ar || pair.en).filter(Boolean).join(separator),
    en: pairs.map((pair) => pair.en || pair.ar).filter(Boolean).join(separator),
  };
}

function componentPair(component) {
  return usefulPair(
    component && component.name,
    component && component.nameI18n,
    component && { ar: component.nameAr, en: component.nameEn }
  );
}

function componentKind(component) {
  const source = [
    component && component.type,
    component && component.groupKey,
    component && component.categoryKey,
    component && component.groupName && component.groupName.en,
  ].map((value) => cleanText(value).toLowerCase()).join(" ");
  if (source.includes("protein") || source.includes("بروتين")) return "protein";
  if (source.includes("carb") || source.includes("كارب")) return "carb";
  if (source.includes("addon") || source.includes("إضاف")) return "addon";
  return "other";
}

function componentPairsByKind(item, kinds) {
  const accepted = new Set(Array.isArray(kinds) ? kinds : [kinds]);
  const seen = new Set();
  const pairs = [];
  const components = Array.isArray(item && item.components)
    ? item.components
    : (Array.isArray(item && item.options) ? item.options : []);
  for (const component of components) {
    if (!accepted.has(componentKind(component))) continue;
    const pair = componentPair(component);
    const key = `${pair.ar}\u0000${pair.en}`;
    if ((!pair.ar && !pair.en) || seen.has(key)) continue;
    seen.add(key);
    pairs.push(pair);
  }
  return pairs;
}

function currentPickupTitlePair(item) {
  return usefulPair(
    item && item.product && item.product.name,
    item && item.meal && item.meal.title,
    item && item.title,
    item && item.display && { ar: item.display.titleAr, en: item.display.titleEn }
  );
}

function hasSandwichHint(item, title) {
  const selectionType = cleanText(item && item.selectionType).toLowerCase();
  const itemType = cleanText(item && item.itemType).toLowerCase();
  if (selectionType === "sandwich" || itemType === "sandwich") return true;
  const hints = [
    item && item.categoryKey,
    item && item.sectionKey,
    item && item.product && item.product.key,
    item && item.productKey,
    title && title.ar,
    title && title.en,
  ].map((value) => cleanText(value).toLowerCase()).join(" ");
  return hints.includes("sandwich") || hints.includes("cold_sandwich") || /ساند(?:وتش|ويتش)/.test(hints);
}

function sandwichTitle(base) {
  const arBase = cleanText(base.ar);
  const enBase = cleanText(base.en);
  return {
    ar: /ساند(?:وتش|ويتش)/.test(arBase) ? arBase : (arBase ? `ساندوتش ${arBase}` : "ساندوتش"),
    en: /\bsandwich\b/i.test(enBase) ? enBase : (enBase ? `${enBase} Sandwich` : "Sandwich"),
  };
}

function pickupTitleFor(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const selectionType = cleanText(item.selectionType).toLowerCase();
  const itemType = cleanText(item.itemType).toLowerCase();
  const title = currentPickupTitlePair(item);

  if (itemType === "addon" || selectionType === "addon") {
    const addonName = usefulPair(
      item.product && item.product.name,
      item.title,
      ...(componentPairsByKind(item, "addon"))
    );
    return addonName.ar || addonName.en ? addonName : null;
  }

  if (itemType === "large_salad" || selectionType === "premium_large_salad") {
    const protein = joinPairs(componentPairsByKind(item, "protein"));
    return {
      ar: protein.ar ? `سلطة كبيرة + ${protein.ar}` : "سلطة كبيرة",
      en: protein.en ? `Large Salad + ${protein.en}` : "Large Salad",
    };
  }

  if (hasSandwichHint(item, title)) {
    return sandwichTitle(title);
  }

  if (["meal", "premium_meal"].includes(itemType)
    || ["standard_meal", "premium_meal", "basic_meal"].includes(selectionType)) {
    const mealParts = componentPairsByKind(item, ["protein", "carb"]);
    const composed = joinPairs(mealParts);
    if (composed.ar || composed.en) return composed;
    return title.ar || title.en ? title : null;
  }

  if (selectionType === "full_meal_product") {
    return title.ar || title.en ? title : null;
  }

  return null;
}

function applyPickupTitle(item, title) {
  if (!item || !title || (!title.ar && !title.en)) return item;
  const pair = pairFrom(title);
  item.title = pair;
  item.display = item.display && typeof item.display === "object" && !Array.isArray(item.display)
    ? item.display
    : {};
  item.display.titleAr = pair.ar;
  item.display.titleEn = pair.en;
  if (item.meal && typeof item.meal === "object" && !Array.isArray(item.meal)) {
    item.meal.title = pair;
  }
  return item;
}

function normalizePickupAvailabilityDisplayNames(payload) {
  const data = payload && payload.data && typeof payload.data === "object" ? payload.data : payload;
  if (!data || typeof data !== "object" || Array.isArray(data)) return payload;
  const visited = new WeakSet();
  const normalizeEntry = (entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || visited.has(entry)) return;
    visited.add(entry);
    const title = pickupTitleFor(entry);
    if (title) applyPickupTitle(entry, title);
  };
  const normalizeList = (value) => {
    if (!Array.isArray(value)) return;
    value.forEach(normalizeEntry);
  };

  normalizeList(data.pickupItems);
  normalizeList(data.slots);
  normalizeList(data.dayAddons);
  normalizeList(data.availableAddonChoices);
  for (const section of Array.isArray(data.sections) ? data.sections : []) {
    normalizeList(section && section.items);
  }
  return payload;
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

function isPickupAvailabilityPath(url = "") {
  const path = String(url).split("?")[0];
  return /^\/api\/subscriptions\/[^/]+\/pickup-availability$/.test(path);
}

function normalizeSubscriptionBilingualResponse(payload, req) {
  const url = req && (req.originalUrl || req.path);
  if (!isSupportedSubscriptionBilingualPath(url)) return payload;
  if (!payload || typeof payload !== "object") return payload;
  if (isPickupAvailabilityPath(url)) normalizePickupAvailabilityDisplayNames(payload);
  return walk(payload, requestedLanguage(req));
}

module.exports = {
  CATEGORY_LABELS,
  isSupportedSubscriptionBilingualPath,
  normalizePickupAvailabilityDisplayNames,
  normalizeSubscriptionBilingualResponse,
  pairFrom,
  requestedLanguage,
};
