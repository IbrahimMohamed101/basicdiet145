const mongoose = require("mongoose");

const MenuCategory = require("../../models/MenuCategory");
const MenuOption = require("../../models/MenuOption");
const MenuOptionGroup = require("../../models/MenuOptionGroup");
const MenuProduct = require("../../models/MenuProduct");
const ProductGroupOption = require("../../models/ProductGroupOption");
const ProductOptionGroup = require("../../models/ProductOptionGroup");
const Setting = require("../../models/Setting");
const { pickLang } = require("../../utils/i18n");
const { computeInclusiveVatBreakdown } = require("../../utils/pricing");
const { VAT_PERCENTAGE } = require("../../config/vat");
const {
  assertLinkedDocGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("../catalog/catalogAvailabilityService");

const SYSTEM_CURRENCY = "SAR";

function createMenuPricingError(code, message, status = 400, details) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

function assertObjectId(value, fieldName) {
  if (!mongoose.Types.ObjectId.isValid(String(value || ""))) {
    throw createMenuPricingError("INVALID_SELECTION", `${fieldName} must be a valid id`);
  }
  return String(value);
}

function normalizeQty(value) {
  const qty = Number(value === undefined || value === null ? 1 : value);
  if (!Number.isInteger(qty) || qty < 1) {
    throw createMenuPricingError("INVALID_SELECTION", "Item quantity must be an integer >= 1");
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

function assertNoForbiddenOneTimeFields(body = {}) {
  const forbidden = [
    "mealSlots",
    "subscriptionDayId",
    "subscriptionId",
    "remainingMeals",
    "skip",
    "freeze",
    "deliveryAddress",
    "deliveryWindow",
  ];
  const present = forbidden.filter((field) => body[field] !== undefined);
  if (body.delivery && Object.keys(body.delivery || {}).length) present.push("delivery");
  if (present.length) {
    throw createMenuPricingError(
      "UNSUPPORTED_ONE_TIME_ORDER_FIELD",
      "One-time orders are pickup-only and separate from subscriptions",
      400,
      { fields: present }
    );
  }
}

function normalizeSelectedOptions(item) {
  const raw = item.selectedOptions || item.options || (item.selections && item.selections.options) || [];
  if (!Array.isArray(raw)) {
    throw createMenuPricingError("INVALID_SELECTION", "selectedOptions must be an array");
  }
  return raw.map((selection) => ({
    groupId: assertObjectId(selection && selection.groupId, "selectedOptions[].groupId"),
    optionId: assertObjectId(selection && selection.optionId, "selectedOptions[].optionId"),
    qty: normalizeQty(selection && selection.qty),
    extraWeightGrams: Number(selection && selection.extraWeightGrams ? selection.extraWeightGrams : 0),
  }));
}

function resolveWeightGrams(item, product) {
  if (product.pricingModel !== "per_100g") return 0;
  const hasWeightGrams = Object.prototype.hasOwnProperty.call(item, "weightGrams");
  if (!hasWeightGrams || item.weightGrams === null || item.weightGrams === "") {
    throw createMenuPricingError("INVALID_WEIGHT_GRAMS", "weightGrams is required for per_100g products");
  }
  const weight = Number(item.weightGrams);
  if (!Number.isInteger(weight) || weight <= 0) {
    throw createMenuPricingError("INVALID_WEIGHT_GRAMS", "weightGrams must be a positive integer for per_100g products");
  }
  const min = Number(product.minWeightGrams || 0);
  const max = Number(product.maxWeightGrams || 0);
  const step = Number(product.weightStepGrams || 1);
  if (min && weight < min) throw createMenuPricingError("INVALID_WEIGHT_GRAMS", "weightGrams is below minimum");
  if (max && weight > max) throw createMenuPricingError("INVALID_WEIGHT_GRAMS", "weightGrams exceeds maximum");
  if (step && weight % step !== 0) {
    throw createMenuPricingError("INVALID_WEIGHT_GRAMS", "weightGrams must match product weight step");
  }
  return weight;
}

function computeProductBasePrice(product, weightGrams) {
  const priceHalala = Number(product.priceHalala || 0);
  if (product.pricingModel === "fixed") return priceHalala;
  const baseUnitGrams = Number(product.baseUnitGrams || 100);
  const units = Math.ceil(weightGrams / baseUnitGrams);
  return Math.max(0, units * priceHalala);
}

function buildPricingSnapshot({ subtotalHalala, vatPercentage }) {
  const subtotal = Math.max(0, Math.round(Number(subtotalHalala || 0)));
  const vat = computeInclusiveVatBreakdown(subtotal, vatPercentage);
  return {
    subtotalHalala: subtotal,
    deliveryFeeHalala: 0,
    discountHalala: 0,
    totalHalala: subtotal,
    vatPercentage: vat.vatPercentage,
    vatHalala: vat.vatHalala,
    vatIncluded: true,
    currency: SYSTEM_CURRENCY,
  };
}

function assertBranchAvailable(product, branchId) {
  const branches = Array.isArray(product.branchAvailability) ? product.branchAvailability : [];
  if (branchId && branches.length && !branches.includes(String(branchId))) {
    throw createMenuPricingError("PRODUCT_NOT_AVAILABLE", "Product is not available for this branch", 409);
  }
}

function isCatalogAvailable(doc) {
  return Boolean(doc)
    && doc.isActive !== false
    && doc.isVisible !== false
    && doc.isAvailable !== false
    && Boolean(doc.publishedAt);
}

function isAvailableForChannel(doc, channel) {
  if (!doc || !Array.isArray(doc.availableFor) || doc.availableFor.length === 0) return true;
  return doc.availableFor.includes(channel);
}

function isRelationAvailable(doc) {
  return Boolean(doc)
    && doc.isActive !== false
    && doc.isVisible !== false
    && doc.isAvailable !== false;
}

async function loadProductContext(productId) {
  const product = await MenuProduct.findById(productId).lean();
  if (!product) throw createMenuPricingError("ITEM_NOT_FOUND", "Product was not found", 404);
  const productCatalogItemsById = await loadCatalogItemsByIdForDocs([product]);
  assertLinkedDocGloballyAvailable(product, productCatalogItemsById, "Product catalog item is unavailable");
  if (!isCatalogAvailable(product) || !isAvailableForChannel(product, "one_time")) {
    throw createMenuPricingError("PRODUCT_NOT_AVAILABLE", "Product is unavailable", 409);
  }
  const category = await MenuCategory.findById(product.categoryId).lean();
  if (!isCatalogAvailable(category)) {
    throw createMenuPricingError("PRODUCT_NOT_AVAILABLE", "Product category is unavailable", 409);
  }
  const [allGroupRelations, allOptionRelations] = await Promise.all([
    ProductOptionGroup.find({ productId: product._id }).sort({ sortOrder: 1 }).lean(),
    ProductGroupOption.find({ productId: product._id }).sort({ sortOrder: 1 }).lean(),
  ]);
  const groupIds = allGroupRelations.map((relation) => relation.groupId);
  const optionIds = allOptionRelations.map((relation) => relation.optionId);
  const [groups, options] = await Promise.all([
    MenuOptionGroup.find({ _id: { $in: groupIds } }).lean(),
    MenuOption.find({ _id: { $in: optionIds } }).lean(),
  ]);
  const catalogItemsById = await loadCatalogItemsByIdForDocs(options);
  const groupsById = new Map(groups.map((group) => [String(group._id), group]));
  const optionsById = new Map(options.map((option) => [String(option._id), option]));
  const availableGroupRelations = allGroupRelations.filter((relation) => (
    isRelationAvailable(relation) && isCatalogAvailable(groupsById.get(String(relation.groupId)))
  ));
  return {
    product,
    category,
    groupRelations: availableGroupRelations,
    allGroupRelations,
    allOptionRelations,
    groupsById,
    optionsById,
    catalogItemsById,
  };
}

function validateAndPriceOptions({ selections, context, lang }) {
  const {
    product,
    groupRelations,
    allGroupRelations,
    allOptionRelations,
    groupsById,
    optionsById,
    catalogItemsById,
  } = context;
  if (product.isCustomizable === false && selections.length > 0) {
    throw createMenuPricingError("OPTION_NOT_ALLOWED", "Product customization is disabled for this product");
  }
  const groupRelationsById = new Map(groupRelations.map((relation) => [String(relation.groupId), relation]));
  const allGroupRelationsById = new Map(allGroupRelations.map((relation) => [String(relation.groupId), relation]));
  const optionRelationsByGroupOption = new Map(
    allOptionRelations.map((relation) => [`${relation.groupId}:${relation.optionId}`, relation])
  );
  const selectionsByGroup = new Map();
  selections.forEach((selection) => {
    if (!selectionsByGroup.has(selection.groupId)) selectionsByGroup.set(selection.groupId, []);
    selectionsByGroup.get(selection.groupId).push(selection);
  });

  for (const relation of groupRelations) {
    const groupId = String(relation.groupId);
    const count = (selectionsByGroup.get(groupId) || []).reduce((sum, selection) => sum + Number(selection.qty || 1), 0);
    const min = Number(relation.minSelections || 0);
    const max = relation.maxSelections === null || relation.maxSelections === undefined ? null : Number(relation.maxSelections);
    if (count < min) {
      throw createMenuPricingError("MIN_SELECTIONS_NOT_MET", "Required option group selections are missing", 400, {
        productId: String(product._id),
        groupId,
        minSelections: min,
      });
    }
    if (max !== null && count > max) {
      throw createMenuPricingError("MAX_SELECTIONS_EXCEEDED", "Option group selections exceed maxSelections", 400, {
        productId: String(product._id),
        groupId,
        maxSelections: max,
      });
    }
  }

  let optionsTotalHalala = 0;
  const selectedOptions = [];
  for (const selection of selections) {
    const groupRelation = groupRelationsById.get(selection.groupId);
    if (!groupRelation) {
      const staleRelation = allGroupRelationsById.get(selection.groupId);
      if (staleRelation) {
        throw createMenuPricingError("OPTION_GROUP_NOT_AVAILABLE", "Option group is unavailable", 409);
      }
      throw createMenuPricingError("OPTION_NOT_ALLOWED", "Option group is not allowed for this product");
    }
    const optionRelation = optionRelationsByGroupOption.get(`${selection.groupId}:${selection.optionId}`);
    if (!optionRelation) {
      throw createMenuPricingError("OPTION_NOT_ALLOWED", "Option is not allowed for this product");
    }
    const group = groupsById.get(selection.groupId);
    const option = optionsById.get(selection.optionId);
    if (!isCatalogAvailable(group)) {
      throw createMenuPricingError("OPTION_GROUP_NOT_AVAILABLE", "Option group is unavailable", 409);
    }
    assertLinkedDocGloballyAvailable(option, catalogItemsById, "Option catalog item is unavailable");
    if (!isRelationAvailable(optionRelation) || !isCatalogAvailable(option) || !isAvailableForChannel(option, "one_time")) {
      throw createMenuPricingError("OPTION_NOT_AVAILABLE", "Option is unavailable", 409);
    }
    if (!option) throw createMenuPricingError("OPTION_NOT_ALLOWED", "Option is not allowed for this product");
    const extraPriceHalala = optionRelation.extraPriceHalala === null || optionRelation.extraPriceHalala === undefined
      ? Number(option.extraPriceHalala || 0)
      : Number(optionRelation.extraPriceHalala || 0);
    const extraWeightPriceHalala = optionRelation.extraWeightPriceHalala === null || optionRelation.extraWeightPriceHalala === undefined
      ? Number(option.extraWeightPriceHalala || 0)
      : Number(optionRelation.extraWeightPriceHalala || 0);
    const extraWeightUnitGrams = optionRelation.extraWeightUnitGrams === null || optionRelation.extraWeightUnitGrams === undefined
      ? Number(option.extraWeightUnitGrams || 0)
      : Number(optionRelation.extraWeightUnitGrams || 0);
    const extraWeightGrams = Number(selection.extraWeightGrams || 0);
    if (extraWeightGrams < 0 || !Number.isInteger(extraWeightGrams)) {
      throw createMenuPricingError("INVALID_WEIGHT", "extraWeightGrams must be an integer >= 0");
    }
    if (extraWeightGrams && (!extraWeightUnitGrams || !extraWeightPriceHalala)) {
      throw createMenuPricingError("INVALID_WEIGHT", "Option does not support extra weight pricing");
    }
    if (extraWeightGrams && extraWeightGrams % extraWeightUnitGrams !== 0) {
      throw createMenuPricingError("INVALID_WEIGHT", "extraWeightGrams must match option extra weight unit");
    }
    const extraWeightUnits = extraWeightGrams ? extraWeightGrams / extraWeightUnitGrams : 0;
    const optionTotalHalala = (extraPriceHalala + (extraWeightUnits * extraWeightPriceHalala)) * selection.qty;
    optionsTotalHalala += optionTotalHalala;
    selectedOptions.push({
      groupId: group._id,
      groupName: localizeName(group.name, lang),
      optionId: option._id,
      name: localizeName(option.name, lang),
      qty: selection.qty,
      extraPriceHalala,
      extraWeightGrams,
      extraWeightUnitGrams,
      extraWeightPriceHalala,
      totalHalala: optionTotalHalala,
    });
  }
  return { optionsTotalHalala, selectedOptions };
}

async function priceMenuItem({ item, lang, branchId }) {
  const productId = assertObjectId(item.productId || item.menuProductId, "items[].productId");
  const qty = normalizeQty(item.qty);
  const context = await loadProductContext(productId);
  const { product, category } = context;
  assertBranchAvailable(product, branchId);
  const weightGrams = resolveWeightGrams(item, product);
  const basePriceHalala = computeProductBasePrice(product, weightGrams);
  const selectedInput = normalizeSelectedOptions(item);
  const { optionsTotalHalala, selectedOptions } = validateAndPriceOptions({
    selections: selectedInput,
    context,
    lang,
  });
  const unitPriceHalala = basePriceHalala + optionsTotalHalala;
  const lineTotalHalala = unitPriceHalala * qty;
  return {
    itemType: product.itemType,
    catalogRef: { model: "MenuProduct", id: product._id },
    productId: product._id,
    menuVersionId: product.versionId || null,
    name: localizeName(product.name, lang),
    qty,
    weightGrams,
    unitPriceHalala,
    lineTotalHalala,
    currency: product.currency || SYSTEM_CURRENCY,
    selections: {
      selectedOptions,
    },
    productSnapshot: {
      productId: product._id,
      categoryId: category._id,
      categoryName: localizeName(category.name, lang),
      key: product.key,
      name: localizeName(product.name, lang),
      itemType: product.itemType,
      pricingModel: product.pricingModel,
      priceHalala: Number(product.priceHalala || 0),
      baseUnitGrams: Number(product.baseUnitGrams || 100),
      weightGrams,
    },
    selectedOptions,
    pricingSnapshot: {
      basePriceHalala,
      optionsTotalHalala,
      unitPriceHalala,
      lineTotalHalala,
      vatIncluded: true,
      currency: product.currency || SYSTEM_CURRENCY,
    },
    nutrition: {},
  };
}

async function priceMenuCart({
  userId,
  items,
  fulfillmentMethod,
  pickup = {},
  lang = "en",
  requestBody = {},
}) {
  if (!userId) throw createMenuPricingError("UNAUTHORIZED", "User is required", 401);
  assertNoForbiddenOneTimeFields(requestBody);
  const method = String(fulfillmentMethod || "pickup").trim();
  if (method !== "pickup") {
    throw createMenuPricingError("DELIVERY_NOT_SUPPORTED", "Delivery is not currently supported for one-time orders");
  }
  const normalizedItems = Array.isArray(items) ? items : [];
  if (!normalizedItems.length) throw createMenuPricingError("EMPTY_ORDER", "Order must include at least one item");
  const branchId = pickup && pickup.branchId ? String(pickup.branchId).trim() : "main";
  const pricedItems = [];
  for (const item of normalizedItems) {
    pricedItems.push(await priceMenuItem({ item, lang, branchId }));
  }
  const subtotalHalala = pricedItems.reduce((sum, item) => sum + Number(item.lineTotalHalala || 0), 0);
  // VAT is system-owned (16%)
  const vatPercentage = VAT_PERCENTAGE;
  const pricing = buildPricingSnapshot({ subtotalHalala, vatPercentage });
  return {
    currency: SYSTEM_CURRENCY,
    items: pricedItems,
    pricing,
    appliedPromo: null,
    fulfillmentMethod: "pickup",
    delivery: null,
    pickup: {
      branchId,
      pickupWindow: pickup && pickup.pickupWindow ? String(pickup.pickupWindow).trim() : "",
    },
  };
}

module.exports = {
  assertNoForbiddenOneTimeFields,
  createMenuPricingError,
  priceMenuCart,
};
