"use strict";
const mongoose = require("mongoose");

// This collection is append-only at the POS service layer. Published invoice
// records must reference one immutable revision, never the mutable catalog.
const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  catalogId: { type: String, required: true, immutable: true },
  revision: { type: Number, required: true, immutable: true },
  publishedAt: { type: Date, required: true, immutable: true },
  publishedBy: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
  contentSha256: { type: String, required: true, immutable: true },
  catalog: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
}, {
  timestamps: false,
  collection: "pos_catalog_revisions",
  strict: "throw",
});
schema.index({ catalogId: 1, revision: 1 }, { unique: true });
module.exports = mongoose.model("PosCatalogRevision", schema);
