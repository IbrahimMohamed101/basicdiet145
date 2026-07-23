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
  BOOTSTRAP_VERSION,
  assertInitialImportOnly,
  inspectManagedData,
  parseArgs: parseBootstrapArgs,
  readBootstrapState,
  runBootstrap,
  writeBootstrapState,
} = require("../scripts/bootstrap");

function testPlansAcceptDynamicCounts() {
  const customMatrix = {
    5: { 120: { 1: 1000 } },
    14: { 150: { 2: 2500, 4: 4500 }, 250: { 3: 5000 } },
    45: { 300: { 1: 7000, 2: 12000, 6: 30000 } },
    60: { 400: { 2: 40000 } },
  };
  const rows = buildSubscriptionPlanRows(customMatrix);
  const result = assertSubscriptionPlanRows(rows);
  assert.strictEqual(rows.length, 4);
  assert.strictEqual(result.planCount, 4);
  assert.strictEqual(result.nestedPricePoints, 8);
  assert.strictEqual(countNestedPricePoints(rows), 8);
}

function testPlanValidationIsStructural() {
  const validRows = buildSubscriptionPlanRows({ 10: { 175: { 2: 12345 } } });
  assert.doesNotThrow(() => assertSubscriptionPlanRows(validRows));
  const duplicateMeals = JSON.parse(JSON.stringify(validRows));
  duplicateMeals[0].gramsOptions[0].mealsOptions.push({
    ...duplicateMeals[0].gramsOptions[0].mealsOptions[0],
  });
  assert.throws(() => assertSubscriptionPlanRows(duplicateMeals), /duplicate mealsPerDay/);
}

function testFocusedPlanCleanupRequiresExplicitOptIn() {
  const previous = process.env.ALLOW_BOOTSTRAP_PLAN_CLEANUP;
  delete process.env.ALLOW_BOOTSTRAP_PLAN_CLEANUP;
  try {
    assert.deepStrictEqual(parsePlanArgs(["--sync"]), { sync: true, cleanupFlatPlans: false });
    assert.throws(() => parsePlanArgs(["--cleanup-legacy-plans"]), /ALLOW_BOOTSTRAP_PLAN_CLEANUP/);
  } finally {
    if (previous === undefined) delete process.env.ALLOW_BOOTSTRAP_PLAN_CLEANUP;
    else process.env.ALLOW_BOOTSTRAP_PLAN_CLEANUP = previous;
  }
}

function testMealBuilderOwnershipProtection() {
  assert.strictEqual(isBootstrapOwned({ source: "bootstrap", createdBySystem: true, bootstrapKey: BOOTSTRAP_KEY }), true);
  assert.strictEqual(isBootstrapOwned({ source: "dashboard", createdBySystem: false, bootstrapKey: BOOTSTRAP_KEY }), false);
  assert.strictEqual(isBootstrapOwned({ source: "bootstrap", createdBySystem: true, bootstrapKey: "another_seed" }), false);
}

function testTopLevelBootstrapIsInitialImportOnly() {
  const previous = {
    sync: process.env.BOOTSTRAP_SYNC,
    accountSync: process.env.ACCOUNT_BOOTSTRAP_SYNC,
    mealBuilder: process.env.MEAL_BUILDER_BOOTSTRAP,
    mealBuilderSync: process.env.MEAL_BUILDER_BOOTSTRAP_SYNC,
  };
  delete process.env.BOOTSTRAP_SYNC;
  delete process.env.ACCOUNT_BOOTSTRAP_SYNC;
  delete process.env.MEAL_BUILDER_BOOTSTRAP;
  delete process.env.MEAL_BUILDER_BOOTSTRAP_SYNC;
  try {
    const safe = parseBootstrapArgs(["--dry-run"]);
    assert.strictEqual(safe.dryRun, true);
    assert.doesNotThrow(() => assertInitialImportOnly(safe));
    assert.throws(() => assertInitialImportOnly({ ...safe, requestedSync: true }), /initial import only/);
    assert.throws(() => assertInitialImportOnly({ ...safe, requestedReset: true }), /never resets/);
    assert.throws(() => assertInitialImportOnly({ ...safe, requestedAccountSync: true }), /never synchronizes existing accounts/);
    assert.throws(() => assertInitialImportOnly({ ...safe, requestedMealBuilderSync: true }), /never synchronizes an existing Meal Builder/);
    assert.throws(() => assertInitialImportOnly({ ...safe, includeMealBuilder: true }), /does not define complete product-group relations/);
  } finally {
    for (const [key, value] of Object.entries({
      BOOTSTRAP_SYNC: previous.sync,
      ACCOUNT_BOOTSTRAP_SYNC: previous.accountSync,
      MEAL_BUILDER_BOOTSTRAP: previous.mealBuilder,
      MEAL_BUILDER_BOOTSTRAP_SYNC: previous.mealBuilderSync,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function createFakeSettingStore() {
  let document = null;
  return {
    model: {
      findOne(query) {
        return { lean: async () => (document && document.key === query.key ? JSON.parse(JSON.stringify(document)) : null) };
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
  assert.strictEqual(BOOTSTRAP_VERSION, 2);
  assert.strictEqual(await readBootstrapState(store.model), null);
  await writeBootstrapState(store.model, "completed", { mode: "test" });
  const state = await readBootstrapState(store.model);
  assert.strictEqual(store.get().key, BOOTSTRAP_MARKER_KEY);
  assert.strictEqual(state.version, 2);
  assert.strictEqual(state.status, "completed");
  assert.strictEqual(state.mode, "test");
  assert.ok(state.sourceSha256);
  assert.ok(state.completedAt);
}

async function testManagedDataInspectionIsStructural() {
  const summary = await inspectManagedData({
    MenuCategory: { countDocuments: async () => 2 },
    MenuProduct: { countDocuments: async () => 5 },
    MenuOptionGroup: { countDocuments: async () => 6 },
    MenuOption: { countDocuments: async () => 7 },
    Plan: { countDocuments: async () => 3 },
    Addon: { countDocuments: async () => 4 },
  });
  assert.deepStrictEqual(summary, {
    categories: 2,
    products: 5,
    optionGroups: 6,
    options: 7,
    plans: 3,
    addons: 4,
    total: 27,
  });
}

async function testCompletedImportCannotReapplySeedData() {
  const store = createFakeSettingStore();
  const calls = [];
  const connection = { readyState: 0 };
  const fakeMongoose = {
    connection,
    async connect() { connection.readyState = 1; calls.push("connect"); },
    async disconnect() { connection.readyState = 0; calls.push("disconnect"); },
  };
  const emptyModel = { countDocuments: async () => 0 };
  const dependencies = {
    mongoose: fakeMongoose,
    Setting: store.model,
    MenuCategory: emptyModel,
    MenuProduct: emptyModel,
    MenuOptionGroup: emptyModel,
    MenuOption: emptyModel,
    Plan: emptyModel,
    Addon: emptyModel,
    resolveMongoUri: () => "mongodb://bootstrap.test/initial",
    seedNewMenu: async () => calls.push("new-menu"),
    seedSubscriptionPlans: async () => calls.push("plans"),
    seedSettings: async () => calls.push("settings"),
    backfillPremiumUpgrades: async () => calls.push("premium"),
    bootstrapDefaultAccounts: async () => calls.push("accounts"),
    verifyMenuWorkbookSource: async () => {
      calls.push("verify-menu");
      return { ok: true, summary: { errors: 0, warnings: 0 } };
    },
    verifyBootstrapStructure: async () => {
      calls.push("verify-structure");
      return { ok: true, summary: { errors: 0, warnings: 0 } };
    },
  };
  const log = { log() {}, warn() {}, error() {} };

  const first = await runBootstrap({ argv: [], dependencies, log, includeAccounts: false, includeMealBuilder: false });
  assert.strictEqual(first.skipped, false);
  assert.deepStrictEqual(
    calls.filter((item) => ["new-menu", "plans", "settings", "premium", "verify-menu", "verify-structure"].includes(item)),
    ["new-menu", "plans", "settings", "premium", "verify-menu", "verify-structure"]
  );

  const seedCallCount = calls.filter((item) => ["new-menu", "plans", "settings", "premium", "verify-menu", "verify-structure"].includes(item)).length;
  const second = await runBootstrap({ argv: [], dependencies, log, includeAccounts: false, includeMealBuilder: false });
  assert.strictEqual(second.skipped, true);
  assert.strictEqual(
    calls.filter((item) => ["new-menu", "plans", "settings", "premium", "verify-menu", "verify-structure"].includes(item)).length,
    seedCallCount
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
  console.log("✅ bootstrap workbook initial-data semantics tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
