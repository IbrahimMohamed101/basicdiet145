const crypto = require("crypto");

const CARD_VARIANTS = Object.freeze([
  "standard",
  "premium",
  "large_salad",
  "addon",
  "hero_builder",
  "compact_builder",
  "ready_meal",
  "ready_meal_customizable",
  "compact_product",
  "sandwich_card",
  "addon_card",
]);
const DEFAULT_CARD_VARIANT = "standard";
const CATEGORY_CARD_VARIANTS = Object.freeze([
  "meal_builder",
  "light_collection",
  "hero_builder_collection",
  "compact_builder_collection",
  "meal_collection",
  "compact_product_collection",
  "sandwich_collection",
  "addon_collection",
]);
const DEFAULT_CATEGORY_CARD_VARIANT = "addon_collection";
const GROUP_DISPLAY_STYLES = Object.freeze(["chips", "radio_cards", "checkbox_grid", "dropdown", "stepper"]);
const DEFAULT_GROUP_DISPLAY_STYLE = "chips";
const BEHAVIOR_HINTS = Object.freeze(["open_builder", "direct_add", "customize_optional_addons"]);
const PRICE_LABEL_MODES = Object.freeze(["fixed", "per_unit", "per_unit_or_from", "final_depends_on_options", "from_price"]);
const SNAKE_CASE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

function isAllowedCardVariant(value) {
  return CARD_VARIANTS.includes(String(value || "").trim());
}

function sanitizeCardVariant(value) {
  const normalized = String(value || "").trim();
  return isAllowedCardVariant(normalized) ? normalized : DEFAULT_CARD_VARIANT;
}

function isAllowedCategoryCardVariant(value) {
  return CATEGORY_CARD_VARIANTS.includes(String(value || "").trim());
}

function sanitizeCategoryCardVariant(value) {
  const normalized = String(value || "").trim();
  return isAllowedCategoryCardVariant(normalized) ? normalized : DEFAULT_CATEGORY_CARD_VARIANT;
}

function isAllowedGroupDisplayStyle(value) {
  return GROUP_DISPLAY_STYLES.includes(String(value || "").trim());
}

function sanitizeGroupDisplayStyle(value) {
  const normalized = String(value || "").trim();
  return isAllowedGroupDisplayStyle(normalized) ? normalized : DEFAULT_GROUP_DISPLAY_STYLE;
}

function sanitizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeBoolean(value) {
  return typeof value === "boolean" ? value : undefined;
}

function sanitizeEnum(value, allowed) {
  const normalized = String(value || "").trim();
  return allowed.includes(normalized) ? normalized : undefined;
}

function sanitizeLocalizedStringMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const ar = sanitizeString(value.ar);
  const en = sanitizeString(value.en);
  return ar || en ? { ar, en } : undefined;
}

function sanitizeLocalePositionMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result = {};
  ["ar", "en"].forEach((locale) => {
    const position = sanitizeEnum(value[locale], ["left", "right", "top", "bottom"]);
    if (position) result[locale] = position;
  });
  return Object.keys(result).length ? result : undefined;
}

function withOptionalUiFields(payload, source) {
  const layout = sanitizeString(source.layout);
  const ctaLabelI18n = sanitizeLocalizedStringMap(source.ctaLabelI18n);
  const mediaPositionByLocale = sanitizeLocalePositionMap(source.mediaPositionByLocale);
  const showDescription = sanitizeBoolean(source.showDescription);
  const showPrice = sanitizeBoolean(source.showPrice);
  const priceLabelMode = sanitizeEnum(source.priceLabelMode, PRICE_LABEL_MODES);
  const behaviorHint = sanitizeEnum(source.behaviorHint, BEHAVIOR_HINTS);

  if (layout) payload.layout = layout;
  if (ctaLabelI18n) payload.ctaLabelI18n = ctaLabelI18n;
  if (mediaPositionByLocale) payload.mediaPositionByLocale = mediaPositionByLocale;
  if (showDescription !== undefined) payload.showDescription = showDescription;
  if (showPrice !== undefined) payload.showPrice = showPrice;
  if (priceLabelMode) payload.priceLabelMode = priceLabelMode;
  if (behaviorHint) payload.behaviorHint = behaviorHint;
  return payload;
}

function normalizeUiMetadata(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return withOptionalUiFields({
    cardVariant: sanitizeCardVariant(source.cardVariant),
  }, source);
}

function normalizeCategoryUiMetadata(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return withOptionalUiFields({
    cardVariant: sanitizeCategoryCardVariant(source.cardVariant),
  }, source);
}

function normalizeProductUiMetadata(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return withOptionalUiFields({
    cardVariant: sanitizeCardVariant(source.cardVariant),
    badge: sanitizeString(source.badge),
    ctaLabel: sanitizeString(source.ctaLabel),
    imageRatio: sanitizeString(source.imageRatio) || "square",
  }, source);
}

function normalizeGroupUiMetadata(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    displayStyle: sanitizeGroupDisplayStyle(source.displayStyle),
  };
}

function inferCardVariantFromKey(key) {
  const normalized = String(key || "").trim().toLowerCase();
  if (normalized === "premium") return "premium";
  if (normalized === "large_salad") return "large_salad";
  if (["addon", "addons", "snack", "juice", "small_salad"].includes(normalized)) return "addon";
  return DEFAULT_CARD_VARIANT;
}

function inferCategoryCardVariantFromKey(key) {
  const normalized = String(key || "").trim().toLowerCase();
  if (normalized.includes("custom") || normalized.includes("builder")) return "meal_builder";
  if (normalized.includes("light") || normalized.includes("salad")) return "light_collection";
  if (normalized.includes("sandwich") || normalized.includes("sourdough")) return "sandwich_collection";
  return DEFAULT_CATEGORY_CARD_VARIANT;
}

function randomSuffix(length = 6) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);
}

function pickNameSource(name) {
  if (typeof name === "string") return name;
  if (name && typeof name === "object" && !Array.isArray(name)) {
    return name.en || name.ar || "";
  }
  return "";
}

function slugifyKeySource(value) {
  const source = pickNameSource(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  return SNAKE_CASE_PATTERN.test(source) ? source : "";
}

async function generateUniqueKey({
  name,
  fallbackPrefix,
  exists,
}) {
  if (typeof exists !== "function") {
    throw new Error("generateUniqueKey requires an exists function");
  }

  const readable = slugifyKeySource(name);
  const base = readable || `${fallbackPrefix || "item"}_${randomSuffix(6)}`;

  if (!(await exists(base))) return base;

  for (let index = 2; index <= 9; index += 1) {
    const candidate = `${base}_${index}`;
    if (!(await exists(candidate))) return candidate;
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `${base}_${randomSuffix(4)}`;
    if (!(await exists(candidate))) return candidate;
  }

  return `${base}_${randomSuffix(8)}`;
}

module.exports = {
  CARD_VARIANTS,
  BEHAVIOR_HINTS,
  DEFAULT_CARD_VARIANT,
  CATEGORY_CARD_VARIANTS,
  DEFAULT_CATEGORY_CARD_VARIANT,
  DEFAULT_GROUP_DISPLAY_STYLE,
  GROUP_DISPLAY_STYLES,
  PRICE_LABEL_MODES,
  SNAKE_CASE_PATTERN,
  generateUniqueKey,
  inferCardVariantFromKey,
  inferCategoryCardVariantFromKey,
  isAllowedCardVariant,
  isAllowedCategoryCardVariant,
  isAllowedGroupDisplayStyle,
  normalizeCategoryUiMetadata,
  normalizeGroupUiMetadata,
  normalizeProductUiMetadata,
  normalizeUiMetadata,
  sanitizeCardVariant,
  sanitizeCategoryCardVariant,
  sanitizeGroupDisplayStyle,
  slugifyKeySource,
};
