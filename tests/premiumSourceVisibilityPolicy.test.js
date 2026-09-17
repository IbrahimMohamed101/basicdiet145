process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const premiumService = require("../src/services/subscription/premiumUpgradeConfigService");

require("../src/services/installIndependentPremiumAuthoring");
require("../src/services/installPremiumSourceVisibilityPolicy");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`premium_source_visibility_${Date.now()}`);
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
    const now = new Date();
    const group = await MenuOptionGroup.create({
      key: "fresh_admin_group",
      name: { ar: "مجموعة جديدة", en: "Fresh Admin Group" },
      publishedAt: now,
    });

    await MenuOption.insertMany([
      {
        groupId: group._id,
        key: "active_unlinked_option",
        name: { ar: "خيار نشط غير مربوط", en: "Active Unlinked Option" },
        availableFor: ["subscription"],
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: now,
      },
      {
        groupId: group._id,
        key: "inactive_unlinked_option",
        name: { ar: "خيار غير نشط", en: "Inactive Option" },
        availableFor: ["subscription"],
        isActive: false,
        isVisible: true,
        isAvailable: true,
        publishedAt: now,
      },
    ]);

    const active = await premiumService.getSources({
      kind: "option",
      status: "active",
      page: 1,
      limit: 20,
    });

    assert.strictEqual(active.status, true);
    assert.strictEqual(active.meta.total, 1);
    assert.strictEqual(active.data[0].key, "active_unlinked_option");
    assert.strictEqual(active.data[0].selectable, false);
    assert.strictEqual(active.data[0].issueCode, "SOURCE_RELATION_MISSING");
    assert.strictEqual(active.data[0].sourceLifecycleStatus, "active");

    const all = await premiumService.getSources({
      kind: "option",
      status: "all",
      page: 1,
      limit: 20,
    });

    assert.strictEqual(all.meta.total, 2);
    assert.deepStrictEqual(
      new Set(all.data.map((row) => row.key)),
      new Set(["active_unlinked_option", "inactive_unlinked_option"])
    );

    console.log("premium source visibility policy passed");
  } finally {
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error);
  await disconnect().catch(() => {});
  process.exit(1);
});
