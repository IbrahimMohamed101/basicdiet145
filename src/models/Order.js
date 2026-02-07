const mongoose = require("mongoose");

const OrderItemSchema = new mongoose.Schema(
  {
    mealId: { type: mongoose.Schema.Types.ObjectId, ref: "Meal", required: true },
    name: { type: String },
    type: { type: String },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, required: true }, // minor units (halalas)
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: [
        "created",
        "confirmed",
        "preparing",
        "out_for_delivery",
        "ready_for_pickup",
        "fulfilled",
        "canceled",
      ],
      default: "created",
    },
    deliveryMode: { type: String, enum: ["delivery", "pickup"], required: true },
    deliveryDate: { type: String, required: true }, // YYYY-MM-DD (KSA)
    items: { type: [OrderItemSchema], default: [] },
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
    pricing: {
      unitPrice: { type: Number, required: true }, // regular unit price (halalas)
      premiumUnitPrice: { type: Number },
      quantity: { type: Number, required: true },
      subtotal: { type: Number, required: true }, // halalas
      deliveryFee: { type: Number, default: 0 }, // halalas
      total: { type: Number, required: true }, // halalas
      currency: { type: String, default: "SAR" },
    },
    deliveryAddress: {
      line1: { type: String },
      line2: { type: String },
      city: { type: String },
      notes: { type: String },
    },
    deliveryWindow: { type: String },
    paymentStatus: {
      type: String,
      enum: ["initiated", "paid", "failed", "canceled", "expired", "refunded"],
      default: "initiated",
    },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },
    providerInvoiceId: { type: String },
    providerPaymentId: { type: String },
    confirmedAt: { type: Date },
    fulfilledAt: { type: Date },
    canceledAt: { type: Date },
  },
  { timestamps: true }
);

OrderSchema.index({ userId: 1, createdAt: -1 });
OrderSchema.index({ deliveryDate: 1 });

module.exports = mongoose.model("Order", OrderSchema);
