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

    res = await api.post("/api/dashboard/menu/option-groups").set(adminHeaders).send({
      key: `${TEST_KEY_TAG}_sauces`,
      name: { en: `${TEST_TAG} Sauces`, ar: "Sauces" },
    });
    expectStatus(res, 201, "create option group");
    const group = res.body.data;

    res = await api.post(`/api/dashboard/menu/option-groups/${group.id}/options`).set(adminHeaders).send({
      key: `${TEST_KEY_TAG}_ranch`,
      name: { en: `${TEST_TAG} Ranch`, ar: "Ranch" },
    });
    expectStatus(res, 201, "create option");
    const option = res.body.data;

    res = await api.post(`/api/dashboard/menu/products/${directProduct.id}/option-groups`).set(adminHeaders).send({
      groupId: group.id,
      minSelections: 0,
      maxSelections: 1,
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
    assert.strictEqual(res.body.data.assignment.relationOwner, "product.categoryId");
    assert.strictEqual(res.body.data.actions.canBulkAssignProducts, true);

    res = await api.get(`/api/dashboard/menu/option-groups/${group.id}`).set(adminHeaders);
    expectStatus(res, 200, "option group detail");
    assert.strictEqual(res.body.data.contractVersion, "dashboard_option_group_detail.v3");
    assert(!Object.prototype.hasOwnProperty.call(res.body.data, "id"), "v3 removes option group root field duplication");
    assert.strictEqual(res.body.data.optionGroup.id, group.id);
    assert(res.body.data.options.some((row) => row.id === option.id));
    assert.strictEqual(res.body.data.usage.linkedProductsCount, 1);
    assert.strictEqual(res.body.data.actions.canAddOptions, true);

    res = await api.get(`/api/dashboard/menu/options/${option.id}`).set(adminHeaders);
    expectStatus(res, 200, "option detail");
    assert.strictEqual(res.body.data.contractVersion, "dashboard_option_detail.v3");
    assert(!Object.prototype.hasOwnProperty.call(res.body.data, "id"), "v3 removes option root field duplication");
    assert.strictEqual(res.body.data.option.id, option.id);
    assert.strictEqual(res.body.data.optionGroup.id, group.id);
    assert.strictEqual(res.body.data.usage.linkedProductsCount, 1);

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
