"use strict";

const assert = require("node:assert/strict");
const { BSON } = require("mongodb");

const ALLOWED_COLLECTIONS = new Set(["menuoptions", "productgroupoptions"]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function fingerprint(document) {
  return JSON.stringify(stable(BSON.EJSON.serialize(document, { relaxed: false })));
}

async function readDocument(db, collection, id) {
  assert(ALLOWED_COLLECTIONS.has(collection), "Unapproved weekly menu rollback collection");
  return db.collection(collection).findOne({ _id: id });
}

// Record only writes performed by this release, never a database-wide snapshot.
// 'before' must be captured immediately before the actual write.
async function recordMutation(db, journal, collection, before, id) {
  const after = await readDocument(db, collection, id);
  assert(after, "Mutation journal cannot record a missing document");
  journal.push({ collection, before, after });
}

// Fail closed if another user, task or deployment has changed the catalog.
// The transaction isn't being rolled back: these are conditional, targeted
// compensations, with no upserts and no replacement of unrelated documents.
async function rollbackPrepublishMutations(db, journal, expectedPublished) {
  const current = await db.collection("mealbuilderconfigs").findOne({
    status: "published",
    isCurrent: true,
  });
  assert(current, "Published Meal Builder config disappeared; manual recovery required");
  assert.equal(String(current._id), String(expectedPublished._id),
    "Published config changed; refusing automatic rollback");
  assert.equal(current.revisionHash, expectedPublished.revisionHash,
    "Published revision changed; refusing automatic rollback");

  for (const entry of journal) {
    assert(ALLOWED_COLLECTIONS.has(entry.collection), "Rollback cannot touch this collection");
    assert(entry.after && entry.after._id, "Invalid rollback journal");
    assert(!entry.before || String(entry.before._id) === String(entry.after._id),
      "Rollback journal ID mismatch");
    const latest = await readDocument(db, entry.collection, entry.after._id);
    assert(latest && fingerprint(latest) === fingerprint(entry.after),
      "Menu document changed since this release wrote it; manual recovery required");
  }

  let reverted = 0;
  for (const entry of [...journal].reverse()) {
    // Matching the entire recorded post-write document prevents overwriting
    // a concurrent edit, including edits that did not touch updatedAt.
    const filter = { ...entry.after };
    const result = entry.before
      ? await db.collection(entry.collection).replaceOne(filter, entry.before, { upsert: false })
      : await db.collection(entry.collection).deleteOne(filter);
    assert.equal(entry.before ? result.matchedCount : result.deletedCount, 1,
      "Concurrent change during rollback; manual recovery required");
    reverted += 1;
  }
  return { status: "reverted", documents: reverted };
}

module.exports = {
  readDocument,
  recordMutation,
  rollbackPrepublishMutations,
};
