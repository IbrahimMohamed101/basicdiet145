process.env.NODE_ENV = process.env.NODE_ENV || "test";

const assert = require("assert");

const {
  isCustomerVisibleGroup,
  isCustomerVisibleOption,
  isCustomerVisibleProduct,
  resolvePublicProductCategory,
  serializeDashboardPreviewCategory,
  serializeDashboardPreviewProduct,
  sortPublicProducts,
} = require("../src/services/orders/menuCatalogPresenter");
const {
  normalizeCategoryUiMetadata,
  normalizeProductUiMetadata,
} = require("../src/services/catalog/catalogKeyUiHelpers");

function testCategoryUiComesFromStoredData() {
  const category = {
    _id: "category-1",
    key: "custom_order",
    name: { ar: "قسم", en: "Category" },
    description: { ar: "", en: "" },
    imageUrl: "",
    sortOrder: 10,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    ui: {
      cardVariant: "meal_collection",
      layout: "dashboard_owned_layout",
      behaviorHint: "direct_add",
      priceLabelMode: "fixed",
    },
  };

  const preview = serializeDashboardPreviewCategory(category, "en", []);
  assert.deepStrictEqual(preview.ui, normalizeCategoryUiMetadata(category.ui));
  assert.strictEqual(preview.ui.cardVariant, "meal_collection");
  assert.strictEqual(preview.ui.layout, "dashboard_owned_layout");
}

function testProductUiComesFromStoredData() {
  const product = {
    _id: "product-1",
    categoryId: "category-1",
    key: "basic_meal",
    name: { ar: "منتج", en: "Product" },
    description: { ar: "", en: "" },
    imageUrl: "",
    itemType: "product",
    pricingModel: "fixed",
    priceHalala: 1000,
    currency: "SAR",
    baseUnitGrams: 100,
    defaultWeightGrams: 0,
    minWeightGrams: 0,
    maxWeightGrams: 0,
    weightStepGrams: 50,
    sortOrder: 20,
    isCustomizable: false,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    ui: {
      cardVariant: "premium",
      cardSize: "small",
      imageRatio: "wide",
      showDescription: false,
      showPrice: false,
      behaviorHint: "direct_add",
      priceLabelMode: "fixed",
    },
  };

  const preview = serializeDashboardPreviewProduct(product, "en", []);
  assert.deepStrictEqual(preview.ui, normalizeProductUiMetadata(product.ui));
  assert.strictEqual(preview.ui.cardVariant, "premium");
  assert.strictEqual(preview.ui.cardSize, "small");
  assert.strictEqual(preview.ui.showDescription, false);
  assert.strictEqual(preview.ui.showPrice, false);
}

function testNoSeedKeyVisibilityOrPlacementOverrides() {
  assert.strictEqual(isCustomerVisibleProduct({ key: "small_salad" }, { key: "carbs" }), true);
  assert.strictEqual(isCustomerVisibleGroup({ key: "basic_meal" }, { key: "extra_protein_50g" }), true);
  assert.strictEqual(isCustomerVisibleOption({ key: "dashboard_option", ruleTags: [] }), true);
  assert.strictEqual(isCustomerVisibleOption({ key: "legacy_only", ruleTags: ["missing_external"] }), false);

  const expectedCategory = { _id: "category-actual", key: "dashboard_category" };
  const categoriesById = new Map([["category-actual", expectedCategory]]);
  const categoriesByKey = new Map([["custom_order", { _id: "category-override", key: "custom_order" }]]);
  assert.strictEqual(
    resolvePublicProductCategory({ key: "basic_meal", categoryId: "category-actual" }, categoriesById, categoriesByKey),
    expectedCategory,
    "product.categoryId must be the only category placement authority"
  );
}

function testOrderingUsesStoredSortOrder() {
  const rows = [
    { key: "basic_meal", sortOrder: 50 },
    { key: "dashboard_first", sortOrder: 10 },
    { key: "dashboard_second", sortOrder: 20 },
  ].sort(sortPublicProducts);
  assert.deepStrictEqual(rows.map((row) => row.key), ["dashboard_first", "dashboard_second", "basic_meal"]);
}

function run() {
  testCategoryUiComesFromStoredData();
  testProductUiComesFromStoredData();
  testNoSeedKeyVisibilityOrPlacementOverrides();
  testOrderingUsesStoredSortOrder();
  console.log("✅ menu presentation database authority tests passed");
}

run();
