const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const source = require("../scripts/bootstrap/fixtures/menu-workbook-source");
const {
  allBuilderOptions,
  normalizeChannels,
  rowStatus,
  validateSource,
} = require("../scripts/bootstrap/seed-new-menu");

const counts = validateSource();

assert.strictEqual(source.metadata.sha256, "947615dae2bd66dd137210cd1a2d17e51a1f2b19a6f1e518b79e7e8f9015d342");
assert.deepStrictEqual(counts, {
  categoryCount: 10,
  productCount: 106,
  builderOptionCount: 33,
  productCandidateCount: 10,
  readyProductCount: 55,
  draftProductCount: 51,
});

const categoryKeys = new Set(source.categories.map((row) => row.key));
const productKeys = new Set(source.products.map((row) => row.key));
const groupKeys = new Set(source.builderGroups.map((row) => row.key));
const optionKeys = new Set(allBuilderOptions().map(({ option }) => option.key));

assert.strictEqual(categoryKeys.size, 10);
assert.strictEqual(productKeys.size, 106);
assert.strictEqual(groupKeys.size, 4);
assert.strictEqual(optionKeys.size, 33);

assert.deepStrictEqual(
  Object.fromEntries([...categoryKeys].map((key) => [
    key,
    source.products.filter((row) => row.categoryKey === key).length,
  ])),
  {
    breakfast: 16,
    meals: 35,
    sandwiches: 9,
    salads: 17,
    carbs: 7,
    greek_yogurt: 1,
    desserts: 8,
    ice_cream: 3,
    juices: 6,
    drinks: 4,
  }
);

for (const row of source.products) {
  assert(categoryKeys.has(row.categoryKey), `${row.key} references unknown category`);
  assert(row.key.startsWith(`${row.categoryKey}_`), `${row.key} should retain workbook category prefix`);
  assert(row.name.ar && row.name.en, `${row.key} must be bilingual`);
  assert(Number.isInteger(Number(row.priceHalala)) && Number(row.priceHalala) >= 0, `${row.key} invalid priceHalala`);
  assert.deepStrictEqual(normalizeChannels(row.availableFor), ["one_time", "subscription"]);
  const state = rowStatus(row.status);
  assert.strictEqual(state.isReady, row.status === "Ready");
}

assert(source.builderGroups.every((group) => group.options.every((row) => row.status === "Draft")));
assert(source.productCandidates.every((row) => !productKeys.has(row.key)), "candidate keys must not be seeded products");

const sourceWrapper = require("../scripts/bootstrap/fixtures/new-menu-source");
assert.strictEqual(sourceWrapper, source, "legacy source import must resolve to the workbook snapshot");

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

console.log("newMenuBootstrapContract.test.js static checks passed");
for (const testFile of [
  "workbookMenuSource.integration.test.js",
  "oneTimeMenuCatalog.test.js",
]) {
  execFileSync(process.execPath, [path.join(__dirname, testFile)], {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "test" },
  });
}
console.log("newMenuBootstrapContract.test.js full workbook suite passed");
