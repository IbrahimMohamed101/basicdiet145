const mongoose = require("mongoose");

const MenuIdentityLinkSchema = new mongoose.Schema(
  {
    identityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SharedMenuIdentity",
      required: true,
    },
    channel: {
      type: String,
      required: true,
      enum: ["one_time", "subscription"],
    },
    sourceModel: {
      type: String,
      required: true,
      enum: [
        "MenuProduct",
        "MenuOption",
        "MenuCategory",
        "BuilderProtein",
        "BuilderCarb",
        "SaladIngredient",
        "Addon",
        "Sandwich",
      ],
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    sourceKey: { type: String, trim: true },
    sourceType: { type: String, trim: true },
    confidence: {
      type: String,
      enum: ["exact", "alias", "manual"],
      default: "manual",
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "rejected"],
      default: "confirmed",
    },
    notes: { type: String, default: "" },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser" },
  },
  { timestamps: true }
);

// Indexes
// Unique active link on channel + sourceModel + sourceId using partialFilterExpression { isActive: true }
MenuIdentityLinkSchema.index(
  { channel: 1, sourceModel: 1, sourceId: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

MenuIdentityLinkSchema.index({ identityId: 1, channel: 1 });
MenuIdentityLinkSchema.index({ sourceModel: 1, sourceId: 1 });
MenuIdentityLinkSchema.index({ sourceKey: 1 });
MenuIdentityLinkSchema.index({ confidence: 1, status: 1 });

module.exports = mongoose.model("MenuIdentityLink", MenuIdentityLinkSchema);
