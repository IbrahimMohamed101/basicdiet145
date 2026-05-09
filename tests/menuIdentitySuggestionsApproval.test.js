/**
 * tests/menuIdentitySuggestionsApproval.test.js
 * 
 * Verifies the dashboard approval workflow for menu identity suggestions.
 */
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.NODE_ENV = "test";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");
const { createApp } = require("../src/app");

const SharedMenuIdentity = require("../src/models/SharedMenuIdentity");
const MenuIdentityLink = require("../src/models/MenuIdentityLink");
const MenuIdentitySuggestion = require("../src/models/MenuIdentitySuggestion");
const MenuProduct = require("../src/models/MenuProduct");
const BuilderProtein = require("../src/models/BuilderProtein");

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

function dashboardAuth(role, userId = "507f191e810c19729de860ea") {
  const token = jwt.sign(
    { userId, role, tokenType: "dashboard_access" },
    process.env.DASHBOARD_JWT_SECRET,
    { expiresIn: "1h" }
  );
  return { Authorization: `Bearer ${token}` };
}

(async function run() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  const app = createApp();
  const api = request(app);

  try {
    // 1. Data Setup
    const prod = await MenuProduct.create({
      key: "ot_shrimp",
      name: { ar: "جمبري", en: "Shrimp" },
      priceHalala: 1000,
      categoryId: new mongoose.Types.ObjectId(),
    });

    const protein = await BuilderProtein.create({
      key: "sub_shrimp",
      name: { ar: "روبيان", en: "Shrimp" },
      proteinFamilyKey: "fish",
      displayCategoryKey: "fish",
      displayCategoryId: new mongoose.Types.ObjectId(),
    });

    const suggestion = await MenuIdentitySuggestion.create({
      identityKey: "shrimp",
      identityName: { ar: "جمبري", en: "Shrimp" },
      type: "product",
      proposedLinks: [
        { channel: "one_time", sourceModel: "MenuProduct", sourceId: prod._id, sourceKey: prod.key, sourceDisplayName: "Shrimp" },
        { channel: "subscription", sourceModel: "BuilderProtein", sourceId: protein._id, sourceKey: protein.key, sourceDisplayName: "Shrimp" }
      ],
      confidence: "alias",
      status: "pending"
    });

    // 2. Auth Tests
    await test("Auth - Returns 403 for courier trying to list suggestions", async () => {
      const res = await api.get("/api/dashboard/menu-identity-suggestions").set(dashboardAuth("courier"));
      assert.strictEqual(res.status, 403);
    });

    await test("Auth - Returns 200 for admin listing suggestions", async () => {
      const res = await api.get("/api/dashboard/menu-identity-suggestions").set(dashboardAuth("admin"));
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.length, 1);
    });

    // 3. Rejection Test
    await test("Reject - Marks suggestion as rejected", async () => {
      const rejSug = await MenuIdentitySuggestion.create({
        identityKey: "reject_me",
        type: "other",
        proposedLinks: [],
        status: "pending"
      });
      const res = await api.post(`/api/dashboard/menu-identity-suggestions/${rejSug._id}/reject`).set(dashboardAuth("admin"));
      assert.strictEqual(res.status, 200);
      
      const updated = await MenuIdentitySuggestion.findById(rejSug._id);
      assert.strictEqual(updated.status, "rejected");
    });

    // 4. Approval Test
    await test("Approve - Creates identity and links", async () => {
      const res = await api.post(`/api/dashboard/menu-identity-suggestions/${suggestion._id}/approve`).set(dashboardAuth("admin"));
      assert.strictEqual(res.status, 200);
      
      const identity = await SharedMenuIdentity.findOne({ key: "shrimp" });
      assert.ok(identity);
      
      const links = await MenuIdentityLink.find({ identityId: identity._id });
      assert.strictEqual(links.length, 2);
      
      const sug = await MenuIdentitySuggestion.findById(suggestion._id);
      assert.strictEqual(sug.status, "approved");
    });

    // 5. Conflict Test
    await test("Approve - Conflict when source already linked", async () => {
      // Create another suggestion for the same product
      const conflictSug = await MenuIdentitySuggestion.create({
        identityKey: "shrimp_duplicate",
        type: "product",
        proposedLinks: [
          { channel: "one_time", sourceModel: "MenuProduct", sourceId: prod._id, sourceKey: prod.key }
        ],
        status: "pending"
      });
      
      const res = await api.post(`/api/dashboard/menu-identity-suggestions/${conflictSug._id}/approve`).set(dashboardAuth("admin"));
      assert.strictEqual(res.status, 409); // Conflict
      assert.ok(res.body.message.includes("already linked"));
    });

  } finally {
    await mongoose.disconnect();
    await mongoServer.stop();
    console.log(`\nResults: ${results.passed} passed, ${results.failed} failed`);
    if (results.failed > 0) process.exit(1);
  }
})();
