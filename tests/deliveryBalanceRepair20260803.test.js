"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet, MongoMemoryServer } = require("mongodb-memory-server");

require("../src/models/User");
require("../src/models/Plan");

const {
  REPAIR_ACTION,
  REQUIRED_CONFIRMATION,
  REQUIRED_STANDALONE_CONFIRMATION,
  deterministicJournalId,
  hash,
  loadScope,
  runRepair,
  scopeHashes,
} = require("../scripts/repair-delivery-balances-2026-08-03");
const {
  buildSubscriptionOperationsAudit,
} = require("../src/services/dashboard/subscriptionOperationsAuditService");

const oid = (value) => new mongoose.Types.ObjectId(value);
const IDS = Object.freeze({
  roa: "6a694dcceabe15012241bcbf",
  osamah: "6a6bfb16669468df32d7765b",
  ahmed: "6a673cefd554e771082cd4e2",
  haifa: "6a67d0622c25e041a25eed25",
  roaUser: "6a69375b9c35b9a31f1181b4",
  osamahUser: "6a6bfa16669468df32d7757a",
  ahmedUser: "6a670882d554e771082cd179",
  haifaUser: "6a67b3a70c08a6f7c17f88f8",
  plan: "6a621994f4f8d0974cebc46f",
  roaLog6: "6a694e51eabe15012241bd3d",
  roaLog8: "6a6ced8c0d05ea74be2fa041",
  roaLog12: "6a6fd6facaeb251aab48d058",
  osamahLog2a: "6a6db4e30d05ea74be2fcbf7",
  osamahLog2b: "6a6f0e2e0d05ea74be301c10",
  osamahLog4: "6a6fd74ecaeb251aab48d170",
  ahmedLog18: "6a6fd6a5caeb251aab48cfb4",
  haifaLog6: "6a6fd728caeb251aab48d0e5",
  allocations: [
    "6a6d542f0d05ea74be2fb2d6",
    "6a6d542f0d05ea74be2fb2d9",
    "6a6d548e0d05ea74be2fb48e",
    "6a6d548e0d05ea74be2fb491",
  ],
});

let replSet;
let dbName;

function user(_id, name, phone) {
  return { _id: oid(_id), name, phone, phoneE164: phone, role: "client" };
}

function deduction(_id, entityId, total, businessDate, createdAt, regular = total, premium = 0) {
  return {
    _id: oid(_id),
    entityType: "subscription",
    entityId: oid(entityId),
    action: "manual_subscription_meal_deduction",
    byRole: "superadmin",
    meta: {
      businessDate,
      deductedTotalMeals: total,
      deductedRegularMeals: regular,
      deductedPremiumMeals: premium,
      deductedAddons: [],
    },
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
  };
}

function allocation(_id, date, slotKey, premiumKey = "") {
  return {
    _id: oid(_id),
    allocationKey: `allocation-${_id}`,
    dayId: oid(date === "2026-08-01" ? "6a6bfb1679ee075a57f70664" : "6a6bfb1679ee075a57f70665"),
    date,
    slotKey,
    quantity: 1,
    state: "reserved",
    reservedAt: new Date("2026-08-01T02:00:00Z"),
    consumedAt: null,
    releasedAt: null,
    forfeitedAt: null,
    premiumFunding: premiumKey ? {
      source: "wallet",
      state: "reserved",
      premiumKey,
      balanceBucketId: oid(premiumKey === "beef" ? "6a6bfb16669468df32d77660" : "6a6bfb16669468df32d77661"),
    } : { source: "none", state: "none", premiumKey: "", balanceBucketId: null },
  };
}

function subscription(_id, userId, fields) {
  return {
    _id: oid(_id),
    userId: oid(userId),
    planId: oid(IDS.plan),
    status: "active",
    deliveryMode: "delivery",
    startDate: new Date("2026-07-29T00:00:00Z"),
    endDate: new Date("2026-08-20T00:00:00Z"),
    premiumBalance: [],
    addonBalance: [],
    createdAt: new Date("2026-07-29T00:00:00Z"),
    updatedAt: new Date("2026-08-02T23:50:00Z"),
    ...fields,
  };
}

async function seedScenario() {
  const db = mongoose.connection.db;
  await db.dropDatabase();
  await db.collection("users").insertMany([
    user(IDS.roaUser, "رؤي", "+966500003475"),
    user(IDS.osamahUser, "osamah alqarni", "+966500002393"),
    user(IDS.ahmedUser, "ahmed", "+966500006659"),
    user(IDS.haifaUser, "هيفاء الشريف", "+966500001785"),
  ]);
  await db.collection("plans").insertOne({
    _id: oid(IDS.plan),
    name: { ar: "اختبار", en: "Test" },
    daysCount: 26,
    mealsPerDay: 2,
  });

  const premiumBalance = [
    { _id: oid("6a6bfb16669468df32d77660"), premiumKey: "beef", purchasedQty: 1, remainingQty: 0, reservedQty: 1, consumedQty: 0 },
    { _id: oid("6a6bfb16669468df32d77661"), premiumKey: "salmon", purchasedQty: 1, remainingQty: 0, reservedQty: 1, consumedQty: 0 },
    { _id: oid("6a6bfb16669468df32d77662"), premiumKey: "salad", purchasedQty: 1, remainingQty: 1, reservedQty: 0, consumedQty: 0 },
  ];
  const addonBalance = [{
    _id: oid("6a6bfb16669468df32d7765f"),
    addonId: oid("6a6219a1f4f8d0974cebc4a5"),
    purchasedQty: 26,
    remainingQty: 25,
    reservedQty: 1,
    consumedQty: 0,
  }];
  await db.collection("subscriptions").insertMany([
    subscription(IDS.roa, IDS.roaUser, {
      totalMeals: 78,
      selectedMealsPerDay: 3,
      remainingMeals: 52,
    }),
    subscription(IDS.osamah, IDS.osamahUser, {
      totalMeals: 52,
      selectedMealsPerDay: 2,
      remainingMeals: 40,
      reservedMeals: 4,
      consumedMeals: 8,
      forfeitedMeals: 0,
      entitlementVersion: 2,
      premiumBalance,
      addonBalance,
      baseMealAllocations: [
        allocation(IDS.allocations[0], "2026-08-01", "slot_1", "beef"),
        allocation(IDS.allocations[1], "2026-08-01", "slot_2", "salmon"),
        allocation(IDS.allocations[2], "2026-08-02", "slot_1"),
        allocation(IDS.allocations[3], "2026-08-02", "slot_2"),
      ],
    }),
    subscription(IDS.ahmed, IDS.ahmedUser, {
      totalMeals: 21,
      selectedMealsPerDay: 3,
      remainingMeals: 3,
      premiumBalance: [{ premiumKey: "shrimp", purchasedQty: 3, remainingQty: 3, reservedQty: 0, consumedQty: 0 }],
      addonBalance: [{ addonId: oid("6a6219a1f4f8d0974cebc4a5"), purchasedQty: 7, remainingQty: 1, reservedQty: 0, consumedQty: 6 }],
    }),
    subscription(IDS.haifa, IDS.haifaUser, {
      totalMeals: 52,
      selectedMealsPerDay: 2,
      remainingMeals: 28,
      reservedMeals: 14,
      consumedMeals: 10,
      forfeitedMeals: 0,
      entitlementVersion: 2,
      baseMealAllocations: [{
        _id: oid("6a67d1632c25e041a25ef0ad"),
        allocationKey: "haifa-protected",
        date: "2026-07-29",
        slotKey: "slot_1",
        quantity: 1,
        state: "consumed",
      }],
    }),
  ]);
  await db.collection("activitylogs").insertMany([
    deduction(IDS.roaLog6, IDS.roa, 6, "2026-07-29", "2026-07-29T00:50:25Z"),
    deduction(IDS.roaLog8, IDS.roa, 8, "2026-07-31", "2026-07-31T18:46:36Z"),
    deduction(IDS.roaLog12, IDS.roa, 12, "2026-08-03", "2026-08-02T23:47:06Z"),
    deduction(IDS.osamahLog2a, IDS.osamah, 2, "2026-08-01", "2026-08-01T08:57:07Z"),
    deduction(IDS.osamahLog2b, IDS.osamah, 2, "2026-08-02", "2026-08-02T09:30:22Z"),
    deduction(IDS.osamahLog4, IDS.osamah, 4, "2026-08-03", "2026-08-02T23:48:30Z"),
    deduction(IDS.ahmedLog18, IDS.ahmed, 18, "2026-08-03", "2026-08-02T23:45:41Z"),
    deduction(IDS.haifaLog6, IDS.haifa, 6, "2026-08-03", "2026-08-02T23:47:52Z"),
  ]);
  await db.collection("subscriptiondays").insertMany([
    { _id: oid("6a6bfb1679ee075a57f70664"), subscriptionId: oid(IDS.osamah), date: "2026-08-01", status: "ready_for_delivery", mealSlots: [] },
    { _id: oid("6a6bfb1679ee075a57f70665"), subscriptionId: oid(IDS.osamah), date: "2026-08-02", status: "open", mealSlots: [] },
    { _id: oid("6a67d06279ee075a57f704f8"), subscriptionId: oid(IDS.haifa), date: "2026-07-29", status: "fulfilled", mealSlots: [] },
  ]);
  await db.collection("deliveries").insertOne({
    _id: oid("6a6db46079ee075a57f7068c"),
    subscriptionId: oid(IDS.osamah),
    date: "2026-08-01",
    status: "ready_for_delivery",
  });

  const config = {
    databaseName: dbName,
    targets: [
      {
        key: "roa",
        subscriptionId: IDS.roa,
        userId: IDS.roaUser,
        expectedName: "رؤي",
        identityHash: hash({ name: "رؤي", phone: "+966500003475" }),
        expectedWallet: { totalMeals: 78, selectedMealsPerDay: 3, remainingMeals: 52 },
        expectedManualLogs: [
          { id: IDS.roaLog6, businessDate: "2026-07-29", total: 6, regular: 6, premium: 0 },
          { id: IDS.roaLog8, businessDate: "2026-07-31", total: 8, regular: 8, premium: 0 },
          { id: IDS.roaLog12, businessDate: "2026-08-03", total: 12, regular: 12, premium: 0 },
        ],
        reversedActivityLogIds: [IDS.roaLog6, IDS.roaLog8],
        restoredRegularMeals: 14,
        restoredPremiumMeals: 0,
        releasedAllocationIds: [],
        expectedAfter: { totalMeals: 78, remainingMeals: 66, netManualDeductions: 12 },
        reason: "test roa reversal",
      },
      {
        key: "osamah",
        subscriptionId: IDS.osamah,
        userId: IDS.osamahUser,
        expectedName: "osamah alqarni",
        identityHash: hash({ name: "osamah alqarni", phone: "+966500002393" }),
        expectedWallet: { totalMeals: 52, selectedMealsPerDay: 2, remainingMeals: 40, reservedMeals: 4, consumedMeals: 8, forfeitedMeals: 0, entitlementVersion: 2 },
        expectedManualLogs: [
          { id: IDS.osamahLog2a, businessDate: "2026-08-01", total: 2, regular: 2, premium: 0 },
          { id: IDS.osamahLog2b, businessDate: "2026-08-02", total: 2, regular: 2, premium: 0 },
          { id: IDS.osamahLog4, businessDate: "2026-08-03", total: 4, regular: 4, premium: 0 },
        ],
        reversedActivityLogIds: [IDS.osamahLog4],
        restoredRegularMeals: 4,
        restoredPremiumMeals: 0,
        releasedAllocationIds: [...IDS.allocations],
        expectedAllocationDates: ["2026-08-01", "2026-08-01", "2026-08-02", "2026-08-02"],
        expectedAfter: { totalMeals: 52, remainingMeals: 48, remainingRegularMeals: 47, remainingPremiumMeals: 1, reservedMeals: 0, consumedMeals: 4, forfeitedMeals: 0, netManualDeductions: 4 },
        reason: "test osamah reversal",
      },
    ],
    protected: [
      {
        key: "ahmed",
        subscriptionId: IDS.ahmed,
        userId: IDS.ahmedUser,
        expectedName: "ahmed",
        identityHash: hash({ name: "ahmed", phone: "+966500006659" }),
        expectedWallet: { totalMeals: 21, remainingMeals: 3 },
      },
      {
        key: "haifa",
        subscriptionId: IDS.haifa,
        userId: IDS.haifaUser,
        expectedName: "هيفاء الشريف",
        identityHash: hash({ name: "هيفاء الشريف", phone: "+966500001785" }),
        expectedWallet: { totalMeals: 52, remainingMeals: 28, reservedMeals: 14, consumedMeals: 10, forfeitedMeals: 0, entitlementVersion: 2 },
      },
    ],
  };
  for (const spec of [...config.targets, ...config.protected]) {
    spec.expectedSnapshotHashes = scopeHashes(await loadScope(db, spec));
  }
  return config;
}

async function snapshots(config) {
  const db = mongoose.connection.db;
  const result = {};
  for (const spec of [...config.targets, ...config.protected]) {
    result[spec.key] = scopeHashes(await loadScope(db, spec));
  }
  return result;
}

async function expectPreconditionFailure(promise) {
  await assert.rejects(promise, (error) => error && error.code === "REPAIR_PRECONDITION_FAILED");
}

function standaloneApplyOptions(config, extras = {}) {
  return {
    apply: true,
    allowStandalone: true,
    confirmation: REQUIRED_STANDALONE_CONFIRMATION,
    config,
    expectedDatabaseName: dbName,
    ...extras,
  };
}

async function journalRows(db) {
  return db.collection("activitylogs").find({ action: REPAIR_ACTION }).sort({ _id: 1 }).toArray();
}

async function assertFinalBalances(db) {
  const roa = await db.collection("subscriptions").findOne({ _id: oid(IDS.roa) });
  const osamah = await db.collection("subscriptions").findOne({ _id: oid(IDS.osamah) });
  assert.strictEqual(roa.remainingMeals, 66);
  assert.strictEqual(osamah.remainingMeals, 48);
  assert.strictEqual(osamah.remainingMeals - osamah.premiumBalance.reduce((sum, row) => sum + Number(row.remainingQty || 0), 0), 47);
  assert.strictEqual(osamah.reservedMeals, 0);
  assert.strictEqual(osamah.consumedMeals, 4);
  assert.strictEqual(osamah.forfeitedMeals, 0);
  assert(osamah.baseMealAllocations.every((row) => row.state === "released" && row.releasedAt));
}

async function runStandaloneCases() {
  const standalone = await MongoMemoryServer.create();
  dbName = `delivery_balance_standalone_${Date.now()}`;
  await mongoose.connect(standalone.getUri(dbName));
  const db = mongoose.connection.db;
  try {
    let config = await seedScenario();
    const dryBefore = await snapshots(config);
    const dryRun = await runRepair({ config, expectedDatabaseName: dbName });
    assert.strictEqual(dryRun.mode, "dry_run", "1. standalone dry run mode");
    assert.strictEqual(dryRun.topology, "standalone");
    assert.strictEqual(dryRun.executionPlan, "standalone_resumable_repair");
    assert.strictEqual(dryRun.writes, 0);
    assert.strictEqual(dryRun.deterministicJournalIds.roa, String(deterministicJournalId(IDS.roa)));
    assert.strictEqual(dryRun.deterministicJournalIds.osamah, String(deterministicJournalId(IDS.osamah)));
    assert.deepStrictEqual(await snapshots(config), dryBefore, "1. dry run writes zero");

    config = await seedScenario();
    await expectPreconditionFailure(runRepair({
      apply: true,
      confirmation: REQUIRED_STANDALONE_CONFIRMATION,
      config,
      expectedDatabaseName: dbName,
    }));
    assert.strictEqual((await journalRows(db)).length, 0, "2. standalone gate failure writes zero");

    config = await seedScenario();
    await db.collection("subscriptions").updateOne({ _id: oid(IDS.roa) }, { $set: { totalMeals: 77 } });
    await expectPreconditionFailure(runRepair(standaloneApplyOptions(config)));
    assert.strictEqual((await journalRows(db)).length, 0, "3. global preflight prevents prepared journals");

    config = await seedScenario();
    await assert.rejects(
      runRepair(standaloneApplyOptions(config, { faultInjectionStep: "after_prepare_roa" })),
      /Injected failure/
    );
    let journals = await journalRows(db);
    assert.strictEqual(journals.length, 1, "4. first deterministic prepared journal exists once");
    assert.strictEqual(String(journals[0]._id), String(deterministicJournalId(IDS.roa)));
    assert.strictEqual(journals[0].meta.status, "prepared");
    let resumed = await runRepair(standaloneApplyOptions(config));
    assert.strictEqual(resumed.mode, "standalone_apply", "7. resume after prepare succeeds");
    await assertFinalBalances(db);

    config = await seedScenario();
    await assert.rejects(
      runRepair(standaloneApplyOptions(config, { faultInjectionStep: "after_prepare_all" })),
      /Injected failure/
    );
    journals = await journalRows(db);
    assert.deepStrictEqual(journals.map((row) => row.meta.status), ["prepared", "prepared"]);
    const pendingReport = await buildSubscriptionOperationsAudit({
      from: "2026-07-29",
      to: "2026-08-03",
      now: new Date("2026-08-03T12:00:00Z"),
    });
    const pendingRoa = pendingReport.subscriptionAudits.find((row) => row.subscriptionId === IDS.roa);
    assert.strictEqual(pendingRoa.balance.reversedManualDeductions, 0, "12. prepared does not reverse audit totals");
    assert.strictEqual(pendingRoa.balance.netManualDeductions, 26);
    assert.strictEqual(pendingRoa.manualDeductionReversalsPending, 1);
    resumed = await runRepair(standaloneApplyOptions(config));
    assert.strictEqual(resumed.targets.roa.stateBefore, "prepared_before", "7. prepared journal resumes at CAS");
    assert.strictEqual(resumed.targets.osamah.stateBefore, "prepared_before");
    await assertFinalBalances(db);

    config = await seedScenario();
    const protectedBeforeUpdateCrash = {
      ahmed: scopeHashes(await loadScope(db, config.protected[0])),
      haifa: scopeHashes(await loadScope(db, config.protected[1])),
    };
    await assert.rejects(
      runRepair(standaloneApplyOptions(config, { faultInjectionStep: "after_roa_subscription_update" })),
      /Injected failure/
    );
    let roa = await db.collection("subscriptions").findOne({ _id: oid(IDS.roa) });
    journals = await journalRows(db);
    assert.strictEqual(roa.remainingMeals, 66, "8. subscription update committed before finalize fault");
    assert.strictEqual(journals.find((row) => row.meta.targetKey === "roa").meta.status, "prepared");
    resumed = await runRepair(standaloneApplyOptions(config));
    assert(resumed.targets.roa.actionsPerformed.includes("journal_finalized_recovery"));
    await assertFinalBalances(db);
    assert.deepStrictEqual(scopeHashes(await loadScope(db, config.protected[0])), protectedBeforeUpdateCrash.ahmed, "14. Ahmed unchanged");
    assert.deepStrictEqual(scopeHashes(await loadScope(db, config.protected[1])), protectedBeforeUpdateCrash.haifa, "15. Haifa unchanged");

    config = await seedScenario();
    let partialFailure;
    try {
      await runRepair(standaloneApplyOptions(config, { faultInjectionStep: "after_roa_finalize" }));
    } catch (error) {
      partialFailure = error;
    }
    assert(partialFailure && /Injected failure/.test(partialFailure.message));
    assert.strictEqual(partialFailure.targetStates.roa.journalStatus, "applied");
    assert.strictEqual(partialFailure.targetStates.roa.subscriptionState, "after");
    assert.strictEqual(partialFailure.targetStates.osamah.journalStatus, "prepared");
    assert.strictEqual(partialFailure.targetStates.osamah.subscriptionState, "before");
    journals = await journalRows(db);
    assert.strictEqual(journals.find((row) => row.meta.targetKey === "roa").meta.status, "applied");
    assert.strictEqual(journals.find((row) => row.meta.targetKey === "osamah").meta.status, "prepared");
    resumed = await runRepair(standaloneApplyOptions(config));
    assert(resumed.targets.roa.actionsPerformed.includes("already_applied_noop"), "9. Roa is not repeated");
    await assertFinalBalances(db);

    config = await seedScenario();
    await assert.rejects(
      runRepair(standaloneApplyOptions(config, { faultInjectionStep: "after_osamah_subscription_update" })),
      /Injected failure/
    );
    let osamah = await db.collection("subscriptions").findOne({ _id: oid(IDS.osamah) });
    assert.strictEqual(osamah.remainingMeals, 48);
    assert.strictEqual((await journalRows(db)).find((row) => row.meta.targetKey === "osamah").meta.status, "prepared");
    resumed = await runRepair(standaloneApplyOptions(config));
    assert(resumed.targets.osamah.actionsPerformed.includes("journal_finalized_recovery"));

    const premiumAfter = hash((await db.collection("subscriptions").findOne({ _id: oid(IDS.osamah) })).premiumBalance);
    const addonsAfter = hash((await db.collection("subscriptions").findOne({ _id: oid(IDS.osamah) })).addonBalance);
    const appliedStateHash = hash(await db.collection("subscriptions").find({
      _id: { $in: [oid(IDS.roa), oid(IDS.osamah)] },
    }).sort({ _id: 1 }).toArray());
    const activityIndexes = await db.collection("activitylogs").indexes();
    assert.deepStrictEqual(
      activityIndexes.map((row) => row.name),
      ["_id_"],
      "19. deterministic _id is the idempotency barrier without the optional repair index"
    );
    const repeated = await runRepair(standaloneApplyOptions(config));
    assert(repeated.targets.roa.actionsPerformed.includes("already_applied_noop"), "10. applied after is a no-op");
    assert(repeated.targets.osamah.actionsPerformed.includes("already_applied_noop"));
    assert.strictEqual((await journalRows(db)).length, 2, "18/19. repeat creates no journals despite no repair index");
    assert.strictEqual(hash(await db.collection("subscriptions").find({
      _id: { $in: [oid(IDS.roa), oid(IDS.osamah)] },
    }).sort({ _id: 1 }).toArray()), appliedStateHash);
    assert.strictEqual(hash((await db.collection("subscriptions").findOne({ _id: oid(IDS.osamah) })).premiumBalance), premiumAfter, "16. premium unchanged");
    assert.strictEqual(hash((await db.collection("subscriptions").findOne({ _id: oid(IDS.osamah) })).addonBalance), addonsAfter, "16. add-ons unchanged");

    const appliedReport = await buildSubscriptionOperationsAudit({
      from: "2026-07-29",
      to: "2026-08-03",
      now: new Date("2026-08-03T12:00:00Z"),
    });
    const appliedRoa = appliedReport.subscriptionAudits.find((row) => row.subscriptionId === IDS.roa);
    const appliedOsamah = appliedReport.subscriptionAudits.find((row) => row.subscriptionId === IDS.osamah);
    assert.deepStrictEqual([
      appliedRoa.balance.grossManualDeductions,
      appliedRoa.balance.reversedManualDeductions,
      appliedRoa.balance.netManualDeductions,
    ], [26, 14, 12], "13. applied Roa reversal affects audit");
    assert.deepStrictEqual([
      appliedOsamah.balance.grossManualDeductions,
      appliedOsamah.balance.reversedManualDeductions,
      appliedOsamah.balance.netManualDeductions,
    ], [8, 4, 4], "13. applied Osamah reversal affects audit");

    config = await seedScenario();
    const beforeConcurrent = await db.collection("subscriptions").findOne({ _id: oid(IDS.roa) });
    await expectPreconditionFailure(runRepair(standaloneApplyOptions(config, {
      beforeTargetApply: async ({ db: callbackDb, context }) => {
        if (context.spec.key === "roa") {
          await callbackDb.collection("subscriptions").updateOne(
            { _id: oid(IDS.roa) },
            { $set: { updatedAt: new Date("2026-08-03T01:00:00Z") } }
          );
        }
      },
    })));
    roa = await db.collection("subscriptions").findOne({ _id: oid(IDS.roa) });
    assert.strictEqual(roa.remainingMeals, beforeConcurrent.remainingMeals, "11. CAS rejects concurrent updatedAt change");
    assert.strictEqual((await journalRows(db)).filter((row) => row.meta.status === "prepared").length, 2);

    console.log("delivery balance standalone repair tests passed (19 standalone safety cases)");
  } finally {
    await mongoose.disconnect().catch(() => {});
    await standalone.stop().catch(() => {});
  }
}

async function runTransactionCases() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  dbName = `delivery_balance_transaction_${Date.now()}`;
  await mongoose.connect(replSet.getUri(dbName));
  const db = mongoose.connection.db;
  try {
    let config = await seedScenario();
    const dryBefore = await snapshots(config);
    const dryRun = await runRepair({ config, expectedDatabaseName: dbName });
    assert.strictEqual(dryRun.topology, "replica_set");
    assert.strictEqual(dryRun.executionPlan, "transactional_repair");
    assert.deepStrictEqual(await snapshots(config), dryBefore);

    config = await seedScenario();
    const ahmedBefore = scopeHashes(await loadScope(db, config.protected[0]));
    const haifaBefore = scopeHashes(await loadScope(db, config.protected[1]));
    const applied = await runRepair({
      apply: true,
      confirmation: REQUIRED_CONFIRMATION,
      config,
      expectedDatabaseName: dbName,
    });
    assert.strictEqual(applied.mode, "apply", "17. transaction path remains available");
    await assertFinalBalances(db);
    assert.deepStrictEqual(scopeHashes(await loadScope(db, config.protected[0])), ahmedBefore);
    assert.deepStrictEqual(scopeHashes(await loadScope(db, config.protected[1])), haifaBefore);
    assert((await journalRows(db)).every((row) => row.meta.status === "applied"));

    config = await seedScenario();
    const rollbackBefore = await snapshots(config);
    await assert.rejects(runRepair({
      apply: true,
      confirmation: REQUIRED_CONFIRMATION,
      config,
      expectedDatabaseName: dbName,
      faultInjectionStep: "after_target_1",
    }), /Injected failure/);
    assert.deepStrictEqual(await snapshots(config), rollbackBefore, "17. transaction rollback remains atomic");
    assert.strictEqual((await journalRows(db)).length, 0);

    console.log("delivery balance transaction repair tests passed");
  } finally {
    await mongoose.disconnect().catch(() => {});
    await replSet.stop().catch(() => {});
  }
}

async function run() {
  await runStandaloneCases();
  await runTransactionCases();
  console.log("delivery balance repair 2026-08-03 tests passed (20 requested scenarios covered)");
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
