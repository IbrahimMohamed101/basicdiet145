"use strict";

const KITCHEN_CONTRACT_VERSION = "v2";

function asId(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value._id) return String(value._id);
  return String(value);
}

function isTruthyQuery(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function compactOptional(target, key, value) {
  if (value !== undefined && value !== null && value !== "") target[key] = value;
}

function sanitizeSectionItem(item = {}) {
  const clean = {
    id: asId(item.id || item.optionId),
    key: item.key || item.optionKey || null,
    name: item.name || "",
    nameI18n: item.nameI18n || null,
    quantity: Number(item.quantity || 1),
  };
  if (item.grams !== undefined && item.grams !== null) clean.grams = Number(item.grams || 0);
  const productUnitPrice = item.productUnitPriceHalala ?? item.unitPriceHalala;
  const payableTotal = item.payableTotalHalala ?? item.totalPriceHalala;
  if (productUnitPrice !== undefined && productUnitPrice !== null) {
    clean.productUnitPriceHalala = Number(productUnitPrice || 0);
  }
  if (payableTotal !== undefined && payableTotal !== null) {
    clean.payableTotalHalala = Number(payableTotal || 0);
  }
  if (item.subscriptionPlanUnitPriceHalala !== undefined && item.subscriptionPlanUnitPriceHalala !== null) {
    clean.subscriptionPlanUnitPriceHalala = Number(item.subscriptionPlanUnitPriceHalala || 0);
  }
  return clean;
}

function sanitizeSections(sections) {
  return (Array.isArray(sections) ? sections : []).map((section) => ({
    key: section && section.key ? String(section.key) : null,
    label: section && section.label ? String(section.label) : "",
    ...(section && section.labelI18n ? { labelI18n: section.labelI18n } : {}),
    items: (Array.isArray(section && section.items) ? section.items : []).map(sanitizeSectionItem),
  }));
}

function sanitizeComponentItem(item) {
  if (!item || typeof item !== "object") return null;
  const clean = {
    id: asId(item.id),
    key: item.key || null,
    name: item.name || "",
    nameI18n: item.nameI18n || null,
  };
  if (item.grams !== undefined && item.grams !== null) clean.grams = Number(item.grams || 0);
  return clean;
}

function sanitizeCard(card = {}, { includeRaw = false } = {}) {
  const sections = sanitizeSections(card.sections);
  const sourceComponents = card.components && typeof card.components === "object" ? card.components : {};
  const clean = {
    cardId: card.cardId || null,
    slotIndex: card.slotIndex === undefined || card.slotIndex === null ? null : Number(card.slotIndex),
    slotKey: card.slotKey || null,
    type: card.type || null,
    title: card.title || "",
    titleI18n: card.titleI18n || null,
    badge: card.badge || null,
    quantity: Number(card.quantity || 1),
    notes: card.notes || null,
    imageUrl: card.imageUrl || null,
    lines: Array.isArray(card.lines) ? card.lines.map(String) : [],
    sections,
    components: {
      product: sanitizeComponentItem(sourceComponents.product),
      protein: sanitizeComponentItem(sourceComponents.protein),
      carbs: (Array.isArray(sourceComponents.carbs) ? sourceComponents.carbs : [])
        .map(sanitizeComponentItem)
        .filter(Boolean),
      salad: sourceComponents.salad ? { sections } : null,
    },
    warnings: Array.isArray(card.warnings) ? [...card.warnings] : [],
  };
  if (includeRaw && card.rawSelection !== undefined) clean.rawSelection = card.rawSelection;
  return clean;
}

function sanitizeAddonGroups(groups) {
  return (Array.isArray(groups) ? groups : []).map((group) => ({
    addonPlanId: asId(group && group.addonPlanId),
    balanceBucketId: asId(group && group.balanceBucketId),
    label: group && group.label ? String(group.label) : "",
    labelI18n: group && group.labelI18n ? group.labelI18n : null,
    items: (Array.isArray(group && group.items) ? group.items : []).map((item) => {
      const clean = {
        productId: asId(item && item.productId),
        key: item && item.key ? String(item.key) : null,
        name: item && item.name ? String(item.name) : "",
        nameI18n: item && item.nameI18n ? item.nameI18n : null,
        quantity: Number(item && item.quantity || 1),
        productUnitPriceHalala: Number(item && item.productUnitPriceHalala || 0),
        payableTotalHalala: Number(item && item.payableTotalHalala || 0),
      };
      if (item && item.subscriptionPlanUnitPriceHalala !== undefined && item.subscriptionPlanUnitPriceHalala !== null) {
        clean.subscriptionPlanUnitPriceHalala = Number(item.subscriptionPlanUnitPriceHalala || 0);
      }
      return clean;
    }),
  }));
}

function resolveSource(item = {}) {
  if (typeof item.source === "string" && item.source) return item.source;
  if (item.entityType === "order" || item.orderId || (item.meta && item.meta.orderId)) return "one_time_order";
  if (item.entityType === "subscription_pickup_request") {
    return "subscription_pickup_request";
  }
  return "subscription";
}

function resolveEntityType(item = {}) {
  if (item.entityType) return String(item.entityType);
  if (item.orderId || (item.meta && item.meta.orderId)) return "order";
  return "subscription_day";
}

function buildFulfillment(item = {}, mode) {
  const delivery = item.delivery || {};
  const pickup = item.pickup || {};
  const context = item.context || {};
  const timeWindow = item.timeWindow || {};
  const fulfillment = {
    mode,
    method: item.fulfillmentMethod || item.deliveryMethod || mode,
    type: item.fulfillmentType || (mode === "pickup" ? "branch_pickup" : "home_delivery"),
  };
  compactOptional(
    fulfillment,
    "pickupLocationId",
    asId(pickup.pickupLocationId || pickup.locationId || pickup.branchId || item.branchId)
  );
  compactOptional(
    fulfillment,
    "deliverySlot",
    delivery.window || delivery.deliveryWindow || context.window || timeWindow.label
  );
  compactOptional(fulfillment, "address", delivery.address || context.address);
  return fulfillment;
}

function serializeKitchenOperation(item = {}, { includeLegacy = false, includeRaw = false } = {}) {
  const mode = item.mode || item.deliveryMode || item.deliveryMethod || item.fulfillmentMethod || "delivery";
  const entityType = resolveEntityType(item);
  const entityId = asId(item.entityId || item.id || item.orderId || item.requestId);
  const cards = (Array.isArray(item.kitchenCards) ? item.kitchenCards : [])
    .map((card) => sanitizeCard(card, { includeRaw }));
  const addonGroups = sanitizeAddonGroups(item.kitchenAddonGroups);
  const warningsByKey = new Map();
  cards.flatMap((card) => card.warnings).forEach((warning) => {
    const key = typeof warning === "string" ? warning : JSON.stringify(warning);
    if (!warningsByKey.has(key)) warningsByKey.set(key, warning);
  });
  const warnings = [...warningsByKey.values()];
  const clean = {
    id: asId(item.id || entityId),
    source: resolveSource(item),
    entityType,
    entityId,
    reference: item.reference || null,
    status: item.status || null,
    statusLabel: item.statusLabel || (item.ui && item.ui.label) || item.status || null,
    mode,
    fulfillment: buildFulfillment(item, mode),
    kitchen: {
      version: KITCHEN_CONTRACT_VERSION,
      mealCount: cards.reduce((total, card) => total + Math.max(1, Number(card.quantity || 1)), 0),
      cards,
      addonGroups,
      warnings,
    },
  };

  compactOptional(clean, "orderId", asId(item.orderId || (item.meta && item.meta.orderId)));
  compactOptional(clean, "subscriptionId", asId(item.subscriptionId || (item.meta && item.meta.subscriptionId)));
  compactOptional(clean, "orderNumber", item.orderNumber);
  compactOptional(clean, "paymentStatus", item.paymentStatus || (item.paymentValidity && item.paymentValidity.paymentStatus));

  if (includeRaw) {
    clean.kitchen.resolverDebug = {
      sourceProjectionVersion: item.kitchenProjectionVersion || null,
      selectionMode: item.kitchenDetails && item.kitchenDetails.selectionMode
        ? item.kitchenDetails.selectionMode
        : null,
      sourceEntityType: entityType,
    };
  }

  if (includeLegacy) {
    clean.kitchenDetails = item.kitchenDetails || null;
    clean.kitchenProjectionVersion = item.kitchenProjectionVersion || "v1";
    clean.kitchenCards = cards;
    clean.kitchenAddonGroups = addonGroups;
  }
  return clean;
}

function serializeKitchenOperationsCollection(data = {}, options = {}) {
  const items = (Array.isArray(data.items) ? data.items : []).map((item) => serializeKitchenOperation(item, options));
  return {
    ...data,
    contractVersion: "kitchen_operations.v2",
    count: items.length,
    items,
  };
}

module.exports = {
  KITCHEN_CONTRACT_VERSION,
  isTruthyQuery,
  serializeKitchenOperation,
  serializeKitchenOperationsCollection,
};
