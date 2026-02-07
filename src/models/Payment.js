const mongoose = require("mongoose");

const PaymentSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ["moyasar"], required: true },
    type: {
      type: String,
      enum: ["premium_topup", "one_time_addon", "subscription_activation", "one_time_order", "custom_salad_day", "custom_salad_order"],
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
    providerInvoiceId: { type: String },
    providerPaymentId: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed },
    applied: { type: Boolean, default: false },
    paidAt: { type: Date },
  },
  { timestamps: true }
);

PaymentSchema.index({ provider: 1, providerInvoiceId: 1 }, { unique: true, sparse: true });
PaymentSchema.index({ provider: 1, providerPaymentId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Payment", PaymentSchema);
