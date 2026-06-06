process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const MenuProduct = require("../src/models/MenuProduct");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");

const TEST_TAG = `dashboard-menu-product-centered-${Date.now()}`;
const TEST_KEY_TAG = TEST_TAG.replace(/-/g, "_");

let mongoServer;
let adminHeaders;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`basicdiet_${TEST_KEY_TAG}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

const DEPRECATED_OPTION_FIELDS = [
  "displayCategoryKey",
  "proteinFamilyKey",
  "premiumKey",
  "selectionType",
  "ruleTags",
  "isVisible",
  "isAvailable",
  "availableFor",
  "availableForSubscription",
];

function assertNoDeprecatedOptionFields(payload, label) {
  for (const field of DEPRECATED_OPTION_FIELDS) {
    assert(!Object.prototype.hasOwnProperty.call(payload, field), `${label} omits ${field}`);
  }
}

async function main() {
  await connect();
  const app = createApp();
  const api = request(app);
  ({ headers: adminHeaders } = await dashboardAuth("admin", TEST_TAG));

  try {
    let res = await api.post("/api/dashboard/menu/categories").set(adminHeaders).send({
      key: `${TEST_KEY_TAG}_primary`,
      name: { en: `${TEST_TAG} Primary`, ar: "Primary" },
    });
    expectStatus(res, 201, "create category");
    const category = res.body.data;

    res = await api.post("/api/dashboard/menu/categories").set(adminHeaders).send({
      key: `${TEST_KEY_TAG}_target`,
      name: { en: `${TEST_TAG} Target`, ar: "Target" },
    });
    expectStatus(res, 201, "create target category");
    const targetCategory = res.body.data;

    res = await api.post("/api/dashboard/menu/categories").set(adminHeaders).send({
      key: `${TEST_KEY_TAG}_sandwiches`,
      name: { en: `${TEST_TAG} Sandwiches`, ar: "Sandwiches" },
    });
    expectStatus(res, 201, "create sandwiches category");
    const sandwichesCategory = res.body.data;

    res = await api.post("/api/dashboard/menu/products").set(adminHeaders).send({
      categoryId: category.id,
      key: `${TEST_KEY_TAG}_direct`,
      name: { en: `${TEST_TAG} Direct`, ar: "Direct" },
      itemType: "drink",
      pricingModel: "fixed",
      priceHalala: 500,
    });
    expectStatus(res, 201, "create direct product");
    const directProduct = res.body.data;
    assert.strictEqual(directProduct.isCustomizable, false);

    res = await api.post("/api/dashboard/menu/products").set(adminHeaders).send({
      categoryId: category.id,
      key: `${TEST_KEY_TAG}_weighted`,
      name: { en: `${TEST_TAG} Weighted`, ar: "Weighted" },
      itemType: "basic_salad",
      pricingModel: "per_100g",
      priceHalala: 1500,
    });
    expectStatus(res, 201, "create customizable product");
    const customizableProduct = res.body.data;
    assert.strictEqual(customizableProduct.isCustomizable, true);

    res = await api.post("/api/dashboard/menu/products").set(adminHeaders).send({
      categoryId: targetCategory.id,
      key: `${TEST_KEY_TAG}_target_product`,
      name: { en: `${TEST_TAG} Target Product`, ar: "Target Product" },
      itemType: "product",
      pricingModel: "fixed",
      priceHalala: 900,
    });
    expectStatus(res, 201, "create target product");
    const targetProduct = res.body.data;

    res = await api.post("/api/dashboard/menu/products").set(adminHeaders).send({
      categoryId: sandwichesCategory.id,
      key: `${TEST_KEY_TAG}_sandwich_product`,
      name: { en: `${TEST_TAG} Sandwich Product`, ar: "Sandwich Product" },
      itemType: "cold_sandwich",
      pricingModel: "fixed",
      priceHalala: 1200,
    });
    expectStatus(res, 201, "create sandwich product");
    const sandwichProduct = res.body.data;

    res = await api.get(`/api/dashboard/menu/products?page=1&limit=10&categoryId=${category.id}`).set(adminHeaders);
    expectStatus(res, 200, "list products by categoryId");
    assert.strictEqual(res.body.status, true);
    assert(Array.isArray(res.body.data.items), "filtered product list returns items");
    assert.strictEqual(res.body.data.pagination.total, 2, "filtered total counts only category products");
    assert(res.body.data.items.length > 0, "filtered category returns products");
    assert(res.body.data.items.every((product) => String(product.categoryId) === String(category.id)), "all filtered products belong to requested category");
    assert(res.body.data.items.some((product) => product.id === directProduct.id), "filtered list includes direct product");
    assert(res.body.data.items.some((product) => product.id === customizableProduct.id), "filtered list includes weighted product");
    assert(!res.body.data.items.some((product) => product.id === targetProduct.id), "filtered list excludes target category product");
    assert(!res.body.data.items.some((product) => product.id === sandwichProduct.id), "filtered list excludes sandwich category product");

    res = await api.get("/api/dashboard/menu/products?page=1&limit=10&categoryId=invalid").set(adminHeaders);
    expectStatus(res, 400, "invalid categoryId rejected");
    assert.strictEqual(res.body.error.code, "INVALID_CATEGORY_ID");

    res = await api.get("/api/dashboard/menu/products?page=1&limit=10").set(adminHeaders);
    expectStatus(res, 200, "list products without categoryId");
    assert(res.body.data.pagination.total >= 4, "unfiltered product list counts all categories");

    res = await api.post("/api/dashboard/menu/option-groups").set(adminHeaders).send({
      key: `${TEST_KEY_TAG}_sauces`,
      name: { en: `${TEST_TAG} Sauces`, ar: "Sauces" },
    });
    expectStatus(res, 201, "create option group");
    const group = res.body.data;

    res = await api.post(`/api/dashboard/menu/option-groups/${group.id}/options`).set(adminHeaders).send({
      key: `${TEST_KEY_TAG}_ranch`,
      name: { en: `${TEST_TAG} Ranch`, ar: "Ranch" },
      displayCategoryKey: "legacy_display",
      proteinFamilyKey: "legacy_family",
      premiumKey: "legacy_premium",
      selectionType: "legacy_selection",
      ruleTags: ["legacy_rule"],
      isVisible: false,
      isAvailable: false,
      availableFor: ["subscription"],
      availableForSubscription: false,
    });
    expectStatus(res, 201, "create option");
    const option = res.body.data;
    assertNoDeprecatedOptionFields(option, "created dashboard option");
    let optionDoc = await mongoose.model("MenuOption").findById(option.id).lean();
    assert.strictEqual(optionDoc.displayCategoryKey, "", "deprecated displayCategoryKey input is ignored");
    assert.strictEqual(optionDoc.proteinFamilyKey, "", "deprecated proteinFamilyKey input is ignored");
    assert.strictEqual(optionDoc.premiumKey, "", "deprecated premiumKey input is ignored");
    assert.strictEqual(optionDoc.selectionType, "", "deprecated selectionType input is ignored");
    assert.deepStrictEqual(optionDoc.ruleTags, [], "deprecated ruleTags input is ignored");
    assert.strictEqual(optionDoc.isActive, true, "isActive defaults to true");
    assert.strictEqual(optionDoc.isVisible, true, "isVisible is derived from isActive on create");
    assert.strictEqual(optionDoc.isAvailable, true, "isAvailable is derived from isActive on create");
    assert.deepStrictEqual(optionDoc.availableFor, ["one_time", "subscription"], "deprecated availableFor input is ignored");
    assert.strictEqual(optionDoc.availableForSubscription, true, "deprecated availableForSubscription input is ignored");

    res = await api.post(`/api/dashboard/menu/option-groups/${group.id}/options`).set(adminHeaders).send({
      key: `${TEST_KEY_TAG}_inactive_status`,
      name: { en: `${TEST_TAG} Inactive Status`, ar: "Inactive Status" },
      isActive: false,
      isVisible: true,
      isAvailable: true,
      availableFor: ["subscription"],
      availableForSubscription: false,
    });
    expectStatus(res, 201, "create inactive option with simplified status");
    assertNoDeprecatedOptionFields(res.body.data, "inactive dashboard option");
    const inactiveOptionDoc = await mongoose.model("MenuOption").findById(res.body.data.id).lean();
    assert.strictEqual(inactiveOptionDoc.isActive, false, "isActive controls dashboard option status");
    assert.strictEqual(inactiveOptionDoc.isVisible, false, "isVisible is derived from inactive status");
    assert.strictEqual(inactiveOptionDoc.isAvailable, false, "isAvailable is derived from inactive status");
    assert.deepStrictEqual(inactiveOptionDoc.availableFor, ["one_time", "subscription"], "availableFor is not controlled by dashboard option form");

    res = await api.post(`/api/dashboard/menu/products/${directProduct.id}/option-groups`).set(adminHeaders).send({
      groupId: group.id,
      minSelections: 0,
      maxSelections: 1,
      initialOptionIds: [option.id],
    });
    expectStatus(res, 201, "link option group");

    const directAfterLink = await MenuProduct.findById(directProduct.id).lean();
    assert.strictEqual(directAfterLink.isCustomizable, true, "linking a group makes product customizable");

    res = await api.get(`/api/dashboard/menu/products/${directProduct.id}/composer`).set(adminHeaders);
    expectStatus(res, 200, "product composer");
    assert.strictEqual(res.body.data.contractVersion, "dashboard_product_composer.v3");
    assert.strictEqual(res.body.data.product.isCustomizable, true);
    assert(!Object.prototype.hasOwnProperty.call(res.body.data, "linkedOptionGroups"), "v3 removes root linkedOptionGroups duplication");
    assert(!Object.prototype.hasOwnProperty.call(res.body.data.product, "optionGroups"), "v3 removes product optionGroups alias");
    assert(!Object.prototype.hasOwnProperty.call(res.body.data.product, "groups"), "v3 removes product groups alias");
    assert.strictEqual(res.body.data.customization.isCustomizable, true);
    assert.strictEqual(res.body.data.customization.linkedGroups[0].groupId, group.id);
    assert.strictEqual(res.body.data.customization.linkedGroups[0].rules.maxSelections, 1);
    assert.strictEqual(res.body.data.customization.linkedGroups[0].options[0].optionId, option.id);
    assert(res.body.data.customization.linkedGroups[0].options[0].effectivePricing, "v3 option exposes effective pricing");
    assert.strictEqual(res.body.data.availableActions.canAttachGroups, true);
    assert.strictEqual(res.body.data.validation.ok, true);

    res = await api.get(`/api/dashboard/menu/categories/${category.id}`).set(adminHeaders);
    expectStatus(res, 200, "category detail");
    assert.strictEqual(res.body.data.contractVersion, "dashboard_category_detail.v3");
    assert(!Object.prototype.hasOwnProperty.call(res.body.data, "id"), "v3 removes category root field duplication");
    assert.strictEqual(res.body.data.category.id, category.id);
    assert(Array.isArray(res.body.data.products));
    assert(res.body.data.products.some((product) => product.id === directProduct.id));
    assert(res.body.data.products.every((product) => String(product.categoryId) === String(category.id)), "category detail only includes products for category");
    assert(!res.body.data.products.some((product) => product.id === targetProduct.id), "category detail excludes target product");
    assert(!res.body.data.products.some((product) => product.id === sandwichProduct.id), "category detail excludes sandwich product");
    assert.strictEqual(res.body.data.assignment.relationOwner, "product.categoryId");
    assert.strictEqual(res.body.data.actions.canBulkAssignProducts, true);

    res = await api.get(`/api/dashboard/menu/option-groups/${group.id}`).set(adminHeaders);
    expectStatus(res, 200, "option group detail");
    assert.strictEqual(res.body.data.contractVersion, "dashboard_option_group_detail.v3");
    assert(!Object.prototype.hasOwnProperty.call(res.body.data, "id"), "v3 removes option group root field duplication");
    assert.strictEqual(res.body.data.optionGroup.id, group.id);
    assert(res.body.data.options.some((row) => row.id === option.id));
    assertNoDeprecatedOptionFields(res.body.data.options.find((row) => row.id === option.id), "option group detail option");
    assert.strictEqual(res.body.data.usage.linkedProductsCount, 1);
    assert.strictEqual(res.body.data.actions.canAddOptions, true);

    res = await api.get(`/api/dashboard/menu/options/${option.id}`).set(adminHeaders);
    expectStatus(res, 200, "option detail");
    assert.strictEqual(res.body.data.contractVersion, "dashboard_option_detail.v3");
    assert(!Object.prototype.hasOwnProperty.call(res.body.data, "id"), "v3 removes option root field duplication");
    assert.strictEqual(res.body.data.option.id, option.id);
    assertNoDeprecatedOptionFields(res.body.data.option, "option detail");
    assert.strictEqual(res.body.data.optionGroup.id, group.id);
    assert.strictEqual(res.body.data.usage.linkedProductsCount, 1);

    res = await api.patch(`/api/dashboard/menu/options/${option.id}`).set(adminHeaders).send({
      displayCategoryKey: "updated_display",
      proteinFamilyKey: "updated_family",
      premiumKey: "updated_premium",
      selectionType: "updated_selection",
      ruleTags: ["updated_rule"],
      isVisible: false,
      isAvailable: false,
      availableFor: ["subscription"],
      availableForSubscription: false,
      extraPriceHalala: 100,
    });
    expectStatus(res, 200, "update option ignores deprecated dashboard fields");
    assertNoDeprecatedOptionFields(res.body.data, "updated dashboard option");
    optionDoc = await mongoose.model("MenuOption").findById(option.id).lean();
    assert.strictEqual(optionDoc.displayCategoryKey, "", "deprecated displayCategoryKey update is ignored");
    assert.strictEqual(optionDoc.proteinFamilyKey, "", "deprecated proteinFamilyKey update is ignored");
    assert.strictEqual(optionDoc.premiumKey, "", "deprecated premiumKey update is ignored");
    assert.strictEqual(optionDoc.selectionType, "", "deprecated selectionType update is ignored");
    assert.deepStrictEqual(optionDoc.ruleTags, [], "deprecated ruleTags update is ignored");
    assert.strictEqual(optionDoc.isActive, true, "omitting isActive preserves current active status");
    assert.strictEqual(optionDoc.isVisible, true, "isVisible update is ignored and derived from isActive");
    assert.strictEqual(optionDoc.isAvailable, true, "isAvailable update is ignored and derived from isActive");
    assert.deepStrictEqual(optionDoc.availableFor, ["one_time", "subscription"], "availableFor update is ignored");
    assert.strictEqual(optionDoc.availableForSubscription, true, "availableForSubscription update is ignored");
    assert.strictEqual(optionDoc.extraPriceHalala, 100, "normal option update still applies");

    res = await api.patch(`/api/dashboard/menu/options/${option.id}`).set(adminHeaders).send({ isActive: false });
    expectStatus(res, 200, "update option inactive with simplified status");
    assertNoDeprecatedOptionFields(res.body.data, "inactive updated dashboard option");
    optionDoc = await mongoose.model("MenuOption").findById(option.id).lean();
    assert.strictEqual(optionDoc.isActive, false, "isActive update applies");
    assert.strictEqual(optionDoc.isVisible, false, "isVisible follows isActive update");
    assert.strictEqual(optionDoc.isAvailable, false, "isAvailable follows isActive update");

    res = await api.patch(`/api/dashboard/menu/options/${option.id}`).set(adminHeaders).send({ isActive: true });
    expectStatus(res, 200, "reactivate option with simplified status");
    optionDoc = await mongoose.model("MenuOption").findById(option.id).lean();
    assert.strictEqual(optionDoc.isActive, true, "isActive reactivation applies");
    assert.strictEqual(optionDoc.isVisible, true, "isVisible follows active status");
    assert.strictEqual(optionDoc.isAvailable, true, "isAvailable follows active status");

    res = await api.get("/api/dashboard/menu/options").set(adminHeaders);
    expectStatus(res, 200, "option list");
    assertNoDeprecatedOptionFields(res.body.data.find((row) => row.id === option.id), "option list item");

    res = await api.get(`/api/dashboard/menu/categories/${category.id}?contractVersion=v2`).set(adminHeaders);
    expectStatus(res, 410, "category detail v2 is deprecated");
    assert.strictEqual(res.body.error.code, "DASHBOARD_CONTRACT_VERSION_UNSUPPORTED");

    res = await api.put(`/api/dashboard/menu/products/${directProduct.id}/groups`).set(adminHeaders).send({
      groups: [{ groupId: group.id }],
    });
    expectStatus(res, 404, "legacy product groups alias removed");

    res = await api.put(`/api/dashboard/menu/categories/${targetCategory.id}/products`).set(adminHeaders).send({
      products: [{ productId: directProduct.id }],
    });
    expectStatus(res, 404, "legacy category product assignment PUT removed");

    res = await api.post(`/api/dashboard/menu/categories/${targetCategory.id}/products`).set(adminHeaders).send({
      productIds: [directProduct.id],
      mode: "assign",
    });
    expectStatus(res, 200, "bulk assign product to category");
    assert.strictEqual(res.body.data.relationOwner, "product.categoryId");
    const movedProduct = await MenuProduct.findById(directProduct.id).lean();
    assert.strictEqual(String(movedProduct.categoryId), targetCategory.id);

    res = await api.post(`/api/dashboard/menu/categories/${category.id}/products`).set(adminHeaders).send({
      productIds: [directProduct.id],
      mode: "assign",
    });
    expectStatus(res, 200, "v3 bulk assign product to category");
    assert.strictEqual(res.body.data.contractVersion, "dashboard_category_product_assignment.v3");
    assert.strictEqual(res.body.data.category.id, category.id);
    assert.strictEqual(res.body.data.assignedCount, 1);
    assert.strictEqual(res.body.data.products[0].id, directProduct.id);
    let reassignedProduct = await MenuProduct.findById(directProduct.id).lean();
    assert.strictEqual(String(reassignedProduct.categoryId), category.id);

    res = await api.patch("/api/dashboard/menu/products/bulk").set(adminHeaders).send({
      productIds: [directProduct.id],
      action: "move_to_category",
      categoryId: targetCategory.id,
    });
    expectStatus(res, 200, "product bulk move to category");
    assert.strictEqual(res.body.data.action, "move_to_category");
    assert.strictEqual(res.body.data.count, 1);
    assert.strictEqual(res.body.data.category.id, targetCategory.id);
    reassignedProduct = await MenuProduct.findById(directProduct.id).lean();
    assert.strictEqual(String(reassignedProduct.categoryId), targetCategory.id);

    res = await api.patch(`/api/dashboard/menu/products/${directProduct.id}`).set(adminHeaders).send({
      isCustomizable: false,
    });
    expectStatus(res, 200, "make product non-customizable");
    assert.strictEqual(res.body.data.isCustomizable, false);
    assert.strictEqual(await ProductOptionGroup.countDocuments({ productId: directProduct.id, isActive: true }), 0);
    assert.strictEqual(await ProductGroupOption.countDocuments({ productId: directProduct.id, isActive: true }), 0);

    console.log("dashboard menu product-centered contract test passed");
  } finally {
    await disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  await disconnect();
  process.exit(1);
});
