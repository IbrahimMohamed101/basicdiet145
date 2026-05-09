const mongoose = require("mongoose");

const LocalizedStringSchema = new mongoose.Schema(
  {
    ar: { type: String, default: "" },
    en: { type: String, default: "" },
  },
  { _id: false }
);

const SharedMenuIdentitySchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        "product",
        "option",
        "category",
        "addon",
        "protein",
        "carb",
        "sauce",
        "fruit",
        "vegetable",
        "sandwich",
        "drink",
        "dessert",
        "other",
      ],
    },
    name: {
      type: LocalizedStringSchema,
      default: () => ({}),
    },
    aliases: {
      ar: { type: [String], default: [] },
      en: { type: [String], default: [] },
    },
    imageUrl: { type: String, default: "" },
    canonicalFamilyKey: { type: String, trim: true, default: "" },
    tags: { type: [String], default: [] },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser" },
  },
  { timestamps: true }
);

// Indexes
SharedMenuIdentitySchema.index({ type: 1, isActive: 1 });
SharedMenuIdentitySchema.index({ canonicalFamilyKey: 1 });

// Validation
SharedMenuIdentitySchema.pre("validate", function (next) {
  if (!this.name.ar && !this.name.en) {
    this.invalidate("name", "At least one name (ar or en) is required");
  }
  next();
});

module.exports = mongoose.model("SharedMenuIdentity", SharedMenuIdentitySchema);
