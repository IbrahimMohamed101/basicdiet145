"use strict";

const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  _id: String,
  revision: { type: Number, required: true },
  publishedRevision: { type: Number, required: true },
  published: { type: mongoose.Schema.Types.Mixed, required: true },
  draft: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true, collection: "pos_catalogs" });

module.exports = mongoose.model("PosCatalog", schema);
