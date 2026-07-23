process.env.NODE_ENV = process.env.NODE_ENV || "test";

const assert = require("assert");

const {
  assertSubscriptionPlanRows,
  buildSubscriptionPlanRows,
  countNestedPricePoints,
  parseArgs: parsePlanArgs,
} = require("../scripts/bootstrap/seed-subscription-plans");
const {
  BOOTSTRAP_KEY,
  isBootstrapOwned,
} = require("../scripts/bootstrap/seed-meal-builder");
const {
  BOOTSTRAP_MARKER_KEY,
  assertInitialImportOnly,
  inspectManagedData,
  parseArgs: parseBootstrapArgs,
  readBootstrapState,
  runBootstrap,
  writeBootstrapState,
} = require("../scripts/bootstrap");

function testPlansAcceptDynamicCounts() {
  const customMatrix = {
    5: {
      120: { 1: 1000 },
    },
    14: {
      150: { 2: 2500, 4: 4500 },
      250: { 3: 5000 },
    },
    45: {
      300: { 1: 7000, 2: 12000, 6: 30000 },
    },
    60: {
      400: { 2: 40000 },
    },
  };

  const rows = buildSubscriptionPlanRows(customMatrix);
  const result = assertSubscriptionPlanRows(rows);

  assert.strictEqual(rows.length, 4, "arbitrary initial plan count is accepted");
  assert.strictEqual(result.planCount, 4);
  assert.strictEqual(result.nestedPricePoints, 8, "arbitrary nested price-point count is derived from data");
  assert.strictEqual(countNestedPricePoints(rows), 8);
}

function testPlanValidationIsStructural() {
  const validRows = buildSubscriptionPlanRows({
    10: {
      175: { 2: 12345 },
    },
  });
  assert.doesNotThrow(() => assertSubscriptionPlanRows(validRows));

  const duplicateMeals = JSON.parse(JSON.stringify(validRows));
  duplicateMeals[0].gramsOptions[0].mealsOptions.push({
    ...duplicateMeals[0].gramsOptions[0].mealsOptions[0],
  });
  assert.throws(
    () => assertSubscriptionPlanRows(duplicateMeals),
    /duplicate mealsPerDay/,
    "invalid structure still fails without enforcing a fixed count"
  );
}

function testFocusedPlanCleanupRequiresExplicitOptIn() {
  const previous = process.env.ALLOW_BOOTSTRAP_PLAN_CLEANUP;
  delete process.env.ALLOW_BOOTSTRAP_PLAN_CLEANUP;
  try {
    assert.deepStrictEqual(parsePlanArgs(["--sync"]), { sync: true, cleanupFlatPlans: false });
    assert.throws(
      () => parsePlanArgs(["--cleanup-legacy-plans"]),
      /ALLOW_BOOTSTRAP_PLAN_CLEANUP/,
      "focused maintenance must not silently deactivate plans"
    );
  } finally {
    if (previous === undefined) delete process.env.ALLOW_BOOTSTRAP_PLAN_CLEANUP;
    else process.env.ALLOW_BOOTSTRAP_PLAN_CLEANUP = previous;
  }
}

function testMealBuilderOwnershipProtection() {
  assert.strictEqual(isBootstrapOwned({
    source: "bootstrap",
    createdBySystem: true,
    bootstrapKey: BOOTSTRAP_KEY,
  }), true);

  assert.strictEqual(isBootstrapOwned({
    source: "dashboard",
    createdBySystem: false,
    bootstrapKey: BOOTSTRAP_KEY,
  }), false, "dashboard-owned config must be protected from bootstrap sync");

  assert.strictEqual(isBootstrapOwned({
    source: "bootstrap",
    createdBySystem: true,
    bootstrapKey: "another_seed",
  }), false, "a different bootstrap owner must not be overwritten");
}

function testTopLevelBootstrapIsInitialImportOnly() {
  const previousSync = process.env.BOOTSTRAP_SYNC;
  const previousAccountSync = process.env.ACCOUNT_BOOTSTRAP_SYNC;
  const previousMealBuilderSync = process.env.MEAL_BUILDER_BOOTSTRAP_SYNC;
  delete process.env.BOOTSTRAP_SYNC;
  delete process.env.ACCOUNT_BOOTSTRAP_SYNC;
  delete process.env.MEAL_BUILDER_BOOTSTRAP_SYNC;

  try {
    const safe = parseBootstrapArgs(["--dry-run"]);
    assert.strictEqual(safe.dryRun, true);
    assert.strictEqual(safe.requestedSync, false);
    assert.strictEqual(safe.requestedReset, false);
    assert.doesNotThrow(() => assertInitialImportOnly(safe));

    assert.throws(
      () => assertInitialImportOnly({ ...safe, requestedSync: true }),
      /initial import only/,
      "top-level bootstrap must never synchronize dashboard-owned rows"
    );
    assert.throws(
      () => assertInitialImportOnly({ ...safe, requestedReset: true }),
      /never resets/,
      "top-level bootstrap must never delete database rows"
    );
    assert.throws(
      () => assertInitialImportOnly({ ...safe, requestedAccountSync: true }),
      /never synchronizes existing accounts/,
      "top-level bootstrap must never overwrite account changes"
    );
    assert.throws(
      () => assertInitialImportOnly({ ...safe, requestedMealBuilderSync: true }),
      /never synchronizes an existing Meal Builder/,
      "top-level bootstrap must never overwrite dashboard Meal Builder data"
    );
  } finally {
    if (previousSync === undefined) delete process.env.BOOTSTRAP_SYNC;
    else process.env.BOOTSTRAP_SYNC = previousSync;
    if (previousAccountSync === undefined) delete process.env.ACCOUNT_BOOTSTRAP_SYNC;
    else process.env.ACCOUNT_BOOTSTRAP_SYNC = previousAccountSync;
    if (previousMealBuilderSync === undefined) delete process.env.MEAL_BUILDER_BOOTSTRAP_SYNC;
    else process.env.MEAL_BUILDER_BOOTSTRAP_SYNC = previousMealBuilderSync;
  }
}

function createFakeSettingStore() {
  let document = null;
  return {
    model: {
      findOne(query) {
        return {
          lean: async () => (
            document && document.key === query.key ? JSON.parse(JSON.stringify(document)) : null
          ),
        };
      },
      async updateOne(query, update) {
        document = {
          key: query.key,
          value: JSON.parse(JSON.stringify(update.$set.value)),
          description: update.$set.description,
        };
        return { acknowledged: true };
      },
    },
    get: () => document,
  };
}

async function testBootstrapMarkerRoundTrip() {
  const store = createFakeSettingStore();
  assert.strictEqual(await readBootstrapState(store.model), null);
  await writeBootstrapState(store.model, "completed", { mode: "test" });
  const state = await readBootstrapState(store.model);
  assert.strictEqual(store.get().key, BOOTSTRAP_MARKER_KEY);
  assert.strictEqual(state.status, "completed");
  assert.strictEqual(state.mode, "test");
  assert.ok(state.completedAt);
}

async function testManagedDataInspectionIsStructural() {
  const summary = await inspectManagedData({
    MenuCategory: { countDocuments: async () => 2 },
    MenuProduct: { countDocuments: async () => 5 },
    Plan: { countDocuments: async () => 3 },
    Addon: { countDocuments: async () => 4 },
  });
  assert.deepStrictEqual(summary, {
    categories: 2,
    products: 5,
    plans: 3,
    addons: 4,
    total: 14,
  });
}

async function testCompletedImportCannotReapplySeedData() {
  const store = createFakeSettingStore();
  const calls = [];
  const connection = { readyState: 0 };
  const fakeMongoose = {
    connection,
    async connect() {
      connection.readyState = 1;
      calls.push("connect");
    },
    async disconnect() {
      connection.readyState = 0;
      calls.push("disconnect");
    },
  };
  const emptyModel = { countDocuments: async () => 0 };
  const dependencies = {
    mongoose: fakeMongoose,
    Setting: store.model,
    MenuCategory: emptyModel,
    MenuProduct: emptyModel,
    Plan: emptyModel,
    Addon: emptyModel,
    resolveMongoUri: () => "mongodb://bootstrap.test/initial",
    seedCatalog: async () => calls.push("catalog"),
    seedNewMenu: async () => calls.push("new-menu"),
    seedSubscriptionPlans: async () => calls.push("plans"),
    seedSubscriptionAddons: async () => calls.push("addons"),
    backfillPremiumUpgrades: async () => calls.push("premium"),
    seedMealBuilderConfig: async () => calls.push("meal-builder"),
    bootstrapDefaultAccounts: async () => calls.push("accounts"),
    verifyBootstrapStructure: async () => {
      calls.push("verify");
      return { ok: true, summary: { errors: 0, warnings: 0 } };
    },
  };
  const log = { log() {}, warn() {}, error() {} };

  const first = await runBootstrap({
    argv: [],
    dependencies,
    log,
    includeAccounts: false,
    includeMealBuilder: false,
  });
  assert.strictEqual(first.skipped, false);
  assert.deepStrictEqual(
    calls.filter((item) => ["catalog", "new-menu", "plans", "addons", "premium", "verify"].includes(item)),
    ["catalog", "new-menu", "plans", "addons", "premium", "verify"]
  );

  const seedCallCount = calls.filter((item) => ["catalog", "new-menu", "plans", "addons", "premium", "verify"].includes(item)).length;
  const second = await runBootstrap({
    argv: [],
    dependencies,
    log,
    includeAccounts: false,
    includeMealBuilder: false,
  });
  assert.strictEqual(second.skipped, true);
  assert.strictEqual(
    calls.filter((item) => ["catalog", "new-menu", "plans", "addons", "premium", "verify"].includes(item)).length,
    seedCallCount,
    "a completed import must not recreate, update, or verify seeded rows again"
  );
}

async function run() {
  testPlansAcceptDynamicCounts();
  testPlanValidationIsStructural();
  testFocusedPlanCleanupRequiresExplicitOptIn();
  testMealBuilderOwnershipProtection();
  testTopLevelBootstrapIsInitialImportOnly();
  await testBootstrapMarkerRoundTrip();
  await testManagedDataInspectionIsStructural();
  await testCompletedImportCannotReapplySeedData();
  console.log("✅ bootstrap initial-data semantics tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
