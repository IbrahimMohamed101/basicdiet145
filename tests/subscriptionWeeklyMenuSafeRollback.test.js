"use strict";

process.env.NODE_ENV = "test";
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const {
  readDocument,
  recordMutation,
  rollbackPrepublishMutations,
} = require("../scripts/lib/weeklyMenuSafeRollback");

async function main() {
  const server = await MongoMemoryServer.create({
    instance: { dbName: "weekly_menu_safe_rollback_test" },
  });
  try {
    await mongoose.connect(server.getUri(), { autoIndex: false });
    const db = mongoose.connection.db;
    const menu = db.collection("menuoptions");
    const configs = db.collection("mealbuilderconfigs");
    const unrelated = db.collection("subscriptions");
    const published = {
      _id: new mongoose.Types.ObjectId(),
      status: "published",
      isCurrent: true,
      revisionHash: "sha256:base",
    };
    await configs.insertOne(published);
    const oldId = new mongoose.Types.ObjectId();
    const newId = new mongoose.Types.ObjectId();
    const unrelatedId = new mongoose.Types.ObjectId();
    await menu.insertOne({ _id: oldId, name: { en: "Old" }, extraPriceHalala: 100 });
    await unrelated.insertOne({ _id: unrelatedId, remainingMeals: 8 });

    const journal = [];
    const before = await readDocument(db, "menuoptions", oldId);
    await menu.updateOne({ _id: oldId }, { $set: { "name.en": "Updated" } });
    await recordMutation(db, journal, "menuoptions", before, oldId);
    await menu.insertOne({ _id: newId, name: { en: "New" }, extraPriceHalala: 0 });
    await recordMutation(db, journal, "menuoptions", null, newId);
    const report = await rollbackPrepublishMutations(db, journal, published);
    assert.deepEqual(report, { status: "reverted", documents: 2 });
    assert.deepEqual(await menu.findOne({ _id: oldId }), before);
    assert.equal(await menu.countDocuments({ _id: newId }), 0);
    assert.equal((await unrelated.findOne({ _id: unrelatedId })).remainingMeals, 8);
    assert.equal(await configs.countDocuments({}), 1);

    // An intervening dashboard edit must win over this release's rollback.
    const second = [];
    const secondBefore = await readDocument(db, "menuoptions", oldId);
    await menu.updateOne({ _id: oldId }, { $set: { "name.en": "Release-edited" } });
    await recordMutation(db, second, "menuoptions", secondBefore, oldId);
    await menu.updateOne({ _id: oldId }, { $set: { extraPriceHalala: 200 } });
    await assert.rejects(
      () => rollbackPrepublishMutations(db, second, published),
      /changed since this release/
    );
    assert.equal((await menu.findOne({ _id: oldId })).extraPriceHalala, 200);
    assert.equal((await menu.findOne({ _id: oldId })).name.en, "Release-edited");

    // A newly published revision invalidates the entire compensation.
    const third = [];
    const thirdBefore = await readDocument(db, "menuoptions", oldId);
    await menu.updateOne({ _id: oldId }, { $set: { "name.en": "Third" } });
    await recordMutation(db, third, "menuoptions", thirdBefore, oldId);
    await configs.updateOne({ _id: published._id }, { $set: { revisionHash: "sha256:new" } });
    await assert.rejects(
      () => rollbackPrepublishMutations(db, third, published),
      /Published revision changed/
    );
    assert.equal((await menu.findOne({ _id: oldId })).name.en, "Third");

    // Rollback never accepts unauthorized collections.
    await assert.rejects(
      () => readDocument(db, "subscriptions", unrelatedId),
      /Unapproved weekly menu rollback collection/
    );
    console.log("weekly menu safe rollback and concurrent edit isolation checks passed");
  } finally {
    await mongoose.disconnect();
    await server.stop();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
