"use strict";

const BuilderProtein = require("../../models/BuilderProtein");
const BuilderCarb = require("../../models/BuilderCarb");

const INSTALL_MARK = Symbol.for("basicdiet.dashboardKitchenLegacyComponentCatalogResolution.installed");
const WRAPPED_MARK = Symbol.for("basicdiet.dashboardKitchenLegacyComponentCatalogResolution.wrapped");

function idText(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value && typeof value.toHexString === "function") {
    try { return String(value.toHexString()).trim() || null; } catch (_) { return null; }
  }
  if (value && typeof value === "object") {
    if (value._id !== undefined && value._id !== value) return idText(value._id);
    if (value.id !== undefined && value.id !== value) return idText(value.id);
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function keyText(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  return text || null;
}

function emptyRefs() {
  return {
    proteinIds: new Set(),
    proteinKeys: new Set(),
    carbIds: new Set(),
    carbKeys: new Set(),
  };
}

function addId(set, value) {
  const id = idText(value);
  if (id && /^[a-fA-F0-9]{24}$/.test(id)) set.add(id);
}

function addKey(set, value) {
  const key = keyText(value);
  if (key) set.add(key);
}

function collectOption(option, refs) {
  if (!option || typeof option !== "object") return;
  const group = String(option.canonicalGroupKey || option.groupKey || "").trim().toLowerCase();
  if (["protein", "proteins"].includes(group)) {
    addId(refs.proteinIds, option.optionId || option.id || option._id || option.catalogItemId);
    addKey(refs.proteinKeys, option.optionKey || option.key || option.proteinFamilyKey);
  }
  if (["carb", "carbs", "carbohydrate", "carbohydrates", "starch", "starches"].includes(group)) {
    addId(refs.carbIds, option.carbId || option.optionId || option.id || option._id || option.catalogItemId);
    addKey(refs.carbKeys, option.carbKey || option.optionKey || option.key);
  }
}

function collectSlot(slot, refs) {
  if (!slot || typeof slot !== "object") return;
  const confirmation = slot.confirmationSnapshot || {};
  const fulfillment = slot.fulfillmentSnapshot || {};
  const selections = slot.selections || {};

  addId(refs.proteinIds,
    slot.proteinId
      || (slot.protein && (slot.protein.id || slot.protein._id))
      || selections.proteinId
      || fulfillment.proteinId);
  addKey(refs.proteinKeys,
    slot.proteinKey
      || slot.proteinFamilyKey
      || (slot.protein && (slot.protein.key || slot.protein.proteinFamilyKey))
      || selections.proteinKey
      || confirmation.proteinKey
      || fulfillment.proteinKey);

  const carbs = []
    .concat(Array.isArray(slot.carbSelections) ? slot.carbSelections : [])
    .concat(Array.isArray(slot.carbs) ? slot.carbs : [])
    .concat(Array.isArray(selections.carbs) ? selections.carbs : [])
    .concat(slot.carbId ? [{ carbId: slot.carbId, carbKey: slot.carbKey }] : []);
  for (const carb of carbs) {
    if (!carb || typeof carb !== "object") continue;
    addId(refs.carbIds, carb.carbId || carb.optionId || carb.id || carb._id || carb.catalogItemId);
    addKey(refs.carbKeys, carb.carbKey || carb.optionKey || carb.key);
  }

  for (const option of []
    .concat(Array.isArray(slot.selectedOptions) ? slot.selectedOptions : [])
    .concat(Array.isArray(selections.selectedOptions) ? selections.selectedOptions : [])
    .concat(Array.isArray(confirmation.selectedOptions) ? confirmation.selectedOptions : [])) {
    collectOption(option, refs);
  }
}

function collectLegacyRefs(documents = []) {
  const refs = emptyRefs();
  for (const document of Array.isArray(documents) ? documents : []) {
    if (!document || typeof document !== "object") continue;
    for (const slot of []
      .concat(Array.isArray(document.mealSlots) ? document.mealSlots : [])
      .concat(document.snapshot && Array.isArray(document.snapshot.mealSlots) ? document.snapshot.mealSlots : [])
      .concat(Array.isArray(document.items) ? document.items : [])) {
      collectSlot(slot, refs);
    }
  }
  return refs;
}

function mapCopy(value) {
  return value instanceof Map ? new Map(value) : new Map();
}

function mergeLegacyRows(catalogMaps = {}, proteins = [], carbs = []) {
  const merged = {
    ...catalogMaps,
    proteinById: mapCopy(catalogMaps.proteinById),
    proteinByKey: mapCopy(catalogMaps.proteinByKey),
    carbById: mapCopy(catalogMaps.carbById),
    carbByKey: mapCopy(catalogMaps.carbByKey),
    optionById: mapCopy(catalogMaps.optionById),
    optionByKey: mapCopy(catalogMaps.optionByKey),
  };

  for (const row of Array.isArray(proteins) ? proteins : []) {
    if (!row || typeof row !== "object") continue;
    const id = idText(row._id);
    const key = keyText(row.key);
    const family = keyText(row.proteinFamilyKey);
    if (id) {
      merged.proteinById.set(id, row);
      merged.optionById.set(id, row);
    }
    if (key) {
      merged.proteinByKey.set(key, row);
      merged.optionByKey.set(key, row);
    }
    if (family) merged.proteinByKey.set(family, row);
  }

  for (const row of Array.isArray(carbs) ? carbs : []) {
    if (!row || typeof row !== "object") continue;
    const id = idText(row._id);
    const key = keyText(row.key);
    if (id) {
      merged.carbById.set(id, row);
      merged.optionById.set(id, row);
    }
    if (key) {
      merged.carbByKey.set(key, row);
      merged.optionByKey.set(key, row);
    }
  }
  return merged;
}

function queryFor(ids, keys, extraKeyField) {
  const or = [];
  if (ids.size) or.push({ _id: { $in: [...ids] } });
  if (keys.size) {
    or.push({ key: { $in: [...keys] } });
    if (extraKeyField) or.push({ [extraKeyField]: { $in: [...keys] } });
  }
  return or.length ? { $or: or } : null;
}

function installKitchenLegacyComponentCatalogResolution() {
  if (globalThis[INSTALL_MARK]) return globalThis[INSTALL_MARK];
  const service = require("./kitchenCatalogService");
  const original = service.buildKitchenCatalogMaps;

  if (typeof original === "function" && !original[WRAPPED_MARK]) {
    const wrapped = async function buildKitchenCatalogMapsWithLegacyAliases(documents, ...args) {
      const maps = await original.call(this, documents, ...args);
      const refs = collectLegacyRefs(documents);
      const proteinQuery = queryFor(refs.proteinIds, refs.proteinKeys, "proteinFamilyKey");
      const carbQuery = queryFor(refs.carbIds, refs.carbKeys);
      const [proteins, carbs] = await Promise.all([
        proteinQuery
          ? BuilderProtein.find(proteinQuery).select("_id key proteinFamilyKey name").lean()
          : [],
        carbQuery
          ? BuilderCarb.find(carbQuery).select("_id key name").lean()
          : [],
      ]);
      return mergeLegacyRows(maps, proteins, carbs);
    };
    wrapped[WRAPPED_MARK] = true;
    service.buildKitchenCatalogMaps = wrapped;
  }

  const verification = Object.freeze({
    installed: true,
    legacyProteinAliasesResolved: true,
    legacyCarbAliasesResolved: true,
  });
  globalThis[INSTALL_MARK] = verification;
  return verification;
}

installKitchenLegacyComponentCatalogResolution();

module.exports = {
  collectLegacyRefs,
  installKitchenLegacyComponentCatalogResolution,
  mergeLegacyRows,
};
