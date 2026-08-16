"use strict";

const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const Payment = require("../../models/Payment");

function toNonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function localizedName(value) {
  if (!value) return { ar: "", en: "" };
  if (typeof value === "string") return { ar: value, en: value };
  return {
    ar: text(value.ar || value.arabic || value.nameAr),
    en: text(value.en || value.english || value.nameEn),
  };
}

function buildInvoiceNumber(subscription) {
  const createdAt = new Date(subscription.createdAt || subscription.startDate || Date.now());
  const year = Number.isFinite(createdAt.getTime()) ? createdAt.getUTCFullYear() : new Date().getUTCFullYear();
  const month = Number.isFinite(createdAt.getTime())
    ? String(createdAt.getUTCMonth() + 1).padStart(2, "0")
    : String(new Date().getUTCMonth() + 1).padStart(2, "0");
  const suffix = String(subscription._id || "").slice(-8).toUpperCase();
  return `INV-${year}${month}-${suffix}`;
}

function resolvePaymentMethod(payment) {
  if (!payment) return null;
  const raw = text(
    payment.method ||
      (payment.metadata && payment.metadata.paymentMethod) ||
      payment.provider
  ).toLowerCase();
  if (raw === "cash") return "cash";
  if (["visa", "card", "credit_card", "credit-card", "mada"].includes(raw)) return "visa";
  if (payment.provider === "moyasar") return "moyasar";
  return raw || null;
}

async function findPrimaryPayment(subscriptionId) {
  const baseQuery = {
    subscriptionId,
    status: { $in: ["paid", "refunded"] },
  };

  const activation = await Payment.findOne({
    ...baseQuery,
    type: "subscription_activation",
  })
    .sort({ paidAt: 1, createdAt: 1 })
    .populate("collectedBy", "email role")
    .lean();
  if (activation) return activation;

  return Payment.findOne({
    ...baseQuery,
    type: "subscription_renewal",
  })
    .sort({ paidAt: 1, createdAt: 1 })
    .populate("collectedBy", "email role")
    .lean();
}

async function getSubscriptionInvoice(req, res) {
  const subscriptionId = text(req.params && req.params.subscriptionId);
  if (!mongoose.Types.ObjectId.isValid(subscriptionId)) {
    return res.status(400).json({
      status: false,
      message: "Invalid subscription id",
      messageAr: "معرّف الاشتراك غير صالح",
      error: { code: "INVALID_SUBSCRIPTION_ID" },
    });
  }

  const subscription = await Subscription.findById(subscriptionId)
    .populate("userId", "name phone phoneE164 email")
    .populate("planId", "name daysCount durationDays currency")
    .lean();

  if (!subscription) {
    return res.status(404).json({
      status: false,
      message: "Subscription not found",
      messageAr: "الاشتراك غير موجود",
      error: { code: "SUBSCRIPTION_NOT_FOUND" },
    });
  }

  const payment = await findPrimaryPayment(subscription._id);
  const paymentAmountHalala = payment ? toNonNegativeInteger(payment.amount) : null;
  const subscriptionTotalHalala = toNonNegativeInteger(subscription.totalPriceHalala);
  const hasStoredSubscriptionTotal = subscriptionTotalHalala !== null && subscriptionTotalHalala > 0;
  const authoritativeTotalHalala = paymentAmountHalala !== null
    ? paymentAmountHalala
    : hasStoredSubscriptionTotal
      ? subscriptionTotalHalala
      : null;
  const financialDataComplete = authoritativeTotalHalala !== null;
  const totalsMismatch = paymentAmountHalala !== null && hasStoredSubscriptionTotal
    ? paymentAmountHalala !== subscriptionTotalHalala
    : false;

  const user = subscription.userId && typeof subscription.userId === "object"
    ? subscription.userId
    : {};
  const plan = subscription.planId && typeof subscription.planId === "object"
    ? subscription.planId
    : {};
  const collectedBy = payment && payment.collectedBy && typeof payment.collectedBy === "object"
    ? payment.collectedBy
    : null;
  const currency = text(
    (payment && payment.currency) ||
      subscription.checkoutCurrency ||
      plan.currency ||
      "SAR"
  ).toUpperCase() || "SAR";

  const paidAt = payment ? toIso(payment.paidAt || payment.createdAt) : null;
  const issuedAt = paidAt || toIso(subscription.createdAt) || toIso(subscription.startDate);

  return res.json({
    status: true,
    data: {
      invoiceNumber: buildInvoiceNumber(subscription),
      issuedAt,
      historical: true,
      customer: {
        id: user._id ? String(user._id) : String(subscription.userId || ""),
        name: text(user.name),
        phone: text(user.phoneE164 || user.phone),
        email: text(user.email),
      },
      subscription: {
        id: String(subscription._id),
        displayId: text(subscription.displayId) || `SUB-${String(subscription._id).slice(-6).toUpperCase()}`,
        status: text(subscription.status),
        planName: localizedName(plan.name),
        startDate: toIso(subscription.startDate),
        endDate: toIso(subscription.endDate),
        validityEndDate: toIso(subscription.validityEndDate),
        selectedGrams: toNonNegativeInteger(subscription.selectedGrams),
        selectedMealsPerDay: toNonNegativeInteger(subscription.selectedMealsPerDay),
        totalMeals: toNonNegativeInteger(subscription.totalMeals),
        deliveryMode: text(subscription.deliveryMode),
        deliveryZoneName: text(subscription.deliveryZoneName),
      },
      financial: {
        currency,
        source: payment
          ? "payment"
          : hasStoredSubscriptionTotal
            ? "subscription_snapshot"
            : "unavailable",
        financialDataComplete,
        reconciliationStatus: totalsMismatch ? "payment_authoritative_mismatch" : "balanced_or_single_source",
        basePlanGrossHalala: toNonNegativeInteger(subscription.basePlanGrossHalala),
        basePlanNetHalala: toNonNegativeInteger(subscription.basePlanNetHalala),
        discountHalala: toNonNegativeInteger(subscription.discountHalala) || 0,
        subtotalHalala: toNonNegativeInteger(subscription.subtotalHalala),
        subtotalBeforeVatHalala: toNonNegativeInteger(subscription.subtotalBeforeVatHalala),
        deliveryFeeHalala: toNonNegativeInteger(subscription.deliveryFeeHalala) || 0,
        vatPercentage: Number.isFinite(Number(subscription.vatPercentage))
          ? Number(subscription.vatPercentage)
          : null,
        vatHalala: toNonNegativeInteger(subscription.vatHalala) || 0,
        subscriptionTotalHalala: hasStoredSubscriptionTotal ? subscriptionTotalHalala : null,
        paidAmountHalala: paymentAmountHalala,
        totalHalala: authoritativeTotalHalala,
      },
      payment: payment
        ? {
            id: String(payment._id),
            status: text(payment.status),
            method: resolvePaymentMethod(payment),
            provider: text(payment.provider),
            paidAt,
            refunded: payment.status === "refunded",
          }
        : null,
      createdBy: collectedBy
        ? {
            id: collectedBy._id ? String(collectedBy._id) : null,
            email: text(collectedBy.email),
            role: text(collectedBy.role),
          }
        : null,
      warnings: [
        ...(!financialDataComplete
          ? [{ code: "FINANCIAL_DATA_INCOMPLETE", messageAr: "لا توجد قيمة دفع أو إجمالي تاريخي موثوق لهذا الاشتراك القديم." }]
          : []),
        ...(totalsMismatch
          ? [{ code: "PAYMENT_TOTAL_MISMATCH", messageAr: "يوجد اختلاف بين إجمالي الاشتراك التاريخي والمبلغ المدفوع؛ تم اعتماد سجل الدفع في الفاتورة." }]
          : []),
      ],
    },
  });
}

module.exports = {
  getSubscriptionInvoice,
};
