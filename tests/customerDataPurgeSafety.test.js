process.env.NODE_ENV = "test";

const assert = require("assert");

const {
  BLOCKED_TEST_EMAILS,
  BLOCKED_TEST_PASSWORDS,
  PURGE_TARGETS,
  REQUIRED_PHRASE,
  assertDatabaseNameSafe,
  assertExecutionConfirmed,
  assertUniqueTargets,
  comparePreservedSummaries,
  deleteTargets,
  loadTargetSummary,
  parseArgs,
  targetCollectionName,
  validateProductionSuperadmin,
} = require("../scripts/purge-customer-data-for-production");

function expectThrow(fn, pattern) {
  assert.throws(fn, pattern);
}

function fakeModel(collectionName, initialCount) {
  let count = initialCount;
  return {
    collection: { collectionName },
    async estimatedDocumentCount() {
      return count;
    },
    async deleteMany() {
      const deletedCount = count;
      count = 0;
      return { acknowledged: true, deletedCount };
    },
  };
}

async function run() {
  assert.deepStrictEqual(parseArgs([]), { execute: false });
  assert.deepStrictEqual(parseArgs(["--execute"]), { execute: true });

  assert.strictEqual(assertDatabaseNameSafe("basicdiet145"), "basicdiet145");
  for (const protectedName of ["admin", "config", "local", "ADMIN"]) {
    expectThrow(() => assertDatabaseNameSafe(protectedName), /protected MongoDB database/);
  }
  expectThrow(() => assertDatabaseNameSafe(""), /database name is empty/);

  assert.strictEqual(assertUniqueTargets(PURGE_TARGETS), true);
  const targetCollections = PURGE_TARGETS.map(targetCollectionName);
  assert.strictEqual(new Set(targetCollections).size, targetCollections.length);
  assert.strictEqual(PURGE_TARGETS.length, 22);
  for (const expectedKey of [
    "users",
    "appUsers",
    "dashboardUsers",
    "subscriptions",
    "subscriptionDays",
    "subscriptionPickupRequests",
    "subscriptionDailyAddonOperations",
    "subscriptionDayAppendOperations",
    "subscriptionDayMutationLocks",
    "subscriptionMealReservationLocks",
    "orders",
    "payments",
    "refreshSessions",
    "otps",
  ]) {
    assert(PURGE_TARGETS.some((target) => target.key === expectedKey), `missing purge target ${expectedKey}`);
  }

  for (const linkedCollection of [
    "subscriptiondailyaddonoperations",
    "subscriptiondayappendoperations",
    "subscriptiondaymutationlocks",
    "subscriptionmealreservationlocks",
  ]) {
    assert(targetCollections.includes(linkedCollection), `linked subscription collection must be purged: ${linkedCollection}`);
  }

  assert.doesNotThrow(() => assertExecutionConfirmed({
    execute: false,
    databaseName: "basicdiet145",
    env: {},
  }));

  expectThrow(() => assertExecutionConfirmed({
    execute: true,
    databaseName: "basicdiet145",
    env: {},
  }), /ALLOW_CUSTOMER_DATA_PURGE=true/);

  const validEnv = {
    ALLOW_CUSTOMER_DATA_PURGE: "true",
    BACKUP_CONFIRMED: "true",
    MAINTENANCE_MODE_CONFIRMED: "true",
    PURGE_DATABASE_NAME: "basicdiet145",
    PURGE_CONFIRM_PHRASE: REQUIRED_PHRASE,
    SUPERADMIN_EMAIL: "owner@real-basicdiet.sa",
    SUPERADMIN_PASSWORD: "RealOwner@2026#Secure",
  };

  const confirmed = assertExecutionConfirmed({
    execute: true,
    databaseName: "basicdiet145",
    env: validEnv,
  });
  assert.strictEqual(confirmed.email, "owner@real-basicdiet.sa");
  assert.strictEqual(confirmed.password, validEnv.SUPERADMIN_PASSWORD);

  for (const email of BLOCKED_TEST_EMAILS) {
    expectThrow(() => validateProductionSuperadmin({
      ...validEnv,
      SUPERADMIN_EMAIL: email,
    }), /known demo\/test account/);
  }

  for (const password of BLOCKED_TEST_PASSWORDS) {
    expectThrow(() => validateProductionSuperadmin({
      ...validEnv,
      SUPERADMIN_PASSWORD: password,
    }), /known demo\/test password|SUPERADMIN_PASSWORD/);
  }

  const fakeTargets = [
    { key: "one", label: "One", Model: fakeModel("ones", 2) },
    { key: "two", label: "Two", Model: fakeModel("twos", 3) },
  ];
  const before = await loadTargetSummary(fakeTargets);
  assert.deepStrictEqual(before.map((row) => row.count), [2, 3]);
  const deleted = await deleteTargets(fakeTargets, { log() {} });
  assert.deepStrictEqual(deleted.map((row) => row.deletedCount), [2, 3]);
  const after = await loadTargetSummary(fakeTargets);
  assert.deepStrictEqual(after.map((row) => row.count), [0, 0]);

  assert.deepStrictEqual(comparePreservedSummaries(
    [{ name: "plans", count: 5 }, { name: "settings", count: 3 }],
    [{ name: "plans", count: 5 }, { name: "settings", count: 3 }]
  ), []);
  assert.deepStrictEqual(comparePreservedSummaries(
    [{ name: "plans", count: 5 }],
    [{ name: "plans", count: 6 }]
  ), [{ name: "plans", beforeCount: 5, afterCount: 6 }]);

  console.log("customer data purge safety checks passed");
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
