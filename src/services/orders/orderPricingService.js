const crypto = require("crypto");
const mongoose = require("mongoose");

const Addon = require("../../models/Addon");
const BuilderCarb = require("../../models/BuilderCarb");
const BuilderProtein = require("../../models/BuilderProtein");
const SaladIngredient = require("../../models/SaladIngredient");
const Sandwich = require("../../models/Sandwich");
const Setting = require("../../models/Setting");
const Zone = require("../../models/Zone");
const { SYSTEM_CURRENCY } = require("../../config/mealPlannerContract");
const { DEFAULT_PICKUP_WINDOW } = require("../../constants/defaultPickupLocation");
const { pickLang } = require("../../utils/i18n");
const { computeInclusiveVatBreakdown } = require("../../utils/pricing");
const { VAT_PERCENTAGE } = require("../../config/vat");
const { assertRestaurantOpenForOrdering } = require("../restaurantHoursService");
const { normalizeWindows } = require("./orderMenuService");
const {
  assertNoForbiddenOneTimeFields,
  priceMenuCart,
} = require("./menuPricingService");

const SUPPORTED_ITEM_TYPES = new Set(["standard_meal", "sandwich", "salad", "addon_item"]);

function createOrderPricingError(code, message, status = 400, details) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

function assertObjectId(value, fieldName) {
  if (!mongoose.Types.ObjectId.isValid(String(value || ""))) {
    throw createOrderPricingError("INVALID_SELECTION", `${fieldName} must be a valid id`);
  }
  return String(value);
}

function normalizeQty(value) {
  const qty = Number(value === undefined || value === null ? 1 : value);
  if (!Number.isInteger(qty) || qty < 1) {
    throw createOrderPricingError("INVALID_SELECTION", "Item quantity must be an integer >= 1");
  }
  return qty;
}

function localizeName(value, lang) {
  return {
    ar: pickLang(value, "ar") || pickLang(value, lang) || "",
    en: pickLang(value, "en") || pickLang(value, lang) || "",
  };
}

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

async function getHalalaSetting(keys, fallback = null) {
  for (const key of keys) {
    const value = await getSettingValue(key, undefined);
    if (value === undefined || value === null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed);
  }
  return fallback;
}

async function getSarSettingAsHalala(keys, fallback = null) {
  for (const key of keys) {
    const value = await getSettingValue(key, undefined);
    if (value === undefined || value === null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed * 100);
  }
  return fallback;
}

function resolvePriceHalala(doc, { allowZero = true, sourceLabel = "item" } = {}) {
  if (doc && doc.priceHalala !== undefined && doc.priceHalala !== null) {
    const value = Number(doc.priceHalala);
    if (Number.isFinite(value) && value >= 0 && (allowZero || value > 0)) return Math.round(value);
  }
  if (doc && doc.price !== undefined && doc.price !== null) {
    const value = Number(doc.price);
    if (Number.isFinite(value) && value >= 0 && (allowZero || value > 0)) return Math.round(value * 100);
  }
  throw createOrderPricingError("ITEM_PRICE_MISSING", `${sourceLabel} price is missing`);
}

async function resolveOrderDeliveryFee({ fulfillmentMethod, zoneId }) {
  if (fulfillmentMethod === "pickup") {
    return { deliveryFeeHalala: 0, zone: null };
  }

  if (fulfillmentMethod !== "delivery") {
    throw createOrderPricingError("INVALID_SELECTION", "fulfillmentMethod must be pickup or delivery");
  }

  if (zoneId) {
    const id = assertObjectId(zoneId, "delivery.zoneId");
    const zone = await Zone.findById(id).lean();
    if (!zone) {
      throw createOrderPricingError("ITEM_NOT_FOUND", "Delivery zone was not found", 404);
    }
    if (zone.isActive === false) {
      throw createOrderPricingError("ZONE_INACTIVE", "Delivery zone is inactive", 409);
    }
    return {
      deliveryFeeHalala: Number(zone.deliveryFeeHalala || 0),
      zone,
    };
  }

  const settingFeeHalala = await getHalalaSetting(["one_time_delivery_fee_halala"], null);
  if (settingFeeHalala !== null) {
    return { deliveryFeeHalala: settingFeeHalala, zone: null };
  }

  const legacyFeeHalala = await getSarSettingAsHalala(["one_time_delivery_fee"], null);
  return { deliveryFeeHalala: legacyFeeHalala !== null ? legacyFeeHalala : 1500, zone: null };
}

function buildOrderPricingSnapshot({
  subtotalHalala,
  deliveryFeeHalala,
  discountHalala,
  vatPercentage,
}) {
  const subtotal = Math.max(0, Math.round(Number(subtotalHalala || 0)));
  const deliveryFee = Math.max(0, Math.round(Number(deliveryFeeHalala || 0)));
  const discount = Math.max(0, Math.min(Math.round(Number(discountHalala || 0)), subtotal + deliveryFee));
  const total = Math.max(0, subtotal + deliveryFee - discount);
  const vat = computeInclusiveVatBreakdown(total, vatPercentage);

  return {
    subtotalHalala: subtotal,
    deliveryFeeHalala: deliveryFee,
    discountHalala: discount,
    totalHalala: total,
    vatPercentage: vat.vatPercentage,
    vatHalala: vat.vatHalala,
    vatIncluded: true,
    currency: SYSTEM_CURRENCY,
  };
}

function buildRequestHash(payload) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload || {}))
    .digest("hex");
}

function normalizeSingleBranchPickup(pickup = {}, restaurantHours = {}) {
  const defaultId = String(restaurantHours.defaultPickupLocationId || "main").trim() || "main";
  const requestedBranchId = String(pickup && pickup.branchId || "").trim();
  const resolvedBranchId = String(
    restaurantHours.resolvedPickupLocationId || restaurantHours.pickupLocationId || ""
  ).trim();
  const branchId = requestedBranchId === "main"
    ? (resolvedBranchId || defaultId)
    : (requestedBranchId || resolvedBranchId || defaultId);
  return {
    ...(pickup && typeof pickup === "object" ? pickup : {}),
    branchId,
    pickupLocationId: branchId,
    branchName: restaurantHours.pickupLocationName || pickup.branchName || null,
  };
}

async function validateWindows({ fulfillmentMethod, delivery, pickup }) {
  if (fulfillmentMethod === "delivery") {
    const deliveryWindow = delivery && delivery.deliveryWindow ? String(delivery.deliveryWindow).trim() : "";
    if (!deliveryWindow) return;
    const windows = normalizeWindows(await getSettingValue("delivery_windows", []));
    if (windows.length && !windows.some((window) => window.value === deliveryWindow)) {
      throw createOrderPricingError("INVALID_DELIVERY_WINDOW", "Invalid delivery window");
    }
    return;
  }

  const pickupWindow = pickup && pickup.pickupWindow ? String(pickup.pickupWindow).trim() : "";
  if (!pickupWindow) return;
  const configuredPickupWindows = normalizeWindows(await getSettingValue("pickup_windows", []));
  const pickupWindows = configuredPickupWindows.length
    ? configuredPickupWindows
    : normalizeWindows([DEFAULT_PICKUP_WINDOW]);
  if (pickupWindows.length && !pickupWindows.some((window) => window.value === pickupWindow)) {
    throw createOrderPricingError("INVALID_DELIVERY_WINDOW", "Invalid pickup window");
  }
}

async function priceSandwichItem({ item, qty, lang }) {
  const sandwichId = assertObjectId(item.selections && item.selections.sandwichId, "selections.sandwichId");
  const sandwich = await Sandwich.findById(sandwichId).lean();
  if (!sandwich) throw createOrderPricingError("ITEM_NOT_FOUND", "Sandwich was not found", 404);
  if (sandwich.isActive === false) throw createOrderPricingError("ITEM_UNAVAILABLE", "Sandwich is unavailable", 409);

  const unitPriceHalala = resolvePriceHalala(sandwich, { allowZero: true, sourceLabel: "Sandwich" });
  return {
    itemType: "sandwich",
    catalogRef: { model: "Sandwich", id: sandwich._id },
    name: localizeName(sandwich.name, lang),
    qty,
    unitPriceHalala,
    lineTotalHalala: unitPriceHalala * qty,
    currency: SYSTEM_CURRENCY,
    selections: { sandwichId: sandwich._id },
    nutrition: { calories: Number(sandwich.calories || 0) },
  };
}

async function priceAddonItem({ item, qty, lang }) {
  const addonItemId = assertObjectId(item.selections && item.selections.addonItemId, "selections.addonItemId");
  const addon = await Addon.findById(addonItemId).lean();
  if (!addon) throw createOrderPricingError("ITEM_NOT_FOUND", "Addon item was not found", 404);
  if (addon.isActive === false || addon.kind !== "item") {
    throw createOrderPricingError("ITEM_UNAVAILABLE", "Addon item is unavailable", 409);
  }

  const unitPriceHalala = resolvePriceHalala(addon, { allowZero: true, sourceLabel: "Addon item" });
  return {
    itemType: "addon_item",
    catalogRef: { model: "Addon", id: addon._id },
    name: localizeName(addon.name, lang),
    qty,
    unitPriceHalala,
    lineTotalHalala: unitPriceHalala * qty,
    currency: addon.currency || SYSTEM_CURRENCY,
    selections: { addonItemId: addon._id },
    nutrition: {},
  };
}

async function priceStandardMealItem({ item, qty, lang }) {
  const selections = item.selections || {};
  const proteinId = assertObjectId(selections.proteinId, "selections.proteinId");
  const carbsInput = Array.isArray(selections.carbs) ? selections.carbs : [];
  if (!carbsInput.length) {
    throw createOrderPricingError("INVALID_SELECTION", "standard_meal requires at least one carb selection");
  }

  const [protein, basePriceHalala] = await Promise.all([
    BuilderProtein.findById(proteinId).lean(),
    getHalalaSetting(["one_time_standard_meal_price_halala"], null),
  ]);
  if (!protein) throw createOrderPricingError("ITEM_NOT_FOUND", "Protein was not found", 404);
  if (protein.isActive === false) throw createOrderPricingError("ITEM_UNAVAILABLE", "Protein is unavailable", 409);

  let resolvedBasePrice = basePriceHalala;
  if (resolvedBasePrice === null) {
    resolvedBasePrice = await getSarSettingAsHalala(["one_time_meal_price"], null);
  }
  if (resolvedBasePrice === null) {
    throw createOrderPricingError("CONFIG_MISSING", "one_time_standard_meal_price_halala setting is missing", 500);
  }

  const carbIds = carbsInput.map((carb) => assertObjectId(carb && carb.carbId, "selections.carbs[].carbId"));
  const carbs = await BuilderCarb.find({ _id: { $in: carbIds } }).lean();
  const carbMap = new Map(carbs.map((carb) => [String(carb._id), carb]));
  const serializedCarbs = carbsInput.map((carbSelection) => {
    const carb = carbMap.get(String(carbSelection.carbId));
    if (!carb) throw createOrderPricingError("ITEM_NOT_FOUND", "Carb was not found", 404);
    if (carb.isActive === false) throw createOrderPricingError("ITEM_UNAVAILABLE", "Carb is unavailable", 409);
    return {
      carbId: carb._id,
      name: localizeName(carb.name, lang),
      grams: Math.max(0, Number(carbSelection.grams || 0)),
    };
  });

  const premiumExtra = Number(protein.extraFeeHalala || 0);
  const unitPriceHalala = Math.max(0, Math.round(Number(resolvedBasePrice || 0) + premiumExtra));
  return {
    itemType: "standard_meal",
    catalogRef: { model: "BuilderProtein", id: protein._id },
    name: localizeName(protein.name, lang),
    qty,
    unitPriceHalala,
    lineTotalHalala: unitPriceHalala * qty,
    currency: protein.currency || SYSTEM_CURRENCY,
    selections: {
      proteinId: protein._id,
      proteinName: localizeName(protein.name, lang),
      carbs: serializedCarbs,
    },
    nutrition: protein.nutrition || {},
  };
}

function flattenSaladIngredientSelections(selections) {
  const salad = selections && selections.salad && typeof selections.salad === "object" ? selections.salad : {};
  const groups = salad.groups && typeof salad.groups === "object" && !Array.isArray(salad.groups)
    ? salad.groups
    : {};
  const flattened = [];
  Object.entries(groups).forEach(([groupKey, value]) => {
    const values = Array.isArray(value) ? value : [value];
    values.forEach((entry) => {
      if (!entry) return;
      if (typeof entry === "object") {
        flattened.push({
          ingredientId: entry.ingredientId || entry.id,
          groupKey,
          qty: entry.qty || entry.quantity || 1,
        });
      } else {
        flattened.push({ ingredientId: entry, groupKey, qty: 1 });
      }
    });
  });
  return flattened;
}

async function priceSaladItem({ item, qty, lang }) {
  const ingredientSelections = flattenSaladIngredientSelections(item.selections || {});
  if (!ingredientSelections.length) {
    throw createOrderPricingError("INVALID_SELECTION", "salad requires at least one ingredient");
  }

  const basePriceHalala = await getHalalaSetting(["one_time_salad_base_price_halala"], null);
  let resolvedBasePrice = basePriceHalala;
  if (resolvedBasePrice === null) {
    resolvedBasePrice = await getSarSettingAsHalala(["custom_salad_base_price"], 0);
  }

  const ingredientIds = ingredientSelections.map((selection) => assertObjectId(selection.ingredientId, "salad.ingredientId"));
  const ingredients = await SaladIngredient.find({ _id: { $in: ingredientIds } }).lean();
  const ingredientMap = new Map(ingredients.map((ingredient) => [String(ingredient._id), ingredient]));

  let ingredientTotal = 0;
  const serializedIngredients = ingredientSelections.map((selection) => {
    const ingredient = ingredientMap.get(String(selection.ingredientId));
    if (!ingredient) throw createOrderPricingError("ITEM_NOT_FOUND", "Salad ingredient was not found", 404);
    if (ingredient.isActive === false) {
      throw createOrderPricingError("ITEM_UNAVAILABLE", "Salad ingredient is unavailable", 409);
    }
    const ingredientQty = normalizeQty(selection.qty);
    if (ingredient.maxQuantity && ingredientQty > Number(ingredient.maxQuantity)) {
      throw createOrderPricingError("INVALID_SELECTION", "Salad ingredient quantity exceeds max");
    }
    const unitPriceHalala = Math.round(Number(ingredient.price || 0) * 100);
    ingredientTotal += unitPriceHalala * ingredientQty;
    return {
      ingredientId: ingredient._id,
      groupKey: selection.groupKey || ingredient.groupKey || "",
      name: localizeName(ingredient.name, lang),
      qty: ingredientQty,
      unitPriceHalala,
    };
  });

  const unitPriceHalala = Math.max(0, Math.round(Number(resolvedBasePrice || 0) + ingredientTotal));
  return {
    itemType: "salad",
    catalogRef: { model: "SaladIngredient", id: serializedIngredients[0].ingredientId },
    name: { ar: "سلطة", en: "Salad" },
    qty,
    unitPriceHalala,
    lineTotalHalala: unitPriceHalala * qty,
    currency: SYSTEM_CURRENCY,
    selections: {
      salad: {
        groups: (item.selections && item.selections.salad && item.selections.salad.groups) || {},
        ingredients: serializedIngredients,
      },
    },
    nutrition: {},
  };
}

async function priceItem({ item, lang }) {
  const itemType = String(item && item.itemType ? item.itemType : "").trim();
  if (!SUPPORTED_ITEM_TYPES.has(itemType)) {
    throw createOrderPricingError("INVALID_ITEM_TYPE", "Unsupported one-time order item type");
  }
  const qty = normalizeQty(item.qty);
  if (itemType === "sandwich") return priceSandwichItem({ item, qty, lang });
  if (itemType === "addon_item") return priceAddonItem({ item, qty, lang });
  if (itemType === "standard_meal") return priceStandardMealItem({ item, qty, lang });
  return priceSaladItem({ item, qty, lang });
}

async function priceOrderCart({
  userId,
  items,
  fulfillmentMethod,
  delivery = {},
  pickup = {},
  promoCode,
  lang = "en",
  requestBody = {},
}) {
  if (!userId) {
    throw createOrderPricingError("UNAUTHORIZED", "User is required", 401);
  }
  assertNoForbiddenOneTimeFields(requestBody);
  const normalizedItems = Array.isArray(items) ? items : [];
  if (!normalizedItems.length) {
    throw createOrderPricingError("EMPTY_ORDER", "Order must include at least one item");
  }
  const method = String(fulfillmentMethod || "pickup").trim();
  const requestedBranchId = pickup && pickup.branchId ? String(pickup.branchId).trim() : null;
  const effectiveBranchId = method === "pickup" ? (requestedBranchId || "main") : requestedBranchId;

  const restaurantHours = await assertRestaurantOpenForOrdering({
    deliveryMode: method,
    branchId: effectiveBranchId,
  });
  const normalizedPickup = normalizeSingleBranchPickup(pickup, restaurantHours);
  await validateWindows({ fulfillmentMethod: method, delivery, pickup: normalizedPickup });

  const usesMenuCatalog = normalizedItems.some((item) => item && (item.productId || item.menuProductId));
  if (usesMenuCatalog) {
    return priceMenuCart({
      userId,
      items: normalizedItems,
      fulfillmentMethod: method,
      pickup: normalizedPickup,
      lang,
      requestBody,
    });
  }

  if (method !== "pickup") {
    throw createOrderPricingError("DELIVERY_NOT_SUPPORTED", "Delivery is not currently supported for one-time orders");
  }
  if (promoCode !== undefined && promoCode !== null && String(promoCode).trim()) {
    throw createOrderPricingError(
      "PROMO_NOT_SUPPORTED_FOR_ORDERS",
      "Promo codes are not supported for one-time order quotes yet"
    );
  }

  const pricedItems = [];
  for (const item of normalizedItems) {
    pricedItems.push(await priceItem({ item, lang }));
  }

  const subtotalHalala = pricedItems.reduce((sum, item) => sum + Number(item.lineTotalHalala || 0), 0);
  const { deliveryFeeHalala, zone } = await resolveOrderDeliveryFee({
    fulfillmentMethod: method,
    zoneId: delivery && delivery.zoneId,
  });
  // VAT is system-owned (16%)
  const vatPercentage = VAT_PERCENTAGE;
  const pricing = buildOrderPricingSnapshot({
    subtotalHalala,
    deliveryFeeHalala,
    discountHalala: 0,
    vatPercentage,
  });

  return {
    currency: SYSTEM_CURRENCY,
    items: pricedItems,
    pricing,
    appliedPromo: null,
    fulfillmentMethod: method,
    delivery: method === "delivery"
      ? {
        zoneId: zone ? String(zone._id) : (delivery && delivery.zoneId ? String(delivery.zoneId) : ""),
        zoneName: zone ? localizeName(zone.name, lang) : null,
        deliveryFeeHalala,
        deliveryWindow: delivery && delivery.deliveryWindow ? String(delivery.deliveryWindow).trim() : "",
      }
      : null,
    pickup: method === "pickup"
      ? {
        branchId: normalizedPickup.branchId,
        pickupWindow: normalizedPickup.pickupWindow ? String(normalizedPickup.pickupWindow).trim() : "",
      }
      : null,
  };
}

module.exports = {
  buildOrderPricingSnapshot,
  buildRequestHash,
  createOrderPricingError,
  priceOrderCart,
  resolveOrderDeliveryFee,
};
