"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const mobileHomeProductKeyCompatibility = require(
  "../src/middleware/mobileHomeProductKeyCompatibility"
);
const {
  applyMobileHomeProductKeyCompatibility,
} = mobileHomeProductKeyCompatibility;

function fixtureMenu() {
  const fruit = {
    id: "fruit-id",
    key: "salads_fruit_salad_150g",
    name: "Fruit Salad",
    priceHalala: 1700,
    canAddDirectly: true,
    requiresBuilder: false,
  };
  const yogurt = {
    id: "yogurt-id",
    key: "greek_yogurt_greek_yogurt_200g",
    name: "Greek Yogurt",
    priceHalala: 1700,
    canAddDirectly: true,
    requiresBuilder: false,
  };
  const unchanged = {
    id: "meal-id",
    key: "basic_meal",
    name: "Basic Meal",
    priceHalala: 1900,
  };

  return {
    currency: "SAR",
    categories: [
      { key: "salads", products: [fruit] },
      { key: "greek_yogurt", products: [yogurt] },
      { key: "custom_order", products: [unchanged] },
    ],
    publicMenuV2: {
      sections: [
        { key: "salads", products: [{ ...fruit }] },
        { key: "greek_yogurt", products: [{ ...yogurt }] },
        { key: "custom_order", products: [{ ...unchanged }] },
      ],
      productIndex: {
        byId: {
          "fruit-id": { sectionKey: "salads", productKey: fruit.key },
          "yogurt-id": { sectionKey: "greek_yogurt", productKey: yogurt.key },
          "meal-id": { sectionKey: "custom_order", productKey: unchanged.key },
        },
        byKey: {
          [fruit.key]: { sectionKey: "salads", productId: fruit.id },
          [yogurt.key]: { sectionKey: "greek_yogurt", productId: yogurt.id },
          [unchanged.key]: { sectionKey: "custom_order", productId: unchanged.id },
        },
      },
    },
  };
}

function findCategoryProduct(menu, categoryKey) {
  return menu.categories.find((category) => category.key === categoryKey).products[0];
}

function runPureContractTest() {
  const menu = fixtureMenu();
  const before = JSON.parse(JSON.stringify(menu));
  const result = applyMobileHomeProductKeyCompatibility(menu);

  const fruit = findCategoryProduct(result, "salads");
  const yogurt = findCategoryProduct(result, "greek_yogurt");
  const meal = findCategoryProduct(result, "custom_order");

  assert.strictEqual(fruit.key, "fruit_salad");
  assert.strictEqual(fruit.canonicalKey, "salads_fruit_salad_150g");
  assert.deepStrictEqual(
    fruit.keyAliases,
    ["salads_fruit_salad_150g", "fruit_salad"]
  );
  assert.strictEqual(fruit.id, "fruit-id");
  assert.strictEqual(fruit.priceHalala, 1700);
  assert.strictEqual(fruit.canAddDirectly, true);

  assert.strictEqual(yogurt.key, "greek_yogurt");
  assert.strictEqual(
    yogurt.canonicalKey,
    "greek_yogurt_greek_yogurt_200g"
  );
  assert.strictEqual(yogurt.id, "yogurt-id");
  assert.strictEqual(yogurt.priceHalala, 1700);
  assert.strictEqual(yogurt.canAddDirectly, true);

  assert.deepStrictEqual(meal, before.categories[2].products[0]);
  assert.deepStrictEqual(menu, before, "compatibility must not mutate the source menu");

  const publicFruit = result.publicMenuV2.sections[0].products[0];
  const publicYogurt = result.publicMenuV2.sections[1].products[0];
  assert.strictEqual(publicFruit.key, "fruit_salad");
  assert.strictEqual(publicYogurt.key, "greek_yogurt");
  assert.strictEqual(
    result.publicMenuV2.productIndex.byId["fruit-id"].productKey,
    "fruit_salad"
  );
  assert.strictEqual(
    result.publicMenuV2.productIndex.byId["yogurt-id"].productKey,
    "greek_yogurt"
  );
  assert.strictEqual(
    result.publicMenuV2.productIndex.byKey.fruit_salad.productId,
    "fruit-id"
  );
  assert.strictEqual(
    result.publicMenuV2.productIndex.byKey.greek_yogurt.productId,
    "yogurt-id"
  );
  assert.strictEqual(
    result.publicMenuV2.productIndex.byKey.salads_fruit_salad_150g.aliasKey,
    "fruit_salad"
  );
  assert.strictEqual(
    result.publicMenuV2.productIndex.byKey.greek_yogurt_greek_yogurt_200g.aliasKey,
    "greek_yogurt"
  );

  const categoryProductCount = result.categories.reduce(
    (sum, category) => sum + category.products.length,
    0
  );
  assert.strictEqual(categoryProductCount, 3, "aliases must not duplicate product cards");
}

function runCollisionSafetyTest() {
  const menu = fixtureMenu();
  menu.categories[0].products.push({
    id: "existing-short-key",
    key: "fruit_salad",
  });

  const result = applyMobileHomeProductKeyCompatibility(menu);
  const saladKeys = result.categories[0].products.map((product) => product.key);
  assert.deepStrictEqual(
    saladKeys,
    ["salads_fruit_salad_150g", "fruit_salad"],
    "a real existing alias key must prevent an ambiguous remap"
  );
}

function runMiddlewareTest() {
  const menu = fixtureMenu();
  let appPayload;
  const appResponse = {
    json(payload) {
      appPayload = payload;
      return payload;
    },
  };
  let appNextCalled = false;
  mobileHomeProductKeyCompatibility(
    { auth: { authContext: "app" } },
    appResponse,
    () => { appNextCalled = true; }
  );
  appResponse.json({ status: true, data: menu });
  assert.strictEqual(appNextCalled, true);
  assert.strictEqual(
    findCategoryProduct(appPayload.data, "salads").key,
    "fruit_salad"
  );
  assert.strictEqual(
    findCategoryProduct(appPayload.data, "greek_yogurt").key,
    "greek_yogurt"
  );

  let dashboardPayload;
  const dashboardResponse = {
    json(payload) {
      dashboardPayload = payload;
      return payload;
    },
  };
  let dashboardNextCalled = false;
  mobileHomeProductKeyCompatibility(
    { auth: { authContext: "dashboard" } },
    dashboardResponse,
    () => { dashboardNextCalled = true; }
  );
  dashboardResponse.json({ status: true, data: menu });
  assert.strictEqual(dashboardNextCalled, true);
  assert.strictEqual(
    findCategoryProduct(dashboardPayload.data, "salads").key,
    "salads_fruit_salad_150g"
  );
  assert.strictEqual(
    findCategoryProduct(dashboardPayload.data, "greek_yogurt").key,
    "greek_yogurt_greek_yogurt_200g"
  );
}

function runRouteWiringTest() {
  const routeSource = fs.readFileSync(
    path.join(__dirname, "../src/routes/orders.js"),
    "utf8"
  );
  assert.match(
    routeSource,
    /optionalMenuAccessAuth,[\s\S]*mobileHomeProductKeyCompatibility,[\s\S]*asyncHandler\(controller\.getOrderMenu\)/,
    "GET /orders/menu must apply compatibility after optional auth and before the controller"
  );
}

runPureContractTest();
runCollisionSafetyTest();
runMiddlewareTest();
runRouteWiringTest();

console.log("mobileHomeProductKeyCompatibility.test.js passed");
