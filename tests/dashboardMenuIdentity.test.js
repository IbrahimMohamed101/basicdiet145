/**
 * tests/dashboardMenuIdentity.test.js
 * 
 * Verifies read-only dashboard endpoints for Phase 2 Shared Menu Identity Mapping.
 */
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.NODE_ENV = "test";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");
const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");

const SharedMenuIdentity = require("../src/models/SharedMenuIdentity");
const MenuIdentityLink = require("../src/models/MenuIdentityLink");
const MenuProduct = require("../src/models/MenuProduct");
const MenuCategory = require("../src/models/MenuCategory");

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

// function dashboardAuth replaced by helper

(async function run() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  const app = createApp();
  const api = request(app);

  const { headers: adminHeaders } = await dashboardAuth("admin");
  const { headers: kitchenHeaders } = await dashboardAuth("kitchen");
  const { headers: superadminHeaders } = await dashboardAuth("superadmin");

  try {
    // 1. Data Setup
    const cat = await MenuCategory.create({
      name: { en: "Category 1", ar: "تصنيف 1" },
      key: "cat1",
      slug: "cat1",
    });

    const prod = await MenuProduct.create({
      categoryId: cat._id,
      key: "prod1",
      name: { en: "Product 1", ar: "منتج 1" },
      priceHalala: 1000,
      isActive: true,
    });

    const identity = await SharedMenuIdentity.create({
      key: "canonical_p1",
      type: "product",
      name: { en: "Canonical Product 1", ar: "المنتج الموحد 1" },
    });

    const link = await MenuIdentityLink.create({
      identityId: identity._id,
      channel: "one_time",
      sourceModel: "MenuProduct",
      sourceId: prod._id,
      confidence: "exact",
      status: "confirmed",
    });

    // 2. Auth Tests
    await test("Auth - Returns 401 if token is missing", async () => {
      const res = await api.get("/api/dashboard/menu-identities");
      assert.strictEqual(res.status, 401);
    });

    await test("Auth - Returns 403 if role is not admin/superadmin", async () => {
      const res = await api.get("/api/dashboard/menu-identities").set(kitchenHeaders);
      assert.strictEqual(res.status, 403);
    });

    await test("Auth - Returns 200 for admin", async () => {
      const res = await api.get("/api/dashboard/menu-identities").set(adminHeaders);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, true);
    });

    await test("Auth - Returns 200 for superadmin", async () => {
      const res = await api.get("/api/dashboard/menu-identities").set(superadminHeaders);
      assert.strictEqual(res.status, 200);
    });

    // 3. List/Detail Tests
    await test("GET /api/dashboard/menu-identities returns list with pagination", async () => {
      const res = await api.get("/api/dashboard/menu-identities").set(adminHeaders);
      assert.strictEqual(res.status, 200);
      assert(Array.isArray(res.body.data));
      assert.strictEqual(res.body.data.length, 1);
      assert.strictEqual(res.body.data[0].key, "canonical_p1");
      assert.ok(res.body.meta);
    });

    await test("GET /api/dashboard/menu-identities/:id returns detail", async () => {
      const res = await api.get(`/api/dashboard/menu-identities/${identity._id}`).set(adminHeaders);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.key, "canonical_p1");
    });

    await test("GET /api/dashboard/menu-identities/:id/links returns links with source summary", async () => {
      const res = await api.get(`/api/dashboard/menu-identities/${identity._id}/links`).set(adminHeaders);
      assert.strictEqual(res.status, 200);
      assert(Array.isArray(res.body.data));
      assert.strictEqual(res.body.data.length, 1);
      assert.strictEqual(res.body.data[0].sourceModel, "MenuProduct");
      assert.strictEqual(res.body.data[0].sourceDisplayName, "Product 1");
    });

    await test("GET /api/dashboard/menu-identity-links returns global list", async () => {
      const res = await api.get("/api/dashboard/menu-identity-links").set(adminHeaders);
      assert.strictEqual(res.status, 200);
      assert(Array.isArray(res.body.data));
      assert.strictEqual(res.body.data.length, 1);
      assert.strictEqual(res.body.data[0].sourceDisplayName, "Product 1");
    });

    await test("Filters work in list all links", async () => {
      const res = await api.get("/api/dashboard/menu-identity-links?channel=subscription").set(adminHeaders);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.length, 0);
    });

  } finally {
    await mongoose.disconnect();
    await mongoServer.stop();
    console.log(`\nResults: ${results.passed} passed, ${results.failed} failed`);
    if (results.failed > 0) process.exit(1);
  }
})();
