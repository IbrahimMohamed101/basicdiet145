"use strict";

const SubscriptionDay = require("../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../models/SubscriptionPickupRequest");
const { buildKitchenCatalogMaps } = require("./dashboard/kitchenCatalogService");
const canonical = require("./subscription/pickupCanonicalPresentationService");

const QUERY_PATCHED = Symbol.for("basicdiet.pickupCanonical.queryPatched");
const INSTALL_KEY = Symbol.for("basicdiet.pickupCanonical.installed");
const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function asId(value) {
  if (value === undefined || value === null || value === "") return null;

  if (value && typeof value === "object") {
    if (typeof value.toHexString === "function") {
      try {
        const hex = clean(value.toHexString());
        if (hex) return hex;
      } catch (_err) {
        // Fall through to nested-id/string handling.
      }
    }

    let nestedId;
    try {
      nestedId = value._id;
    } catch (_err) {
      nestedId = null;
    }
    if (nestedId !== undefined && nestedId !== null && nestedId !== value) {
      return asId(nestedId);
    }
  }

  const text = clean(value);
  return text || null;
}

function pair(value, fallback = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const nested = value.nameI18n || value.titleI18n || value.name || value.title || value.labelI18n || value.label;
    if (nested && nested !== value) return pair(nested, fallback);
    const ar = clean(value.ar || value.nameAr || value.titleAr || value.arabic);
    const en = clean(value.en || value.nameEn || value.titleEn || value.english);
    if (ar || en) return { ar: ar || en, en: en || ar };
  }
  const text = clean(value || fallback);
  return { ar: text, en: text };
}

function getMap(catalogMaps, kind, id, key) {
  const byId = catalogMaps && catalogMaps[`${kind}ById`];
  const byKey = catalogMaps && catalogMaps[`${kind}ByKey`];
  return (byId && id ? byId.get(String(id)) : null)
    || (byKey && key ? byKey.get(String(key)) : null)
    || null;
}

function resolveProductDoc(slot = {}, catalogMaps = {}) {
  const snapshotProduct = (slot.confirmationSnapshot && slot.confirmationSnapshot.product)
    || (slot.displaySnapshot && slot.displaySnapshot.product)
    || (slot.fulfillmentSnapshot && slot.fulfillmentSnapshot.product)
    || {};
  const id = asId(slot.productId || slot.sandwichId || snapshotProduct.id || snapshotProduct._id);
  const key = slot.productKey || slot.sandwichKey || snapshotProduct.key || null;
  return getMap(catalogMaps, "product", id, key)
    || getMap(catalogMaps, "sandwich", id, key)
    || null;
}

function resolveOptionDoc(option = {}, catalogMaps = {}) {
  const id = asId(option.optionId || option.id || option._id || option.ingredientId);
  const key = option.optionKey || option.key || option.ingredientKey || null;
  return getMap(catalogMaps, "option", id, key)
    || getMap(catalogMaps, "saladItem", id, key)
    || getMap(catalogMaps, "protein", id, key)
    || getMap(catalogMaps, "carb", id, key)
    || null;
}

function groupKind(option = {}) {
  const raw = `${clean(option.canonicalGroupKey || option.groupKey)} ${clean(option.groupName || option.groupLabel)}`.toLowerCase();
  if (raw.includes("protein") || raw.includes("بروتين")) return "protein";
  if (raw.includes("carb") || raw.includes("كارب") || raw.includes("نشوي")) return "carb";
  if (raw.includes("sauce") || raw.includes("صوص")) return "sauce";
  if (raw.includes("addon") || raw.includes("إضاف")) return "addon";
  return clean(option.canonicalGroupKey || option.groupKey) || "other";
}

function optionComponent(option = {}, catalogMaps = {}) {
  const doc = resolveOptionDoc(option, catalogMaps);
  const kind = groupKind(option);
  const name = pair(
    option.nameI18n
      || option.name
      || option.optionName
      || option.label
      || (doc && doc.name),
    option.optionKey || option.key || (doc && doc.key) || ""
  );
  const groupName = pair(
    option.groupNameI18n || option.groupName || option.groupLabel,
    kind === "protein"
      ? { ar: "البروتين", en: "Protein" }
      : kind === "carb"
        ? { ar: "الكارب", en: "Carbs" }
        : { ar: "المكونات", en: "Components" }
  );
  return {
    id: asId(option.optionId || option.id || option._id || (doc && doc._id)),
    optionId: asId(option.optionId || option.id || option._id || (doc && doc._id)),
    key: option.optionKey || option.key || (doc && doc.key) || null,
    optionKey: option.optionKey || option.key || (doc && doc.key) || null,
    type: kind,
    groupKey: option.canonicalGroupKey || option.groupKey || kind,
    canonicalGroupKey: option.canonicalGroupKey || option.groupKey || kind,
    groupName,
    groupNameI18n: groupName,
    name,
    nameI18n: name,
    quantity: Math.max(1, Number(option.quantity || option.qty || 1)),
    grams: option.grams === undefined || option.grams === null ? null : Number(option.grams || 0),
  };
}

function addUniqueComponent(target, component) {
  if (!component || (!component.id && !component.key && !component.name.ar && !component.name.en)) return;
  const identity = `${component.type}:${component.id || ""}:${component.key || ""}:${component.name.ar}:${component.name.en}`;
  if (target.some((row) => row.__identity === identity)) return;
  target.push({ ...component, __identity: identity });
}

function collectSlotComponents(slot = {}, catalogMaps = {}) {
  const components = [];
  const selectedOptions = []
    .concat(Array.isArray(slot.selectedOptions) ? slot.selectedOptions : [])
    .concat(slot.displaySnapshot && Array.isArray(slot.displaySnapshot.groups) ? slot.displaySnapshot.groups : [])
    .concat(slot.confirmationSnapshot && Array.isArray(slot.confirmationSnapshot.selectedOptions) ? slot.confirmationSnapshot.selectedOptions : []);
  for (const option of selectedOptions) addUniqueComponent(components, optionComponent(option, catalogMaps));

  const proteinId = asId(slot.proteinId || (slot.fulfillmentSnapshot && slot.fulfillmentSnapshot.proteinId));
  const proteinKey = slot.proteinKey
    || slot.proteinFamilyKey
    || slot.premiumKey
    || (slot.confirmationSnapshot && slot.confirmationSnapshot.proteinKey)
    || null;
  if (proteinId || proteinKey) {
    const doc = getMap(catalogMaps, "protein", proteinId, proteinKey);
    addUniqueComponent(components, optionComponent({
      optionId: proteinId || (doc && doc._id),
      optionKey: proteinKey || (doc && (doc.key || doc.proteinFamilyKey)),
      canonicalGroupKey: "protein",
      groupKey: "protein",
      groupNameI18n: { ar: "البروتين", en: "Protein" },
      nameI18n: (doc && doc.name) || slot.proteinNameI18n || slot.proteinName,
      grams: slot.proteinGrams,
    }, catalogMaps));
  }

  const carbs = []
    .concat(Array.isArray(slot.carbSelections) ? slot.carbSelections : [])
    .concat(Array.isArray(slot.carbs) ? slot.carbs : [])
    .concat(slot.carbId ? [{ carbId: slot.carbId }] : []);
  for (const carb of carbs) {
    const id = asId(carb && carb.carbId);
    const key = carb && (carb.key || carb.carbKey);
    const doc = getMap(catalogMaps, "carb", id, key);
    addUniqueComponent(components, optionComponent({
      optionId: id || (doc && doc._id),
      optionKey: key || (doc && doc.key),
      canonicalGroupKey: "carbs",
      groupKey: "carbs",
      groupNameI18n: { ar: "الكارب", en: "Carbs" },
      nameI18n: (carb && (carb.nameI18n || carb.name || carb.carbName)) || (doc && doc.name),
      grams: carb && carb.grams,
    }, catalogMaps));
  }

  const salad = slot.salad || slot.customSalad;
  const saladGroups = salad && salad.groups && typeof salad.groups === "object" ? salad.groups : {};
  for (const [groupKey, values] of Object.entries(saladGroups)) {
    for (const value of Array.isArray(values) ? values : []) {
      const row = value && typeof value === "object" ? value : { optionId: value };
      addUniqueComponent(components, optionComponent({
        ...row,
        optionId: row.optionId || row.id || row._id || row.ingredientId,
        optionKey: row.optionKey || row.key || row.ingredientKey,
        canonicalGroupKey: groupKey,
        groupKey,
      }, catalogMaps));
    }
  }

  return components.map(({ __identity, ...component }) => component);
}

function snapshotProduct(slot = {}) {
  return (slot.confirmationSnapshot && slot.confirmationSnapshot.product)
    || (slot.displaySnapshot && slot.displaySnapshot.product)
    || (slot.fulfillmentSnapshot && slot.fulfillmentSnapshot.product)
    || {};
}

function sourceSlotToPickupItem(slot = {}, index = 0, catalogMaps = {}) {
  const doc = resolveProductDoc(slot, catalogMaps);
  const snapshot = snapshotProduct(slot);
  const productId = asId(slot.productId || slot.sandwichId || snapshot.id || snapshot._id || (doc && doc._id));
  const productKey = slot.productKey || slot.sandwichKey || snapshot.key || (doc && doc.key) || null;
  const productName = pair(
    (doc && doc.name)
      || snapshot.name
      || snapshot.title
      || slot.productNameI18n
      || slot.sandwichNameI18n
      || slot.productName
      || slot.sandwichName,
    productKey || ""
  );
  const item = {
    itemId: clean(slot.slotKey || slot.slotId || slot.slotIndex || `slot_${index + 1}`),
    slotId: clean(slot.slotKey || slot.slotId || slot.slotIndex || `slot_${index + 1}`),
    slotKey: slot.slotKey || null,
    slotIndex: Number(slot.slotIndex || index + 1),
    selectionType: slot.selectionType || "standard_meal",
    itemType: (doc && doc.itemType) || slot.itemType || "",
    isPremium: Boolean(slot.isPremium),
    premiumKey: slot.premiumKey || null,
    premiumSource: slot.premiumSource || "none",
    productId,
    productKey,
    sandwichId: asId(slot.sandwichId),
    sandwichKey: slot.sandwichKey || null,
    product: {
      id: productId,
      key: productKey,
      itemType: (doc && doc.itemType) || slot.itemType || null,
      cardVariant: doc && doc.ui ? doc.ui.cardVariant || null : null,
      name: productName,
      image: snapshot.image || snapshot.imageUrl || (doc && doc.imageUrl) || slot.imageUrl || null,
    },
    title: productName,
    components: collectSlotComponents(slot, catalogMaps),
    quantity: Math.max(1, Number(slot.quantity || 1)),
    image: snapshot.image || snapshot.imageUrl || (doc && doc.imageUrl) || slot.imageUrl || null,
    notes: slot.notes || null,
  };
  return canonical.normalizePickupItem(item, slot);
}

function sourceSlotToKitchenSlot(slot = {}, index = 0, catalogMaps = {}) {
  return canonical.pickupItemToKitchenSlot(sourceSlotToPickupItem(slot, index, catalogMaps), index);
}

function sourceAddonToPickupItem(addon = {}, index = 0, catalogMaps = {}) {
  const id = asId(addon.productId || addon.menuProductId || addon.addonId || addon.id || addon._id);
  const key = addon.productKey || addon.addonKey || addon.key || null;
  const doc = getMap(catalogMaps, "product", id, key) || getMap(catalogMaps, "addon", id, key);
  const name = pair(addon.nameI18n || addon.name || addon.addonName || (doc && doc.name), key || "إضافة");
  return canonical.normalizePickupItem({
    itemId: clean(addon.itemId || `addon_${id || index + 1}`),
    itemType: "addon",
    selectionType: "addon",
    addonId: id,
    sourceId: id,
    addonPlanId: asId(addon.addonPlanId),
    balanceBucketId: asId(addon.balanceBucketId),
    entitlementKey: addon.entitlementKey || null,
    product: { id, key: key || (doc && doc.key) || null, name },
    title: name,
    components: [{
      id,
      key,
      type: "addon",
      groupKey: "addons",
      groupName: { ar: "الإضافات", en: "Add-ons" },
      name,
      quantity: Number(addon.quantity || addon.qty || 1),
    }],
    quantity: Number(addon.quantity || addon.qty || 1),
    productUnitPriceHalala: Number(addon.productUnitPriceHalala || addon.unitPriceHalala || addon.priceHalala || 0),
    payableTotalHalala: Number(addon.payableTotalHalala || addon.totalPriceHalala || 0),
  });
}

function mergeMaps(primary = {}, fallback = {}) {
  const result = { ...fallback, ...primary };
  for (const key of new Set([...Object.keys(fallback), ...Object.keys(primary)])) {
    if (!(fallback[key] instanceof Map) && !(primary[key] instanceof Map)) continue;
    result[key] = new Map([
      ...((fallback[key] instanceof Map) ? fallback[key] : new Map()),
      ...((primary[key] instanceof Map) ? primary[key] : new Map()),
    ]);
  }
  return result;
}

function selectedIds(pickupRequest = {}) {
  return new Set([
    ...(Array.isArray(pickupRequest.selectedMealSlotIds) ? pickupRequest.selectedMealSlotIds : []),
    ...(Array.isArray(pickupRequest.selectedPickupItemIds) ? pickupRequest.selectedPickupItemIds : []),
    ...(pickupRequest.snapshot && Array.isArray(pickupRequest.snapshot.selectedMealSlotIds) ? pickupRequest.snapshot.selectedMealSlotIds : []),
    ...(pickupRequest.snapshot && Array.isArray(pickupRequest.snapshot.selectedPickupItemIds) ? pickupRequest.snapshot.selectedPickupItemIds : []),
  ].map(clean).filter(Boolean));
}

function selectedSourceSlots(pickupRequest = {}, sourceDay = null) {
  const snapshotSlots = pickupRequest.snapshot && Array.isArray(pickupRequest.snapshot.mealSlots)
    ? pickupRequest.snapshot.mealSlots
    : [];
  if (snapshotSlots.length) return snapshotSlots;
  const daySlots = sourceDay && Array.isArray(sourceDay.mealSlots) ? sourceDay.mealSlots : [];
  if (!daySlots.length) return [];
  const ids = selectedIds(pickupRequest);
  if (!ids.size) return daySlots.slice(0, Math.max(0, Number(pickupRequest.mealCount || daySlots.length)));
  return daySlots.filter((slot) => [slot.slotKey, slot.slotId, slot.slotIndex].map(clean).some((id) => ids.has(id)));
}

function canonicalKitchenDetailsForRequest(pickupRequest = {}, sourceDay = null, catalogMaps = {}) {
  const slots = selectedSourceSlots(pickupRequest, sourceDay);
  const storedItems = Array.isArray(pickupRequest.selectedPickupItems) && pickupRequest.selectedPickupItems.length
    ? pickupRequest.selectedPickupItems
    : (pickupRequest.snapshot && Array.isArray(pickupRequest.snapshot.selectedPickupItems)
      ? pickupRequest.snapshot.selectedPickupItems
      : []);
  const itemBySlot = new Map(storedItems.map((item) => [clean(item.slotKey || item.slotId || item.itemId || item.slotIndex), item]));
  let mealSlots = slots.map((slot, index) => {
    const canonicalSlot = sourceSlotToKitchenSlot(slot, index, catalogMaps);
    const stored = itemBySlot.get(clean(slot.slotKey || slot.slotId || slot.slotIndex));
    if (!stored) return canonicalSlot;
    const storedSlot = canonical.pickupItemToKitchenSlot(canonical.normalizePickupItem(stored, slot), index);
    if (!storedSlot) return canonicalSlot;
    return {
      ...storedSlot,
      ...canonicalSlot,
      canonicalTitleI18n: canonicalSlot.canonicalTitleI18n || storedSlot.canonicalTitleI18n,
    };
  }).filter(Boolean);
  if (!mealSlots.length) {
    mealSlots = storedItems.map((item, index) => canonical.pickupItemToKitchenSlot(item, index)).filter(Boolean);
  }

  let addonItems = storedItems.filter((item) => canonical.canonicalItemType(item) === "addon");
  if (!addonItems.length && pickupRequest.snapshot && Array.isArray(pickupRequest.snapshot.addons)) {
    addonItems = pickupRequest.snapshot.addons.map((addon, index) => sourceAddonToPickupItem(addon, index, catalogMaps));
  }
  if (!addonItems.length && sourceDay && Array.isArray(sourceDay.addonSelections)) {
    addonItems = sourceDay.addonSelections.map((addon, index) => sourceAddonToPickupItem(addon, index, catalogMaps));
  }
  const addons = addonItems.map((item) => canonical.pickupItemToAddon(item)).filter(Boolean);
  return { mealSlots, addons };
}

function enrichAvailabilityWithCatalog(availability = {}, day = {}, catalogMaps = {}) {
  const rawById = new Map((Array.isArray(day && day.mealSlots) ? day.mealSlots : []).flatMap((slot) => (
    [slot.slotKey, slot.slotId, slot.slotIndex]
      .map(clean)
      .filter(Boolean)
      .map((key) => [key, slot])
  )));
  const enrichedSlots = (Array.isArray(availability.slots) ? availability.slots : []).map((slot, index) => {
    const key = clean(slot.slotId || slot.slotKey || slot.slotIndex);
    const raw = rawById.get(key) || (Array.isArray(day.mealSlots) ? day.mealSlots[index] : null) || {};
    const canonicalItem = sourceSlotToPickupItem({ ...raw, ...slot }, index, catalogMaps);
    return {
      ...slot,
      selectionType: canonicalItem.selectionType,
      product: canonicalItem.product,
      meal: canonicalItem.meal,
      options: canonicalItem.components,
      display: canonicalItem.display,
    };
  });
  return canonical.normalizeAvailability({ ...availability, slots: enrichedSlots }, day);
}

function recomputeSummary(data = {}) {
  const items = Array.isArray(data.pickupItems) ? data.pickupItems : [];
  const available = items.filter((item) => item.availability && item.availability.available && item.availability.canSelect);
  const byType = (type) => available.filter((item) => canonical.canonicalItemType(item) === type).length;
  return {
    ...(data.summary || {}),
    availableSelectableCount: available.length,
    availableCount: available.length,
    canCreatePickupRequest: available.length > 0,
    availableMealSlotCount: byType("meal") + byType("premium_meal"),
    availableSandwichCount: byType("sandwich"),
    availableSaladCount: byType("large_salad"),
    availableAddonCount: byType("addon"),
    availableProteinExtraCount: byType("protein_extra"),
  };
}

async function attachSourceDays(result) {
  const rows = Array.isArray(result) ? result : (result ? [result] : []);
  if (!rows.length) return result;
  const ids = rows.map((row) => asId(row.subscriptionDayId)).filter((id) => id && OBJECT_ID_RE.test(id));
  const pairs = rows
    .filter((row) => row.subscriptionId && row.date)
    .map((row) => ({ subscriptionId: asId(row.subscriptionId && row.subscriptionId._id || row.subscriptionId), date: row.date }));
  const or = [];
  if (ids.length) or.push({ _id: { $in: ids } });
  if (pairs.length) or.push(...pairs);
  if (!or.length) return result;
  const days = await SubscriptionDay.find({ $or: or }).lean();
  const byId = new Map(days.map((day) => [String(day._id), day]));
  const byPair = new Map(days.map((day) => [`${String(day.subscriptionId)}:${day.date}`, day]));
  for (const row of rows) {
    const id = asId(row.subscriptionDayId);
    const subscriptionId = asId(row.subscriptionId && row.subscriptionId._id || row.subscriptionId);
    const day = (id && byId.get(id)) || byPair.get(`${subscriptionId}:${row.date}`) || null;
    if (day) row.__sourceDay = day;
  }
  return result;
}

function patchPickupRequestQueries() {
  for (const methodName of ["find", "findOne", "findById"]) {
    const original = SubscriptionPickupRequest[methodName];
    if (typeof original !== "function" || original[QUERY_PATCHED]) continue;
    const wrapped = function canonicalPickupQuery(...args) {
      const query = original.apply(this, args);
      if (!query || typeof query.exec !== "function" || query[QUERY_PATCHED]) return query;
      const originalExec = query.exec.bind(query);
      query.exec = async function canonicalPickupExec(...execArgs) {
        const result = await originalExec(...execArgs);
        return attachSourceDays(result);
      };
      query[QUERY_PATCHED] = true;
      return query;
    };
    wrapped[QUERY_PATCHED] = true;
    SubscriptionPickupRequest[methodName] = wrapped;
  }
}

function patchOpsPayload() {
  const service = require("./dashboard/opsPayloadService");
  const original = service.buildKitchenDetailsPayload;
  if (typeof original !== "function" || original.__pickupCanonical) return service;
  const wrapped = function canonicalKitchenDetails(day = {}, subscription = {}, lang = "en", catalogMaps = {}) {
    const base = original(day, subscription, lang, catalogMaps);
    const slots = Array.isArray(day && day.mealSlots) ? day.mealSlots : [];
    if (!slots.length) return base;
    return {
      ...base,
      mealSlots: slots.map((slot, index) => sourceSlotToKitchenSlot(slot, index, catalogMaps)).filter(Boolean),
    };
  };
  wrapped.__pickupCanonical = true;
  service.buildKitchenDetailsPayload = wrapped;
  return service;
}

function patchKitchenProjection() {
  const service = require("./dashboard/kitchenProjectionService");
  const original = service.buildKitchenProjection;
  if (typeof original !== "function" || original.__pickupCanonical) return service;
  const wrapped = function canonicalKitchenProjection(kitchenDetails = {}) {
    const projection = original(kitchenDetails);
    const slots = Array.isArray(kitchenDetails.mealSlots) ? kitchenDetails.mealSlots : [];
    return {
      ...projection,
      kitchenCards: (Array.isArray(projection.kitchenCards) ? projection.kitchenCards : [])
        .map((card, index) => canonical.normalizeKitchenCard(card, slots[index] || {})),
    };
  };
  wrapped.__pickupCanonical = true;
  service.buildKitchenProjection = wrapped;
  return service;
}

function patchPickupSlotService() {
  const service = require("./subscription/subscriptionPickupSlotService");
  const originalBuild = service.buildAvailabilityFromDay;
  if (typeof originalBuild === "function" && !originalBuild.__pickupCanonical) {
    const wrappedBuild = function canonicalAvailability(args = {}) {
      const raw = originalBuild(args);
      return enrichAvailabilityWithCatalog(raw, args.day || {}, args.catalogMaps || {});
    };
    wrappedBuild.__pickupCanonical = true;
    service.buildAvailabilityFromDay = wrappedBuild;
  }

  const originalAssert = service.assertSelectedPickupItemsAvailable;
  if (typeof originalAssert === "function" && !originalAssert.__pickupCanonical) {
    const wrappedAssert = async function canonicalSelectedItems(args = {}) {
      const ids = service.normalizeSelectedPickupItemIds(args.selectedPickupItemIds);
      if (!ids.length) throw service.createServiceError("SELECTED_PICKUP_ITEM_IDS_REQUIRED", "selectedPickupItemIds is required", 400);
      if (!args.day) throw service.createServiceError("DAY_NOT_FOUND", "Subscription day not found", 404);
      const [pickupRequests, richMaps] = await Promise.all([
        service.findBlockingPickupRequests({ subscriptionId: args.subscriptionId, date: args.day.date, session: args.session }),
        buildKitchenCatalogMaps([args.day]),
      ]);
      const catalogMaps = mergeMaps(richMaps, args.catalogMaps || {});
      const availability = service.buildAvailabilityFromDay({
        day: args.day,
        pickupRequests,
        subscription: args.subscription || {},
        catalogMaps,
      });
      const byId = new Map((availability.pickupItems || []).map((item) => [String(item.itemId), item]));
      const invalid = ids.filter((id) => !byId.has(String(id)));
      if (invalid.length) throw service.createServiceError("PICKUP_ITEM_NOT_FOUND", "Selected pickup item was not found", 422, { selectedPickupItemIds: invalid });
      const selectedPickupItems = ids.map((id) => byId.get(String(id)));
      const blocked = selectedPickupItems.filter((item) => !(item.availability && item.availability.available && item.availability.canSelect));
      if (blocked.length) {
        const firstReason = blocked[0].availability && blocked[0].availability.unavailableReason || "PICKUP_ITEM_UNAVAILABLE";
        const code = ["PREMIUM_PAYMENT_REQUIRED", "ADDON_PAYMENT_REQUIRED", "PAYMENT_REQUIRED"].includes(firstReason)
          ? firstReason
          : "PICKUP_ITEM_UNAVAILABLE";
        throw service.createServiceError(code, "Selected pickup item is unavailable for pickup", 422, { pickupItems: blocked });
      }
      const selectedMealItems = selectedPickupItems.filter((item) => canonical.isMealPickupItem(item));
      return {
        selectedPickupItemIds: ids,
        selectedPickupItems,
        selectedMealSlotIds: selectedMealItems.map((item) => clean(item.slotId || item.slotKey || item.itemId)).filter(Boolean),
        mealCreditCount: selectedMealItems.length,
        availability,
      };
    };
    wrappedAssert.__pickupCanonical = true;
    service.assertSelectedPickupItemsAvailable = wrappedAssert;
  }
  return service;
}

function patchClientService() {
  const service = require("./subscription/subscriptionPickupRequestClientService");
  const originalGet = service.getPickupAvailabilityForClient;
  if (typeof originalGet === "function" && !originalGet.__pickupCanonical) {
    const wrappedGet = async function canonicalPickupAvailability(args = {}) {
      const result = await originalGet(args);
      const day = await SubscriptionDay.findOne({ subscriptionId: args.subscriptionId, date: args.date }).lean();
      if (!day) return result;
      const maps = await buildKitchenCatalogMaps([day]);
      const normalized = enrichAvailabilityWithCatalog(result, day, maps);
      normalized.summary = recomputeSummary(normalized);
      return normalized;
    };
    wrappedGet.__pickupCanonical = true;
    service.getPickupAvailabilityForClient = wrappedGet;
  }
  return service;
}

function patchDashboardMapper(opsPayload, projectionService) {
  const service = require("./dashboard/dashboardDtoService");
  const original = service.mapSubscriptionPickupRequestToDTO;
  if (typeof original !== "function" || original.__pickupCanonical) return service;
  const wrapped = function canonicalPickupRequestDTO(pickupRequest, subscription, user, role, lang, catalogMaps = {}, sourceDay = null) {
    const dto = original(pickupRequest, subscription, user, role, lang, catalogMaps);
    const effectiveDay = sourceDay || pickupRequest.__sourceDay || null;
    const details = canonicalKitchenDetailsForRequest(pickupRequest, effectiveDay, catalogMaps);
    const projection = projectionService.buildKitchenProjection(details);
    return {
      ...dto,
      mealCount: details.mealSlots.length,
      kitchenDetails: details,
      ...projection,
    };
  };
  wrapped.__pickupCanonical = true;
  service.mapSubscriptionPickupRequestToDTO = wrapped;
  return service;
}

function installPickupCanonicalContract() {
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;
  patchPickupRequestQueries();
  const opsPayload = patchOpsPayload();
  const projection = patchKitchenProjection();
  patchPickupSlotService();
  patchClientService();
  patchDashboardMapper(opsPayload, projection);
}

installPickupCanonicalContract();

module.exports = {
  canonicalKitchenDetailsForRequest,
  enrichAvailabilityWithCatalog,
  installPickupCanonicalContract,
  sourceSlotToKitchenSlot,
};
