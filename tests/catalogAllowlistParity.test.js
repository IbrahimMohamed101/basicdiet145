const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  CUSTOMER_VISIBLE_CARB_KEYS,
  PREMIUM_MEAL_PROTEIN_KEYS,
  STANDARD_MEAL_PROTEIN_KEYS,
  SUBSCRIPTION_COLD_SANDWICH_KEYS,
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS,
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS,
} = require("../src/config/mealPlannerContract");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function assertSameSet(actual, expected, label) {
  assert.deepStrictEqual(uniqueSorted(actual), uniqueSorted(expected), label);
}

function extractConstStringArray(source, constName) {
  const match = source.match(new RegExp(`const\\s+${constName}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  assert(match, `Missing const array ${constName}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function extractConstArrayBody(source, constName, endPattern = "\\];") {
  const match = source.match(new RegExp(`const\\s+${constName}\\s*=\\s*\\[([\\s\\S]*?)${endPattern}`));
  assert(match, `Missing const array body ${constName}`);
  return match[1];
}

function extractKeyedObjectRows(arrayBody) {
  return [...arrayBody.matchAll(/\{[\s\S]*?\}/g)].map((match) => match[0]);
}

function extractKeysFromObjectRows(arrayBody, predicate = () => true) {
  return extractKeyedObjectRows(arrayBody)
    .filter(predicate)
    .map((row) => {
      const keyMatch = row.match(/\bkey:\s*"([^"]+)"/);
      return keyMatch ? keyMatch[1] : "";
    })
    .filter(Boolean);
}

function extractProductAllowedGroupBlock(source, productKey) {
  const match = source.match(new RegExp(`${productKey}:\\s*\\{([\\s\\S]*?)\\n\\s*\\},`));
  assert(match, `Missing product allowed option block ${productKey}`);
  return match[1];
}

function extractSeedProteinsGroupBlock(source) {
  const start = source.indexOf('key: "proteins"');
  const end = source.indexOf('key: "carbs"', start);
  assert(start >= 0 && end > start, "Missing seed proteins group block");
  return source.slice(start, end);
}

function run() {
  const seedSource = read("scripts/seed-catalog.js");
  const publicMenuSource = read("src/services/orders/menuCatalogService.js");
  const catalogServiceSource = read("src/services/catalog/CatalogService.js");
  const mealSlotPlannerSource = read("src/services/subscription/mealSlotPlannerService.js");

  const seedPremiumLargeSaladProteins = extractConstStringArray(seedSource, "subscriptionPremiumLargeSaladProteinKeys");
  assertSameSet(
    seedPremiumLargeSaladProteins,
    SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS,
    "seed premium large salad protein allowlist matches runtime contract"
  );

  const premiumLargeSaladAllowedBlock = extractProductAllowedGroupBlock(seedSource, "premium_large_salad");
  const seedExcludedGroups = [...premiumLargeSaladAllowedBlock.matchAll(/\b([a-z0-9_]+):\s*\[\s*\]/g)]
    .map((match) => match[1]);
  assertSameSet(
    seedExcludedGroups,
    SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS,
    "seed premium large salad excluded groups match runtime contract"
  );
  assert(catalogServiceSource.includes("SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS"), "CatalogService uses excluded group contract");
  assert(mealSlotPlannerSource.includes("SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS"), "mealSlotPlannerService uses excluded group contract");

  const seedStandardProteinKeys = extractConstStringArray(seedSource, "standardProteinOptionKeys");
  assertSameSet(seedStandardProteinKeys, STANDARD_MEAL_PROTEIN_KEYS, "seed standard proteins match contract");
  assert(publicMenuSource.includes("STANDARD_MEAL_PROTEIN_KEYS"), "public menu serializer uses standard protein contract");

  const seedPremiumMealProteins = extractConstStringArray(seedSource, "premiumMealProteinKeys");
  assertSameSet(seedPremiumMealProteins, PREMIUM_MEAL_PROTEIN_KEYS, "seed premium meal proteins match contract");

  const seedCarbRows = extractConstArrayBody(seedSource, "carbRows");
  const seedCanonicalCarbs = extractKeysFromObjectRows(seedCarbRows);
  assertSameSet(seedCanonicalCarbs, CUSTOMER_VISIBLE_CARB_KEYS, "seed canonical carbs match contract");
  assert(publicMenuSource.includes("CUSTOMER_VISIBLE_CARB_KEYS"), "public menu serializer uses customer-visible carb contract");
  assert(catalogServiceSource.includes("CUSTOMER_VISIBLE_CARB_KEYS"), "planner catalog uses customer-visible carb contract");

  const seedSubscriptionSandwiches = extractConstStringArray(seedSource, "subscriptionSandwichKeys");
  assertSameSet(seedSubscriptionSandwiches, SUBSCRIPTION_COLD_SANDWICH_KEYS, "seed subscription sandwiches match contract");
  assert(catalogServiceSource.includes("SUBSCRIPTION_COLD_SANDWICH_KEYS"), "planner catalog uses subscription sandwich contract");

  console.log("Catalog allowlist parity tests passed.");
}

run();
