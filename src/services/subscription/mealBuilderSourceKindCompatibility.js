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
  ["product_category", "product_list"],
  ["direct_product", "product_list"],
  ["direct_products", "product_list"],
  ["menu_product", "product_list"],
  ["menu_products", "product_list"],
  ["standalone_product", "product_list"],
  ["full_meal_product", "product_list"],
  ["premium_mixed", "premium_visual"],
  ["premium", "premium_visual"],
  ["premium_section", "premium_visual"],
  ["configurable", "configurable_product"],
  ["configurable_meal", "configurable_product"],
  ["product_option_group", "configurable_product"],
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

function normalizeMealBuilderSectionSourceKind(section = {}) {
  if (!section || typeof section !== "object" || Array.isArray(section)) {
    return section;
  }

  const candidate = sourceKindCandidate(section);
  if (!candidate) return { ...section };

  return {
    ...section,
    sourceKind: canonicalSourceKind(candidate),
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
  normalizeMealBuilderDraftArgs,
  normalizeMealBuilderSectionArgs,
  normalizeMealBuilderSectionSourceKind,
  normalizeMealBuilderSections,
};
