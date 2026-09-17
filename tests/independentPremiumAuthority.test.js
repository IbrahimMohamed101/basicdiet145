process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");
const authority = require("../src/services/installIndependentPremiumAuthority");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`independent_premium_authority_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

async function run() {
  await connect();
  try {
    authority.installIndependentPremiumAuthority();
    const now = new Date();
    const group = await MenuOptionGroup.create({
      key: "independent_premium_options",
      name: { ar: "خيارات مميزة", en: "Premium Options" },
      publishedAt: now,
    });
    const option = await MenuOption.create({
      groupId: group._id,
      key: "independent_salmon",
      name: { ar: "سالمون", en: "Salmon" },
      availableFor: ["one_time", "subscription"],
      publishedAt: now,
    });

    const sources = await authority.independentGetSources({
      kind: "option",
      status: "active",
      page: 1,
      limit: 20,
    });
    assert.strictEqual(sources.meta.total, 1);
    assert.strictEqual(sources.data[0].sourceId, String(option._id));
    assert.strictEqual(sources.data[0].selectable, true);
    assert.strictEqual(sources.data[0].relationRequired, false);
    assert.strictEqual(sources.data[0].relationId, null);

    const created = await authority.independentCreateConfig({
      kind: "option",
      sourceId: String(option._id),
      upgradeDeltaHalala: 1500,
      currency: "SAR",
      isActive: true,
      isVisible: true,
      sortOrder: 1,
    });
    assert.strictEqual(created.health, "ready");
    assert.strictEqual(created.source.productId, null);
    assert.strictEqual(created.source.groupId, String(group._id));

    const stored = await PremiumUpgradeConfig.findOne({
      premiumKey: "independent_salmon",
    }).lean();
    assert.ok(stored);
    assert.strictEqual(stored.sourceProductId, null);
    assert.strictEqual(String(stored.sourceGroupId), String(group._id));

    const resolved = await authority.independentResolvePremiumUpgrade(
      "independent_salmon"
    );
    assert.strictEqual(resolved.priceHalala, 1500);
    assert.strictEqual(String(resolved.sourceId), String(option._id));
    assert.strictEqual(resolved.sourceProductId, null);

    const readiness = await authority.independentGetReadiness();
    assert.strictEqual(readiness.isReady, true);
    assert.strictEqual(readiness.diagnostics.invalidRelations, 0);

    console.log("independent premium authority passed");
  } finally {
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error);
  await disconnect().catch(() => {});
  process.exit(1);
});
