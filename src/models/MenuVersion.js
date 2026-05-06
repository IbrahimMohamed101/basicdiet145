const mongoose = require("mongoose");

const MenuVersionSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["draft", "published", "archived"], default: "draft", index: true },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    notes: { type: String, default: "" },
    snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

MenuVersionSchema.index({ status: 1, publishedAt: -1 });

module.exports = mongoose.model("MenuVersion", MenuVersionSchema);
