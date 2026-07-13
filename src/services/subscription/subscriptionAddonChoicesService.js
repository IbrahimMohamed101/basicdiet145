const mongoose = require("mongoose");
const MenuCategory = require("../../models/MenuCategory");
const MenuProduct = require("../../models/MenuProduct");
const { pickLang } = require("../../utils/i18n");
const { normalizeProductUiMetadata } = require("../catalog/catalogKeyUiHelpers");
const {
  filterGloballyAvailable,
  isLinkedDocGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("../catalog/catalogAvailabilityService");

const SYSTEM_CURRENCY = "SAR";

const SUBSCRIPTION_ADDON_CHOICE_MAPPINGS = Object.freeze({
  juice: Object.freeze({
    category: "juice",
    sourceCategories: Object.freeze(["juices", "drinks"]),
  }),
  snack: Object.freeze({
    category: "snack",
    sourceCategories: Object.freeze(["desserts"]),
  }),
  small_salad: Object.freeze({
    category: "small_salad",
    sourceCategories: Object.freeze(["light_options"]),
    productKeys: Object.freeze(["green_salad", "small_salad", "fruit_salad", "greek_salad", "vegetable_salad", "fruit_salad_addon"]),
  }),
});

const SUBSCRIPTION_ADDON_CATEGORIES = Object.freeze(Object.keys(SUBSCRIPTION_ADDON_CHOICE_MAPPINGS));

function isDailyAddonMenuProduct(product) {
  return String(product && product.kind || "").toLowerCase() !== "plan"
    && String(product && product.type || "").toLowerCase() !== "subscription"
    && String(product && product.itemType || "").toLowerCase() !== "subscription"
    && String(product && product.billingMode || "").toLowerCase() !== "per_day";
}

function localized(value, lang) {
  return pickLang(value, lang) || pickLang(value, "en") || pickLang(value, "ar") || "";
}

function availableForOneTimeQuery() {
  return {
    $or: [
      { availableFor: { $exists: false } },
      { availableFor: [] },
      { availableFor: "one_time" },
    ],
  };
}

function activePublishedQuery(extra = {}) {
  return {
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
    publishedAt: { $ne: null },
    ...extra,
  };
}

function normalizeCategoryFilter(category) {
  if (category === undefined || category === null || String(category).trim() === "") {
    return SUBSCRIPTION_ADDON_CATEGORIES;
  }
  const normalized = String(category).trim();
  if (!SUBSCRIPTION_ADDON_CHOICE_MAPPINGS[normalized]) {
    const err = new Error("category must be one of: juice, snack, small_salad");
    err.status = 400;
    err.code = "INVALID";
    throw err;
  }
  return [normalized];
}

function serializeChoice(product, categoryKey, lang) {
  const priceHalala = Number(product.priceHalala || 0);
  return {
    id: String(product._id),
    key: product.key || "",
    name: localized(product.name, lang),
    nameAr: pickLang(product.name, "ar") || "",
    nameI18n: {
      ar: pickLang(product.name, "ar") || "",
      en: pickLang(product.name, "en") || "",
    },
    description: localized(product.description, lang),
    descriptionI18n: {
      ar: pickLang(product.description, "ar") || "",
      en: pickLang(product.description, "en") || "",
    },
    imageUrl: product.imageUrl || "",
    priceHalala,
    priceSar: priceHalala / 100,
    currency: product.currency || SYSTEM_CURRENCY,
    calories: Number.isFinite(Number(product.calories)) ? Number(product.calories) : null,
    prepTimeMinutes: Number.isFinite(Number(product.prepTimeMinutes)) ? Number(product.prepTimeMinutes) : null,
    categoryKey,
    itemType: product.itemType || "product",
    type: "menu_product",
    available: product.isAvailable !== false,
    active: product.isActive !== false,
    ui: normalizeProductUiMetadata(product.ui),
  };
}

async function findActiveOneTimeCategories(sourceCategoryKeys, { MenuCategoryModel = MenuCategory } = {}) {
  const rows = await MenuCategoryModel.find(activePublishedQuery({
    key: { $in: sourceCategoryKeys },
  }))
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();

  return rows;
}

async function findMappedProducts(categoryRows, mapping, { MenuProductModel = MenuProduct } = {}) {
  if (!categoryRows.length) return [];
  const categoryIds = categoryRows.map((category) => category._id);
  const productQuery = activePublishedQuery({
    categoryId: { $in: categoryIds },
    ...availableForOneTimeQuery(),
  });
  if (Array.isArray(mapping.productKeys) && mapping.productKeys.length) {
    productQuery.key = { $in: mapping.productKeys };
  }

  const rows = await MenuProductModel.find(productQuery)
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
  const catalogItemsById = await loadCatalogItemsByIdForDocs(rows);
  return filterGloballyAvailable(rows, catalogItemsById).filter(isDailyAddonMenuProduct);
}

async function buildAddonChoicesCatalog({
  lang = "en",
  category,
  subscriptionId = null,
  models = {},
} = {}) {
  const entitledCategories = new Set();
  const legacyEligibleProductIds = new Set();
  let hasSubscriptionFilter = false;
  if (subscriptionId) {
    const SubscriptionModel = models.SubscriptionModel || mongoose.model("Subscription");
    const sub = await SubscriptionModel.findById(subscriptionId).lean();
    if (sub && Array.isArray(sub.addonSubscriptions)) {
      hasSubscriptionFilter = true;
      for (const ent of sub.addonSubscriptions) {
        if (ent && ent.category) {
          entitledCategories.add(String(ent.category));
        } else if (ent && Array.isArray(ent.menuProductIds)) {
          ent.menuProductIds.forEach((id) => legacyEligibleProductIds.add(String(id)));
        }
      }
    }
  }

  const categories = normalizeCategoryFilter(category);
  const sourceCategoryKeys = [
    ...new Set(categories.flatMap((key) => SUBSCRIPTION_ADDON_CHOICE_MAPPINGS[key].sourceCategories)),
  ];

  const categoryRows = await findActiveOneTimeCategories(sourceCategoryKeys, models);
  const categoriesById = new Map(categoryRows.map((row) => [String(row._id), row]));
  const categoriesByKey = new Map(categoryRows.map((row) => [row.key, row]));
  const data = {};

  for (const addonCategory of categories) {
    const mapping = SUBSCRIPTION_ADDON_CHOICE_MAPPINGS[addonCategory];
    const mappedCategoryRows = mapping.sourceCategories
      .map((key) => categoriesByKey.get(key))
      .filter(Boolean);
    const productRows = await findMappedProducts(mappedCategoryRows, mapping, models);
    let choices = productRows
      .map((product) => {
        const sourceCategory = categoriesById.get(String(product.categoryId));
        if (!sourceCategory) return null;
        return serializeChoice(product, sourceCategory.key, lang);
      })
      .filter(Boolean);

    if (hasSubscriptionFilter) {
      choices.forEach((choice) => {
        choice.isEligibleForAllowance = entitledCategories.has(addonCategory)
          || legacyEligibleProductIds.has(String(choice.id));
      });
    }

    data[addonCategory] = {
      category: addonCategory,
      sourceCategories: [...mapping.sourceCategories],
      choices,
    };
  }

  return data;
}

async function resolveAddonChoiceProductById(productId, { models = {} } = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(productId || ""))) return null;
  const MenuProductModel = models.MenuProductModel || MenuProduct;
  const MenuCategoryModel = models.MenuCategoryModel || MenuCategory;
  const product = await MenuProductModel.findOne(activePublishedQuery({
    _id: productId,
    ...availableForOneTimeQuery(),
  })).lean();
  if (!product) {
    const AddonModel = mongoose.model("Addon");
    const addon = await AddonModel.findOne({ _id: productId, kind: "item" }).lean();
    if (addon && addon.isActive !== false) {
      return {
        product: addon,
        category: { key: addon.category },
        addonCategory: addon.category,
      };
    }
    return null;
  }
  const catalogItemsById = await loadCatalogItemsByIdForDocs([product]);
  if (!isLinkedDocGloballyAvailable(product, catalogItemsById)) return null;
  if (!isDailyAddonMenuProduct(product)) return null;

  const category = await MenuCategoryModel.findOne(activePublishedQuery({
    _id: product.categoryId,
  })).lean();
  if (!category) return null;

  for (const mapping of Object.values(SUBSCRIPTION_ADDON_CHOICE_MAPPINGS)) {
    if (!mapping.sourceCategories.includes(category.key)) continue;
    if (Array.isArray(mapping.productKeys) && mapping.productKeys.length && !mapping.productKeys.includes(product.key)) {
      continue;
    }
    return {
      product,
      category,
      addonCategory: mapping.category,
    };
  }

  return null;
}

module.exports = {
  SUBSCRIPTION_ADDON_CHOICE_MAPPINGS,
  SUBSCRIPTION_ADDON_CATEGORIES,
  buildAddonChoicesCatalog,
  isDailyAddonMenuProduct,
  resolveAddonChoiceProductById,
  serializeChoice,
};
