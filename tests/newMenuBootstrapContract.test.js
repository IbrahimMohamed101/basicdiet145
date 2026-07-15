const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = require("../scripts/bootstrap/fixtures/new-menu-source");
const {
  buildSaladGroup,
  buildSharedGroups,
  productGroupKeys,
} = require("../scripts/bootstrap/seed-new-menu");

assert.strictEqual(source.categories.length, 4, "expected four workbook menu categories");
assert.strictEqual(source.products.length, 49, "expected all 49 workbook products");

const categoryKeys = new Set(source.categories.map((row) => row[0]));
assert.strictEqual(categoryKeys.size, source.categories.length, "category keys must be unique");

const productKeys = new Set(source.products.map((row) => row[0]));
assert.strictEqual(productKeys.size, source.products.length, "product keys must be unique");

for (const product of source.products) {
  const [key, categoryKey, nameAr, ingredients, priceHalala, weightGrams, calories, protein, carbs, fat, customizationKind] = product;
  assert.ok(key.startsWith("new_menu_"));
  assert.ok(categoryKeys.has(categoryKey), `unknown category ${categoryKey}`);
  assert.ok(nameAr.trim(), `${key} missing Arabic name`);
  assert.ok(ingredients.trim(), `${key} missing ingredients`);
  assert.ok(Number.isInteger(priceHalala) && priceHalala >= 0, `${key} invalid price`);
  assert.ok(Number.isInteger(weightGrams) && weightGrams >= 0, `${key} invalid weight`);
  for (const value of [calories, protein, carbs, fat]) {
    assert.ok(Number.isFinite(value) && value >= 0, `${key} invalid nutrition`);
  }
  assert.ok(["", "bread", "fruit", "custom_sandwich", "salad_size"].includes(customizationKind));
}

assert.strictEqual(source.products.filter((row) => row[1] === "new_menu_main_courses").length, 16);
assert.strictEqual(source.products.filter((row) => row[1] === "new_menu_breakfast").length, 16);
assert.strictEqual(source.products.filter((row) => row[1] === "new_menu_sandwiches").length, 9);
assert.strictEqual(source.products.filter((row) => row[1] === "new_menu_salads").length, 8);

assert.deepStrictEqual(productGroupKeys("x", "bread"), ["new_menu_bread_choice"]);
assert.deepStrictEqual(productGroupKeys("x", "fruit"), ["new_menu_fruit_choice"]);
assert.deepStrictEqual(productGroupKeys("x", "custom_sandwich"), ["new_menu_bread_choice", "new_menu_sandwich_filling"]);
assert.deepStrictEqual(productGroupKeys("new_menu_salads_01", "salad_size"), ["new_menu_salads_01_size"]);

const sharedGroups = buildSharedGroups();
assert.strictEqual(sharedGroups.length, 3);
assert.strictEqual(sharedGroups.find((group) => group.key === "new_menu_fruit_choice").minSelections, 2);
assert.strictEqual(sharedGroups.find((group) => group.key === "new_menu_fruit_choice").maxSelections, 2);
assert.strictEqual(sharedGroups.find((group) => group.key === "new_menu_sandwich_filling").options.length, 8);

const saladProducts = source.products.filter((row) => row[10] === "salad_size");
assert.strictEqual(saladProducts.length, 7);
for (const product of saladProducts) {
  const group = buildSaladGroup(product);
  assert.strictEqual(group.options.length, 2);
  assert.strictEqual(group.minSelections, 1);
  assert.strictEqual(group.maxSelections, 1);
  assert.strictEqual(group.options[0].extraPriceHalala, 0);
  assert.strictEqual(group.options[1].extraPriceHalala, 1000);
}

const dashboardRoutes = fs.readFileSync(path.join(__dirname, "../src/routes/dashboardMenu.js"), "utf8");
for (const requiredRoute of [
  'router.post("/categories"',
  'router.patch("/categories/:id"',
  'router.post("/products"',
  'router.patch("/products/:id"',
  'router.post("/option-groups"',
  'router.patch("/option-groups/:id"',
  'router.post("/options"',
  'router.patch("/options/:id"',
  'router.post("/products/:productId/option-groups"',
  'router.post("/products/:productId/option-groups/:groupId/options"',
  'router.patch("/products/:productId/option-groups/:groupId/options/:optionId"',
  'router.post("/publish"',
]) {
  assert.ok(dashboardRoutes.includes(requiredRoute), `dashboard route missing: ${requiredRoute}`);
}

console.log("newMenuBootstrapContract.test.js passed");
