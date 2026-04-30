const mongoose = require("mongoose");

function normalizeOptionalProviderIdentifier(value) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

const PaymentSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ["moyasar"], required: true },
    type: {
      type: String,
      enum: [
        "one_time_addon_day_planning",
        "day_planning_payment",
        "one_time_addon",
        "subscription_activation",
        "subscription_renewal",
        "one_time_order",
        "premium_extra_day",
        "custom_salad_day",
        "custom_salad_order",
        "custom_meal_day",
        "custom_meal_order",
      ],
      required: true,
    },
    status: {
      type: String,
      enum: ["initiated", "paid", "failed", "canceled", "expired", "refunded"],
      default: "initiated",
    },
    amount: { type: Number, required: true }, // minor units (halalas)
    currency: { type: String, default: "SAR" },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription" },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    providerInvoiceId: { type: String, set: normalizeOptionalProviderIdentifier },
    providerPaymentId: { type: String, set: normalizeOptionalProviderIdentifier },
    metadata: { type: mongoose.Schema.Types.Mixed },
    applied: { type: Boolean, default: false },
    paidAt: { type: Date },
    operationScope: { type: String, trim: true },
    operationIdempotencyKey: { type: String, trim: true },
    operationRequestHash: { type: String, trim: true },
  },
  { timestamps: true }
);

PaymentSchema.pre("validate", function normalizeProviderIdentifiersBeforeValidate(next) {
  this.providerInvoiceId = normalizeOptionalProviderIdentifier(this.providerInvoiceId);
  this.providerPaymentId = normalizeOptionalProviderIdentifier(this.providerPaymentId);
  next();
});

PaymentSchema.index(
  { provider: 1, providerInvoiceId: 1 },
  {
    name: "provider_1_providerInvoiceId_1",
    unique: true,
    partialFilterExpression: {
      providerInvoiceId: { $type: "string" },
    },
  }
);
PaymentSchema.index(
  { provider: 1, providerPaymentId: 1 },
  {
    name: "provider_1_providerPaymentId_1",
    unique: true,
    partialFilterExpression: {
      providerPaymentId: { $type: "string" },
    },
  }
);
PaymentSchema.index({ subscriptionId: 1, status: 1 });

PaymentSchema.index(
  { operationIdempotencyKey: 1 },
  {
    name: "operationIdempotencyKey_1",
    unique: true,
    partialFilterExpression: {
      operationIdempotencyKey: { $type: "string", $ne: "" },
    },
  }
);

module.exports = mongoose.model("Payment", PaymentSchema);
