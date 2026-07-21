"use strict";

const kitchenCatalogService = require("./dashboard/kitchenCatalogService");
const { localizedPair } = require("../utils/safeLocalizedText");

const INSTALL_KEY = Symbol.for("basicdiet.pickupLocalizedCatalogGuard.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.pickupLocalizedCatalogGuard.wrapped");

function humanizeKey(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return text
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCatalogRowName(row) {
  if (!row || typeof row !== "object") return row;
  const fallback = humanizeKey(row.key || row.productKey || row.addonKey || row.proteinFamilyKey || "");
  const name = localizedPair(
    row.nameI18n
      || row.name
      || row.titleI18n
      || row.title
      || row.labelI18n
      || row.label,
    fallback
  );
  if (!name.ar && !name.en) return row;
  row.name = name;
  row.nameI18n = name;
  return row;
}

function normalizeCatalogMaps(catalogMaps = {}) {
  const visited = new WeakSet();
  for (const value of Object.values(catalogMaps || {})) {
    if (!(value instanceof Map)) continue;
    for (const row of value.values()) {
      if (!row || typeof row !== "object" || visited.has(row)) continue;
      visited.add(row);
      normalizeCatalogRowName(row);
    }
  }
  return catalogMaps;
}

function installPickupLocalizedCatalogGuard() {
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;

  const original = kitchenCatalogService.buildKitchenCatalogMaps;
  if (typeof original !== "function" || original[WRAPPED_KEY]) return;

  const wrapped = async function buildKitchenCatalogMapsWithSafeNames(...args) {
    const maps = await original.apply(this, args);
    return normalizeCatalogMaps(maps);
  };
  wrapped[WRAPPED_KEY] = true;
  wrapped.__original = original;
  kitchenCatalogService.buildKitchenCatalogMaps = wrapped;
}

installPickupLocalizedCatalogGuard();

module.exports = {
  installPickupLocalizedCatalogGuard,
  normalizeCatalogMaps,
  normalizeCatalogRowName,
};
