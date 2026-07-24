"use strict";

const MenuOption = require("../../models/MenuOption");

const INSTALL_MARK = Symbol.for("basicdiet.dashboardKitchenCatalogNameResolution.installed");
const WRAPPED_MARK = Symbol.for("basicdiet.dashboardKitchenCatalogNameResolution.wrapped");

function scalarId(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value && typeof value === "object" && value._id) return scalarId(value._id);
  if (["string", "number"].includes(typeof value)) {
    const text = String(value).trim();
    return text || null;
  }
  if (value && typeof value.toHexString === "function") return value.toHexString();
  return null;
}

function scalarKey(value) {
  return ["string", "number"].includes(typeof value) && String(value).trim()
    ? String(value).trim()
    : null;
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
  const id = scalarId(value);
  if (id && /^[a-fA-F0-9]{24}$/.test(id)) set.add(id);
}

function addKey(set, value) {
  const key = scalarKey(value);
  if (key) set.add(key);
}

function canonicalGroupKey(option = {}) {
  return String(option.canonicalGroupKey || option.groupKey || "").trim().toLowerCase();
}

function collectGroupedOption(option, refs) {
  if (!option || typeof option !== "object") return;
  const groupKey = canonicalGroupKey(option);
  if (["protein", "proteins"].includes(groupKey)) {
    addId(refs.proteinIds, option.optionId || option.id || option._id);
    addKey(refs.proteinKeys, option.optionKey || option.key);
  }
  if (["carb", "carbs", "carbohydrate", "carbohydrates", "starch", "starches"].includes(groupKey)) {
    addId(refs.carbIds, option.optionId || option.id || option._id);
    addKey(refs.carbKeys, option.optionKey || option.key);
  }
}

function collectSlot(slot = {}, refs) {
  if (!slot || typeof slot !== "object") return;
  const confirmation = slot.confirmationSnapshot || {};
  const display = slot.displaySnapshot || {};
  const fulfillment = slot.fulfillmentSnapshot || {};

  addId(refs.proteinIds, slot.proteinId || fulfillment.proteinId);
  addKey(refs.proteinKeys, slot.proteinKey || slot.proteinFamilyKey || confirmation.proteinKey || fulfillment.proteinKey);

  for (const carb of []
    .concat(Array.isArray(slot.carbSelections) ? slot.carbSelections : [])
    .concat(Array.isArray(slot.carbs) ? slot.carbs : [])
    .concat(slot.carbId ? [{ carbId: slot.carbId, key: slot.carbKey }] : [])) {
    if (!carb || typeof carb !== "object") continue;
    addId(refs.carbIds, carb.carbId || carb.optionId || carb.id || carb._id);
    addKey(refs.carbKeys, carb.key || carb.optionKey || carb.carbKey);
  }

  for (const option of []
    .concat(Array.isArray(slot.selectedOptions) ? slot.selectedOptions : [])
    .concat(Array.isArray(display.groups) ? display.groups : [])
    .concat(Array.isArray(confirmation.selectedOptions) ? confirmation.selectedOptions : [])) {
    collectGroupedOption(option, refs);
  }
}

function collectOperationalOptionRefs(documents = []) {
  const refs = emptyRefs();

  for (const document of Array.isArray(documents) ? documents : []) {
    if (!document || typeof document !== "object") continue;

    for (const slot of []
      .concat(Array.isArray(document.mealSlots) ? document.mealSlots : [])
      .concat(document.snapshot && Array.isArray(document.snapshot.mealSlots) ? document.snapshot.mealSlots : [])) {
      collectSlot(slot, refs);
    }

    for (const item of Array.isArray(document.items) ? document.items : []) {
      if (!item || typeof item !== "object") continue;
      const selections = item.selections || {};
      collectSlot({
        ...item,
        proteinId: selections.proteinId || item.proteinId,
        proteinKey: selections.proteinKey || item.proteinKey,
        carbSelections: Array.isArray(selections.carbs) ? selections.carbs : item.carbSelections,
        selectedOptions: []
          .concat(Array.isArray(item.selectedOptions) ? item.selectedOptions : [])
          .concat(Array.isArray(selections.selectedOptions) ? selections.selectedOptions : []),
      }, refs);
    }
  }

  return refs;
}

function mapCopy(value) {
  return value instanceof Map ? new Map(value) : new Map();
}

function mergeCatalogRows(catalogMaps = {}, refs = emptyRefs(), rows = []) {
  const merged = {
    ...catalogMaps,
    proteinById: mapCopy(catalogMaps.proteinById),
    proteinByKey: mapCopy(catalogMaps.proteinByKey),
    carbById: mapCopy(catalogMaps.carbById),
    carbByKey: mapCopy(catalogMaps.carbByKey),
    optionById: mapCopy(catalogMaps.optionById),
    optionByKey: mapCopy(catalogMaps.optionByKey),
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const id = scalarId(row._id || row.id);
    const key = scalarKey(row.key);
    const proteinFamilyKey = scalarKey(row.proteinFamilyKey);

    if (id) merged.optionById.set(id, row);
    if (key) merged.optionByKey.set(key, row);

    const isReferencedProtein = Boolean(
      (id && refs.proteinIds.has(id))
      || (key && refs.proteinKeys.has(key))
      || (proteinFamilyKey && refs.proteinKeys.has(proteinFamilyKey))
    );
    if (isReferencedProtein) {
      if (id) merged.proteinById.set(id, row);
      if (key) merged.proteinByKey.set(key, row);
      if (proteinFamilyKey) merged.proteinByKey.set(proteinFamilyKey, row);
    }

    const isReferencedCarb = Boolean(
      (id && refs.carbIds.has(id))
      || (key && refs.carbKeys.has(key))
    );
    if (isReferencedCarb) {
      if (id) merged.carbById.set(id, row);
      if (key) merged.carbByKey.set(key, row);
    }
  }

  return merged;
}

function buildQuery(refs) {
  const ids = [...new Set([...refs.proteinIds, ...refs.carbIds])];
  const keys = [...new Set([...refs.proteinKeys, ...refs.carbKeys])];
  const or = [];
  if (ids.length) or.push({ _id: { $in: ids } });
  if (keys.length) {
    or.push({ key: { $in: keys } });
    or.push({ proteinFamilyKey: { $in: keys } });
  }
  return or.length ? { $or: or } : null;
}

function installKitchenCatalogNameResolution() {
  if (globalThis[INSTALL_MARK]) return globalThis[INSTALL_MARK];

  const service = require("./kitchenCatalogService");
  const original = service.buildKitchenCatalogMaps;

  if (typeof original === "function" && !original[WRAPPED_MARK]) {
    const wrapped = async function buildResolvedKitchenCatalogMaps(documents, ...args) {
      const catalogMaps = await original.call(this, documents, ...args);
      const refs = collectOperationalOptionRefs(documents);
      const query = buildQuery(refs);
      if (!query) return catalogMaps;

      const rows = await MenuOption.find(query)
        .select("_id key name proteinFamilyKey displayCategoryKey selectionType")
        .lean();
      return mergeCatalogRows(catalogMaps, refs, rows);
    };
    wrapped[WRAPPED_MARK] = true;
    service.buildKitchenCatalogMaps = wrapped;
  }

  const verification = Object.freeze({ installed: true, kitchenCatalogWrapped: true });
  globalThis[INSTALL_MARK] = verification;
  return verification;
}

installKitchenCatalogNameResolution();

module.exports = {
  collectOperationalOptionRefs,
  installKitchenCatalogNameResolution,
  mergeCatalogRows,
};
