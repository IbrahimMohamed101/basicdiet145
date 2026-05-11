const mongoose = require("mongoose");
const integerOrNull = {
  validator(value) {
    return value === null || value === undefined || Number.isInteger(value);
  },
  message: "{PATH} must be an integer",
};

const ProductGroupOptionSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "MenuProduct", required: true, index: true },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: "MenuOptionGroup", required: true, index: true },
    optionId: { type: mongoose.Schema.Types.ObjectId, ref: "MenuOption", required: true, index: true },
    extraPriceHalala: { type: Number, min: 0, default: null, validate: integerOrNull },
    extraWeightUnitGrams: { type: Number, min: 0, default: null, validate: integerOrNull },
    extraWeightPriceHalala: { type: Number, min: 0, default: null, validate: integerOrNull },
    isActive: { type: Boolean, default: true, index: true },
    isVisible: { type: Boolean, default: true, index: true },
    isAvailable: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

ProductGroupOptionSchema.index({ productId: 1, groupId: 1, optionId: 1 }, { unique: true });
ProductGroupOptionSchema.index({ productId: 1, groupId: 1, isActive: 1, isVisible: 1, isAvailable: 1, sortOrder: 1 });

module.exports = mongoose.model("ProductGroupOption", ProductGroupOptionSchema);
