/**
 * Menu Identity Mapping System Tests (Standalone)
 * Run: NODE_ENV=test node tests/menuIdentityMapping.test.js
 */
const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const SharedMenuIdentity = require("../src/models/SharedMenuIdentity");
const MenuIdentityLink = require("../src/models/MenuIdentityLink");
const MenuProduct = require("../src/models/MenuProduct");
const {
  normalizeIdentityKey,
  normalizeAlias,
  validateIdentityLinks,
  createIdentity,
  createLink,
} = require("../src/services/menuIdentityMappingService");

const results = { passed: 0, failed: 0 };

async function test(name, fn) {
  try {
    await fn();
    results.passed += 1;
    console.log(`  ✅  ${name}`);
  } catch (err) {
    results.failed += 1;
    console.error(`  ❌  ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

(async function run() {
  const mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  console.log("\n--- Starting Menu Identity Mapping Tests ---");

  try {
    console.log("Syncing indexes...");
    await SharedMenuIdentity.syncIndexes();
    await MenuIdentityLink.syncIndexes();

    await SharedMenuIdentity.deleteMany({});
    await MenuIdentityLink.deleteMany({});
    await MenuProduct.deleteMany({});

    // 1. SharedMenuIdentity key uniqueness
    await test("SharedMenuIdentity enforces key uniqueness", async () => {
      await SharedMenuIdentity.create({
        key: "chicken_breast",
        type: "protein",
        name: { en: "Chicken Breast" },
      });

      try {
        await SharedMenuIdentity.create({
          key: "chicken_breast",
          type: "protein",
          name: { ar: "صدر دجاج" },
        });
        throw new Error("Should have thrown unique constraint error");
      } catch (err) {
        assert.ok(err.code === 11000 || err.message.includes("E11000"), "Expected duplicate key error");
      }
    });

    // 2. MenuIdentityLink prevents one source record linking to two active identities
    await test("MenuIdentityLink prevents double active mapping", async () => {
      const id1 = await SharedMenuIdentity.create({
        key: "id1",
        type: "product",
        name: { en: "Identity 1" },
      });
      const id2 = await SharedMenuIdentity.create({
        key: "id2",
        type: "product",
        name: { en: "Identity 2" },
      });

      const sourceId = new mongoose.Types.ObjectId();

      await MenuIdentityLink.create({
        identityId: id1._id,
        channel: "one_time",
        sourceModel: "MenuProduct",
        sourceId: sourceId,
        isActive: true,
      });

      try {
        await MenuIdentityLink.create({
          identityId: id2._id,
          channel: "one_time",
          sourceModel: "MenuProduct",
          sourceId: sourceId,
          isActive: true,
        });
        throw new Error("Should have prevented double active mapping");
      } catch (err) {
        assert.strictEqual(err.code, 11000, "Expected duplicate key error code 11000 for link");
      }
    });

    // 3. Same identity can link to one_time and subscription sources
    await test("Identity can link to multiple channels", async () => {
      const id = await SharedMenuIdentity.create({
        key: "multi_channel",
        type: "product",
        name: { en: "Multi Channel" },
      });

      await MenuIdentityLink.create({
        identityId: id._id,
        channel: "one_time",
        sourceModel: "MenuProduct",
        sourceId: new mongoose.Types.ObjectId(),
      });

      await MenuIdentityLink.create({
        identityId: id._id,
        channel: "subscription",
        sourceModel: "MenuProduct",
        sourceId: new mongoose.Types.ObjectId(),
      });

      const count = await MenuIdentityLink.countDocuments({ identityId: id._id });
      assert.strictEqual(count, 2);
    });

    // 4. Alias normalization
    await test("Alias normalization works for common Arabic variations", () => {
      assert.strictEqual(normalizeAlias("أرز أبيض"), normalizeAlias("ارز ابيض"));
      assert.strictEqual(normalizeAlias("جمبرى"), normalizeAlias("جمبري"));
      assert.strictEqual(normalizeAlias("رز أبيض"), normalizeAlias("رز ابيض"));
    });

    // 5. validateIdentityLinks detects missing sourceId
    await test("validateIdentityLinks detects missing sourceId", async () => {
      const id = await createIdentity({ key: "missing_source", type: "other", name: { en: "Missing" } });
      await createLink({
        identityId: id._id,
        channel: "one_time",
        sourceModel: "MenuProduct",
        sourceId: new mongoose.Types.ObjectId(),
      });

      const report = await validateIdentityLinks();
      assert.ok(report.errors.some(e => e.includes("not found in model MenuProduct")));
    });

    // 6. validateIdentityLinks detects alias collisions
    await test("validateIdentityLinks detects alias collisions", async () => {
      await createIdentity({
        key: "shrimp_canonical",
        type: "protein",
        name: { ar: "جمبري", en: "Shrimp" }
      });
      await createIdentity({
        key: "shrimp_other",
        type: "protein",
        name: { en: "Shrimp Alternative" },
        aliases: { ar: ["جمبري"] }
      });

      const report = await validateIdentityLinks();
      assert.ok(report.warnings.some(w => w.includes("Alias collision")));
    });

  } finally {
    console.log(`\nResults: ${results.passed} passed, ${results.failed} failed`);
    await mongoose.disconnect();
    await mongoServer.stop();
    if (results.failed > 0) process.exit(1);
  }
})();
