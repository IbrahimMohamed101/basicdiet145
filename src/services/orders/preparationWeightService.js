"use strict";

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function textOf(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (typeof value !== "object" || Array.isArray(value)) return "";
  return textOf(
    value.ar
      || value.en
      || value.nameI18n
      || value.name
      || value.titleI18n
      || value.title
      || value.labelI18n
      || value.label
      || ""
  );
}

function readPath(value, path) {
  return String(path || "").split(".").reduce((current, key) => (
    current && typeof current === "object" ? current[key] : undefined
  ), value);
}

function firstPositive(source, paths) {
  for (const path of paths) {
    const resolved = positiveInteger(readPath(source, path));
    if (resolved) return resolved;
  }
  return null;
}

function extractDeclaredWeightGrams(...values) {
  for (const value of values) {
    const text = textOf(value);
    if (!text) continue;

    const explicit = text.match(/(?:^|[^0-9])(\d{2,4})\s*(?:g|gr|gram|grams|جرام|جرامات|جم)(?:\b|_|\s|$)/iu);
    if (explicit) {
      const grams = positiveInteger(explicit[1]);
      if (grams) return grams;
    }

    const keySuffix = text.toLowerCase().match(/(?:^|_)(\d{2,4})g(?:_|$)/u);
    if (keySuffix) {
      const grams = positiveInteger(keySuffix[1]);
      if (grams) return grams;
    }
  }
  return null;
}

function resolvePreparationWeight({ item = {}, product = {}, snapshot = {}, slot = {}, card = {} } = {}) {
  const pricingModel = String(
    product.pricingModel
      || snapshot.pricingModel
      || readPath(item, "productSnapshot.pricingModel")
      || "fixed"
  );

  const selectedWeight = firstPositive({ item, snapshot, slot, card }, [
    "item.servingWeightGrams",
    "item.preparationWeightGrams",
    "item.weightGrams",
    "item.selectedWeightGrams",
    "item.pricingSnapshot.weightPricing.selectedWeightGrams",
    "item.productSnapshot.servingWeightGrams",
    "item.productSnapshot.preparationWeightGrams",
    "item.productSnapshot.weightGrams",
    "snapshot.servingWeightGrams",
    "snapshot.preparationWeightGrams",
    "snapshot.weightGrams",
    "slot.productGrams",
    "slot.weightGrams",
    "card.components.product.grams",
  ]);

  const catalogDefault = firstPositive({ product, snapshot, item }, [
    "product.defaultWeightGrams",
    "snapshot.defaultWeightGrams",
    "item.productSnapshot.defaultWeightGrams",
  ]);

  const declaredFixedServing = extractDeclaredWeightGrams(
    product.key,
    product.name,
    snapshot.key,
    snapshot.name,
    readPath(item, "productSnapshot.key"),
    readPath(item, "productSnapshot.name"),
    item.productKey,
    item.name,
    slot.productKey,
    slot.productNameI18n,
    slot.productName,
    card.titleI18n,
    card.title
  );

  if (pricingModel === "per_100g") {
    if (selectedWeight) return { grams: selectedWeight, source: "selected_weight", pricingModel };
    if (catalogDefault) return { grams: catalogDefault, source: "catalog_default", pricingModel };
    if (declaredFixedServing) return { grams: declaredFixedServing, source: "legacy_declared_weight", pricingModel };
    return { grams: null, source: "missing", pricingModel };
  }

  // Fixed products do not support an arbitrary customer-selected weight. Prefer
  // the catalog serving definition over stale snapshots written by old pricing code.
  if (catalogDefault) return { grams: catalogDefault, source: "catalog_default", pricingModel };
  if (declaredFixedServing) return { grams: declaredFixedServing, source: "legacy_declared_weight", pricingModel };
  if (selectedWeight) return { grams: selectedWeight, source: "stored_weight", pricingModel };
  return { grams: null, source: "missing", pricingModel };
}

module.exports = {
  extractDeclaredWeightGrams,
  positiveInteger,
  resolvePreparationWeight,
};
