"use strict";

const CANONICAL_SOURCE_KINDS = new Set([
  "",
  "visual_family",
  "configurable_product",
  "product_list",
  "premium_visual",
]);

const SOURCE_KIND_ALIASES = new Map([
  ["option_group", "visual_family"],
  ["option_family", "visual_family"],
  ["visual_option_family", "visual_family"],
  ["protein_family", "visual_family"],
  ["carbs_family", "visual_family"],
  ["menu_option", "visual_family"],
  ["menu_options", "visual_family"],
  ["menu_option_group", "visual_family"],
  ["menu_option_groups", "visual_family"],
  ["builder_group", "visual_family"],
  ["builder_groups", "visual_family"],
  ["product_category", "product_list"],
  ["direct_product", "product_list"],
  ["direct_products", "product_list"],
  ["menu_product", "product_list"],
  ["menu_products", "product_list"],
  ["standalone_product", "product_list"],
  ["full_meal_product", "product_list"],
  ["catalog_product", "product_list"],
  ["catalog_products", "product_list"],
  ["premium_mixed", "premium_visual"],
  ["premium", "premium_visual"],
  ["premium_section", "premium_visual"],
  ["configurable", "configurable_product"],
  ["configurable_meal", "configurable_product"],
  ["product_option_group", "configurable_product"],
  ["product_option_groups", "configurable_product"],
  ["product_context", "configurable_product"],
]);

function token(value) {
  return value === undefined || value === null
    ? ""
    : String(value).trim().toLowerCase();
}

function canonicalSourceKind(value) {
  const normalized = token(value);
  if (CANONICAL_SOURCE_KINDS.has(normalized)) return normalized;
  return SOURCE_KIND_ALIASES.get(normalized) || normalized;
}

function sourceKindCandidate(section = {}) {
  const topLevel = token(section.sourceKind);
  if (topLevel) return topLevel;
  const nestedSource =
    section.source &&
    typeof section.source === "object" &&
    !Array.isArray(section.source)
      ? section.source
      : null;
  return token(nestedSource && nestedSource.kind);
}

function canonicalSourceKindForSection(section = {}) {
  if (!section || typeof section !== "object" || Array.isArray(section)) {
    return "";
  }

  const candidate = canonicalSourceKind(sourceKindCandidate(section));
  if (CANONICAL_SOURCE_KINDS.has(candidate)) return candidate;

  const sectionType = token(section.sectionType || section.type);
  const selectionType = token(section.selectionType);
  const key = token(section.key || section.sectionKey);
  const hasProductIds =
    Array.isArray(section.selectedProductIds) ||
    Array.isArray(section.productIds);
  const hasOptionContext =
    Array.isArray(section.selectedOptionIds) ||
    Array.isArray(section.optionIds) ||
    Boolean(section.productContextId || section.sourceGroupId);

  if (
    sectionType === "product_list" ||
    sectionType === "product_category" ||
    selectionType === "full_meal_product" ||
    selectionType === "sandwich" ||
    (hasProductIds && !hasOptionContext)
  ) {
    return "product_list";
  }

  if (
    key === "premium" ||
    selectionType === "premium_meal" ||
    selectionType === "premium_large_salad"
  ) {
    return "premium_visual";
  }

  if (sectionType === "option_group" || hasOptionContext) {
    return candidate.includes("configurable") ||
      candidate.includes("product_option") ||
      candidate.includes("product_context")
      ? "configurable_product"
      : "visual_family";
  }

  return candidate;
}

function normalizeMealBuilderSectionSourceKind(section = {}) {
  if (!section || typeof section !== "object" || Array.isArray(section)) {
    return section;
  }

  const candidate = sourceKindCandidate(section);
  if (!candidate) return { ...section };

  return {
    ...section,
    sourceKind: canonicalSourceKindForSection(section),
  };
}

function normalizeMealBuilderSections(sections) {
  if (!Array.isArray(sections)) return sections;
  return sections.map(normalizeMealBuilderSectionSourceKind);
}

function normalizeMealBuilderDraftArgs(args = {}) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  if (!Object.prototype.hasOwnProperty.call(args, "sections")) return { ...args };
  return {
    ...args,
    sections: normalizeMealBuilderSections(args.sections),
  };
}

function normalizeMealBuilderSectionArgs(args = {}, fieldName = "section") {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  if (!Object.prototype.hasOwnProperty.call(args, fieldName)) return { ...args };
  return {
    ...args,
    [fieldName]: normalizeMealBuilderSectionSourceKind(args[fieldName]),
  };
}

module.exports = {
  CANONICAL_SOURCE_KINDS,
  SOURCE_KIND_ALIASES,
  canonicalSourceKind,
  canonicalSourceKindForSection,
  normalizeMealBuilderDraftArgs,
  normalizeMealBuilderSectionArgs,
  normalizeMealBuilderSectionSourceKind,
  normalizeMealBuilderSections,
  sourceKindCandidate,
};
