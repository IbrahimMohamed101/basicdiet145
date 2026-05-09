/**
 * tests/menuIdentitySuggestions.test.js
 * 
 * Verifies the suggestion logic for menu identity mapping.
 * Updated for Phase 4 staging workflow.
 */
const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const MenuIdentitySuggestion = require("../src/models/MenuIdentitySuggestion");
const SharedMenuIdentity = require("../src/models/SharedMenuIdentity");
const MenuProduct = require("../src/models/MenuProduct");
const BuilderProtein = require("../src/models/BuilderProtein");
const { run, getCanonicalToken } = require("../scripts/suggest-menu-identity-mappings");

const results = { passed: 0, failed: 0 };
let mongoServer;

async function test(name, fn) {
  try {
    await fn();
    results.passed += 1;
    console.log(`✅ ${name}`);
  } catch (err) {
    results.failed += 1;
    console.error(`❌ ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

(async function main() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGO_URI = uri;

  await mongoose.connect(uri);

  try {
    await test("Normalization - Arabic alif variations", () => {
      assert.strictEqual(getCanonicalToken("أرز أبيض"), getCanonicalToken("ارز ابيض"));
    });

    await test("Normalization - Business aliases (shrimp/robian)", () => {
      assert.strictEqual(getCanonicalToken("جمبري"), getCanonicalToken("روبيان"));
    });

    await test("Suggestion Logic - Dry-run does not write to staging", async () => {
      await MenuProduct.create({
        key: "ot_shrimp",
        name: { ar: "جمبري", en: "Shrimp" },
        categoryId: new mongoose.Types.ObjectId(),
        priceHalala: 1000,
        isActive: true
      });
      await BuilderProtein.create({
        key: "sub_shrimp",
        name: { ar: "روبيان", en: "Shrimp" },
        isActive: true,
        proteinFamilyKey: "fish",
        displayCategoryKey: "fish",
        displayCategoryId: new mongoose.Types.ObjectId()
      });

      process.env.MENU_IDENTITY_SUGGESTIONS_WRITE = "false";
      await run();

      const suggs = await MenuIdentitySuggestion.countDocuments();
      assert.strictEqual(suggs, 0, "No suggestions should be created in dry-run");
    });

    await test("Suggestion Logic - Write mode creates staging records", async () => {
      process.env.MENU_IDENTITY_SUGGESTIONS_WRITE = "true";
      await run();

      const suggs = await MenuIdentitySuggestion.find();
      assert.strictEqual(suggs.length, 1, "Should create one pending suggestion for shrimp");
      assert.strictEqual(suggs[0].identityKey, "shrimp");
      assert.strictEqual(suggs[0].proposedLinks.length, 2);
    });

    await test("Collision detection - Multiple records in same group", async () => {
      // Add exact duplicate in one-time
      await MenuProduct.create({
        key: "ot_shrimp_clone",
        name: { ar: "جمبري", en: "Shrimp" },
        categoryId: new mongoose.Types.ObjectId(),
        priceHalala: 1000,
        isActive: true
      });

      await run();
      // Should still be one group if identityKey matches and it skips existing pending
      const suggs = await MenuIdentitySuggestion.countDocuments({ status: "pending" });
      assert.strictEqual(suggs, 1);
    });

  } finally {
    await mongoose.disconnect();
    await mongoServer.stop();
    console.log(`\nResults: ${results.passed} passed, ${results.failed} failed`);
    if (results.failed > 0) process.exit(1);
  }
})();
