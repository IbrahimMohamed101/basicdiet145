const mongoose = require("mongoose");
const {
  CONTRACT_MODES,
  CONTRACT_COMPLETENESS_VALUES,
  CONTRACT_SOURCES,
} = require("../constants/phase1Contract");
const {
  addonBalanceLedgerFields,
  addonSelectionLifecycleFields,
} = require("./schemaFragments/subscriptionAddonLifecycleFields");

const PremiumBalanceSchema = new mongoose.Schema(
  {
    configId: { type: mongoose.Schema.Types.ObjectId, ref: "PremiumUpgradeConfig", default: null },
    revision: { type: Number, min: 0, default: 0 },
    premiumKey: { type: String, required: true, trim: true },
    proteinId: { type: mongoose.Schema.Types.ObjectId, ref: "BuilderProtein", default: null },
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
    name: { type: mongoose.Schema.Types.Mixed, default: "" },
    nameI18n: {
      ar: { type: String, default: "" },
      en: { type: String, default: "" },
    },
    imageUrl: { type: String, default: "" },
    purchasedQty: { type: Number, min: 0, default: 0 },
    consumedQty: { type: Number, min: 0, default: 0 },
    reservedQty: { type: Number, min: 0, default: 0 },
    remainingQty: { type: Number, min: 0, default: 0 },
    unitExtraFeeHalala: { type: Number, min: 0, default: 0 },
    totalHalala: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "SAR" },
    catalogVersion: { type: mongoose.Schema.Types.Mixed, default: null },
    purchasedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

// Backend-only base entitlement ledger. Clients continue to use totalMeals,
// remainingMeals and mealBalance; allocation identity is always server-derived.
const BaseMealAllocationSchema = new mongoose.Schema(
  {
    allocationKey: { type: String, required: true, trim: true },
    dayId: { type: mongoose.Schema.Types.ObjectId, ref: "SubscriptionDay", default: null },
    date: { type: String, required: true, trim: true },
    slotKey: { type: String, required: true, trim: true },
    plannerRevisionHash: { type: String, default: "", trim: true },
    quantity: { type: Number, min: 1, max: 1, default: 1 },
    state: { type: String, enum: ["reserved", "consumed", "released", "forfeited"], required: true },
    reservedAt: { type: Date, default: null },
    consumedAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
    forfeitedAt: { type: Date, default: null },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", default: null },
    pickupRequestId: { type: mongoose.Schema.Types.ObjectId, ref: "SubscriptionPickupRequest", default: null },
    premiumFunding: {
      source: { type: String, enum: ["none", "wallet", "pending_payment", "paid_difference"], default: "none" },
      state: { type: String, enum: ["none", "reserved", "paid", "consumed", "released", "forfeited"], default: "none" },
      premiumKey: { type: String, default: "", trim: true },
      balanceBucketId: { type: mongoose.Schema.Types.ObjectId, default: null },
      configId: { type: mongoose.Schema.Types.ObjectId, ref: "PremiumUpgradeConfig", default: null },
      revision: { type: Number, min: 0, default: 0 },
      paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", default: null },
    },
  },
  { _id: true }
);

const AddonBalanceSchema = new mongoose.Schema(
  {
    addonPlanId: { type: mongoose.Schema.Types.ObjectId, ref: "Addon", default: null },
    addonId: { type: mongoose.Schema.Types.ObjectId, ref: "Addon", required: true },
    entitlementKey: { type: String, default: "", trim: true },
    balanceBucketId: { type: mongoose.Schema.Types.ObjectId, default: null },
    name: { type: mongoose.Schema.Types.Mixed, default: "" },
    category: { type: String, default: "" },
    allowanceCategory: { type: String, default: "" },
    displayKey: { type: String, default: "" },
    displayCategory: { type: String, default: "" },
    purchasedDailyQty: { type: Number, min: 0, default: 1 },
    includedTotalQty: { type: Number, min: 0, default: 0 },
    purchasedQty: { type: Number, min: 0, default: 0 },
    consumedQty: { type: Number, min: 0, default: 0 },
    reservedQty: { type: Number, min: 0, default: 0 },
    remainingQty: { type: Number, min: 0, default: 0 },
    extraPurchasedQty: { type: Number, min: 0, default: 0 },
    overageConsumedQty: { type: Number, min: 0, default: 0 },
    unitIncludedPriceHalala: { type: Number, min: 0, default: 0 },
    overageUnitPriceHalala: { type: Number, min: 0, default: 0 },
    unitPriceHalala: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "SAR" },
    purchasedAt: { type: Date, default: Date.now },
    ...addonBalanceLedgerFields(),
  },
  { _id: true }
);

const PremiumSelectionSchema = new mongoose.Schema(
  {
    dayId: { type: mongoose.Schema.Types.ObjectId, ref: "SubscriptionDay" },
    date: { type: String },
    baseSlotKey: { type: String, required: true },
    premiumKey: { type: String, required: true },
    configId: { type: mongoose.Schema.Types.ObjectId, ref: "PremiumUpgradeConfig", default: null },
    revision: { type: Number, min: 0, default: 0 },
    kind: { type: String, trim: true, default: "" },
    entityType: { type: String, trim: true, default: "" },
    selectionType: { type: String, trim: true, default: "" },
    sourceType: { type: String, trim: true, default: "" },
    sourceModel: { type: String, trim: true, default: "" },
    sourceId: { type: String, trim: true, default: "" },
    sourceProductId: { type: String, trim: true, default: "" },
    sourceGroupId: { type: String, trim: true, default: "" },
    sourceGroupKey: { type: String, trim: true, default: "" },
    sourceKey: { type: String, trim: true, default: "" },
    name: { type: mongoose.Schema.Types.Mixed, default: "" },
    nameI18n: { type: mongoose.Schema.Types.Mixed, default: undefined },
    imageUrl: { type: String, default: "" },
    proteinId: { type: mongoose.Schema.Types.ObjectId, ref: "BuilderProtein", default: null },
    quantity: { type: Number, min: 1, default: 1 },
    coveredQty: { type: Number, min: 0, default: 0 },
    paidQty: { type: Number, min: 0, default: 0 },
    unitExtraFeeHalala: { type: Number, min: 0, default: 0 },
    payableTotalHalala: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "SAR" },
    balanceBucketId: { type: mongoose.Schema.Types.ObjectId, default: null },
    premiumWalletRowId: { type: mongoose.Schema.Types.ObjectId, default: null },
    source: { type: String, enum: ["subscription", "pending_payment", "paid", ""], default: "" },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", default: null },
    consumedAt: { type: Date, default: Date.now },
    paidAt: { type: Date, default: null },
  },
  { _id: true }
);

const AddonSelectionSchema = new mongoose.Schema(
  {
    dayId: { type: mongoose.Schema.Types.ObjectId, ref: "SubscriptionDay" },
    date: { type: String },
    addonId: { type: mongoose.Schema.Types.ObjectId, ref: "Addon", required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, default: null },
    menuProductId: { type: mongoose.Schema.Types.ObjectId, default: null },
    addonPlanId: { type: mongoose.Schema.Types.ObjectId, ref: "Addon", default: null },
    addonKey: { type: String, default: "", trim: true },
    productKey: { type: String, default: "", trim: true },
    name: { type: String, default: "" },
    nameI18n: { type: mongoose.Schema.Types.Mixed, default: undefined },
    imageUrl: { type: String, default: "" },
    qty: { type: Number, min: 1, default: 1 },
    quantity: { type: Number, min: 1, default: 1 },
    coveredQty: { type: Number, min: 0, default: 0 },
    paidQty: { type: Number, min: 0, default: 0 },
    priceHalala: { type: Number, min: 0, default: 0 },
    unitPriceHalala: { type: Number, min: 0, default: 0 },
    payableTotalHalala: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "SAR" },
    consumedAt: { type: Date, default: Date.now },
    // Owned entitlement identity — populated on save so edit/cancel can release the exact bucket.
    // All fields are optional for backward compatibility with historical selections.
    category: { type: String, default: "" },
    entitlementCategory: { type: String, default: "" },
    entitlementKey: { type: String, default: "" },
    balanceBucketId: { type: mongoose.Schema.Types.ObjectId, default: null },
    ownedSnapshot: { type: Boolean, default: false },
    snapshotMissing: { type: Boolean, default: false },
    liveCatalogMissing: { type: Boolean, default: false },
    legacyRecovered: { type: Boolean, default: false },
    legacySourceProductId: { type: mongoose.Schema.Types.ObjectId, default: null },
    available: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
    availableForNewSale: { type: Boolean, default: true },
    catalogAvailable: { type: Boolean, default: true },
    catalogActive: { type: Boolean, default: true },
    liveCatalogAvailable: { type: Boolean, default: true },
    liveCatalogActive: { type: Boolean, default: true },
    selectable: { type: Boolean, default: true },
    selectionAvailable: { type: Boolean, default: true },
    disabled: { type: Boolean, default: false },
    disableReason: { type: String, default: null },
    isEligibleForAllowance: { type: Boolean, default: false },
    requestedQty: { type: Number, min: 1, default: 1 },
    includedTotalQty: { type: Number, min: 0, default: 0 },
    remainingQty: { type: Number, min: 0, default: 0 },
    freeQtyAvailable: { type: Number, min: 0, default: 0 },
    remainingBefore: { type: Number, min: 0, default: 0 },
    remainingAfter: { type: Number, min: 0, default: 0 },
    pricingMode: {
      type: String,
      enum: ["allowance_covered", "allowance_partial", "paid_overage", "paid_no_entitlement", ""],
      default: "",
    },
    maxPerDay: { type: Number, min: 1, default: 1 },
    source: { type: String, default: "" },
    ...addonSelectionLifecycleFields(mongoose),
  },
  { _id: true }
);

// Immutable product snapshot stored per entitlement at checkout so the product
// can still be resolved after the live catalog record is archived.
const MenuProductSnapshotSchema = new mongoose.Schema(
  {
    id: { type: mongoose.Schema.Types.ObjectId, ref: "MenuProduct" },
    key: { type: String, default: "" },
    name: { type: mongoose.Schema.Types.Mixed, default: "" },
    nameI18n: { type: mongoose.Schema.Types.Mixed, default: null },
    description: { type: mongoose.Schema.Types.Mixed, default: "" },
    descriptionI18n: { type: mongoose.Schema.Types.Mixed, default: null },
    imageUrl: { type: String, default: "" },
    category: { type: String, default: "" },
    categoryKey: { type: String, default: "" },
    itemType: { type: String, default: "" },
    priceHalala: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "SAR" },
  },
  { _id: false }
);

const AddonSubscriptionEntitlementSchema = new mongoose.Schema(
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
    entitlementKey: { type: String, default: "", trim: true },
    balanceBucketId: { type: mongoose.Schema.Types.ObjectId, default: null },
    sortOrder: { type: Number, default: 0 },
    maxPerDay: { type: Number, min: 1, default: 1 },
    basePlanId: { type: mongoose.Schema.Types.ObjectId, ref: "Plan" },
    priceHalala: { type: Number, default: 0 },
    quantityPerDay: { type: Number, min: 1, default: 1 },
    purchasedDailyQty: { type: Number, min: 1, default: 1 },
    includedTotalQty: { type: Number, min: 0, default: 0 },
    unitPlanPriceHalala: { type: Number, min: 0, default: 0 },
    // Authoritative per-unit price for this entitlement — persisted at checkout
    // so validate/save can price correctly even when the live catalog is archived.
    unitPriceHalala: { type: Number, min: 0, default: 0 },
    totalHalala: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "SAR" },
    menuProductIds: { type: [mongoose.Schema.Types.ObjectId], ref: "MenuProduct", default: [] },
    menuCategoryKeys: { type: [String], default: [] },
    priceSource: { type: String, default: "" },
    sourceRequestShape: { type: mongoose.Schema.Types.Mixed, default: null },
    // Immutable product snapshot. Optional — absent on historical subscriptions.
    // Use as fallback when the live MenuProduct document is no longer accessible.
    menuProductsSnapshot: { type: [MenuProductSnapshotSchema], default: undefined },
  },
  { _id: false }
);

const AppliedPromoSchema = new mongoose.Schema(
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
  },
  { _id: false }
);

const SubscriptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", required: true },
    // Parent subscription lifecycle.
    // Active subscriptions may have individual SubscriptionDay rows with status
    // "frozen"; the parent "frozen" status is retained only for legacy reads.
    // "expired" is normally resolved as an effective read status after
    // validityEndDate; historical rows may persist it. "completed" is also a
    // legacy terminal value and is not written by the canonical checkout flow.
    status: { type: String, enum: ["pending_payment", "active", "frozen", "expired", "canceled", "completed"], default: "pending_payment" },
    startDate: { type: Date },
    endDate: { type: Date },
    validityEndDate: { type: Date },
    canceledAt: { type: Date, default: null },
    cancellationReason: { type: String, trim: true, default: "" },
    replacedBySubscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription", default: null },
    replacedAt: { type: Date, default: null },
    replacementState: { type: String, enum: ["", "staged", "switching", "completed"], default: "" },
    totalMeals: { type: Number, required: true },
    remainingMeals: { type: Number, required: true },
    entitlementVersion: { type: Number, default: undefined },
    reservedMeals: { type: Number, min: 0, default: undefined },
    consumedMeals: { type: Number, min: 0, default: undefined },
    forfeitedMeals: { type: Number, min: 0, default: undefined },
    baseMealAllocations: { type: [BaseMealAllocationSchema], default: undefined },
    addonSubscriptions: { type: [AddonSubscriptionEntitlementSchema], default: [] },
    addonBalance: { type: [AddonBalanceSchema], default: [] },
    addonSelections: { type: [AddonSelectionSchema], default: [] },

    selectedGrams: { type: Number },
    selectedMealsPerDay: { type: Number },
    basePlanPriceHalala: { type: Number, min: 0, default: 0 },
    basePlanGrossHalala: { type: Number, min: 0, default: 0 },
    basePlanNetHalala: { type: Number, min: 0, default: 0 },
    discountHalala: { type: Number, min: 0, default: 0 },
    subtotalHalala: { type: Number, min: 0, default: 0 },
    subtotalBeforeVatHalala: { type: Number, min: 0, default: 0 },
    vatPercentage: { type: Number, min: 0, default: 0 },
    vatHalala: { type: Number, min: 0, default: 0 },
    totalPriceHalala: { type: Number, min: 0, default: 0 },
    checkoutCurrency: { type: String, default: "SAR" },
    appliedPromo: { type: AppliedPromoSchema, default: null },

    premiumBalance: { type: [PremiumBalanceSchema], default: [] },
    premiumSelections: { type: [PremiumSelectionSchema], default: [] },

    contractVersion: { type: String, trim: true },
    contractMode: { type: String, enum: CONTRACT_MODES },
    contractCompleteness: { type: String, enum: CONTRACT_COMPLETENESS_VALUES },
    contractSource: { type: String, enum: CONTRACT_SOURCES },
    contractHash: { type: String, trim: true },
    contractSnapshot: { type: mongoose.Schema.Types.Mixed },
    renewedFromSubscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription", default: null },

    deliveryMode: { type: String, enum: ["delivery", "pickup"], required: true },
    deliveryAddress: {
      line1: { type: String },
      line2: { type: String },
      city: { type: String },
      district: { type: String },
      street: { type: String },
      building: { type: String },
      apartment: { type: String },
      lat: { type: Number },
      lng: { type: Number },
      notes: { type: String },
    },
    deliveryZoneId: { type: mongoose.Schema.Types.ObjectId, default: null },
    deliveryZoneName: { type: String, default: "" },
    deliveryFeeHalala: { type: Number, default: 0 },
    pickupLocationId: { type: String, default: "" },
    deliveryWindow: { type: String },
    deliverySlot: {
      type: {
        type: String,
        enum: ["delivery", "pickup"],
        default: "delivery",
      },
      window: { type: String, default: "" },
      slotId: { type: String, default: "" },
      label: { type: String, default: "" },
    },

    skippedCount: { type: Number, default: 0 },
    skipDaysUsed: { type: Number, default: 0 },
    expiryReminder3dSentAt: { type: Date, default: null },
    expiryReminder24hSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Performance: common per-user reads are covered by the userId prefix of { userId, status } below.
SubscriptionSchema.index({ status: 1, createdAt: -1 });
// Support efficient lookups for per-user subscription lists that may be filtered by status.
SubscriptionSchema.index({ userId: 1, status: 1 });
// Enforce the domain invariant after duplicate active production rows have been audited/repaired.
SubscriptionSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { status: "active" } }
);

module.exports = mongoose.model("Subscription", SubscriptionSchema);
