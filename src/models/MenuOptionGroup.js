const mongoose = require("mongoose");

const LocalizedStringSchema = new mongoose.Schema(
  {
    ar: { type: String, default: "" },
    en: { type: String, default: "" },
  },
  { _id: false }
);

const MenuOptionGroupSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    name: { type: LocalizedStringSchema, default: () => ({}) },
    description: { type: LocalizedStringSchema, default: () => ({}) },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    publishedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

MenuOptionGroupSchema.index({ key: 1 }, { unique: true });
MenuOptionGroupSchema.index({ isActive: 1, publishedAt: 1, sortOrder: 1, createdAt: -1 });

module.exports = mongoose.model("MenuOptionGroup", MenuOptionGroupSchema);
