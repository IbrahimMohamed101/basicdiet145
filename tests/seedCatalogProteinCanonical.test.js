const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "bootstrap", "seed-catalog.js"), "utf8");

const expectedProteinKeys = [
  "chicken",
  "beef",
  "fish",
  "eggs",
  "beef_steak",
  "shrimp",
  "salmon",
  "boiled_eggs",
  "tuna",
  "chicken_fajita",
  "spicy_chicken",
  "italian_spiced_chicken",
  "chicken_tikka",
  "asian_chicken",
  "chicken_strips",
  "grilled_chicken",
  "mexican_chicken",
  "meatballs",
  "beef_stroganoff",
  "fish_fillet",
];

function extractArrayBlock(constName) {
  const match = source.match(new RegExp(`const ${constName} = \\[([\\s\\S]*?)\\];`));
  assert(match, `${constName} must exist as an array literal`);
  return match[1];
}

function extractKeys(block) {
  return [...block.matchAll(/\bkey:\s*"([^"]+)"/g)].map((match) => match[1]);
}

const proteinRowsBlock = extractArrayBlock("proteinRows");
const proteinKeys = extractKeys(proteinRowsBlock);

assert.deepStrictEqual(proteinKeys, expectedProteinKeys, "proteinRows must contain the canonical 20 proteins once");
assert.strictEqual(new Set(proteinKeys).size, proteinKeys.length, "proteinRows must not contain duplicate keys");

assert(!source.includes("saladProteinRows"), "salad protein definitions must not be split into a second canonical array");
assert(source.includes("options: proteinRows"), "proteins option group must use proteinRows directly");
assert(source.includes("const standardMealProteinRelations = ["), "standard meal eligibility must be a relation list");
assert(source.includes("const premiumMealProteinRelations ="), "premium meal eligibility must be a relation list");
assert(source.includes("const premiumLargeSaladProteinRelations ="), "premium large salad eligibility must be a relation list");
assert(source.includes("const oneTimeMealProteinRelations ="), "one-time meal eligibility must be a relation list");
assert(source.includes("const oneTimeSaladProteinRelations = ["), "one-time salad eligibility must be a relation list");

assert(
  source.includes('extraPriceHalala: groupDef.key === "proteins" ? 0'),
  "canonical protein options must not store relation-specific extra prices"
);
assert(
  source.includes('premiumKey: groupDef.key === "proteins" ? ""'),
  "canonical protein options must not store relation-specific premium keys"
);
assert(
  source.includes('selectionType: groupDef.key === "proteins" ? ""'),
  "canonical protein options must not store relation-specific selection types"
);

console.log("seedCatalogProteinCanonical.test.js passed");
