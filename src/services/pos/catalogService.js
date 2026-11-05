"use strict";

const PosCatalog = require("../../models/PosCatalog");
const { normalizePosCatalog } = require("./catalogValidation");
const stagingCatalog = require("./stagingCatalog.json");

const CATALOG_ID = "pos-menu";

async function seedPosStagingCatalog() {
  await PosCatalog.updateOne({ _id: CATALOG_ID }, {
    $setOnInsert: { revision: 1, publishedRevision: 1, published: normalizePosCatalog(stagingCatalog), draft: null },
  }, { upsert: true, timestamps: false });
}

function getCatalog() {
  return PosCatalog.findById(CATALOG_ID).lean();
}

function saveDraft(revision, draft) {
  return PosCatalog.findOneAndUpdate({ _id: CATALOG_ID, revision }, {
    $set: { draft },
    $inc: { revision: 1 },
  }, { new: true }).lean();
}

async function publishDraft(revision) {
  const current = await getCatalog();
  if (!current?.draft || current.revision !== revision) return null;
  return PosCatalog.findOneAndUpdate({ _id: CATALOG_ID, revision }, {
    $set: { published: current.draft, draft: null, publishedRevision: revision + 1 },
    $inc: { revision: 1 },
  }, { new: true }).lean();
}

module.exports = { seedPosStagingCatalog, getCatalog, saveDraft, publishDraft };
