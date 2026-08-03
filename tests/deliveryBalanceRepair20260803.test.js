"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

require("../src/models/User");
require("../src/models/Plan");

const {
  REPAIR_ACTION,
  REQUIRED_CONFIRMATION,
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

async function run() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  dbName = `delivery_balance_repair_test_${Date.now()}`;
  await mongoose.connect(replSet.getUri(dbName));
  const db = mongoose.connection.db;

  try {
    let config = await seedScenario();
    const dryBefore = await snapshots(config);
    const dryRun = await runRepair({ config, expectedDatabaseName: dbName });
    assert.strictEqual(dryRun.mode, "dry_run");
    assert.strictEqual(dryRun.writes, 0);
    assert.deepStrictEqual(await snapshots(config), dryBefore, "1. dry run must not write");

    config = await seedScenario();
    await db.collection("subscriptions").updateOne({ _id: oid(IDS.roa) }, { $set: { totalMeals: 77 } });
    const mismatchBaseline = hash(await db.collection("subscriptions").find({}).sort({ _id: 1 }).toArray());
    await expectPreconditionFailure(runRepair({
      apply: true,
      confirmation: REQUIRED_CONFIRMATION,
      config,
      expectedDatabaseName: dbName,
    }));
    assert.strictEqual(hash(await db.collection("subscriptions").find({}).sort({ _id: 1 }).toArray()), mismatchBaseline, "2. mismatch prevents every repair write");
    assert.strictEqual(await db.collection("activitylogs").countDocuments({ action: REPAIR_ACTION }), 0);

    config = await seedScenario();
    const ahmedBefore = scopeHashes(await loadScope(db, config.protected[0]));
    const haifaBefore = scopeHashes(await loadScope(db, config.protected[1]));
    const osamahBefore = await db.collection("subscriptions").findOne({ _id: oid(IDS.osamah) });
    const premiumBefore = hash(osamahBefore.premiumBalance);
    const addonsBefore = hash(osamahBefore.addonBalance);
    const originalLogsBefore = await db.collection("activitylogs").find({
      entityId: { $in: [oid(IDS.roa), oid(IDS.osamah)] },
      action: "manual_subscription_meal_deduction",
    }).sort({ _id: 1 }).toArray();

    const applied = await runRepair({
      apply: true,
      confirmation: REQUIRED_CONFIRMATION,
      config,
      expectedDatabaseName: dbName,
    });
    assert.strictEqual(applied.mode, "apply");
    const roa = await db.collection("subscriptions").findOne({ _id: oid(IDS.roa) });
    const osamah = await db.collection("subscriptions").findOne({ _id: oid(IDS.osamah) });
    assert.strictEqual(roa.remainingMeals, 66, "3. Roa balance becomes 66");
    assert.strictEqual(osamah.remainingMeals, 48, "4. Osamah remaining becomes 48");
    assert.strictEqual(osamah.reservedMeals, 0);
    assert.strictEqual(osamah.consumedMeals, 4);
    assert(osamah.baseMealAllocations.every((row) => row.state === "released"));
    assert.strictEqual(hash(osamah.premiumBalance), premiumBefore, "5. premium balances stay unchanged");
    assert.strictEqual(hash(osamah.addonBalance), addonsBefore, "5. add-on balances stay unchanged");
    assert.deepStrictEqual(scopeHashes(await loadScope(db, config.protected[0])), ahmedBefore, "6. Ahmed stays unchanged");
    assert.deepStrictEqual(scopeHashes(await loadScope(db, config.protected[1])), haifaBefore, "7. Haifa stays unchanged");

    const appliedStateHash = hash(await db.collection("subscriptions").find({ _id: { $in: [oid(IDS.roa), oid(IDS.osamah)] } }).sort({ _id: 1 }).toArray());
    await expectPreconditionFailure(runRepair({
      apply: true,
      confirmation: REQUIRED_CONFIRMATION,
      config,
      expectedDatabaseName: dbName,
    }));
    assert.strictEqual(await db.collection("activitylogs").countDocuments({ action: REPAIR_ACTION }), 2, "8. rerun does not duplicate repair");
    assert.strictEqual(hash(await db.collection("subscriptions").find({ _id: { $in: [oid(IDS.roa), oid(IDS.osamah)] } }).sort({ _id: 1 }).toArray()), appliedStateHash);

    const report = await buildSubscriptionOperationsAudit({
      from: "2026-07-29",
      to: "2026-08-03",
      now: new Date("2026-08-03T12:00:00Z"),
    });
    const roaAudit = report.subscriptionAudits.find((row) => row.subscriptionId === IDS.roa);
    const osamahAudit = report.subscriptionAudits.find((row) => row.subscriptionId === IDS.osamah);
    assert(roaAudit && osamahAudit);
    assert.deepStrictEqual(
      [roaAudit.balance.grossManualDeductions, roaAudit.balance.reversedManualDeductions, roaAudit.balance.netManualDeductions],
      [26, 14, 12],
      "10. report exposes Roa gross/reversed/net"
    );
    assert.deepStrictEqual(
      [osamahAudit.balance.grossManualDeductions, osamahAudit.balance.reversedManualDeductions, osamahAudit.balance.netManualDeductions],
      [8, 4, 4],
      "10. report exposes Osamah gross/reversed/net"
    );
    assert.strictEqual(osamah.totalMeals, osamah.remainingMeals + osamah.reservedMeals + osamah.consumedMeals + osamah.forfeitedMeals, "11. balance equation remains balanced");
    const originalLogsAfter = await db.collection("activitylogs").find({
      entityId: { $in: [oid(IDS.roa), oid(IDS.osamah)] },
      action: "manual_subscription_meal_deduction",
    }).sort({ _id: 1 }).toArray();
    assert.strictEqual(hash(originalLogsAfter), hash(originalLogsBefore), "12. historical logs are not changed or deleted");

    config = await seedScenario();
    const rollbackBefore = await snapshots(config);
    await assert.rejects(runRepair({
      apply: true,
      confirmation: REQUIRED_CONFIRMATION,
      config,
      expectedDatabaseName: dbName,
      faultInjectionStep: "after_target_1",
    }), /Injected failure/);
    assert.deepStrictEqual(await snapshots(config), rollbackBefore, "9. injected failure rolls back the complete repair");
    assert.strictEqual(await db.collection("activitylogs").countDocuments({ action: REPAIR_ACTION }), 0);

    console.log("delivery balance repair 2026-08-03 tests passed (12 safety cases)");
  } finally {
    await mongoose.disconnect().catch(() => {});
    await replSet.stop().catch(() => {});
  }
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
