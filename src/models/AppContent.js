const mongoose = require("mongoose");

const AppContentSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    locale: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      default: "ar",
    },
    version: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DashboardUser",
      default: null,
    },
  },
  { timestamps: true }
);

AppContentSchema.index(
  { key: 1, locale: 1, isActive: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
    name: "uniq_active_content_per_key_locale",
  }
);

module.exports = mongoose.model("AppContent", AppContentSchema);
