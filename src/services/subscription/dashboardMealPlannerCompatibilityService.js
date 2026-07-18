const MenuCategory = require("../../models/MenuCategory");
const MenuProduct = require("../../models/MenuProduct");
const { pickLang } = require("../../utils/i18n");
const baseService = require("./mealBuilderConfigService");

const PICKER_VERSION = "dashboard_meal_builder_picker.v1";
const SYSTEM_CURRENCY = "SAR";
const DIRECT_PRODUCT_ITEM_TYPES = ["cold_sandwich", "full_meal_product"];
const MAX_PICKER_LIMIT = 1000;

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function normalizePagination({ page, limit } = {}) {
  const normalizedPage = Math.max(1, Number.parseInt(page || "1", 10) || 1);
  const normalizedLimit = Math.min(
    MAX_PICKER_LIMIT,
    Math.max(1, Number.parseInt(limit || "100", 10) || 100)
  );
  return {
    page: normalizedPage,
    limit: normalizedLimit,
    skip: (normalizedPage - 1) * normalizedLimit,
  };
}

function matchesSearch(row = {}, query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return [
    row.key,
    row.name?.ar,
    row.name?.en,
    row.description?.ar,
    row.description?.en,
  ]
    .map((value) => String(value || "").toLowerCase())
    .some((value) => value.includes(q));
}

function isSubscriptionEnabled(product = {}) {
  if (product.availableForSubscription === false) return false;
  if (!Array.isArray(product.availableFor) || product.availableFor.length === 0) {
    return true;
  }
  return product.availableFor.includes("subscription");
}

function productStatus(product = {}) {
  const reasonCodes = [];
  if (product.isActive === false) reasonCodes.push("PRODUCT_INACTIVE");
  if (product.isVisible === false) reasonCodes.push("PRODUCT_HIDDEN");
  if (product.isAvailable === false) reasonCodes.push("PRODUCT_UNAVAILABLE");
  if (!product.publishedAt) reasonCodes.push("PRODUCT_UNPUBLISHED");
  if (!isSubscriptionEnabled(product)) {
    reasonCodes.push("PRODUCT_NOT_SUBSCRIPTION_ENABLED");
  }

  return {
    active: product.isActive !== false,
    visible: product.isVisible !== false,
    available: product.isAvailable !== false,
    published: Boolean(product.publishedAt),
    subscriptionEnabled: isSubscriptionEnabled(product),
    reasonCodes,
    eligible: reasonCodes.length === 0,
  };
}

function directSelectionType(product = {}) {
  return product.itemType === "cold_sandwich"
    ? "sandwich"
    : "full_meal_product";
}

function serializeDirectProduct(product, category, selected, lang) {
  const status = productStatus(product);
  return {
    id: String(product._id),
    productId: String(product._id),
    type: "product",
    key: product.key || "",
    name: product.name || { ar: "", en: "" },
    label: pickLang(product.name || {}, lang),
    imageUrl: product.imageUrl || "",
    itemType: product.itemType || "",
    categoryId: product.categoryId ? String(product.categoryId) : null,
    categoryKey: category?.key || "",
    category: category
      ? {
          id: String(category._id),
          key: category.key || "",
          name: category.name || { ar: "", en: "" },
        }
      : null,
    selectionType: directSelectionType(product),
    configurable: product.isCustomizable === true,
    pricing: {
      pricingModel: product.pricingModel || "fixed",
      priceHalala: Number(product.priceHalala || 0),
      currency: product.currency || SYSTEM_CURRENCY,
    },
    selected,
    required: false,
    eligible: status.eligible,
    linked: true,
    available: status.available,
    active: status.active,
    visible: status.visible,
    published: status.published,
    subscriptionEnabled: status.subscriptionEnabled,
    relationExists: true,
    catalogItemAvailable: true,
    reasonCodes: selected
      ? ["SELECTED", ...status.reasonCodes]
      : status.eligible
        ? ["ELIGIBLE"]
        : status.reasonCodes,
    warnings: [],
    errors: [],
    state: selected ? "selected" : status.eligible ? "eligible" : "unavailable",
    sortOrder: Number(product.sortOrder || 0),
  };
}

async function currentProductSection(sectionKey, lang) {
  const state = await baseService.getDashboardState({ lang });
  const config = state.draft || state.published;
  const sections = config?.sections || [];
  return (
    sections.find((section) => section.key === sectionKey) ||
    sections.find(
      (section) =>
        sectionKey === "sandwich" &&
        ["product_list", "product_category"].includes(section.sectionType)
    ) ||
    null
  );
}

async function getDirectProductPicker({
  sectionKey,
  lang = "en",
  q = "",
  includeUnavailable,
  page,
  limit,
} = {}) {
  const section = await currentProductSection(sectionKey, lang);
  const selectedIds = new Set(
    (section?.selectedProductIds || []).map((value) => String(value))
  );
  const pagination = normalizePagination({ page, limit });
  const showUnavailable = normalizeBoolean(includeUnavailable, false);

  const products = await MenuProduct.find({
    itemType: { $in: DIRECT_PRODUCT_ITEM_TYPES },
  })
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();

  const categoryIds = [
    ...new Set(
      products
        .map((product) => String(product.categoryId || ""))
        .filter(Boolean)
    ),
  ];
  const categories = categoryIds.length
    ? await MenuCategory.find({ _id: { $in: categoryIds } }).lean()
    : [];
  const categoriesById = new Map(
    categories.map((category) => [String(category._id), category])
  );

  const rows = products
    .filter((product) => matchesSearch(product, q))
    .map((product) =>
      serializeDirectProduct(
        product,
        categoriesById.get(String(product.categoryId || "")) || null,
        selectedIds.has(String(product._id)),
        lang
      )
    )
    .filter(
      (candidate) =>
        candidate.selected || showUnavailable || candidate.eligible
    )
    .sort(
      (left, right) =>
        Number(right.selected) - Number(left.selected) ||
        left.sortOrder - right.sortOrder ||
        String(left.key).localeCompare(String(right.key))
    );

  const total = rows.length;
  const candidates = rows.slice(
    pagination.skip,
    pagination.skip + pagination.limit
  );

  return {
    contractVersion: PICKER_VERSION,
    sectionKey: String(sectionKey || "sandwich"),
    candidateType: "product",
    category: null,
    rules: {
      itemTypes: DIRECT_PRODUCT_ITEM_TYPES,
      source: "menu_products",
      selectionBehavior: "direct_full_meal",
    },
    candidates,
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      pages: total === 0 ? 0 : Math.ceil(total / pagination.limit),
      eligible: rows.filter((row) => row.eligible).length,
      unavailable: rows.filter((row) => !row.eligible).length,
    },
  };
}

async function getSectionPicker(options = {}) {
  const sectionKey = String(options.sectionKey || "").trim().toLowerCase();
  if (sectionKey === "sandwich" || sectionKey === "products") {
    return getDirectProductPicker({ ...options, sectionKey });
  }
  return baseService.getSectionPicker(options);
}

module.exports = {
  ...baseService,
  DIRECT_PRODUCT_ITEM_TYPES,
  MAX_PICKER_LIMIT,
  getDirectProductPicker,
  getSectionPicker,
};
