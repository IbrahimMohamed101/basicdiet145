"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const PosCatalog = require("../src/models/PosCatalog");
const PosCatalogRevision = require("../src/models/PosCatalogRevision");
const PosAudit = require("../src/models/PosAudit");
const {
  seedPosStagingCatalog, getCatalog, saveDraft, publishDraft,
  getCatalogRevisions, getCatalogRevision,
} = require("../src/services/pos/catalogService");

test("published POS prices and immutable snapshots commit together on a Mongo replica set", async () => {
  if (process.env.NODE_ENV !== "test" || !process.env.MONGO_URI_TEST) {
    throw new Error("Requires explicit disposable test-only database.");
  }
  await mongoose.connect(process.env.MONGO_URI_TEST, { autoIndex: true });
  try {
    await PosCatalog.deleteMany({});
    await PosCatalogRevision.deleteMany({});
    await PosAudit.deleteMany({});
    await seedPosStagingCatalog();

    const original = await getCatalog();
    const originalHistory = await getCatalogRevision(original.publishedRevision);
    assert.ok(originalHistory);
    assert.equal(originalHistory.contentSha256.length, 64);

    const draft = structuredClone(original.published);
    draft.products[0].variants[0].prices.restaurant = 9876;
    const actor = { id: "staging-cashier-test", name: "كاشير تجريبي",
      email: "cashier@pos-staging.invalid", role: "cashier" };
    const saved = await saveDraft(original.revision, draft, actor);
    assert.deepEqual(saved.draftSavedBy, actor);
    assert.ok(saved.draft);
    assert.equal((await getCatalog()).published.products[0].variants[0].prices.restaurant,
      original.published.products[0].variants[0].prices.restaurant);

    const published = await publishDraft(saved.revision, actor);
    assert.deepEqual(published.publishedBy, actor);
    assert.ok(published.publishedAt);
    assert.equal(published.publishedRevision, saved.revision + 1);
    const audits = await PosAudit.find({ event: "POS_CATALOG_PUBLISHED" }).lean();
    assert.equal(audits.length, 1);
    assert.deepEqual(audits[0].actor, actor);
    assert.equal(audits[0].details.sourceRevision, original.publishedRevision);
    assert.equal(audits[0].details.publishedRevision, published.publishedRevision);
    assert.match(audits[0].details.sourceContentSha256, /^[a-f0-9]{64}$/);
    assert.match(audits[0].details.contentSha256, /^[a-f0-9]{64}$/);
    assert.notEqual(audits[0].details.contentSha256, audits[0].details.sourceContentSha256);
    const history = await getCatalogRevisions();
    assert.deepEqual(history[0].publishedBy, actor);
    assert.equal(history.length, 2);
    assert.equal((await getCatalogRevision(published.publishedRevision)).catalog
      .products[0].variants[0].prices.restaurant, 9876);
    assert.equal((await getCatalogRevision(original.publishedRevision)).catalog
      .products[0].variants[0].prices.restaurant,
      original.published.products[0].variants[0].prices.restaurant);

    // Replaying publication is rejected; snapshots remain unchanged.
    assert.equal(await publishDraft(saved.revision), null);
    assert.equal((await getCatalogRevisions()).length, 2);
  } finally {
    // This test-only DB is disposable; never connect to a production source.
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
