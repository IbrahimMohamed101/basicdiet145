const mongoose = require("mongoose");

const MealSlotSchema = new mongoose.Schema(
  {
    slotIndex: { type: Number, required: true, min: 1 },
    slotKey: {
      type: String,
      required: true,
      trim: true,
      default() {
        return Number.isInteger(this.slotIndex) && this.slotIndex > 0 ? `slot_${this.slotIndex}` : undefined;
      },
    },
    status: {
      type: String,
      enum: ["empty", "partial", "complete"],
      default: "empty",
      required: true,
    },
    proteinId: { type: mongoose.Schema.Types.ObjectId, ref: "BuilderProtein", default: null },
    proteinDisplayCategoryKey: { type: String, default: null, trim: true },
    proteinFamilyKey: {
      type: String,
      enum: ["chicken", "beef", "seafood", "other"],
      default: null,
    },
    proteinRuleTags: { type: [String], default: [] },
    carbId: { type: mongoose.Schema.Types.ObjectId, ref: "BuilderCarb", default: null },
    carbDisplayCategoryKey: { type: String, default: null, trim: true },
    isPremium: { type: Boolean, default: false },
    premiumCreditCost: { type: Number, min: 0, default: 0 },
    premiumSource: {
      type: String,
      enum: ["none", "balance", "pending_payment", "paid_extra", "paid"],
      default: "none",
    },
    premiumExtraFeeHalala: { type: Number, min: 0, default: 0 },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const PlannerMetaSchema = new mongoose.Schema(
  {
    requiredSlotCount: { type: Number, min: 0, default: 0 },
    emptySlotCount: { type: Number, min: 0, default: 0 },
    partialSlotCount: { type: Number, min: 0, default: 0 },
    completeSlotCount: { type: Number, min: 0, default: 0 },
    beefSlotCount: { type: Number, min: 0, default: 0 },
    premiumSlotCount: { type: Number, min: 0, default: 0 },
    premiumCoveredByBalanceCount: { type: Number, min: 0, default: 0 },
    premiumPendingPaymentCount: { type: Number, min: 0, default: 0 },
    premiumPaidExtraCount: { type: Number, min: 0, default: 0 },
    premiumTotalHalala: { type: Number, min: 0, default: 0 },
    isDraftValid: { type: Boolean, default: true },
    isConfirmable: { type: Boolean, default: false },
    lastEditedAt: { type: Date, default: Date.now },
    confirmedAt: { type: Date, default: null },
    confirmedByRole: { type: String, default: null },
  },
  { _id: false }
);

const MaterializedMealSchema = new mongoose.Schema(
  {
    slotKey: { type: String, required: true, trim: true },
    proteinId: { type: mongoose.Schema.Types.ObjectId, ref: "BuilderProtein", required: true },
    carbId: { type: mongoose.Schema.Types.ObjectId, ref: "BuilderCarb", required: true },
    isPremium: { type: Boolean, default: false },
    premiumSource: {
      type: String,
      enum: ["none", "balance", "pending_payment", "paid_extra", "paid"],
      default: "none",
    },
    comboKey: { type: String, required: true, trim: true },
    operationalSku: { type: String, required: true, trim: true },
    generatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const PremiumExtraPaymentSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["none", "pending", "paid", "failed", "expired", "revision_mismatch"],
      default: "none",
    },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", default: null },
    providerInvoiceId: { type: String, trim: true, default: null },
    amountHalala: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "SAR" },
    expiresAt: { type: Date, default: null },
    reused: { type: Boolean, default: false },
    revisionHash: { type: String, trim: true, default: "" },
    extraPremiumCount: { type: Number, min: 0, default: 0 },
    createdAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
  },
  { _id: false }
);

const SubscriptionDaySchema = new mongoose.Schema(
  {
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription", required: true },
    date: { type: String, required: true }, // YYYY-MM-DD (KSA)
    status: {
      type: String,
      enum: [
        "open",
        "frozen",
        "locked",
        "in_preparation",
        "out_for_delivery",
        "ready_for_pickup",
        "fulfilled",
        "consumed_without_preparation",
        // Item 11: Terminal delivery failures.
        // These statuses do NOT trigger automatic compensation. 
        // Compensation is strictly admin-controlled via explicit addition of days.
        "delivery_canceled",
        "canceled_at_branch",
        "no_show",
        "skipped",
      ],
      default: "open",
    },
    selections: [{ type: mongoose.Schema.Types.ObjectId, ref: "Meal" }],
    addonSelections: [
      {
        addonId: { type: mongoose.Schema.Types.ObjectId, ref: "Addon", required: true },
        name: { type: String, default: "" },
        category: { type: String, required: true },
        source: {
          type: String,
          enum: ["subscription", "pending_payment", "paid"],
          default: "pending_payment",
        },
        priceHalala: { type: Number, min: 0, default: 0 },
        currency: { type: String, default: "SAR" },
        paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", default: null },
        consumedAt: { type: Date, default: Date.now },
      },
    ],
    premiumUpgradeSelections: [
      {
        baseSlotKey: { type: String, required: true },
        proteinId: { type: mongoose.Schema.Types.ObjectId, ref: "BuilderProtein", required: true },
        unitExtraFeeHalala: { type: Number, min: 0, default: 0 },
        currency: { type: String, default: "SAR" },
        premiumSource: {
          type: String,
          enum: ["balance", "pending_payment", "paid_extra", "paid"],
          default: "paid",
        },
        consumedAt: { type: Date, default: Date.now },
      },
    ],
    skippedByUser: { type: Boolean, default: false },
    skipCompensated: { type: Boolean, default: false },
    canonicalDayActionType: {
      type: String,
      enum: ["freeze", "skip"],
      // P2-S7-S1: Written only by canonical freeze/skip write paths going forward.
      // Legacy days will have this absent — that is valid and expected.
      // Read paths must treat absence as valid; no default, no required.
    },
    assignedByKitchen: { type: Boolean, default: false },
    pickupRequested: { type: Boolean, default: false },
    pickupRequestedAt: { type: Date, default: null },
    pickupPreparationStartedAt: { type: Date, default: null },
    pickupPreparedAt: { type: Date, default: null },
    pickupCode: { type: String, trim: true, default: null },
    pickupCodeIssuedAt: { type: Date, default: null },
    pickupVerifiedAt: { type: Date, default: null },
    pickupVerifiedByDashboardUserId: { type: mongoose.Schema.Types.ObjectId, ref: "DashboardUser", default: null },
    pickupNoShowAt: { type: Date, default: null },
    dayEndConsumptionReason: { type: String, trim: true, default: null },
    cancellationReason: { type: String, trim: true, default: null },
    cancellationCategory: { type: String, enum: ["customer_issue", "delivery_issue"], default: null },
    cancellationNote: { type: String, trim: true, default: null },
    canceledBy: { type: String, trim: true, default: null },
    canceledAt: { type: Date, default: null },
    operationAuditLog: {
      type: [
        {
          action: { type: String, required: true },
          by: { type: String, default: "" },
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    creditsDeducted: { type: Boolean, default: false },
    autoLocked: { type: Boolean, default: false },
    deliveryAddressOverride: {
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
    deliveryWindowOverride: { type: String },
    customSalads: [
      {
        items: [
          {
            ingredientId: { type: mongoose.Schema.Types.ObjectId, ref: "SaladIngredient" },
            name_en: { type: String },
            name_ar: { type: String },
            unitPriceSar: { type: Number },
            unitPrice: { type: Number }, // halalas
            quantity: { type: Number },
            calories: { type: Number },
          },
        ],
        basePriceSar: { type: Number, default: 0 },
        basePrice: { type: Number, default: 0 }, // halalas
        totalPriceSar: { type: Number },
        totalPrice: { type: Number }, // halalas
        currency: { type: String, default: "SAR" },
      },
    ],
    customMeals: [
      {
        items: [
          {
            ingredientId: { type: mongoose.Schema.Types.ObjectId, ref: "MealIngredient" },
            name_en: { type: String },
            name_ar: { type: String },
            category: { type: String, default: "" },
            unitPriceSar: { type: Number },
            unitPrice: { type: Number }, // halalas
            quantity: { type: Number },
            calories: { type: Number },
          },
        ],
        basePriceSar: { type: Number, default: 0 },
        basePrice: { type: Number, default: 0 }, // halalas
        totalPriceSar: { type: Number },
        totalPrice: { type: Number }, // halalas
        currency: { type: String, default: "SAR" },
      },
    ],
    // V1 meal-slot planner source of truth.
    // These fields stay optional at the top level so legacy creation paths are not
    // silently opted into the new planner before service-layer rollout.
    plannerVersion: { type: String, trim: true },
    plannerState: {
      type: String,
      enum: ["draft", "confirmed"],
    },
    plannerRevisionHash: { type: String, trim: true, default: "" },
    mealSlots: {
      type: [MealSlotSchema],
      default: undefined,
    },
    plannerMeta: {
      type: PlannerMetaSchema,
      default: undefined,
    },
    premiumExtraPayment: {
      type: PremiumExtraPaymentSchema,
      default: undefined,
    },
    // Derived operational bridge for complete slots only. This is the preferred
    // compatibility surface for downstream ops while legacy meal-id consumers exist.
    materializedMeals: {
      type: [MaterializedMealSchema],
      default: undefined,
    },
    // Legacy canonical planning fields retained during migration.
    planningVersion: { type: String, trim: true },
    planningState: {
      type: String,
      enum: ["draft", "confirmed"],
    },
    baseMealSlots: [
      {
        slotKey: { type: String, required: true },
        mealId: { type: mongoose.Schema.Types.ObjectId, ref: "Meal", required: true },
        assignmentSource: { type: String, default: "client" },
        assignedAt: { type: Date, default: Date.now },
      },
    ],
    planningMeta: {
      requiredMealCount: { type: Number, min: 0 },
      selectedBaseMealCount: { type: Number, min: 0 },
      selectedPremiumMealCount: { type: Number, min: 0 },
      selectedTotalMealCount: { type: Number, min: 0 },
      isExactCountSatisfied: { type: Boolean },
      lastEditedAt: { type: Date },
      confirmedAt: { type: Date },
      confirmedByRole: { type: String },
    },
    premiumOverageCount: { type: Number, min: 0 },
    premiumOverageStatus: {
      type: String,
      enum: ["pending", "paid"],
    },
    lockedSnapshot: { type: mongoose.Schema.Types.Mixed },
    fulfilledSnapshot: { type: mongoose.Schema.Types.Mixed },
    lockedAt: { type: Date },
    fulfilledAt: { type: Date },
    mealReminderSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Performance: Frequent queries filter by subscriptionId, status (e.g. counting frozen days)
// and/or date. A compound index supports these access patterns without requiring full collection scans.
SubscriptionDaySchema.index({ subscriptionId: 1, status: 1, date: 1 });
SubscriptionDaySchema.index({ subscriptionId: 1, canonicalDayActionType: 1, skipCompensated: 1, date: 1 });
SubscriptionDaySchema.index({ date: 1, pickupCode: 1 });

// Unique index to quickly lookup or upsert per-subscription per-day rows.
SubscriptionDaySchema.index({ subscriptionId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("SubscriptionDay", SubscriptionDaySchema);
