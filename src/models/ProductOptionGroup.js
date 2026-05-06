const mongoose = require("mongoose");

const ProductOptionGroupSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "MenuProduct", required: true, index: true },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: "MenuOptionGroup", required: true, index: true },
    minSelections: { type: Number, min: 0, default: 0 },
    maxSelections: { type: Number, min: 0, default: null },
    isRequired: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

ProductOptionGroupSchema.index({ productId: 1, groupId: 1 }, { unique: true });
ProductOptionGroupSchema.index({ productId: 1, isActive: 1, sortOrder: 1 });

module.exports = mongoose.model("ProductOptionGroup", ProductOptionGroupSchema);
