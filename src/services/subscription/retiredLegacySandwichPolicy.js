"use strict";

const LEGACY_SANDWICH_KEY = "sandwich";
const CARD_TYPES = Object.freeze({
  DIRECT_PRODUCT: "direct_product",
  OPTION_FAMILY: "option_family",
  SYSTEM_PREMIUM: "system_premium",
});
const PREMIUM_SELECTION_TYPES = new Set([
  "premium_meal",
  "premium_large_salad",
  "premium",
]);

function token(value) {
  return String(value || "").trim().toLowerCase();
}

function sectionKey(section = {}) {
  return token(section.key || section.sectionKey);
}

function metadataOf(section = {}) {
  const source =
    section.metadata && typeof section.metadata === "object" && !Array.isArray(section.metadata)
      ? section.metadata
      : section.ui && typeof section.ui === "object" && !Array.isArray(section.ui)
        ? section.ui
        : {};
  return source;
}

function isPremiumSection(section = {}) {
  const metadata = metadataOf(section);
  const selectionType = token(section.selectionType);
  return (
    sectionKey(section) === "premium" ||
    token(section.sourceKind) === "premium_visual" ||
    token(section.source?.kind) === "premium_mixed" ||
    token(metadata.visualRole) === "premium" ||
    PREMIUM_SELECTION_TYPES.has(selectionType)
  );
}

function isDashboardAuthored(section = {}) {
  const metadata = metadataOf(section);
  return (
    metadata.dashboardManaged === true ||
    metadata.configuredExplicitly === true ||
    token(metadata.configuredBy) === "dashboard_user" ||
    token(section.source) === "dashboard"
  );
}

function isRetiredLegacySandwichSection(section = {}) {
  if (sectionKey(section) !== LEGACY_SANDWICH_KEY || isPremiumSection(section)) {
    return false;
  }

  const metadata = metadataOf(section);
  const staleSystemMarker =
    section.systemManaged === true ||
    metadata.systemManaged === true ||
    token(section.cardType) === CARD_TYPES.SYSTEM_PREMIUM ||
    token(metadata.cardType) === CARD_TYPES.SYSTEM_PREMIUM;

  // The historical bootstrap card was not authored by the dashboard. Retire only
  // that card, while allowing a future dashboard-created card to reuse the key.
  return staleSystemMarker || !isDashboardAuthored(section);
}

function inferredEditableCardType(section = {}) {
  const metadata = metadataOf(section);
  const explicit = token(section.cardType || metadata.cardType);
  const sectionType = token(
    section.sectionType || section.builderSectionType || section.type
  );

  if (
    explicit === CARD_TYPES.DIRECT_PRODUCT ||
    sectionType === "product_list" ||
    section.itemEntity === "MenuProduct" ||
    section.completeByItself === true ||
    Array.isArray(section.selectedProductIds) ||
    Array.isArray(section.productIds)
  ) {
    return CARD_TYPES.DIRECT_PRODUCT;
  }

  if (
    explicit === CARD_TYPES.OPTION_FAMILY ||
    sectionType === "option_group" ||
    sectionType === "option_family" ||
    sectionType === "configurable_product" ||
    section.itemEntity === "MenuOption" ||
    Array.isArray(section.selectedOptionIds) ||
    Array.isArray(section.optionIds) ||
    section.productContextId ||
    section.sourceGroupId
  ) {
    return CARD_TYPES.OPTION_FAMILY;
  }

  return explicit && explicit !== CARD_TYPES.SYSTEM_PREMIUM ? explicit : "";
}

function normalizeEditableSection(section = {}) {
  if (!section || typeof section !== "object" || Array.isArray(section)) {
    return section;
  }
  if (isPremiumSection(section)) {
    return section;
  }

  const cardType = inferredEditableCardType(section);
  const metadata = { ...metadataOf(section) };
  delete metadata.systemManaged;
  if (cardType) metadata.cardType = cardType;

  const normalized = {
    ...section,
    metadata,
    systemManaged: false,
  };

  if (cardType) normalized.cardType = cardType;
  if (cardType === CARD_TYPES.DIRECT_PRODUCT) {
    normalized.itemEntity = "MenuProduct";
    normalized.completeByItself = true;
  } else if (cardType === CARD_TYPES.OPTION_FAMILY) {
    normalized.itemEntity = "MenuOption";
    normalized.completeByItself = false;
  }

  if (section.ui && section.ui !== section.metadata) {
    const ui = { ...section.ui };
    delete ui.systemManaged;
    if (cardType) ui.cardType = cardType;
    normalized.ui = ui;
  }

  return normalized;
}

function sanitizeSections(sections = []) {
  if (!Array.isArray(sections)) return sections;
  return sections
    .filter((section) => !isRetiredLegacySandwichSection(section))
    .map(normalizeEditableSection);
}

function sanitizeConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return config;
  }
  return {
    ...config,
    sections: sanitizeSections(config.sections || []),
  };
}

function sanitizePayload(value) {
  if (Array.isArray(value)) return value.map(sanitizePayload);
  if (!value || typeof value !== "object") return value;

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = key === "sections" && Array.isArray(entry)
      ? sanitizeSections(entry).map(sanitizePayload)
      : sanitizePayload(entry);
  }

  if (
    Object.prototype.hasOwnProperty.call(output, "sectionType") ||
    Object.prototype.hasOwnProperty.call(output, "cardType") ||
    Object.prototype.hasOwnProperty.call(output, "selectedProductIds") ||
    Object.prototype.hasOwnProperty.call(output, "selectedOptionIds")
  ) {
    return normalizeEditableSection(output);
  }
  return output;
}

function sectionFingerprint(sections = []) {
  return JSON.stringify(sanitizeSections(sections));
}

module.exports = {
  CARD_TYPES,
  LEGACY_SANDWICH_KEY,
  inferredEditableCardType,
  isDashboardAuthored,
  isPremiumSection,
  isRetiredLegacySandwichSection,
  normalizeEditableSection,
  sanitizeConfig,
  sanitizePayload,
  sanitizeSections,
  sectionFingerprint,
  sectionKey,
};
