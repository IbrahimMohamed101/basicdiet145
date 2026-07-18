process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");

const TEST_TAG = `dashboard-menu-edit-parity-${Date.now()}`;
const TEST_KEY = TEST_TAG.replace(/-/g, "_");

let mongoServer;

function expectStatus(response, expected, label) {
  assert.strictEqual(
    response.status,
    expected,
    `${label}: expected ${expected}, got ${response.status} ${JSON.stringify(response.body)}`
  );
}

function fieldSet(value) {
  return Object.keys(value || {}).sort();
}

function assertFieldParity(left, right, label) {
  assert.deepStrictEqual(fieldSet(left), fieldSet(right), `${label}: canonical field sets differ`);
}

async function main() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`basicdiet_${TEST_KEY}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const api = request(createApp());
  const { headers } = await dashboardAuth("admin", TEST_TAG);

  try {
    let response = await api.post("/api/dashboard/menu/categories").set(headers).send({
      key: `${TEST_KEY}_category`,
      name: { ar: "تصنيف", en: "Category" },
      description: { ar: "وصف", en: "Category description" },
      imageUrl: "https://cdn.example.test/category.png",
      sortOrder: 7,
      isActive: true,
      isVisible: false,
      isAvailable: true,
      ui: { cardVariant: "addon_collection", layout: "grid" },
      availability: { branchIds: ["north"] },
    });
    expectStatus(response, 201, "create category");
    const createdCategory = response.body.data;

    response = await api.patch(`/api/dashboard/menu/categories/${createdCategory.id}`).set(headers).send({
      name: { ar: "تصنيف محدث", en: "Updated Category" },
    });
    expectStatus(response, 200, "patch category name only");
    const updatedCategory = response.body.data;
    assertFieldParity(createdCategory, updatedCategory, "category create/update");
    assert.deepStrictEqual(updatedCategory.description, createdCategory.description);
    assert.strictEqual(updatedCategory.imageUrl, createdCategory.imageUrl);
    assert.strictEqual(updatedCategory.isVisible, false);
    assert.deepStrictEqual(updatedCategory.availability.branchIds, ["north"]);

    response = await api.get(`/api/dashboard/menu/categories/${createdCategory.id}`).set(headers);
    expectStatus(response, 200, "read category for edit");
    assertFieldParity(updatedCategory, response.body.data.category, "category update/read");

    response = await api.post("/api/dashboard/menu/products").set(headers).send({
      categoryId: createdCategory.id,
      key: `${TEST_KEY}_product`,
      name: { ar: "منتج", en: "Product" },
      description: { ar: "تفاصيل", en: "Product details" },
      imageUrl: "https://cdn.example.test/product.png",
      itemType: "basic_salad",
      pricingModel: "per_100g",
      priceHalala: 1900,
      baseUnitGrams: 100,
      defaultWeightGrams: 100,
      minWeightGrams: 100,
      maxWeightGrams: 250,
      weightStepGrams: 50,
      availableFor: ["one_time"],
      isCustomizable: true,
      isActive: true,
      isVisible: false,
      isAvailable: true,
      sortOrder: 8,
      ui: { cardVariant: "large_salad", cardSize: "large", badge: "Fresh" },
      branchAvailability: ["north"],
    });
    expectStatus(response, 201, "create product");
    const createdProduct = response.body.data;
    assert.strictEqual(createdProduct.weightStepPriceHalala, null);
    assert.strictEqual(createdProduct.weightPricing.contractVersion, "weight_pricing.v1");

    response = await api.patch(`/api/dashboard/menu/products/${createdProduct.id}`).set(headers).send({
      name: { ar: "منتج محدث", en: "Updated Product" },
    });
    expectStatus(response, 200, "patch product name only");
    const updatedProduct = response.body.data;
    assertFieldParity(createdProduct, updatedProduct, "product create/update");
    for (const field of [
      "description",
      "imageUrl",
      "priceHalala",
      "baseUnitGrams",
      "defaultWeightGrams",
      "minWeightGrams",
      "maxWeightGrams",
      "weightStepGrams",
      "availableFor",
      "isVisible",
      "ui",
      "branchAvailability",
    ]) {
      assert.deepStrictEqual(updatedProduct[field], createdProduct[field], `product PATCH preserved ${field}`);
    }

    response = await api.get(`/api/dashboard/menu/products/${createdProduct.id}`).set(headers);
    expectStatus(response, 200, "read product for edit");
    assertFieldParity(updatedProduct, response.body.data.product, "product update/read");

    response = await api.get(`/api/dashboard/menu/products/${createdProduct.id}/composer?contractVersion=v4`).set(headers);
    expectStatus(response, 200, "read v4 product composer");
    assert.strictEqual(response.body.data.contractVersion, "dashboard_product_composer.v4");
    assertFieldParity(updatedProduct, response.body.data.product, "product update/composer");
    assert.strictEqual(response.body.data.product.imageUrl, createdProduct.imageUrl);
    assert.strictEqual(response.body.data.product.priceHalala, 1900);

    response = await api.post("/api/dashboard/menu/option-groups").set(headers).send({
      key: `${TEST_KEY}_group`,
      name: { ar: "مجموعة", en: "Group" },
      description: { ar: "وصف", en: "Group description" },
      sortOrder: 3,
      isActive: true,
      isVisible: false,
      isAvailable: true,
      ui: { displayStyle: "checkbox_grid" },
    });
    expectStatus(response, 201, "create option group");
    const createdGroup = response.body.data;

    response = await api.patch(`/api/dashboard/menu/option-groups/${createdGroup.id}`).set(headers).send({
      name: { ar: "مجموعة محدثة", en: "Updated Group" },
    });
    expectStatus(response, 200, "patch option group name only");
    const updatedGroup = response.body.data;
    assertFieldParity(createdGroup, updatedGroup, "option group create/update");
    assert.deepStrictEqual(updatedGroup.description, createdGroup.description);
    assert.strictEqual(updatedGroup.isVisible, false);
    assert.deepStrictEqual(updatedGroup.ui, createdGroup.ui);

    response = await api.get(`/api/dashboard/menu/option-groups/${createdGroup.id}`).set(headers);
    expectStatus(response, 200, "read option group for edit");
    assertFieldParity(updatedGroup, response.body.data.optionGroup, "option group update/read");

    response = await api.post("/api/dashboard/menu/options").set(headers).send({
      groupId: createdGroup.id,
      key: `${TEST_KEY}_option`,
      name: { ar: "خيار", en: "Option" },
      description: { ar: "تفاصيل", en: "Option details" },
      imageUrl: "https://cdn.example.test/option.png",
      extraPriceHalala: 500,
      extraWeightUnitGrams: 50,
      extraWeightPriceHalala: 200,
      availableFor: ["subscription"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: 4,
    });
    expectStatus(response, 201, "create option");
    const createdOption = response.body.data;

    response = await api.patch(`/api/dashboard/menu/options/${createdOption.id}`).set(headers).send({
      name: { ar: "خيار محدث", en: "Updated Option" },
    });
    expectStatus(response, 200, "patch option name only");
    const updatedOption = response.body.data;
    assertFieldParity(createdOption, updatedOption, "option create/update");
    for (const field of [
      "description",
      "imageUrl",
      "extraPriceHalala",
      "extraFeeHalala",
      "extraWeightUnitGrams",
      "extraWeightPriceHalala",
      "availableFor",
      "isVisible",
    ]) {
      assert.deepStrictEqual(updatedOption[field], createdOption[field], `option PATCH preserved ${field}`);
    }
    for (const field of [
      "availableForSubscription",
      "nutrition",
      "proteinFamilyKey",
      "displayCategoryKey",
      "premiumKey",
      "ruleTags",
      "selectionType",
    ]) {
      assert(Object.prototype.hasOwnProperty.call(updatedOption, field), `option compatibility field ${field} is returned`);
    }

    response = await api.get(`/api/dashboard/menu/options/${createdOption.id}`).set(headers);
    expectStatus(response, 200, "read option for edit");
    assertFieldParity(updatedOption, response.body.data.option, "option update/read");

    response = await api.post(`/api/dashboard/menu/products/${createdProduct.id}/option-groups`).set(headers).send({
      groupId: createdGroup.id,
      minSelections: 1,
      maxSelections: 2,
      isRequired: true,
      isActive: true,
      isVisible: false,
      isAvailable: true,
      sortOrder: 5,
    });
    expectStatus(response, 201, "create product group relation");
    const createdGroupRelation = response.body.data;

    response = await api.patch(`/api/dashboard/menu/products/${createdProduct.id}/option-groups/${createdGroup.id}`).set(headers).send({
      sortOrder: 6,
    });
    expectStatus(response, 200, "patch product group relation order only");
    const updatedGroupRelation = response.body.data;
    assertFieldParity(createdGroupRelation, updatedGroupRelation, "product group relation create/update");
    assert.strictEqual(updatedGroupRelation.minSelections, 1);
    assert.strictEqual(updatedGroupRelation.maxSelections, 2);
    assert.strictEqual(updatedGroupRelation.isRequired, true);
    assert.strictEqual(updatedGroupRelation.isVisible, false);

    response = await api.get(`/api/dashboard/menu/products/${createdProduct.id}/option-groups?includeInactive=true`).set(headers);
    expectStatus(response, 200, "read product group relation");
    const readGroupRelation = response.body.data.find((row) => row.groupId === createdGroup.id);
    assertFieldParity(updatedGroupRelation, readGroupRelation, "product group relation update/read");

    response = await api.post(`/api/dashboard/menu/products/${createdProduct.id}/option-groups/${createdGroup.id}/options`).set(headers).send({
      optionId: createdOption.id,
      extraPriceHalala: 700,
      extraWeightUnitGrams: 100,
      extraWeightPriceHalala: 300,
      isActive: true,
      isVisible: false,
      isAvailable: true,
      sortOrder: 9,
    });
    expectStatus(response, 201, "create product option relation");
    const createdOptionRelation = response.body.data;

    response = await api.patch(`/api/dashboard/menu/products/${createdProduct.id}/option-groups/${createdGroup.id}/options/${createdOption.id}`).set(headers).send({
      extraPriceHalala: 0,
    });
    expectStatus(response, 200, "patch product option relation price only");
    const updatedOptionRelation = response.body.data;
    assertFieldParity(createdOptionRelation, updatedOptionRelation, "product option relation create/update");
    assert.strictEqual(updatedOptionRelation.extraPriceHalala, 0);
    assert.strictEqual(updatedOptionRelation.extraWeightUnitGrams, 100);
    assert.strictEqual(updatedOptionRelation.extraWeightPriceHalala, 300);
    assert.strictEqual(updatedOptionRelation.isVisible, false);

    response = await api.get(`/api/dashboard/menu/products/${createdProduct.id}/option-groups/${createdGroup.id}/options?includeInactive=true`).set(headers);
    expectStatus(response, 200, "read product option relation");
    const readOptionRelation = response.body.data.find((row) => row.optionId === createdOption.id);
    assertFieldParity(updatedOptionRelation, readOptionRelation, "product option relation update/read");

    response = await api.patch(`/api/dashboard/menu/products/${createdProduct.id}`).set(headers).send({
      priceHalala: 0,
      imageUrl: "",
      availableFor: [],
      branchAvailability: [],
      isVisible: false,
    });
    expectStatus(response, 200, "explicit product clears and false/zero values");
    assert.strictEqual(response.body.data.priceHalala, 0);
    assert.strictEqual(response.body.data.imageUrl, "");
    assert.deepStrictEqual(response.body.data.availableFor, []);
    assert.deepStrictEqual(response.body.data.branchAvailability, []);
    assert.strictEqual(response.body.data.isVisible, false);

    response = await api.patch(`/api/dashboard/menu/products/${createdProduct.id}`).set(headers).send({ priceHalala: null });
    expectStatus(response, 400, "reject null product price");
    assert.strictEqual(response.body.error.code, "NULL_NOT_ALLOWED");
    response = await api.get(`/api/dashboard/menu/products/${createdProduct.id}`).set(headers);
    expectStatus(response, 200, "read product after rejected null patch");
    assert.strictEqual(response.body.data.product.priceHalala, 0, "rejected null patch did not mutate price");

    response = await api.patch(`/api/dashboard/menu/categories/${createdCategory.id}`).set(headers).send({ description: null });
    expectStatus(response, 400, "reject null category description");

    response = await api.patch(`/api/dashboard/menu/option-groups/${createdGroup.id}`).set(headers).send({ sortOrder: null });
    expectStatus(response, 400, "reject null option group order");

    response = await api.patch(`/api/dashboard/menu/options/${createdOption.id}`).set(headers).send({ extraPriceHalala: null });
    expectStatus(response, 400, "reject null option price");

    response = await api.patch(`/api/dashboard/menu/products/${createdProduct.id}/option-groups/${createdGroup.id}/options/${createdOption.id}`).set(headers).send({
      extraPriceHalala: null,
    });
    expectStatus(response, 200, "clear product option override with null");
    assert.strictEqual(response.body.data.extraPriceHalala, null);

    response = await api.patch(`/api/dashboard/menu/products/${createdProduct.id}/weight-pricing`).set(headers).send({
      priceHalala: 2100,
      baseUnitGrams: 100,
      defaultWeightGrams: 100,
      minWeightGrams: 100,
      maxWeightGrams: 300,
      weightStepGrams: 50,
      weightStepPriceHalala: 500,
    });
    expectStatus(response, 200, "update canonical weight pricing");
    assert.strictEqual(response.body.data.product.weightStepPriceHalala, 500);
    assert.deepStrictEqual(response.body.data.product.weightPricing, response.body.data.weightPricing);

    response = await api.get(`/api/dashboard/menu/products/${createdProduct.id}/composer?contractVersion=v4`).set(headers);
    expectStatus(response, 200, "composer reflects canonical weight pricing");
    assert.strictEqual(response.body.data.product.weightStepPriceHalala, 500);
    assert.strictEqual(response.body.data.product.weightPricing.strategy, "base_plus_steps");

    console.log("dashboard menu edit contract parity test passed");
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }
}

main().catch(async (error) => {
  console.error(error);
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
  process.exit(1);
});
