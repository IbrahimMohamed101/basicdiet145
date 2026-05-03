const mongoose = require("mongoose");
const {
  FINAL_ORDER_STATUSES,
  ORDER_STATUSES,
  normalizeLegacyOrderStatus,
} = require("../utils/orderState");

const SYSTEM_CURRENCY = "SAR";

const LocalizedStringSchema = new mongoose.Schema(
  {
    ar: { type: String, default: "" },
    en: { type: String, default: "" },
  },
  { _id: false }
);

const OrderItemSchema = new mongoose.Schema(
  {
    itemType: {
      type: String,
      enum: ["standard_meal", "sandwich", "salad", "addon_item", "drink", "dessert"],
      default: "standard_meal",
    },
    catalogRef: {
      model: { type: String, default: "" },
      id: { type: mongoose.Schema.Types.ObjectId },
    },
    name: { type: LocalizedStringSchema, default: () => ({}) },
    qty: { type: Number, min: 1, default: 1 },
    unitPriceHalala: { type: Number, min: 0, default: 0 },
    lineTotalHalala: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: SYSTEM_CURRENCY },
    selections: {
      proteinId: { type: mongoose.Schema.Types.ObjectId, ref: "BuilderProtein" },
      proteinName: { type: LocalizedStringSchema, default: () => ({}) },
      carbs: [
        {
          carbId: { type: mongoose.Schema.Types.ObjectId, ref: "BuilderCarb" },
          name: { type: LocalizedStringSchema, default: () => ({}) },
          grams: { type: Number, min: 0 },
        },
      ],
      sandwichId: { type: mongoose.Schema.Types.ObjectId, ref: "Sandwich" },
      salad: {
        groups: { type: mongoose.Schema.Types.Mixed },
        ingredients: [
          {
            ingredientId: { type: mongoose.Schema.Types.ObjectId, ref: "SaladIngredient" },
            groupKey: { type: String, default: "" },
            name: { type: LocalizedStringSchema, default: () => ({}) },
            qty: { type: Number, min: 1, default: 1 },
            unitPriceHalala: { type: Number, min: 0, default: 0 },
          },
        ],
      },
      addonItemId: { type: mongoose.Schema.Types.ObjectId, ref: "Addon" },
    },
    nutrition: { type: mongoose.Schema.Types.Mixed },

    // Legacy one-time order item fields. Keep these during migration so older
    // order reads and controller code do not lose data.
    mealId: { type: mongoose.Schema.Types.ObjectId, ref: "Meal" },
    type: { type: String },
    quantity: { type: Number, min: 1 },
    unitPrice: { type: Number, min: 0 },
  },
  { _id: false }
);

const CustomSaladSchema = new mongoose.Schema(
  {
    items: [
      {
        ingredientId: { type: mongoose.Schema.Types.ObjectId, ref: "SaladIngredient" },
        name_en: { type: String },
        name_ar: { type: String },
        unitPriceSar: { type: Number },
        unitPrice: { type: Number },
        quantity: { type: Number },
        calories: { type: Number },
      },
    ],
    basePriceSar: { type: Number, default: 0 },
    basePrice: { type: Number, default: 0 },
    totalPriceSar: { type: Number },
    totalPrice: { type: Number },
    currency: { type: String, default: SYSTEM_CURRENCY },
  },
  { _id: false }
);

const CustomMealSchema = new mongoose.Schema(
  {
    items: [
      {
        ingredientId: { type: mongoose.Schema.Types.ObjectId, ref: "MealIngredient" },
        name_en: { type: String },
        name_ar: { type: String },
        category: { type: String, default: "" },
        unitPriceSar: { type: Number },
        unitPrice: { type: Number },
        quantity: { type: Number },
        calories: { type: Number },
      },
    ],
    basePriceSar: { type: Number, default: 0 },
    basePrice: { type: Number, default: 0 },
    totalPriceSar: { type: Number },
    totalPrice: { type: Number },
    currency: { type: String, default: SYSTEM_CURRENCY },
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, trim: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: {
      type: String,
      enum: FINAL_ORDER_STATUSES,
      default: ORDER_STATUSES.PENDING_PAYMENT,
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ["initiated", "paid", "failed", "canceled", "expired", "refunded"],
      default: "initiated",
      index: true,
    },

    fulfillmentMethod: { type: String, enum: ["delivery", "pickup"], required: true, index: true },
    fulfillmentDate: { type: String, required: true, index: true },
    requestedFulfillmentDate: { type: String, default: "" },
    fulfillmentDateAdjusted: { type: Boolean, default: false },

    // Legacy aliases kept for collection continuity and current controllers.
    deliveryMode: { type: String, enum: ["delivery", "pickup"] },
    deliveryDate: { type: String },
    requestedDeliveryDate: { type: String, default: "" },
    deliveryDateAdjusted: { type: Boolean, default: false },

    items: { type: [OrderItemSchema], default: [] },
    customSalads: { type: [CustomSaladSchema], default: [] },
    customMeals: { type: [CustomMealSchema], default: [] },

    pricing: {
      subtotalHalala: { type: Number, min: 0, default: 0 },
      deliveryFeeHalala: { type: Number, min: 0, default: 0 },
      discountHalala: { type: Number, min: 0, default: 0 },
      totalHalala: { type: Number, min: 0, default: 0 },
      vatPercentage: { type: Number, min: 0, default: 0 },
      vatHalala: { type: Number, min: 0, default: 0 },
      vatIncluded: { type: Boolean, default: true },
      currency: { type: String, default: SYSTEM_CURRENCY },
      appliedPromo: { type: mongoose.Schema.Types.Mixed },

      // Legacy pricing fields kept until controllers and clients migrate.
      unitPrice: { type: Number, min: 0, default: 0 },
      premiumUnitPrice: { type: Number, min: 0 },
      quantity: { type: Number, min: 0, default: 0 },
      subtotal: { type: Number, min: 0, default: 0 },
      basePrice: { type: Number, min: 0, default: 0 },
      deliveryFee: { type: Number, min: 0, default: 0 },
      vatAmount: { type: Number, min: 0, default: 0 },
      total: { type: Number, min: 0, default: 0 },
      totalPrice: { type: Number, min: 0, default: 0 },
    },

    pickup: {
      branchId: { type: String, default: "" },
      branchName: { type: LocalizedStringSchema, default: () => ({}) },
      pickupWindow: { type: String, default: "" },
      pickupCode: { type: String, default: "" },
      readyAt: { type: Date },
      pickedUpAt: { type: Date },
    },
    delivery: {
      zoneId: { type: mongoose.Schema.Types.ObjectId, ref: "Zone" },
      zoneName: { type: LocalizedStringSchema, default: () => ({}) },
      deliveryFeeHalala: { type: Number, min: 0, default: 0 },
      address: {
        label: { type: String, default: "" },
        line1: { type: String, default: "" },
        line2: { type: String, default: "" },
        district: { type: String, default: "" },
        city: { type: String, default: "" },
        phone: { type: String, default: "" },
        notes: { type: String, default: "" },
      },
    },

    // Legacy delivery fields kept for existing order controllers.
    deliveryAddress: {
      line1: { type: String },
      line2: { type: String },
      city: { type: String },
      notes: { type: String },
    },
    deliveryWindow: { type: String },

    paymentUrl: { type: String, default: "" },
    idempotencyKey: { type: String, trim: true, default: "" },
    requestHash: { type: String, trim: true, default: "" },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },
    providerInvoiceId: { type: String },
    providerPaymentId: { type: String },
    expiresAt: { type: Date },
    confirmedAt: { type: Date },
    preparationStartedAt: { type: Date },
    readyAt: { type: Date },
    dispatchedAt: { type: Date },
    fulfilledAt: { type: Date },
    cancelledAt: { type: Date },
    canceledAt: { type: Date },
    cancellationReason: { type: String },
    cancellationNote: { type: String },
    cancelledBy: { type: String },
    canceledBy: { type: String },
  },
  { timestamps: true }
);

function coalesce(value, fallback) {
  return value !== undefined && value !== null && value !== "" ? value : fallback;
}

OrderSchema.pre("validate", function normalizeOrderBeforeValidate(next) {
  this.status = normalizeLegacyOrderStatus(this.status, { paymentStatus: this.paymentStatus });

  this.fulfillmentMethod = coalesce(this.fulfillmentMethod, this.deliveryMode);
  this.deliveryMode = coalesce(this.deliveryMode, this.fulfillmentMethod);

  this.fulfillmentDate = coalesce(this.fulfillmentDate, this.deliveryDate);
  this.deliveryDate = coalesce(this.deliveryDate, this.fulfillmentDate);

  this.requestedFulfillmentDate = coalesce(this.requestedFulfillmentDate, this.requestedDeliveryDate);
  this.requestedDeliveryDate = coalesce(this.requestedDeliveryDate, this.requestedFulfillmentDate);

  this.fulfillmentDateAdjusted = Boolean(this.fulfillmentDateAdjusted || this.deliveryDateAdjusted);
  this.deliveryDateAdjusted = this.fulfillmentDateAdjusted;

  if (this.cancelledAt && !this.canceledAt) this.canceledAt = this.cancelledAt;
  if (this.canceledAt && !this.cancelledAt) this.cancelledAt = this.canceledAt;
  if (this.cancelledBy && !this.canceledBy) this.canceledBy = this.cancelledBy;
  if (this.canceledBy && !this.cancelledBy) this.cancelledBy = this.canceledBy;

  const pricing = this.pricing || {};
  pricing.subtotalHalala = coalesce(pricing.subtotalHalala, pricing.subtotal);
  pricing.deliveryFeeHalala = coalesce(pricing.deliveryFeeHalala, pricing.deliveryFee);
  pricing.vatHalala = coalesce(pricing.vatHalala, pricing.vatAmount);
  pricing.totalHalala = coalesce(pricing.totalHalala, coalesce(pricing.totalPrice, pricing.total));
  pricing.subtotal = coalesce(pricing.subtotal, pricing.subtotalHalala);
  pricing.deliveryFee = coalesce(pricing.deliveryFee, pricing.deliveryFeeHalala);
  pricing.vatAmount = coalesce(pricing.vatAmount, pricing.vatHalala);
  pricing.total = coalesce(pricing.total, pricing.totalHalala);
  pricing.totalPrice = coalesce(pricing.totalPrice, pricing.totalHalala);
  this.pricing = pricing;

  this.items = (Array.isArray(this.items) ? this.items : []).map((item) => {
    const plain = item && typeof item.toObject === "function" ? item.toObject() : { ...item };
    const qty = coalesce(plain.qty, plain.quantity);
    const unitPriceHalala = coalesce(plain.unitPriceHalala, plain.unitPrice);
    return {
      ...plain,
      qty,
      quantity: coalesce(plain.quantity, qty),
      unitPriceHalala,
      unitPrice: coalesce(plain.unitPrice, unitPriceHalala),
      lineTotalHalala: coalesce(plain.lineTotalHalala, Number(qty || 0) * Number(unitPriceHalala || 0)),
    };
  });

  next();
});

OrderSchema.index({ userId: 1, createdAt: -1 });
OrderSchema.index({ status: 1, fulfillmentDate: 1 });
OrderSchema.index({ fulfillmentMethod: 1, fulfillmentDate: 1, status: 1 });
OrderSchema.index({ "delivery.zoneId": 1, fulfillmentDate: 1 });
OrderSchema.index({ paymentId: 1 });
OrderSchema.index({ providerInvoiceId: 1 }, { sparse: true });
OrderSchema.index({ deliveryDate: 1 });
OrderSchema.index(
  { userId: 1, idempotencyKey: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { idempotencyKey: { $type: "string", $ne: "" } },
  }
);
OrderSchema.index(
  { userId: 1, requestHash: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      requestHash: { $type: "string", $ne: "" },
      status: ORDER_STATUSES.PENDING_PAYMENT,
    },
  }
);

module.exports = mongoose.model("Order", OrderSchema);
