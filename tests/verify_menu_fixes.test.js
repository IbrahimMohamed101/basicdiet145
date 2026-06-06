process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");
const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");

const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const MenuVersion = require("../src/models/MenuVersion");

const TEST_TAG = `fix-verify-${Date.now()}`;
let mongoServer;
let adminHeaders;
let app;

async function setup() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
  app = createApp();
  ({ headers: adminHeaders } = await dashboardAuth("admin", TEST_TAG));
}

async function teardown() {
  await mongoose.disconnect();
  await mongoServer.stop();
}

async function runTests() {
  console.log("Starting Menu Fix Verification Tests...");
  
  try {
    await setup();

    // --- TEST A: Rollback Safety ---
    console.log("Running Test A: Rollback Safety...");
    
    // 1. Seed initial state
    let res = await request(app).post("/api/dashboard/menu/categories").set(adminHeaders).send({
      key: "cat_1", name: { en: "Category 1" }
    });
    const catId = res.body.data.id;

    res = await request(app).post("/api/dashboard/menu/products").set(adminHeaders).send({
      categoryId: catId, key: "prod_1", name: { en: "Product 1" }, priceHalala: 1000, itemType: "product"
    });
    const prodId = res.body.data.id;

    // Publish V1
    res = await request(app).post("/api/dashboard/menu/publish").set(adminHeaders).send({ notes: "V1" });
    const v1Id = res.body.data.id;

    // 2. Modify state
    await request(app).patch(`/api/dashboard/menu/products/${prodId}`).set(adminHeaders).send({ priceHalala: 2000 });

    // Publish V2
    res = await request(app).post("/api/dashboard/menu/publish").set(adminHeaders).send({ notes: "V2" });
    const v2Id = res.body.data.id;

    // 3. Try rollback without confirm
    res = await request(app).post(`/api/dashboard/menu/rollback/${v1Id}`).set(adminHeaders).send({});
    assert.strictEqual(res.status, 400, "Rollback should fail without confirm");
    assert.strictEqual(res.body.error.code, "ROLLBACK_CONFIRMATION_REQUIRED");

    // 4. Rollback with confirm
    const rollbackRes = await request(app).post(`/api/dashboard/menu/rollback/${v1Id}`).set(adminHeaders).send({ confirm: true });
    console.log("Rollback response:", JSON.stringify(rollbackRes.body, null, 2));
    assert.strictEqual(rollbackRes.status, 200, "Rollback should succeed with confirm");
    assert.strictEqual(rollbackRes.body.success, true);
    assert(rollbackRes.body.restoredVersion, "Should return restoredVersion");
    assert(rollbackRes.body.backupVersion, "Should return backupVersion");
    assert.strictEqual(rollbackRes.body.data.rollback.restoredFrom, "dashboard_catalog_snapshot");

    // 5. Verify price is restored
    res = await request(app).get(`/api/dashboard/menu/products/${prodId}`).set(adminHeaders);
    // Note: rollback logic in service restores publishedAt and isActive. 
    // Wait, let's check if my service rollback actually updates the price.
    // Looking at menuCatalogService.js:989: priceHalala: prod.priceHalala (from snapshot)
    assert.strictEqual(res.body.data.product.priceHalala, 1000, "Price should be restored to V1 value");

    // 6. Verify versions
    const body = rollbackRes.body.data || rollbackRes.body;
    const backupId = body.backupVersion;
    const restoredId = body.restoredVersion;
    
    const backupV = await MenuVersion.findOne({ _id: new mongoose.Types.ObjectId(backupId) });
    const restoredV = await MenuVersion.findOne({ _id: new mongoose.Types.ObjectId(restoredId) });
    
    assert(backupV, "Backup version should exist in DB");
    assert(restoredV, "Restored version should exist in DB");
    
    assert(backupV.notes.includes("Auto-snapshot before rollback"), "Backup version notes");
    assert(restoredV.notes.includes("Rollback to version"), "Restored version notes");

    console.log("✅ Test A passed");

    // --- TEST B: Option Price Isolation ---
    console.log("Running Test B: Option Price Isolation...");

    // 1. Setup global group and option
    res = await request(app).post("/api/dashboard/menu/option-groups").set(adminHeaders).send({
      key: "group_1", name: { en: "Group 1" }
    });
    const groupId = res.body.data.id;

    res = await request(app).post("/api/dashboard/menu/options").set(adminHeaders).send({
      groupId, key: "opt_1", name: { en: "Global Option" }, extraPriceHalala: 500
    });
    const optionId = res.body.data.id;

    // 2. Link to two products
    res = await request(app).post("/api/dashboard/menu/products").set(adminHeaders).send({
      categoryId: catId, key: "prod_2", name: { en: "Product 2" }, priceHalala: 1000, itemType: "product"
    });
    const prod2Id = res.body.data.id;

    await request(app).post(`/api/dashboard/menu/products/${prodId}/option-groups`).set(adminHeaders).send({
      groupId, minSelections: 0, maxSelections: 1
    });

    await request(app).post(`/api/dashboard/menu/products/${prod2Id}/option-groups`).set(adminHeaders).send({
      groupId, minSelections: 0, maxSelections: 1
    });

    // 3. Update option for prod_1 only
    res = await request(app).patch(`/api/dashboard/menu/products/${prodId}/option-groups/${groupId}/options/${optionId}`).set(adminHeaders).send({
      extraPriceHalala: 1500
    });
    assert.strictEqual(res.status, 200, "Update per-product option should succeed");

    // 4. Verify isolation
    // Prod 1 option relation
    const rel1 = await ProductGroupOption.findOne({ productId: prodId, optionId });
    assert.strictEqual(rel1.extraPriceHalala, 1500, "Prod 1 specific price updated");

    // Prod 2 option relation
    const rel2 = await ProductGroupOption.findOne({ productId: prod2Id, optionId });
    assert.strictEqual(rel2.extraPriceHalala, null, "Prod 2 specific price remains null (inherited)");

    // Global option
    const globalOpt = await MenuOption.findById(optionId);
    assert.strictEqual(globalOpt.extraPriceHalala, 500, "Global option price unchanged");

    // 5. Try updating restricted field
    res = await request(app).patch(`/api/dashboard/menu/products/${prodId}/option-groups/${groupId}/options/${optionId}`).set(adminHeaders).send({
      premiumKey: "some_key"
    });
    assert.strictEqual(res.status, 400, "Updating premiumKey via product endpoint should fail");
    assert.strictEqual(res.body.error.code, "MENU_VALIDATION_ERROR");
    assert(res.body.error.message.includes("غير مسموح بتعديلها هنا"), "Arabic error message check");

    console.log("✅ Test B passed");

    // --- TEST C: Duplicate Safety ---
    console.log("Running Test C: Duplicate Safety...");

    // 1. Duplicate product twice
    const dup1Res = await request(app).post(`/api/dashboard/menu/products/${prodId}/duplicate`).set(adminHeaders);
    const dup2Res = await request(app).post(`/api/dashboard/menu/products/${prodId}/duplicate`).set(adminHeaders);

    assert.strictEqual(dup1Res.status, 201);
    assert.strictEqual(dup2Res.status, 201);
    
    assert.notStrictEqual(dup1Res.body.data.key, dup2Res.body.data.key, "Duplicate keys must be unique");
    assert(dup1Res.body.data.key.includes("_copy"), "Key should include _copy");
    assert(!dup1Res.body.data.key.includes("$"), "Key should not include invalid $ separator");
    assert(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(dup1Res.body.data.key), "Duplicate key should be valid snake_case");
    assert.strictEqual(dup1Res.body.data.isActive, false, "Duplicate should be inactive");

    // 2. Test 409 on forced collision (if we could easily)
    // We can't easily force an E11000 without mocking or very fast parallel calls.
    // But we verified the key format.

    console.log("✅ Test C passed");

  } catch (err) {
    console.error("Test failed!");
    console.error(err);
    process.exit(1);
  } finally {
    await teardown();
  }
}

runTests();
