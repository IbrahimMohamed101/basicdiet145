const mongoose = require("mongoose");

function addLifecycleAvailabilityFilter(query) {
  const filter = query.getFilter();
  if (filter.isActive !== true) return;
  if (filter.isArchived === undefined) query.where({ isArchived: { $ne: true } });
  if (filter.archivedAt === undefined) query.where({ archivedAt: null });
  if (filter.isDeleted === undefined) query.where({ isDeleted: { $ne: true } });
  if (filter.deletedAt === undefined) query.where({ deletedAt: null });
}

function syncArchiveUpdateLifecycle(query) {
  const update = query.getUpdate() || {};
  const set = update.$set || update;
  if (set.isArchived === true || set.isDeleted === true || set.archivedAt || set.deletedAt) {
    if (!update.$set) update.$set = {};
    update.$set.isActive = false;
    query.setUpdate(update);
  }
}

const AddonSchema = new mongoose.Schema(
  {
    name: {
      ar: { type: String, default: "" },
      en: { type: String, default: "" },
    },
    description: {
      ar: { type: String, default: "" },
      en: { type: String, default: "" },
    },
    imageUrl: { type: String, default: "" },
    priceHalala: { type: Number, required: true, min: 0 },
    priceSar: { type: Number, default: 0, min: 0 },
    priceLabel: { type: String, default: "" },
    currency: { type: String, default: "SAR" },
    isActive: { type: Boolean, default: true },
    isArchived: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    sortOrder: { type: Number, default: 0 },

    // New explicit billing behavior control.
    // flat_once: total = price (usually for ad-hoc one-day purchase)
    // per_day: total = price * days (standard for subscription plans)
    // per_meal: total = price * days * mealsPerDay
    billingMode: {
      type: String,
      enum: ["flat_once", "per_day", "per_meal"],
      default: "per_day",
    },

    // New Addon categorization
    // plan: The entity purchased at checkout (e.g. "Juice Subscription Plan")
    // item: The specific entity selected daily (e.g. "Orange Juice")
    kind: {
      type: String,
      enum: ["plan", "item"],
      default: "item",
      required: true,
    },

    type: {
      type: String,
      enum: ["subscription", "one_time"],
      default: "one_time",
    },

    pricingModel: {
      type: String,
      enum: ["one_time", "subscription"],
      default: "one_time",
    },

    billingUnit: {
      type: String,
      enum: ["item", "day", "meal"],
      default: "item",
    },

    category: {
      type: String,
      enum: ["juice", "snack", "small_salad"],
      required: true,
      trim: true,
    },

    menuProductId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MenuProduct",
      default: null,
      index: true,
    },

    menuProductIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "MenuProduct" }],
      default: [],
    },

    menuCategoryKeys: {
      type: [String],
      default: [],
    },

    maxPerDay: {
      type: Number,
      default: 1,
    },

    pricingMode: {
      type: String,
      enum: ["base_plan_matrix"],
      default: undefined,
    },

    // Backward-compat fields.
    price: { type: Number, default: 0 },
  },
  { timestamps: true }
);

AddonSchema.pre("validate", function syncBillingModeAndKind(next) {
  // 1. Sync legacy priceHalala
  if (this.priceHalala === undefined && Number.isFinite(this.price)) {
    this.priceHalala = Math.max(0, Math.round(Number(this.price) * 100));
  }
  if ((!Number.isFinite(this.price) || this.price === 0) && Number.isFinite(this.priceHalala)) {
    this.price = Number(this.priceHalala) / 100;
  }
  if (Number.isFinite(this.priceHalala)) {
    this.priceSar = Number(this.priceHalala) / 100;
    this.priceLabel = `${this.priceSar} SAR`;
  }

  // 2. Sync billingMode and kind
  // If kind is "item", billingMode should usually be "flat_once" (as it's priced per selection)
  if (this.kind === "item" && !this.isModified("billingMode")) {
    this.billingMode = "flat_once";
  }
  // If kind is "plan", billingMode is usually "per_day" (subscription)
  if (this.kind === "plan" && !this.isModified("billingMode")) {
    this.billingMode = "per_day";
  }
  if (this.billingMode === "flat_once") {
    this.type = "one_time";
    this.pricingModel = "one_time";
    this.billingUnit = "item";
  } else if (this.billingMode === "per_day") {
    this.type = "subscription";
    this.pricingModel = "subscription";
    this.billingUnit = "day";
  } else if (this.billingMode === "per_meal") {
    this.type = "subscription";
    this.pricingModel = "subscription";
    this.billingUnit = "meal";
  }

  if (this.isArchived || this.isDeleted || this.archivedAt || this.deletedAt) {
    this.isActive = false;
  }

  next();
});

AddonSchema.pre(/^find/, function filterArchivedActiveRows(next) {
  addLifecycleAvailabilityFilter(this);
  next();
});
for (const operation of ["updateOne", "updateMany", "findOneAndUpdate"]) {
  AddonSchema.pre(operation, function syncArchiveUpdates(next) {
    syncArchiveUpdateLifecycle(this);
    next();
  });
}

AddonSchema.index(
  { kind: 1, category: 1, isActive: 1 },
  { name: "kind_1_category_1_isActive_1" }
);

AddonSchema.index(
  { isActive: 1, sortOrder: 1 },
  { name: "isActive_1_sortOrder_1" }
);

module.exports = mongoose.model("Addon", AddonSchema);
