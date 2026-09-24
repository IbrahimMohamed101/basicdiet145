process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const AppContent = require("../src/models/AppContent");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`app_version_contract_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

async function main() {
  await connect();

  try {
    const app = createApp();
    const api = request(app);
    const { headers } = await dashboardAuth("admin", "app-version");

    let res = await api.get("/api/content/app-version?platform=android&version=1.0.0");
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.latestVersion, "1.0.0");
    assert.strictEqual(res.body.data.updateAvailable, false);
    assert.strictEqual(res.body.data.updateRequired, false);

    res = await api
      .put("/api/admin/content/app-version")
      .set(headers)
      .send({
        platform: "android",
        latestVersion: "1.2.0",
        minimumVersion: "1.1.0",
        forceUpdate: false,
        updateUrl: "https://play.google.com/store/apps/details?id=com.basicdiet",
        messageAr: "يوجد تحديث جديد للتطبيق.",
        messageEn: "A new app update is available.",
      });

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.key, "app_version");
    assert.strictEqual(res.body.data.locale, "android");
    assert.strictEqual(res.body.data.content.latestVersion, "1.2.0");
    assert.strictEqual(res.body.data.content.minimumVersion, "1.1.0");

    res = await api.get("/api/content/app-version?platform=android&version=1.0.0");
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.updateAvailable, true);
    assert.strictEqual(res.body.data.updateRequired, true);
    assert.strictEqual(res.body.data.forceUpdate, false);
    assert.strictEqual(res.body.data.updateUrl.includes("play.google.com"), true);

    res = await api.get("/api/content/app-version?platform=android&version=1.1.0");
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.updateAvailable, true);
    assert.strictEqual(res.body.data.updateRequired, false);

    res = await api.get("/api/content/app-version?platform=android&version=1.2.0");
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.updateAvailable, false);
    assert.strictEqual(res.body.data.updateRequired, false);

    res = await api
      .put("/api/admin/content/app-version")
      .set(headers)
      .send({
        platform: "android",
        latestVersion: "1.3.0",
        minimumVersion: "1.2.0",
        forceUpdate: true,
        updateUrl: "https://play.google.com/store/apps/details?id=com.basicdiet",
      });

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));

    res = await api.get("/api/content/app-version?platform=android&version=1.2.0");
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.updateAvailable, true);
    assert.strictEqual(res.body.data.updateRequired, true);
    assert.strictEqual(res.body.data.forceUpdate, true);

    res = await api.get("/api/content/app-version?platform=ios&version=1.0.0");
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.latestVersion, "1.0.0");
    assert.strictEqual(res.body.data.updateAvailable, false);
    assert.strictEqual(res.body.data.updateRequired, false);

    assert.strictEqual(await AppContent.countDocuments({ key: "app_version", locale: "android", isActive: true }), 1);

    console.log("appVersionContract.test.js passed");
  } finally {
    await disconnect();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
