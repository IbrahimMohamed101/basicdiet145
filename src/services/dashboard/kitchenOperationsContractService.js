"use strict";

const KITCHEN_CONTRACT_VERSION = "v2";
const DEFAULT_BRANCH_DISPLAY_NAMES = {
  main: { ar: "الفرع الرئيسي", en: "Main Branch" },
  branch_1: { ar: "الفرع الرئيسي", en: "Main Branch" },
};

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

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function defaultBranchNameFor(value) {
  const id = asId(value);
  return id && DEFAULT_BRANCH_DISPLAY_NAMES[id] ? DEFAULT_BRANCH_DISPLAY_NAMES[id] : null;
}

function resolvePickupBranchName({ pickup = {}, context = {}, branchId, locationId, item = {} } = {}) {
  const explicit = pickup.branchName;
  if (explicit && typeof explicit === "object") return explicit;
  const explicitText = cleanText(explicit);
  const explicitDefault = defaultBranchNameFor(explicitText);
  if (explicitText && !explicitDefault) return explicitText;

  const contextBranch = context.branch;
  if (contextBranch && typeof contextBranch === "object") return contextBranch;
  const contextText = cleanText(contextBranch);
  const contextDefault = defaultBranchNameFor(contextText);
  if (contextText && !contextDefault) return contextText;

  return explicitDefault
    || contextDefault
    || defaultBranchNameFor(branchId)
    || defaultBranchNameFor(locationId)
    || defaultBranchNameFor(pickup.pickupLocationId)
    || defaultBranchNameFor(item.branchId)
    || explicitText
    || contextText
    || branchId
    || null;
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
  const saladSummary = sourceComponents.salad
    ? {
      sectionCount: sections.length,
      itemCount: sections.reduce((total, section) => total + section.items.length, 0),
      ...(includeRaw ? { sections } : {}),
    }
    : null;
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
      salad: saladSummary,
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
  if (mode === "pickup") {
    const branchId = asId(pickup.branchId || pickup.locationId || pickup.pickupLocationId || item.branchId);
    const locationId = asId(pickup.locationId || pickup.pickupLocationId || branchId);
    const pickupWindow = pickup.pickupWindow || pickup.window || context.window || null;
    fulfillment.pickup = {
      pickupRequestId: asId(pickup.pickupRequestId),
      branchId,
      locationId,
      branchName: resolvePickupBranchName({ pickup, context, branchId, locationId, item }),
      pickupWindow,
    };
    compactOptional(fulfillment.pickup, "pickupCode", pickup.pickupCode || context.pickupCode);
    compactOptional(fulfillment.pickup, "pickupCodeState", pickup.pickupCodeState);
    compactOptional(fulfillment.pickup, "pickupCodeIssuedAt", pickup.pickupCodeIssuedAt || context.pickupCodeIssuedAt);
    compactOptional(fulfillment.pickup, "pickupVerifiedAt", pickup.pickupVerifiedAt || context.pickupVerifiedAt);
  } else {
    fulfillment.delivery = {
      deliveryId: asId(delivery.deliveryId || delivery.id),
      date: delivery.date || context.date || null,
      status: delivery.status || null,
      address: delivery.address || context.address || null,
      window: delivery.window || delivery.deliveryWindow || context.window || null,
      zoneId: asId(delivery.zoneId),
      courierId: asId(delivery.courierId),
    };
  }
  return fulfillment;
}

function localizedText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return String(value.ar || value.en || value.displayName || value.name || "");
  }
  return String(value);
}

function resolveCustomerDisplayName(customer = {}) {
  const name = cleanText(localizedText(customer.name));
  const phone = cleanText(customer.phone);
  return name || phone || "";
}

function sanitizeSelectedOption(option = {}) {
  return {
    groupId: asId(option.groupId),
    groupKey: option.canonicalGroupKey || option.groupKey || null,
    groupName: localizedText(option.groupName),
    optionId: asId(option.optionId || option.id),
    optionKey: option.optionKey || option.key || null,
    optionName: localizedText(option.optionName || option.name || option.label),
    quantity: Number(option.quantity || option.qty || 1),
    grams: option.grams === undefined || option.grams === null ? null : Number(option.grams || 0),
    unitPriceHalala: Number(option.unitPriceHalala || option.extraPriceHalala || 0),
    totalPriceHalala: Number(option.totalPriceHalala || option.totalHalala || 0),
    extraWeightUnitGrams: Number(option.extraWeightUnitGrams || 0),
    extraWeightPriceHalala: Number(option.extraWeightPriceHalala || 0),
  };
}

function sanitizeOrderItems(item = {}) {
  const slotsByIndex = new Map(
    (Array.isArray(item.kitchenDetails && item.kitchenDetails.mealSlots)
      ? item.kitchenDetails.mealSlots
      : [])
      .map((slot) => [Number(slot && slot.slotIndex), slot])
      .filter(([index]) => Number.isFinite(index))
  );

  return (Array.isArray(item.items) ? item.items : []).map((rawItem, index) => {
    const productSnapshot = rawItem.productSnapshot && typeof rawItem.productSnapshot === "object"
      ? rawItem.productSnapshot
      : {};
    const pricingSnapshot = rawItem.pricingSnapshot && typeof rawItem.pricingSnapshot === "object"
      ? rawItem.pricingSnapshot
      : {};
    const slot = slotsByIndex.get(index + 1) || {};
    const selectedOptions = (Array.isArray(slot.selectedOptions) ? slot.selectedOptions : [])
      .map(sanitizeSelectedOption);

    return {
      id: asId(rawItem._id || rawItem.id) || `item_${index + 1}`,
      itemType: rawItem.itemType || rawItem.type || null,
      productId: asId(rawItem.productId || rawItem.mealId || (rawItem.catalogRef && rawItem.catalogRef.id)),
      productKey: productSnapshot.key || rawItem.productKey || null,
      productName: localizedText(rawItem.name || productSnapshot.name),
      quantity: Number(rawItem.qty || rawItem.quantity || 1),
      weightGrams: rawItem.weightGrams === undefined || rawItem.weightGrams === null
        ? (productSnapshot.weightGrams ?? null)
        : Number(rawItem.weightGrams || 0),
      notes: rawItem.notes || null,
      unitPriceHalala: Number(rawItem.unitPriceHalala || 0),
      lineTotalHalala: Number(rawItem.lineTotalHalala || 0),
      currency: rawItem.currency || pricingSnapshot.currency || "SAR",
      productSnapshot: {
        key: productSnapshot.key || rawItem.productKey || null,
        name: productSnapshot.name || rawItem.name || null,
        itemType: productSnapshot.itemType || rawItem.itemType || rawItem.type || null,
        pricingModel: productSnapshot.pricingModel || null,
        baseUnitGrams: productSnapshot.baseUnitGrams === undefined ? null : Number(productSnapshot.baseUnitGrams || 0),
        weightGrams: productSnapshot.weightGrams === undefined ? null : Number(productSnapshot.weightGrams || 0),
      },
      selectedOptions,
      pricingSnapshot: {
        basePriceHalala: Number(pricingSnapshot.basePriceHalala || 0),
        optionsTotalHalala: Number(pricingSnapshot.optionsTotalHalala || 0),
        unitPriceHalala: Number(pricingSnapshot.unitPriceHalala ?? rawItem.unitPriceHalala ?? 0),
        lineTotalHalala: Number(pricingSnapshot.lineTotalHalala ?? rawItem.lineTotalHalala ?? 0),
        currency: pricingSnapshot.currency || rawItem.currency || "SAR",
        vatIncluded: pricingSnapshot.vatIncluded !== false,
      },
    };
  });
}

function sanitizeOrderPricing(pricing = {}) {
  return {
    subtotalHalala: Number(pricing.subtotalHalala || 0),
    deliveryFeeHalala: Number(pricing.deliveryFeeHalala || 0),
    discountHalala: Number(pricing.discountHalala || 0),
    totalHalala: Number(pricing.totalHalala || 0),
    vatPercentage: Number(pricing.vatPercentage || 0),
    vatHalala: Number(pricing.vatHalala || 0),
    vatIncluded: pricing.vatIncluded !== false,
    currency: pricing.currency || "SAR",
  };
}

function serializeKitchenOperation(item = {}, { includeLegacy = false, includeRaw = false } = {}) {
  const mode = item.mode || item.deliveryMode || item.deliveryMethod || item.fulfillmentMethod || "delivery";
  const entityType = resolveEntityType(item);
  const entityId = asId(item.entityId || item.id || item.orderId || item.requestId);
  const cards = (Array.isArray(item.kitchenCards) ? item.kitchenCards : [])
    .map((card) => sanitizeCard(card, { includeRaw }));
  const addonGroups = sanitizeAddonGroups(item.kitchenAddonGroups);
  const customer = item.customer && typeof item.customer === "object" ? item.customer : {};
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
    ui: item.ui || null,
    customer: {
      id: asId(customer.id),
      name: resolveCustomerDisplayName(customer),
      phone: cleanText(customer.phone),
    },
    fulfillment: buildFulfillment(item, mode),
    kitchen: {
      version: KITCHEN_CONTRACT_VERSION,
      mealCount: cards.reduce((total, card) => total + Math.max(1, Number(card.quantity || 1)), 0),
      cards,
      addonGroups,
      warnings,
    },
    allowedActions: Array.isArray(item.allowedActions) ? item.allowedActions : [],
    timestamps: item.timestamps || {
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || null,
    },
  };

  compactOptional(clean, "orderId", asId(item.orderId || (item.meta && item.meta.orderId)));
  compactOptional(clean, "subscriptionId", asId(item.subscriptionId || (item.meta && item.meta.subscriptionId)));
  compactOptional(clean, "orderNumber", item.orderNumber);
  compactOptional(clean, "paymentStatus", item.paymentStatus || (item.paymentValidity && item.paymentValidity.paymentStatus));

  if (resolveSource(item) === "one_time_order") {
    const orderItems = sanitizeOrderItems(item);
    clean.items = orderItems;
    clean.pricing = sanitizeOrderPricing(item.pricing || {});
    clean.payment = {
      paymentStatus: item.paymentStatus || (item.paymentValidity && item.paymentValidity.paymentStatus) || null,
      paymentApplied: Boolean(item.paymentValidity && item.paymentValidity.paymentApplied),
    };
    clean.orderSummary = {
      itemCount: orderItems.length,
      mealCount: Number(item.mealCount || 0),
      addonCount: (Array.isArray(item.kitchenDetails && item.kitchenDetails.addons)
        ? item.kitchenDetails.addons
        : []).length,
    };
  }

  if (mode === "pickup" && clean.fulfillment.pickup) {
    clean.pickup = clean.fulfillment.pickup;
  }
  if (mode === "delivery" && clean.fulfillment.delivery) {
    clean.delivery = clean.fulfillment.delivery;
  }

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
