"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { getPosRuntimeStatus, requireFinancialStagingWrites } =
  require("../src/services/pos/financialRuntime");
function conn(hello) {
  return { name: "test", host: "mongodb.railway.internal", readyState: 1,
    db: { admin: () => ({ command: async () => hello }) } };
}
test("Production without explicit activation is disabled without connecting to Mongo", async () => {
  let commandCalled = false;
  const result = await getPosRuntimeStatus({
    env: { NODE_ENV: "production" },
    connection: { ...conn({}), db: { admin: () => ({ command: async () => {commandCalled = true;} }) } },
  });
  assert.equal(result.reason, "POS_DISABLED");
  assert.equal(result.enabled, false);
  assert.equal(commandCalled, false);
});
test("explicit Production activation without rs0 PRIMARY stays disabled", async () => {
  for (const hello of [{ isWritablePrimary: true }, { setName: "rs0", isWritablePrimary: false },
    { setName: "wrong", isWritablePrimary: true }]) {
    const status = await getPosRuntimeStatus({
      env: { NODE_ENV: "production", POS_PRODUCTION_ENABLED: "true" },
      connection: conn(hello),
    });
    assert.equal(status.reason, "POS_DISABLED");
  }
});
test("explicit Production activation and live PRIMARY rs0 enables tax POS only for correct database/host", async () => {
  const enabled = await getPosRuntimeStatus({
    env: { NODE_ENV: "production", POS_PRODUCTION_ENABLED: "true" },
    connection: conn({ setName: "rs0", isWritablePrimary: true }),
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.documentType, "SIMPLIFIED_TAX_INVOICE");
  assert.equal(enabled.financialWritesEnabled, true);
  const wrongHost = await getPosRuntimeStatus({
    env: { NODE_ENV: "production", POS_PRODUCTION_ENABLED: "true" },
    connection: { ...conn({ setName: "rs0", isWritablePrimary: true }), host: "staging.railway.internal" },
  });
  assert.equal(wrongHost.enabled, false);
});
test("Staging remains exactly isolated; Production flag cannot relax its own write toggle", async () => {
  const env = { POS_STAGING_ISOLATED: "true",
    RAILWAY_ENVIRONMENT_ID: "90700265-e775-4075-a99c-8d04508a7d98",
    RAILWAY_SERVICE_ID: "9a6d629e-c9f4-4687-bf83-613011606018",
    POS_STAGE_F_WRITES_ENABLED: "false", POS_PRODUCTION_ENABLED: "true" };
  const connection = { name: "basicdiet_pos_staging_test", host: "mongodb-qxhu.railway.internal" };
  const disabled = await getPosRuntimeStatus({ env, connection });
  assert.equal(disabled.environment, "staging");
  assert.equal(disabled.financialWritesEnabled, false);
  assert.equal(disabled.documentType, "STAGING_TEST_NON_TAX");
  assert.equal((await getPosRuntimeStatus({
    env: { ...env, POS_STAGE_F_WRITES_ENABLED: "true" }, connection,
  })).financialWritesEnabled, true);
  assert.equal((await getPosRuntimeStatus({
    env: { ...env, POS_STAGE_F_WRITES_ENABLED: "true" },
    connection: { ...connection, host: "mongodb.railway.internal" },
  })).enabled, false);
});
test("Production guard default rejects writes as HTTP 403 POS_DISABLED", async () => {
  const original = process.env.POS_PRODUCTION_ENABLED;
  process.env.POS_PRODUCTION_ENABLED = "false";
  try {
    await assert.rejects(requireFinancialStagingWrites(), (error) =>
      error.status === 403 && error.code === "POS_DISABLED");
  } finally {
    if (original === undefined) delete process.env.POS_PRODUCTION_ENABLED;
    else process.env.POS_PRODUCTION_ENABLED = original;
  }
});


test("D-098: Production enabled catalog draft/publish/history permissions match Staging, without seeding", async (t) => {
  const router = require("../src/routes/dashboardPosCatalog");
  const PosCatalog = require("../src/models/PosCatalog");
  const { saveDraft } = require("../src/services/pos/catalogService");
  const oldNode = process.env.NODE_ENV, oldFlag = process.env.POS_PRODUCTION_ENABLED;
  process.env.NODE_ENV = "production";
  process.env.POS_PRODUCTION_ENABLED = "true";
  try {
    const managementEndpoints = [
      ["get", "/catalog/manage"],
      ["get", "/catalog/revisions"],
      ["get", "/catalog/revisions/:revision"],
      ["put", "/catalog/draft"],
      ["post", "/catalog/publish"],
    ];
    for (const [method, endpoint] of managementEndpoints) {
      const layer = router.stack.find(({ route }) =>
        route?.path === endpoint && route.methods[method])?.route.stack[0];
      assert.ok(layer, `missing management route ${method} ${endpoint}`);
      for (const role of ["admin", "superadmin", "restaurant", "cashier", "kitchen", "courier"]) {
        let status = 200, allowed = false, payload;
        layer.handle({ dashboardUserRole: role, method: method.toUpperCase() }, {
          status(code) { status = code; return this; },
          json(x) { payload = x; return this; },
        }, () => { allowed = true; });
        if (["kitchen", "courier"].includes(role)) {
          assert.equal(status, 403, `${method} ${endpoint}: ${role}`);
          assert.equal(payload.error.code, "FORBIDDEN");
          assert.equal(allowed, false);
        } else {
          assert.equal(allowed, true, `${method} ${endpoint}: ${role}`);
        }
      }
    }
    let inserted = null;
    t.mock.method(PosCatalog, "create", async (payload) => {
      inserted = payload;
      return { toObject: () => payload };
    });
    const draft = { channels: [{ id: "restaurant", label: "مطعم" }],
      categories: [{ id: "meal", label: "وجبات" }], products: [] };
    const result = await saveDraft(0, draft, "admin-id");
    assert.equal(result.revision, 1);
    assert.equal(result.publishedRevision, 0);
    assert.deepEqual(inserted.published.products, []);
    assert.deepEqual(inserted.published.categories, []);
    assert.deepEqual(inserted.draft, draft);
  } finally {
    if (oldNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNode;
    if (oldFlag === undefined) delete process.env.POS_PRODUCTION_ENABLED;
    else process.env.POS_PRODUCTION_ENABLED = oldFlag;
  }
});


test("D-098: both branch operator roles can persist a first Production draft and publish an immutable revision", async (t) => {
  const mongoose = require("mongoose");
  const PosCatalog = require("../src/models/PosCatalog");
  const PosCatalogRevision = require("../src/models/PosCatalogRevision");
  const PosAudit = require("../src/models/PosAudit");
  const { saveDraft, publishDraft } = require("../src/services/pos/catalogService");
  const savedActors = [], publishedActors = [], snapshots = [];
  const prevNode = process.env.NODE_ENV, prevFlag = process.env.POS_PRODUCTION_ENABLED;
  process.env.NODE_ENV = "production";
  process.env.POS_PRODUCTION_ENABLED = "true";
  t.after(() => {
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    if (prevFlag === undefined) delete process.env.POS_PRODUCTION_ENABLED;
    else process.env.POS_PRODUCTION_ENABLED = prevFlag;
  });

  let currentDraft;
  t.mock.method(PosCatalog, "create", async (data) => {
    savedActors.push(data.draftSavedBy);
    currentDraft = data.draft;
    return { toObject: () => data };
  });
  t.mock.method(mongoose, "startSession", async () => ({
    withTransaction: async (callback) => callback(),
    endSession: async () => {},
  }));
  t.mock.method(PosCatalog, "findOne", () => ({
    session: () => ({
      lean: async () => ({
        revision: 1, publishedRevision: 0, draft: currentDraft,
        published: { channels: [], categories: [], products: [] },
      }),
    }),
  }));
  t.mock.method(PosCatalog, "findOneAndUpdate", (_query, update) => ({
    lean: async () => ({
      revision: 2, publishedRevision: 2, published: update.$set.published,
      draft: null, publishedBy: update.$set.publishedBy,
    }),
  }));
  t.mock.method(PosCatalogRevision, "create", async (docs) => {
    snapshots.push(...docs);
    return docs;
  });
  t.mock.method(PosAudit, "create", async (docs) => {
    publishedActors.push(...docs.map(doc => doc.actor));
    return docs;
  });

  for (const role of ["cashier", "restaurant"]) {
    const draft = { channels: [{ id: "restaurant", label: "مطعم" }],
      categories: [{ id: "meal", label: "وجبات" }], products: [] };
    const saved = await saveDraft(0, draft, role);
    assert.equal(saved.revision, 1);
    assert.equal(saved.publishedRevision, 0);
    assert.deepEqual(saved.draft, draft);
    const published = await publishDraft(1, role);
    assert.equal(published.revision, 2);
    assert.equal(published.publishedRevision, 2);
    assert.equal(published.publishedBy, role);
    assert.deepEqual(published.published, draft);
  }
  assert.deepEqual(savedActors, ["cashier", "restaurant"]);
  assert.deepEqual(publishedActors, ["cashier", "restaurant"]);
  assert.equal(snapshots.length, 2);
  for (const snapshot of snapshots) {
    assert.equal(snapshot.revision, 2);
    assert.equal(typeof snapshot.contentSha256, "string");
    assert.equal(snapshot.contentSha256.length, 64);
  }
});
