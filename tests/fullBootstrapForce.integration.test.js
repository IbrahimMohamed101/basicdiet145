process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "full-bootstrap-test-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "full-bootstrap-dashboard-secret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Addon = require("../src/models/Addon");
const AddonPlanPrice = require("../src/models/AddonPlanPrice");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const Plan = require("../src/models/Plan");
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");
const Setting = require("../src/models/Setting");
const Zone = require("../src/models/Zone");
const source = require("../scripts/bootstrap/fixtures/menu-workbook-source");
const { BOOTSTRAP_MARKER_KEY, runFullBootstrap } = require("../scripts/bootstrap/full-bootstrap");

const quietLog = { log() {}, info() {}, warn() {}, error() {} };
let mongoServer;

async function run() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`full_bootstrap_force_test_${Date.now()}`);
  process.env.MONGO_URI_TEST = uri;
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;

  try {
    const first = await runFullBootstrap({ includeAccounts: false, log: quietLog });
    assert.strictEqual(first.forced, true);
    assert.strictEqual(first.state.status, "completed");
    assert.strictEqual(first.state.mode, "guarded-full-rebuild");
    assert(first.verification.readiness.every((row) => row.status !== "FAIL" && row.status !== "ERROR"));

    assert.strictEqual(
      await MenuCategory.countDocuments({ isActive: true, isVisible: true, isAvailable: true, publishedAt: { $ne: null } }),
      source.metadata.categoryCount
    );
    assert.strictEqual(
      await MenuProduct.countDocuments({ key: { $in: source.products.map((row) => row.key) } }),
      source.metadata.productCount
    );
    assert.strictEqual(await PremiumUpgradeConfig.countDocuments({ status: "active", isEnabled: true }), 4);
    assert((await Plan.countDocuments({ isActive: true })) >= 3);
    assert.strictEqual(await Addon.countDocuments({ kind: "plan", isActive: true, isArchived: false }), 3);
    assert.strictEqual(await AddonPlanPrice.countDocuments({ isActive: true }), 9);
    assert((await Zone.countDocuments({ isActive: true })) > 0);

    const requiredSettings = [
      "vat_percentage",
      "restaurant_name",
      "restaurant_address",
      "restaurant_open_time",
      "restaurant_close_time",
      "restaurant_hours",
      "pickup_locations",
    ];
    for (const key of requiredSettings) {
      assert(await Setting.exists({ key }), `missing setting ${key}`);
    }
    const vat = await Setting.findOne({ key: "vat_percentage" }).lean();
    assert.strictEqual(vat.value, 15);

    const marker = await Setting.findOne({ key: BOOTSTRAP_MARKER_KEY }).lean();
    assert.strictEqual(marker.value.status, "completed");
    assert.strictEqual(marker.value.mode, "guarded-full-rebuild");

    const second = await runFullBootstrap({ includeAccounts: false, log: quietLog });
    assert.strictEqual(second.forced, true);
    assert.strictEqual(second.state.status, "completed");
    assert(second.verification.readiness.every((row) => row.status !== "FAIL" && row.status !== "ERROR"));
    assert.strictEqual(await PremiumUpgradeConfig.countDocuments({ status: "active", isEnabled: true }), 4);

    console.log("fullBootstrapForce.integration.test.js passed");
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.connection.dropDatabase();
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }
}

run().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  try { if (mongoose.connection.readyState !== 0) await mongoose.disconnect(); } catch (_error) {}
  try { if (mongoServer) await mongoServer.stop(); } catch (_error) {}
  process.exit(1);
});
