"use strict";

const mongoose = require("mongoose");
const crypto = require("node:crypto");
const PosCatalog = require("../../models/PosCatalog");
const PosCatalogRevision = require("../../models/PosCatalogRevision");
const PosAudit = require("../../models/PosAudit");
const { normalizePosCatalog } = require("./catalogValidation");
const stagingCatalog = require("./stagingCatalog.json");
const { isPosStagingRuntime } = require("../../utils/posStagingRuntime");
const { buildSanitizedStagingFixture } = require("../../../scripts/pos/buildSanitizedStagingFixture");
const publicMenuSample = require("../../../fixtures/pos/public-menu-nonpersonal-sample.json");

const CATALOG_ID = "pos-menu";

function makeSnapshot(revision, published, publishedAt = new Date(), publishedBy = null) {
  if (!Number.isSafeInteger(revision) || revision < 1
    || !published || !Array.isArray(published.products) || !Array.isArray(published.categories)) {
    throw new Error("Cannot snapshot an invalid published POS catalogue.");
  }
  // Published documents are append-only and are tied to their content hash.
  const copy = structuredClone(published);
  return {
    _id: CATALOG_ID + ":" + revision,
    catalogId: CATALOG_ID,
    revision,
    publishedAt, publishedBy,
    contentSha256: crypto.createHash("sha256").update(JSON.stringify(copy)).digest("hex"),
    catalog: copy,
  };
}

async function seedPosStagingCatalog() {
  const initial = normalizePosCatalog(stagingCatalog);
  await PosCatalog.updateOne({ _id: CATALOG_ID }, {
    $setOnInsert: {
      revision: 1, publishedRevision: 1, published: initial, draft: null,
    },
  }, { upsert: true, timestamps: false });

  // Backfill ONLY the current published document. An overwritten older
  // catalogue cannot be reconstructed and must never be fabricated.
  const current = await getCatalog();
  if (current?.published) {
    const snapshot = makeSnapshot(
      current.publishedRevision, current.published, current.publishedAt || current.updatedAt || new Date(), current.publishedBy || null
    );
    const existing = await PosCatalogRevision.findById(snapshot._id).lean();
    if (existing && existing.contentSha256 !== snapshot.contentSha256) {
      throw new Error("POS published catalogue diverges from immutable revision history.");
    }
    if (!existing) {
      await PosCatalogRevision.updateOne({ _id: snapshot._id }, {
        $setOnInsert: snapshot,
      }, { upsert: true });
    }
  }
  // This optional Staging-only draft consists exclusively of names and sizes
  // from the public restaurant menu. It contains NO customer, subscription or
  // payment records; all POS prices are null and all products inactive.
  if (process.env.POS_STAGING_FIXTURE_PROFILE === "public-menu-12") {
    if (!isPosStagingRuntime()) {
      throw new Error("POS public-menu fixtures can run only on the isolated Staging service");
    }
    if (current?.revision === 1 && current.publishedRevision === 1
      && current.draft === null
      && current.published.products.some((item) => item.id === "butter")) {
      const draft = buildSanitizedStagingFixture(publicMenuSample);
      const stagedDraft = await PosCatalog.findOneAndUpdate(
        { _id: CATALOG_ID, revision: 1, draft: null },
        { $set: { draft }, $inc: { revision: 1 } },
        { new: true }
      );
      if (stagedDraft) {
        console.info("[pos-staging] Review-only public menu draft prepared: 12 inactive products, no prices or personal records");
      }
    }
  }
}

function getCatalog() {
  return PosCatalog.findById(CATALOG_ID).lean();
}

function saveDraft(revision, draft, actor = null) {
  return PosCatalog.findOneAndUpdate({ _id: CATALOG_ID, revision }, {
    $set: { draft, draftSavedBy: actor, draftSavedAt: new Date() },
    $inc: { revision: 1 },
  }, { new: true }).lean();
}

async function publishDraft(revision, actor = null) {
  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async () => {
      const current = await PosCatalog
        .findOne({ _id: CATALOG_ID, revision, draft: { $ne: null } })
        .session(session).lean();
      if (!current) return;

      const previous = makeSnapshot(
        current.publishedRevision, current.published, current.publishedAt || current.updatedAt || new Date(), current.publishedBy || null
      );
      const existingPrevious = await PosCatalogRevision
        .findById(previous._id).session(session).lean();
      if (existingPrevious && existingPrevious.contentSha256 !== previous.contentSha256) {
        throw new Error("POS previous published catalog history does not match its source.");
      }
      const nextRevision = revision + 1;
      const nextPublishedAt = new Date();
      const nextSnapshot = makeSnapshot(nextRevision, current.draft, nextPublishedAt, actor);

      // Publishing and history inserts are one transaction. If any write fails,
      // the catalog and its revision history both roll back.
      const updated = await PosCatalog.findOneAndUpdate(
        { _id: CATALOG_ID, revision, draft: { $ne: null } },
        {
          $set: { published: current.draft, draft: null,
            publishedRevision: nextRevision, publishedBy: actor, publishedAt: nextPublishedAt },
          $inc: { revision: 1 },
        },
        { session, new: true }
      ).lean();
      if (!updated) return;
      await PosCatalogRevision.updateOne(
        { _id: previous._id }, { $setOnInsert: previous },
        { upsert: true, session }
      );
      await PosCatalogRevision.create([nextSnapshot], { session });
      if (actor) await PosAudit.create([{
        event: "POS_CATALOG_PUBLISHED", actor, at: nextPublishedAt,
        details: { publishedRevision: nextRevision, contentSha256: nextSnapshot.contentSha256 },
      }], { session });
      result = updated;
    }, {
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function getCatalogRevisions(limit = 30) {
  const capped = Math.max(1, Math.min(Number(limit) || 30, 50));
  return PosCatalogRevision.find({ catalogId: CATALOG_ID })
    .select("revision publishedAt contentSha256")
    .sort({ revision: -1 })
    .limit(capped)
    .lean();
}

function getCatalogRevision(revision) {
  if (!Number.isSafeInteger(revision) || revision < 1) return null;
  return PosCatalogRevision.findById(CATALOG_ID + ":" + revision).lean();
}

module.exports = {
  seedPosStagingCatalog, getCatalog, saveDraft, publishDraft,
  getCatalogRevisions, getCatalogRevision, makeSnapshot,
};
