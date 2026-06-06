process.env.NODE_ENV = "test";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "app-test-secret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const DashboardUser = require("../src/models/DashboardUser");
const {
  compareDashboardPassword,
  hashDashboardPassword,
} = require("../src/services/dashboardPasswordService");
const {
  createDashboardAccount,
  verifyDashboardLoginCompatibility,
} = require("../scripts/create_default_accounts");

const TEST_DB_NAME = `default_accounts_bootstrap_${Date.now()}`;

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: TEST_DB_NAME },
  });
  const uri = mongoServer.getUri(TEST_DB_NAME);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
}

async function run() {
  await connect();
  try {
    const account = {
      label: "Sync Test Admin",
      email: "sync-admin@basicdiet.com",
      password: "Admin@123456",
      role: "admin",
    };

    const created = await createDashboardAccount(account);
    assert.strictEqual(created.status, "created");
    assert.strictEqual((await verifyDashboardLoginCompatibility(created)).ok, true);

    const firstHash = created.user.passwordHash;
    const skipped = await createDashboardAccount({
      ...account,
      password: "Admin@654321",
      role: "kitchen",
    });
    assert.strictEqual(skipped.status, "skipped");

    const afterSkipped = await DashboardUser.findOne({ email: account.email });
    assert.strictEqual(afterSkipped.role, "admin");
    assert.strictEqual(afterSkipped.passwordHash, firstHash);
    assert.strictEqual(await compareDashboardPassword("Admin@123456", afterSkipped.passwordHash), true);

    await DashboardUser.updateOne(
      { email: account.email },
      {
        $set: {
          passwordHash: await hashDashboardPassword("OldPass@123456"),
          role: "kitchen",
          isActive: false,
        },
      }
    );

    const updated = await createDashboardAccount(account, { sync: true });
    assert.strictEqual(updated.status, "updated");
    assert.strictEqual(updated.role, "admin");
    assert.strictEqual(updated.user.isActive, true);
    assert.strictEqual(await compareDashboardPassword(account.password, updated.user.passwordHash), true);
    assert.strictEqual((await verifyDashboardLoginCompatibility(updated)).ok, true);
  } finally {
    await disconnect();
  }
}

run()
  .then(() => {
    console.log("defaultAccountsBootstrap.test.js passed");
  })
  .catch(async (err) => {
    console.error(err);
    await disconnect();
    process.exit(1);
  });
