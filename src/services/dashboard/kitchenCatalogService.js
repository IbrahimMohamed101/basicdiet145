"use strict";

const BuilderProtein = require("../../models/BuilderProtein");
const BuilderCarb = require("../../models/BuilderCarb");
const MenuProduct = require("../../models/MenuProduct");
const MenuOption = require("../../models/MenuOption");
const SaladIngredient = require("../../models/SaladIngredient");
const Addon = require("../../models/Addon");
const Meal = require("../../models/Meal");
const Sandwich = require("../../models/Sandwich");

function collectCatalogRefsFromDays(days) {
  const refs = {
    proteinIds: new Set(),
    proteinKeys: new Set(),
    carbIds: new Set(),
    carbKeys: new Set(),
    productIds: new Set(),
    productKeys: new Set(),
    sandwichIds: new Set(),
    sandwichKeys: new Set(),
    optionIds: new Set(),
    optionKeys: new Set(),
    saladItemIds: new Set(),
    saladItemKeys: new Set(),
    addonIds: new Set(),
    addonKeys: new Set(),
    addonPlanIds: new Set(),
  };
  const isObjectId = (val) => /^[a-fA-F0-9]{24}$/.test(String(val || ""));
  const addIdRef = (set, value) => {
    if (value !== undefined && value !== null && value !== "") {
      const str = String(value).trim();
      if (isObjectId(str)) set.add(str);
    }
  };
  const addKeyRef = (set, value) => {
    if (value !== undefined && value !== null && value !== "") {
      set.add(String(value).trim());
    }
  };
  const addProteinRef = (id, key) => {
    addIdRef(refs.proteinIds, id);
    addKeyRef(refs.proteinKeys, key);
    // Subscription Meal Builder stores MenuOption ids for proteins. Always query
    // the canonical option collection as well as the legacy BuilderProtein model.
    addIdRef(refs.optionIds, id);
    addKeyRef(refs.optionKeys, key);
  };
  const addCarbRef = (id, key) => {
    addIdRef(refs.carbIds, id);
    addKeyRef(refs.carbKeys, key);
    // carbId is an option identity in the current Flutter contract. Mirroring the
    // reference into optionIds/optionKeys prevents valid carbs from disappearing
    // merely because no BuilderCarb document owns the same ObjectId.
    addIdRef(refs.optionIds, id);
    addKeyRef(refs.optionKeys, key);
  };
  const collectOption = (option) => {
    if (!option || typeof option !== "object") return;
    const optionId = option.optionId || option.id || option._id || option.catalogItemId;
    const optionKey = option.optionKey || option.key;
    addIdRef(refs.optionIds, optionId);
    addKeyRef(refs.optionKeys, optionKey);
    const group = String(
      option.canonicalGroupKey
        || option.groupKey
        || option.groupName
        || option.groupLabel
        || ""
    ).trim().toLowerCase();
    if (["protein", "proteins"].includes(group)) addProteinRef(optionId, optionKey || option.proteinFamilyKey);
    if (["carb", "carbs", "carbohydrate", "carbohydrates", "starch", "starches", "نشويات", "كارب"].includes(group)) {
      addCarbRef(option.carbId || optionId, option.carbKey || optionKey);
    }
  };
  const collectSalad = (salad) => {
    const groups = salad && typeof salad === "object" && salad.groups && typeof salad.groups === "object"
      ? salad.groups
      : {};
    for (const values of Object.values(groups)) {
      for (const item of Array.isArray(values) ? values : []) {
        if (item && typeof item === "object") {
          addIdRef(refs.saladItemIds, item.id || item._id || item.optionId || item.ingredientId);
          addKeyRef(refs.saladItemKeys, item.key || item.optionKey || item.ingredientKey);
          addIdRef(refs.optionIds, item.id || item._id || item.optionId || item.ingredientId);
          addKeyRef(refs.optionKeys, item.key || item.optionKey || item.ingredientKey);
          addProteinRef(
            item.id || item._id || item.optionId || item.ingredientId,
            item.key || item.optionKey || item.ingredientKey
          );
        } else {
          addIdRef(refs.saladItemIds, item);
          addIdRef(refs.optionIds, item);
          addIdRef(refs.proteinIds, item);
        }
      }
    }
  };
  const collectAddon = (addon) => {
    if (!addon || typeof addon !== "object") return;
    addIdRef(refs.addonIds, addon.addonId || addon.id || addon._id || addon.productId || addon.menuProductId);
    addKeyRef(refs.addonKeys, addon.addonKey || addon.key || addon.productKey);
    addIdRef(refs.productIds, addon.productId || addon.menuProductId);
    addKeyRef(refs.productKeys, addon.productKey || addon.key || addon.addonKey);
    addIdRef(refs.addonPlanIds, addon.addonPlanId);
  };
  const collectCarb = (carb) => {
    if (!carb || typeof carb !== "object") return;
    addCarbRef(
      carb.carbId || carb.optionId || carb.id || carb._id || carb.catalogItemId,
      carb.carbKey || carb.optionKey || carb.key
    );
  };

  for (const day of Array.isArray(days) ? days : []) {
    const snapshotContainers = [
      day,
      day && day.snapshot,
      day && day.lockedSnapshot,
      day && day.fulfilledSnapshot,
    ].filter((value) => value && typeof value === "object");
    const slots = snapshotContainers.flatMap((container) => (
      Array.isArray(container.mealSlots) ? container.mealSlots : []
    ));

    for (const slot of slots) {
      if (!slot || typeof slot !== "object") continue;
      const selections = slot.selections && typeof slot.selections === "object" ? slot.selections : {};
      const confirmation = slot.confirmationSnapshot || {};
      const display = slot.displaySnapshot || {};
      const fulfillment = slot.fulfillmentSnapshot || {};

      addProteinRef(
        slot.proteinId
          || (slot.protein && (slot.protein.id || slot.protein._id))
          || selections.proteinId
          || fulfillment.proteinId,
        slot.proteinKey
          || slot.proteinFamilyKey
          || (slot.protein && (slot.protein.key || slot.protein.proteinFamilyKey))
          || selections.proteinKey
          || confirmation.proteinKey
          || fulfillment.proteinKey
      );
      addIdRef(refs.productIds, slot.productId);
      addKeyRef(refs.productKeys, slot.productKey);
      addIdRef(refs.sandwichIds, slot.sandwichId);
      addKeyRef(refs.sandwichKeys, slot.sandwichKey);
      if (slot.selectionType === "premium_large_salad") {
        addKeyRef(refs.productKeys, "premium_large_salad");
      }
      collectSalad(slot.salad || slot.customSalad || selections.salad);

      for (const option of []
        .concat(Array.isArray(slot.selectedOptions) ? slot.selectedOptions : [])
        .concat(Array.isArray(selections.selectedOptions) ? selections.selectedOptions : [])
        .concat(Array.isArray(display.groups) ? display.groups : [])
        .concat(Array.isArray(display.selectedOptions) ? display.selectedOptions : [])
        .concat(Array.isArray(confirmation.selectedOptions) ? confirmation.selectedOptions : [])
        .concat(Array.isArray(fulfillment.selectedOptions) ? fulfillment.selectedOptions : [])) {
        collectOption(option);
      }

      for (const product of [confirmation.product, display.product, fulfillment.product]) {
        if (!product) continue;
        addIdRef(refs.productIds, product.id || product._id);
        addKeyRef(refs.productKeys, product.key);
      }

      for (const carb of []
        .concat(Array.isArray(slot.carbSelections) ? slot.carbSelections : [])
        .concat(Array.isArray(slot.carbs) ? slot.carbs : [])
        .concat(Array.isArray(selections.carbs) ? selections.carbs : [])
        .concat(Array.isArray(display.carbs) ? display.carbs : [])
        .concat(Array.isArray(confirmation.carbs) ? confirmation.carbs : [])
        .concat(Array.isArray(fulfillment.carbs) ? fulfillment.carbs : [])
        .concat(slot.carbId ? [{ carbId: slot.carbId, carbKey: slot.carbKey }] : [])) {
        collectCarb(carb);
      }
    }

    for (const premiumSelection of Array.isArray(day && day.premiumUpgradeSelections) ? day.premiumUpgradeSelections : []) {
      addIdRef(refs.productIds, premiumSelection.sourceProductId || premiumSelection.sourceId);
      addKeyRef(refs.productKeys, premiumSelection.sourceKey);
    }
    for (const meal of Array.isArray(day && day.materializedMeals) ? day.materializedMeals : []) {
      addProteinRef(meal.proteinId, meal.proteinKey || meal.proteinFamilyKey);
      collectCarb({
        carbId: meal.carbId,
        carbKey: meal.carbKey,
        key: meal.key,
      });
      for (const carb of Array.isArray(meal.carbSelections) ? meal.carbSelections : []) collectCarb(carb);
      addIdRef(refs.productIds, meal.productId);
      addKeyRef(refs.productKeys, meal.productKey);
      addIdRef(refs.sandwichIds, meal.sandwichId);
    }
    for (const addon of []
      .concat(Array.isArray(day && day.addonSelections) ? day.addonSelections : [])
      .concat(Array.isArray(day && day.oneTimeAddonSelections) ? day.oneTimeAddonSelections : [])
      .concat(Array.isArray(day && day.recurringAddons) ? day.recurringAddons : [])
      .concat(day && day.snapshot && Array.isArray(day.snapshot.addons) ? day.snapshot.addons : [])) collectAddon(addon);
    for (const item of Array.isArray(day && day.items) ? day.items : []) {
      const selections = item.selections || {};
      const itemType = String(item.itemType || item.type || "");
      if (itemType === "addon_item" || itemType === "drink" || itemType === "dessert") {
        collectAddon({
          id: (item.catalogRef && item.catalogRef.id) || item.productId || item.mealId,
          key: item.productKey || (item.productSnapshot && item.productSnapshot.key),
        });
        continue;
      }
      addIdRef(refs.productIds, item.productId || item.mealId || (item.catalogRef && item.catalogRef.id));
      addKeyRef(refs.productKeys, item.productKey || (item.productSnapshot && item.productSnapshot.key));
      addProteinRef(selections.proteinId || item.proteinId, selections.proteinKey || item.proteinKey);
      collectSalad(selections.salad);
      for (const option of []
        .concat(Array.isArray(item.selectedOptions) ? item.selectedOptions : [])
        .concat(Array.isArray(selections.selectedOptions) ? selections.selectedOptions : [])) collectOption(option);
      for (const carb of Array.isArray(selections.carbs) ? selections.carbs : []) collectCarb(carb);
      for (const carb of Array.isArray(item.carbSelections) ? item.carbSelections : []) collectCarb(carb);
    }
    const selectedPickupItems = []
      .concat(Array.isArray(day && day.selectedPickupItems) ? day.selectedPickupItems : [])
      .concat(day && day.snapshot && Array.isArray(day.snapshot.selectedPickupItems) ? day.snapshot.selectedPickupItems : []);
    for (const item of selectedPickupItems) {
      if (!item) continue;
      const realId = (item.product && (item.product.id || item.product._id)) || item.addonId || item.sourceId;
      if (item.itemType === "sandwich") {
        addIdRef(refs.sandwichIds, realId);
      } else if (item.itemType !== "addon") {
        addIdRef(refs.productIds, realId);
      } else {
        addIdRef(refs.addonIds, realId);
      }
      for (const comp of Array.isArray(item.components) ? item.components : []) collectOption(comp);
    }
  }
  return refs;
}

function mapBy(rows, field) {
  return new Map((Array.isArray(rows) ? rows : [])
    .map((row) => row && row[field] ? [String(row[field]), row] : null)
    .filter(Boolean));
}

function rowIds(row = {}) {
  return [...new Set([row._id, row.id, row.catalogItemId].filter(Boolean).map(String))];
}

function rowMatchesRefs(row, ids, keys) {
  if (!row || typeof row !== "object") return false;
  const rowKey = row.key ? String(row.key) : null;
  const familyKey = row.proteinFamilyKey ? String(row.proteinFamilyKey) : null;
  return rowIds(row).some((id) => ids.has(id))
    || Boolean(rowKey && keys.has(rowKey))
    || Boolean(familyKey && keys.has(familyKey));
}

function mergeRowsByKey(primary = [], authoritative = []) {
  const rows = [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(authoritative) ? authoritative : [])];
  const byId = mapBy(rows, "_id");
  const byKey = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (row.key) byKey.set(String(row.key), row);
    if (row.proteinFamilyKey) byKey.set(String(row.proteinFamilyKey), row);
  }
  return { byId, byKey };
}

async function buildKitchenCatalogMaps(days) {
  const refs = collectCatalogRefsFromDays(days);
  const optionIds = [...new Set([
    ...refs.optionIds,
    ...refs.saladItemIds,
    ...refs.proteinIds,
    ...refs.carbIds,
  ])];
  const optionKeys = [...new Set([
    ...refs.optionKeys,
    ...refs.saladItemKeys,
    ...refs.proteinKeys,
    ...refs.carbKeys,
  ])];

  const [proteins, carbs, products, meals, sandwiches, menuOptions, saladIngredients, addons, addonProducts, addonPlans] = await Promise.all([
    (refs.proteinIds.size || refs.proteinKeys.size)
      ? BuilderProtein.find({
        $or: [
          refs.proteinIds.size ? { _id: { $in: [...refs.proteinIds] } } : null,
          refs.proteinKeys.size ? { key: { $in: [...refs.proteinKeys] } } : null,
          refs.proteinKeys.size ? { proteinFamilyKey: { $in: [...refs.proteinKeys] } } : null,
        ].filter(Boolean),
      }).select("_id key proteinFamilyKey name").lean()
      : Promise.resolve([]),
    (refs.carbIds.size || refs.carbKeys.size)
      ? BuilderCarb.find({
        $or: [
          refs.carbIds.size ? { _id: { $in: [...refs.carbIds] } } : null,
          refs.carbKeys.size ? { key: { $in: [...refs.carbKeys] } } : null,
        ].filter(Boolean),
      }).select("_id key name").lean()
      : Promise.resolve([]),
    (refs.productIds.size || refs.productKeys.size || refs.sandwichIds.size || refs.sandwichKeys.size)
      ? MenuProduct.find({
        $or: [
          refs.productIds.size ? { _id: { $in: [...refs.productIds] } } : null,
          refs.productKeys.size ? { key: { $in: [...refs.productKeys] } } : null,
          refs.sandwichIds.size ? { _id: { $in: [...refs.sandwichIds] } } : null,
          refs.sandwichKeys.size ? { key: { $in: [...refs.sandwichKeys] } } : null,
        ].filter(Boolean),
      }).select("_id key name imageUrl priceHalala itemType").lean()
      : Promise.resolve([]),
    refs.sandwichIds.size
      ? Meal.find({ _id: { $in: [...refs.sandwichIds] } }).select("_id name").lean()
      : Promise.resolve([]),
    refs.sandwichIds.size
      ? Sandwich.find({ _id: { $in: [...refs.sandwichIds] } }).select("_id name").lean()
      : Promise.resolve([]),
    (optionIds.length || optionKeys.length)
      ? MenuOption.find({
        $or: [
          optionIds.length ? { _id: { $in: optionIds } } : null,
          optionKeys.length ? { key: { $in: optionKeys } } : null,
          optionKeys.length ? { proteinFamilyKey: { $in: optionKeys } } : null,
        ].filter(Boolean),
      }).select("_id catalogItemId key name proteinFamilyKey displayCategoryKey selectionType").lean()
      : Promise.resolve([]),
    refs.saladItemIds.size
      ? SaladIngredient.find({ _id: { $in: [...refs.saladItemIds] } }).select("_id name groupKey").lean()
      : Promise.resolve([]),
    refs.addonIds.size
      ? Addon.find({ _id: { $in: [...refs.addonIds] } }).select("_id name menuProductId category").lean()
      : Promise.resolve([]),
    (refs.addonIds.size || refs.addonKeys.size)
      ? MenuProduct.find({
        $or: [
          refs.addonIds.size ? { _id: { $in: [...refs.addonIds] } } : null,
          refs.addonKeys.size ? { key: { $in: [...refs.addonKeys] } } : null,
        ].filter(Boolean),
      }).select("_id key name imageUrl priceHalala itemType").lean()
      : Promise.resolve([]),
    refs.addonPlanIds.size
      ? Addon.find({ _id: { $in: [...refs.addonPlanIds] } })
        .select("_id name displayKey category imageUrl")
        .lean()
      : Promise.resolve([]),
  ]);

  const optionProteins = menuOptions.filter((row) => rowMatchesRefs(row, refs.proteinIds, refs.proteinKeys));
  const optionCarbs = menuOptions.filter((row) => rowMatchesRefs(row, refs.carbIds, refs.carbKeys));
  const proteinMaps = mergeRowsByKey(proteins, optionProteins);
  const carbMaps = mergeRowsByKey(carbs, optionCarbs);
  const sandwichRows = [...products, ...meals, ...sandwiches];
  const optionById = mapBy(menuOptions, "_id");
  const optionByKey = mapBy(menuOptions, "key");
  const addonProductById = mapBy(addonProducts, "_id");
  const saladRows = saladIngredients.map((ingredient) => ({
    ...ingredient,
    key: ingredient.key || (optionById.get(String(ingredient._id)) || {}).key || null,
  }));
  const addonRows = [
    ...addons.map((addon) => {
      const linkedProduct = addon.menuProductId ? addonProductById.get(String(addon.menuProductId)) : null;
      return {
        ...addon,
        key: addon.key || (linkedProduct && linkedProduct.key) || null,
        name: addon.name || (linkedProduct && linkedProduct.name),
      };
    }),
    ...addonProducts,
  ];

  return {
    proteinById: proteinMaps.byId,
    proteinByKey: proteinMaps.byKey,
    carbById: carbMaps.byId,
    carbByKey: carbMaps.byKey,
    productById: mapBy(products, "_id"),
    productByKey: mapBy(products, "key"),
    sandwichById: mapBy(sandwichRows, "_id"),
    sandwichByKey: mapBy(sandwichRows, "key"),
    optionById,
    optionByKey,
    saladItemById: mapBy(saladRows, "_id"),
    saladItemByKey: mapBy(saladRows, "key"),
    addonById: mapBy(addonRows, "_id"),
    addonByKey: mapBy(addonRows, "key"),
    addonPlanById: mapBy(addonPlans, "_id"),
  };
}

module.exports = {
  buildKitchenCatalogMaps,
  collectCatalogRefsFromDays,
  rowMatchesRefs,
};
