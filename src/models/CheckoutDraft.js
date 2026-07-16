const mongoose = require("mongoose");
const {
  CONTRACT_MODES,
  CONTRACT_COMPLETENESS_VALUES,
  CONTRACT_SOURCES,
} = require("../constants/phase1Contract");
const DraftPremiumItemSchema = new mongoose.Schema(
  {
    configId: { type: mongoose.Schema.Types.ObjectId, ref: "PremiumUpgradeConfig", default: null },
    revision: { type: Number, min: 0, default: 0 },
    proteinId: { type: mongoose.Schema.Types.ObjectId, ref: "BuilderProtein", default: null },
    premiumKey: { type: String, required: true, trim: true },
    kind: { type: String, trim: true, default: "" },
    entityType: { type: String, trim: true, default: "premium_meal" },
    selectionType: { type: String, trim: true, default: "" },
    sourceType: { type: String, trim: true, default: "" },
    sourceModel: { type: String, trim: true, default: "" },
    sourceId: { type: String, trim: true, default: "" },
    sourceProductId: { type: String, trim: true, default: "" },
    sourceGroupId: { type: String, trim: true, default: "" },
    sourceGroupKey: { type: String, trim: true, default: "" },
    sourceKey: { type: String, trim: true, default: "" },
    name: { type: String, default: "" },
    nameI18n: {
      ar: { type: String, default: "" },
      en: { type: String, default: "" },
    },
    imageUrl: { type: String, default: "" },
    qty: { type: Number, min: 1, required: true },
    unitExtraFeeHalala: { type: Number, min: 0, required: true },
    totalHalala: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "SAR" },
    catalogVersion: { type: mongoose.Schema.Types.Mixed, default: null },
    purchasedAt: { type: Date, default: Date.now },
    priceSource: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

DraftPremiumItemSchema.pre("validate", function (next) {
  if (!this.proteinId && !this.premiumKey) {
    next(new Error("Either proteinId or premiumKey must be provided"));
  }
  next();
});

const DraftAddonSubscriptionSchema = new mongoose.Schema(
  {
    addonId: { type: mongoose.Schema.Types.ObjectId, ref: "Addon" }, // The Category Plan ID
    addonPlanId: { type: mongoose.Schema.Types.ObjectId, ref: "Addon" },
    name: { type: String, default: "" },
    addonPlanName: { type: String, default: "" },
    addonPlanNameI18n: { type: mongoose.Schema.Types.Mixed, default: null },
    category: { type: String, required: true },
    allowanceCategory: { type: String, default: "" },
    displayKey: { type: String, default: "" },
    displayCategory: { type: String, default: "" },
    sortOrder: { type: Number, default: 0 },
    entitlementKey: { type: String, default: "", trim: true },
    maxPerDay: { type: Number, min: 1, default: 1 },
    basePlanId: { type: mongoose.Schema.Types.ObjectId, ref: "Plan" },
    priceHalala: { type: Number, default: 0 },
    quantityPerDay: { type: Number, min: 1, default: 1 },
    purchasedDailyQty: { type: Number, min: 1, default: 1 },
    includedTotalQty: { type: Number, min: 0, default: 0 },
    unitPlanPriceHalala: { type: Number, min: 0, default: 0 },
    totalHalala: { type: Number, min: 0, default: 0 },
    unitPriceHalala: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "SAR" },
    menuProductIds: { type: [mongoose.Schema.Types.ObjectId], ref: "MenuProduct", default: [] },
    menuCategoryKeys: { type: [String], default: [] },
    priceSource: { type: String, default: "" },
    menuProductsSnapshot: { type: [mongoose.Schema.Types.Mixed], default: undefined },
    sourceRequestShape: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const DraftPromoSchema = new mongoose.Schema(
  {
    promoCodeId: { type: mongoose.Schema.Types.ObjectId, ref: "PromoCode", default: null },
    usageId: { type: mongoose.Schema.Types.ObjectId, ref: "PromoUsage", default: null },
    code: { type: String, default: "" },
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    discountType: { type: String, enum: ["percentage", "fixed"], default: null },
    discountValue: { type: Number, min: 0, default: 0 },
    discountAmountHalala: { type: Number, min: 0, default: 0 },
    message: { type: String, default: "" },
    isApplied: { type: Boolean, default: false },
  },
  { _id: false }
);

const InvoiceInitializationSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["idle", "initializing", "ready", "failed"],
      default: "idle",
    },
    token: { type: String, trim: true, default: "" },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
  },
  { _id: false }
);

/**
 * Item 9: Pre-Activation Model
 * CheckoutDraft explicitly models the pre-activation state along with its paired Payment.
 * It is intentionally designed NOT as an actual Subscription row to avoid 'ghost' reservations.
 * If draft is completed successfully, it converts into a row in the Subscription collection.
 */
const CheckoutDraftSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", required: true },
    idempotencyKey: { type: String, trim: true, default: "" },
    requestHash: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["pending_payment", "completed", "failed", "canceled", "expired"],
      default: "pending_payment",
    },

    daysCount: { type: Number, required: true, min: 1 },
    grams: { type: Number, required: true, min: 1 },
    mealsPerDay: { type: Number, required: true, min: 1 },
    startDate: { type: Date },

    delivery: {
      type: {
        type: String,
        enum: ["delivery", "pickup"],
        required: true,
      },
      firstDayFulfillmentOverride: { type: mongoose.Schema.Types.Mixed, default: null },
      address: { type: mongoose.Schema.Types.Mixed },
      zoneId: { type: mongoose.Schema.Types.ObjectId, default: null },
      zoneName: { type: String, default: "" },
      pickupLocationId: { type: String, default: "" },
      slot: {
        type: {
          type: String,
          enum: ["delivery", "pickup"],
          default: "delivery",
        },
        window: { type: String, default: "" },
        slotId: { type: String, default: "" },
        label: { type: String, default: "" },
      },
    },

    premiumItems: { type: [DraftPremiumItemSchema], default: [] },
    premiumUpgradeLimit: {
      maxPremiumUpgrades: { type: Number, min: 0, default: 0 },
      selectedPremiumUpgrades: { type: Number, min: 0, default: 0 },
      remainingPremiumUpgrades: { type: Number, min: 0, default: 0 },
    },
    addonSubscriptions: { type: [DraftAddonSubscriptionSchema], default: [] },
    promo: { type: DraftPromoSchema, default: null },

    contractVersion: { type: String, trim: true },
    contractMode: { type: String, enum: CONTRACT_MODES },
    contractCompleteness: { type: String, enum: CONTRACT_COMPLETENESS_VALUES },
    contractSource: { type: String, enum: CONTRACT_SOURCES },
    contractHash: { type: String, trim: true },
    contractSnapshot: { type: mongoose.Schema.Types.Mixed },
    renewedFromSubscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription", default: null },

    breakdown: {
      basePlanPriceHalala: { type: Number, min: 0, required: true },
      basePlanGrossHalala: { type: Number, min: 0 },
      basePlanNetHalala: { type: Number, min: 0 },
      premiumTotalHalala: { type: Number, min: 0, required: true },
      addonsTotalHalala: { type: Number, min: 0, required: true },
      deliveryFeeHalala: { type: Number, min: 0, required: true },
      grossTotalHalala: { type: Number, min: 0, default: 0 },
      discountHalala: { type: Number, min: 0, default: 0 },
      subtotalHalala: { type: Number, min: 0, default: 0 },
      subtotalBeforeVatHalala: { type: Number, min: 0, default: 0 },
      vatPercentage: { type: Number, min: 0, default: 0 },
      vatHalala: { type: Number, min: 0, required: true },
      totalHalala: { type: Number, min: 0, required: true },
      currency: { type: String, default: "SAR" },
    },

    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },
    providerInvoiceId: { type: String },
    paymentUrl: { type: String, default: "" },
    invoiceInitialization: { type: InvoiceInitializationSchema, default: () => ({}) },
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription" },
    completedAt: { type: Date },
    failedAt: { type: Date },
    failureReason: { type: String, default: "" },
  },
  { timestamps: true }
);

CheckoutDraftSchema.index({ userId: 1, createdAt: -1 });
CheckoutDraftSchema.index({ status: 1, createdAt: -1 });
CheckoutDraftSchema.index({ userId: 1, requestHash: 1, status: 1, createdAt: -1 });
CheckoutDraftSchema.index(
  { userId: 1, requestHash: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "pending_payment", requestHash: { $type: "string", $gt: "" } } }
);
CheckoutDraftSchema.index(
  { userId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string", $gt: "" } } }
);
CheckoutDraftSchema.index({ paymentId: 1 }, { sparse: true });
CheckoutDraftSchema.index({ providerInvoiceId: 1 }, { sparse: true });
CheckoutDraftSchema.index({ "invoiceInitialization.status": 1, "invoiceInitialization.startedAt": 1 });

function isIdempotencyDuplicateKeyError(err) {
  if (!err || err.code !== 11000) return false;
  const fields = Object.keys(err.keyPattern || err.keyValue || {});
  if (fields.some((field) => field === "idempotencyKey" || field === "requestHash")) {
    return true;
  }
  const message = String(err.message || "");
  return message.includes("idempotencyKey") || message.includes("requestHash");
}

function idempotencyConflictError() {
  const err = new Error("idempotencyKey is already used with a different checkout payload");
  err.status = 409;
  err.code = "IDEMPOTENCY_CONFLICT";
  return err;
}

const CheckoutDraft = mongoose.model("CheckoutDraft", CheckoutDraftSchema);
const originalCreate = CheckoutDraft.create.bind(CheckoutDraft);

// Turn a database-level uniqueness race into the same idempotent result that a
// caller would receive if the winning draft had been visible during the first
// lookup. This is intentionally limited to single-document CheckoutDraft.create
// calls; array/bulk/session variants preserve native Mongoose behavior.
CheckoutDraft.create = async function createCheckoutDraftWithRaceRecovery(doc, ...args) {
  if (!doc || Array.isArray(doc) || args.length > 0) {
    return originalCreate(doc, ...args);
  }

  try {
    return await originalCreate(doc);
  } catch (err) {
    if (!isIdempotencyDuplicateKeyError(err) || !doc.userId) {
      throw err;
    }

    const idempotencyKey = String(doc.idempotencyKey || "").trim();
    const requestHash = String(doc.requestHash || "").trim();

    if (idempotencyKey) {
      const existingByKey = await CheckoutDraft.findOne({
        userId: doc.userId,
        idempotencyKey,
      }).sort({ createdAt: -1 });

      if (existingByKey) {
        const existingHash = String(existingByKey.requestHash || "").trim();
        if (requestHash && existingHash && existingHash !== requestHash) {
          throw idempotencyConflictError();
        }
        return existingByKey;
      }
    }

    if (requestHash) {
      const existingByHash = await CheckoutDraft.findOne({
        userId: doc.userId,
        requestHash,
        status: "pending_payment",
      }).sort({ createdAt: -1 });
      if (existingByHash) {
        return existingByHash;
      }
    }

    throw err;
  }
};

module.exports = CheckoutDraft;
