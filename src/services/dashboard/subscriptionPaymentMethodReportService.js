"use strict";

const ActivityLog = require("../../models/ActivityLog");
const DashboardUser = require("../../models/DashboardUser");
const Payment = require("../../models/Payment");
const Plan = require("../../models/Plan");
const Subscription = require("../../models/Subscription");
const User = require("../../models/User");
const { calculateVatBreakdownFromInclusiveTotal, VAT_PERCENTAGE } = require("../../config/vat");
const dateUtils = require("../../utils/date");
const accountingDailyReportService = require("./accountingDailyReportService");

const PAYMENT_TYPES = ["subscription_activation", "subscription_renewal"];
const PAYMENT_AUDIT_ACTIONS = [
  "subscription_cash_payment_collected",
  "subscription_visa_payment_recorded",
];

const AR_LABELS = Object.freeze({
  paymentMethod: {
    cash: "نقدي",
    visa: "بطاقة بنكية",
    unknown: "غير محدد",
  },
  provider: {
    moyasar: "بوابة ميسر",
    cash: "نقدي",
    manual: "تسجيل يدوي",
    unknown: "غير محدد",
  },
  paymentStatus: {
    initiated: "بانتظار الدفع",
    paid: "مدفوع",
    failed: "فشل الدفع",
    canceled: "ملغي",
    expired: "منتهي",
    refunded: "مسترد",
    unknown: "غير محدد",
  },
  fulfillmentMethod: {
    all: "الكل",
    pickup: "استلام من الفرع",
    delivery: "توصيل",
    unknown: "غير محدد",
  },
  subscriptionStatus: {
    pending_payment: "بانتظار الدفع",
    active: "نشط",
    frozen: "مجمد",
    expired: "منتهي",
    canceled: "ملغي",
    completed: "مكتمل",
    unknown: "غير محدد",
  },
  paymentType: {
    subscription_activation: "تفعيل اشتراك",
    subscription_renewal: "تجديد اشتراك",
    unknown: "دفعة اشتراك",
  },
  recordingMode: {
    dashboard_manual: "تسجيل يدوي من لوحة التحكم",
    moyasar_gateway: "تحصيل إلكتروني عبر ميسر",
    unknown: "غير محدد",
  },
  role: {
    superadmin: "مدير عام",
    admin: "مدير",
    cashier: "كاشير",
    restaurant: "المطعم",
    kitchen: "المطبخ",
    courier: "مندوب التوصيل",
    unknown: "غير محدد",
  },
});

const moneyFormatter = new Intl.NumberFormat("ar-AE", {
  style: "currency",
  currency: "SAR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dayFormatter = new Intl.DateTimeFormat("ar-AE", {
  timeZone: "UTC",
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});
const monthFormatter = new Intl.DateTimeFormat("ar-AE", {
  timeZone: "UTC",
  year: "numeric",
  month: "long",
});
const dateTimeFormatter = new Intl.DateTimeFormat("ar-AE", {
  timeZone: dateUtils.KSA_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function safeString(value, fallback = "") {
  const normalized = value === undefined || value === null ? "" : String(value).trim();
  return normalized || fallback;
}

function normalizeHalala(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function moneyValue(amountHalala) {
  const normalized = normalizeHalala(amountHalala);
  return {
    amountHalala: normalized,
    amountSar: normalized / 100,
    formattedAr: moneyFormatter.format(normalized / 100),
    currency: "SAR",
    currencyLabelAr: "ريال سعودي",
  };
}

function dateFromDateString(dateString) {
  const [year, month, day] = safeString(dateString).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day || 1));
}

function formatBusinessDateAr(dateString) {
  const date = dateFromDateString(dateString);
  return Number.isNaN(date.getTime()) ? safeString(dateString) : dayFormatter.format(date);
}

function formatBusinessMonthAr(monthString) {
  const date = dateFromDateString(`${monthString}-01`);
  return Number.isNaN(date.getTime()) ? safeString(monthString) : monthFormatter.format(date);
}

function formatDateTimeAr(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateTimeFormatter.format(date);
}

function labelAr(group, value) {
  const normalized = safeString(value, "unknown").toLowerCase();
  const labels = AR_LABELS[group] || {};
  return labels[normalized] || labels.unknown || "غير محدد";
}

function normalizeFulfillmentMethod(value) {
  const normalized = safeString(value, "all").toLowerCase();
  if (!["all", "pickup", "delivery"].includes(normalized)) {
    throw new accountingDailyReportService.AccountingReportError(
      "INVALID_FULFILLMENT_METHOD",
      "طريقة التنفيذ غير صحيحة",
      400
    );
  }
  return normalized;
}

function parseIncludeDetails(value) {
  if (value === undefined || value === null || value === "") return true;
  const normalized = safeString(value).toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new accountingDailyReportService.AccountingReportError(
    "INVALID_INCLUDE_DETAILS",
    "قيمة عرض التفاصيل غير صحيحة",
    400
  );
}

function normalizeMonth(value) {
  const normalized = safeString(value);
  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    throw new accountingDailyReportService.AccountingReportError(
      "INVALID_MONTH",
      "صيغة الشهر غير صحيحة. استخدم YYYY-MM",
      400
    );
  }
  const [year, month] = normalized.split("-").map(Number);
  if (year < 2000 || month < 1 || month > 12) {
    throw new accountingDailyReportService.AccountingReportError(
      "INVALID_MONTH",
      "الشهر غير صالح",
      400
    );
  }
  return normalized;
}

function listMonthDates(monthString) {
  const [year, month] = normalizeMonth(monthString).split("-").map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: days }, (_, index) => (
    `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`
  ));
}

function normalizeMethodToken(value) {
  const raw = safeString(value).toLowerCase();
  if (["cash", "cod", "cash_on_delivery", "cash-on-delivery", "نقدي", "كاش"].includes(raw)) {
    return "cash";
  }
  if ([
    "visa",
    "card",
    "credit_card",
    "credit-card",
    "debit_card",
    "debit-card",
    "mada",
    "apple_pay",
    "apple-pay",
    "stc_pay",
    "manual",
    "بطاقة",
    "فيزا",
  ].includes(raw)) {
    return "visa";
  }
  return null;
}

function resolvePaymentMethodClassification(payment = {}, audit = null) {
  const metadata = payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  const auditMeta = audit && audit.meta && typeof audit.meta === "object" ? audit.meta : {};
  const candidates = [
    [payment.method, "payment.method"],
    [metadata.paymentMethod, "payment.metadata.paymentMethod"],
    [metadata.method, "payment.metadata.method"],
    [metadata.brand, "payment.metadata.brand"],
    [auditMeta.paymentMethod, "activity_log.paymentMethod"],
    [payment.source, "payment.source"],
  ];
  for (const [candidate, source] of candidates) {
    const method = normalizeMethodToken(candidate);
    if (method) return { method, source, recoveredFromLegacyAudit: source.startsWith("activity_log") };
  }

  const auditAction = safeString(audit && audit.action).toLowerCase();
  if (auditAction === "subscription_cash_payment_collected") {
    return { method: "cash", source: "activity_log.action", recoveredFromLegacyAudit: true };
  }
  if (auditAction === "subscription_visa_payment_recorded") {
    return { method: "visa", source: "activity_log.action", recoveredFromLegacyAudit: true };
  }

  const provider = safeString(payment.provider, "unknown").toLowerCase();
  if (provider === "cash") {
    return { method: "cash", source: "payment.provider", recoveredFromLegacyAudit: false };
  }
  if (
    provider === "moyasar"
    && (
      metadata.gatewayUsed === true
      || safeString(payment.providerPaymentId)
      || safeString(payment.providerInvoiceId)
    )
  ) {
    return { method: "visa", source: "moyasar_gateway_reference", recoveredFromLegacyAudit: false };
  }

  return { method: "unknown", source: "unresolved", recoveredFromLegacyAudit: false };
}

function normalizeRecordedPaymentMethod(payment = {}, audit = null) {
  return resolvePaymentMethodClassification(payment, audit).method;
}

function localizedName(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && !Array.isArray(value)) {
    return safeString(value.ar || value.en || value.name || value.value);
  }
  return "";
}

function paymentOccurredAt(payment = {}) {
  return payment.paidAt || payment.createdAt || null;
}

function resolveStoredVatBreakdown(amountHalala, subscription = {}) {
  const amount = normalizeHalala(amountHalala);
  const storedTotal = normalizeHalala(subscription.totalPriceHalala);
  const storedVat = normalizeHalala(subscription.vatHalala);
  const storedNet = normalizeHalala(
    subscription.subtotalBeforeVatHalala !== undefined
      ? subscription.subtotalBeforeVatHalala
      : subscription.basePlanNetHalala
  );
  if (storedTotal === amount && storedVat <= amount && (storedVat > 0 || storedNet > 0)) {
    const netHalala = storedNet > 0 && storedNet + storedVat === amount
      ? storedNet
      : amount - storedVat;
    return {
      source: "subscription_snapshot",
      sourceLabelAr: "بيانات الاشتراك المحفوظة",
      vatIncluded: true,
      vatPercentage: Number(subscription.vatPercentage || VAT_PERCENTAGE),
      totalHalala: amount,
      subtotalExcludingVatHalala: netHalala,
      vatHalala: storedVat,
    };
  }
  return {
    ...calculateVatBreakdownFromInclusiveTotal(amount),
    source: "system_fallback",
    sourceLabelAr: "احتساب النظام لضريبة شاملة",
  };
}

function findPeriodForPayment(payment, periods) {
  const occurredAt = paymentOccurredAt(payment);
  if (!occurredAt) return null;
  const instant = new Date(occurredAt);
  if (Number.isNaN(instant.getTime())) return null;
  return periods.find((period) => instant >= period.start && instant <= period.end) || null;
}

function buildAuditIndex(audits = []) {
  const byPaymentId = new Map();
  const bySubscriptionId = new Map();
  for (const audit of audits) {
    const paymentId = safeString(audit.meta && audit.meta.paymentId);
    const subscriptionId = safeString(audit.entityId);
    if (paymentId && !byPaymentId.has(paymentId)) byPaymentId.set(paymentId, audit);
    if (subscriptionId) {
      const rows = bySubscriptionId.get(subscriptionId) || [];
      rows.push(audit);
      bySubscriptionId.set(subscriptionId, rows);
    }
  }
  return { byPaymentId, bySubscriptionId };
}

function closestAuditForPayment(payment, subscriptionId, auditIndex) {
  const direct = auditIndex.byPaymentId.get(String(payment._id));
  if (direct) return direct;
  const candidates = auditIndex.bySubscriptionId.get(subscriptionId) || [];
  if (!candidates.length) return null;
  const occurredAt = new Date(paymentOccurredAt(payment) || 0).getTime();
  return candidates.reduce((closest, candidate) => {
    if (!closest) return candidate;
    const candidateTime = new Date(candidate.createdAt || 0).getTime();
    const closestTime = new Date(closest.createdAt || 0).getTime();
    return Math.abs(candidateTime - occurredAt) < Math.abs(closestTime - occurredAt) ? candidate : closest;
  }, null);
}

function buildReviewReasons({ paymentMethod, subscriptionStatus, amountMismatch, customerId, vatSource }) {
  const reasons = [];
  if (paymentMethod === "unknown") reasons.push("طريقة الدفع غير مصنفة");
  if (subscriptionStatus === "canceled") reasons.push("الاشتراك ملغي مع وجود دفعة محصلة");
  if (amountMismatch) reasons.push("قيمة الدفعة لا تطابق إجمالي الاشتراك المحفوظ");
  if (!customerId) reasons.push("الدفعة غير مرتبطة بعميل");
  if (vatSource === "system_fallback") reasons.push("تفصيل الضريبة غير محفوظ وتم احتسابه بواسطة النظام");
  return reasons;
}

function serializePaymentItem({ payment, subscription, user, plan, collector, audit, businessDate }) {
  const customerId = safeString(payment.userId || subscription && subscription.userId);
  const amountHalala = normalizeHalala(payment.amount);
  const methodClassification = resolvePaymentMethodClassification(payment, audit);
  const paymentMethod = methodClassification.method;
  const provider = safeString(payment.provider, "unknown").toLowerCase();
  const status = safeString(payment.status, "unknown").toLowerCase();
  const fulfillmentMethod = safeString(subscription && subscription.deliveryMode, "unknown").toLowerCase();
  const subscriptionStatus = safeString(subscription && subscription.status, "unknown").toLowerCase();
  const paymentType = safeString(payment.type, "unknown").toLowerCase();
  const metadata = payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  const recordingMode = safeString(
    metadata.recordingMode,
    provider === "moyasar" && (metadata.gatewayUsed === true || payment.providerPaymentId || payment.providerInvoiceId)
      ? "moyasar_gateway"
      : "unknown"
  ).toLowerCase();
  const vat = resolveStoredVatBreakdown(amountHalala, subscription || {});
  const subscriptionTotal = normalizeHalala(subscription && subscription.totalPriceHalala);
  const amountMismatch = subscriptionTotal > 0 && subscriptionTotal !== amountHalala;
  const reviewReasonsAr = buildReviewReasons({
    paymentMethod,
    subscriptionStatus,
    amountMismatch,
    customerId,
    vatSource: vat.source,
  });
  const amount = moneyValue(amountHalala);
  const tax = moneyValue(vat.vatHalala);
  const netBeforeVat = moneyValue(vat.subtotalExcludingVatHalala);
  const paidAt = payment.paidAt ? new Date(payment.paidAt).toISOString() : null;
  const createdAt = payment.createdAt ? new Date(payment.createdAt).toISOString() : null;
  const paymentReference = safeString(
    payment.providerPaymentId || payment.providerInvoiceId,
    `PAY-${String(payment._id).slice(-8).toUpperCase()}`
  );
  const accountingTreatmentAr = subscriptionStatus === "canceled"
    ? "تحصيل قائم لاشتراك ملغي — لا يُخصم من الإيراد إلا عند تسجيل مرتجع مالي"
    : "تحصيل اشتراك مدفوع";

  return {
    paymentId: String(payment._id),
    paymentReference,
    subscriptionId: safeString(payment.subscriptionId),
    customerId,
    customerName: user ? safeString(user.name, user.phone) : "",
    customerPhone: user ? safeString(user.phone) : "",
    planId: safeString(subscription && subscription.planId),
    planNameAr: plan ? localizedName(plan.name) : "",
    paymentType,
    paymentTypeLabelAr: labelAr("paymentType", paymentType),
    paymentMethod,
    paymentMethodLabelAr: labelAr("paymentMethod", paymentMethod),
    paymentMethodClassificationSource: methodClassification.source,
    paymentMethodClassificationSourceAr: methodClassification.recoveredFromLegacyAudit
      ? "تم استرجاعها من سجل الحركة القديم"
      : methodClassification.source === "unresolved"
        ? "لم يتم العثور على مصدر موثوق"
        : "بيانات الدفعة",
    provider,
    providerLabelAr: labelAr("provider", provider),
    status,
    statusLabelAr: labelAr("paymentStatus", status),
    amountHalala,
    amountSar: amount.amountSar,
    amountFormattedAr: amount.formattedAr,
    currency: safeString(payment.currency, "SAR").toUpperCase(),
    currencyLabelAr: "ريال سعودي",
    vatIncluded: true,
    vatPercentage: Number(vat.vatPercentage || VAT_PERCENTAGE),
    vatHalala: tax.amountHalala,
    vatSar: tax.amountSar,
    vatFormattedAr: tax.formattedAr,
    netBeforeVatHalala: netBeforeVat.amountHalala,
    netBeforeVatSar: netBeforeVat.amountSar,
    netBeforeVatFormattedAr: netBeforeVat.formattedAr,
    vatCalculationSource: vat.source,
    vatCalculationSourceAr: vat.sourceLabelAr,
    fulfillmentMethod,
    fulfillmentMethodLabelAr: labelAr("fulfillmentMethod", fulfillmentMethod),
    subscriptionStatus,
    subscriptionStatusLabelAr: labelAr("subscriptionStatus", subscriptionStatus),
    subscriptionStartDate: subscription && subscription.startDate ? dateUtils.toKSADateString(subscription.startDate) : null,
    subscriptionEndDate: subscription && (subscription.validityEndDate || subscription.endDate)
      ? dateUtils.toKSADateString(subscription.validityEndDate || subscription.endDate)
      : null,
    selectedGrams: Number(subscription && subscription.selectedGrams || 0) || null,
    selectedMealsPerDay: Number(subscription && subscription.selectedMealsPerDay || 0) || null,
    totalMeals: Number(subscription && subscription.totalMeals || 0),
    pickupLocationId: safeString(subscription && subscription.pickupLocationId),
    deliveryZoneName: safeString(subscription && subscription.deliveryZoneName),
    gatewayUsed: Boolean(metadata.gatewayUsed || provider === "moyasar" && (payment.providerPaymentId || payment.providerInvoiceId)),
    gatewayUsedLabelAr: Boolean(metadata.gatewayUsed || provider === "moyasar" && (payment.providerPaymentId || payment.providerInvoiceId)) ? "نعم" : "لا",
    recordingMode,
    recordingModeLabelAr: labelAr("recordingMode", recordingMode),
    source: safeString(payment.source),
    providerInvoiceId: safeString(payment.providerInvoiceId) || null,
    providerPaymentId: safeString(payment.providerPaymentId) || null,
    collectedBy: collector ? {
      id: String(collector._id),
      name: safeString(collector.email),
      role: safeString(collector.role, "unknown"),
      roleLabelAr: labelAr("role", collector.role),
    } : null,
    businessDate,
    businessDateLabelAr: formatBusinessDateAr(businessDate),
    paidAt,
    paidAtLabelAr: formatDateTimeAr(paidAt),
    createdAt,
    createdAtLabelAr: formatDateTimeAr(createdAt),
    accountingTreatmentAr,
    needsReview: reviewReasonsAr.length > 0,
    reviewReasonsAr,
    subscriptionPricing: {
      storedTotalHalala: subscriptionTotal,
      storedTotalFormattedAr: moneyValue(subscriptionTotal).formattedAr,
      basePlanHalala: normalizeHalala(subscription && (subscription.basePlanGrossHalala || subscription.basePlanPriceHalala)),
      discountHalala: normalizeHalala(subscription && subscription.discountHalala),
      deliveryFeeHalala: normalizeHalala(subscription && subscription.deliveryFeeHalala),
    },
  };
}

function percentage(part, total) {
  if (!total) return 0;
  return Math.round((Number(part || 0) / total) * 10000) / 100;
}

function buildBucketRows(items, key, group) {
  const buckets = new Map();
  for (const item of items) {
    const value = safeString(item[key], "unknown");
    const customerId = safeString(item.customerId);
    const current = buckets.get(value) || {
      value,
      count: 0,
      totalHalala: 0,
      customerIds: new Set(),
    };
    current.count += 1;
    current.totalHalala += normalizeHalala(item.amountHalala);
    if (customerId) current.customerIds.add(customerId);
    buckets.set(value, current);
  }
  const grandTotal = items.reduce((sum, item) => sum + normalizeHalala(item.amountHalala), 0);
  return Array.from(buckets.values())
    .map((bucket) => {
      const money = moneyValue(bucket.totalHalala);
      return {
        [key === "paymentMethod" ? "method" : key]: bucket.value,
        labelAr: labelAr(group, bucket.value),
        count: bucket.count,
        uniqueCustomersCount: bucket.customerIds.size,
        totalHalala: bucket.totalHalala,
        totalSar: money.amountSar,
        totalFormattedAr: money.formattedAr,
        percentage: percentage(bucket.totalHalala, grandTotal),
      };
    })
    .sort((left, right) => right.totalHalala - left.totalHalala);
}

function buildPaymentMethodSummary(items = []) {
  const byPaymentMethod = buildBucketRows(items, "paymentMethod", "paymentMethod");
  const byMethod = new Map(byPaymentMethod.map((row) => [row.method, row]));
  const empty = { count: 0, uniqueCustomersCount: 0, totalHalala: 0, totalSar: 0, totalFormattedAr: moneyValue(0).formattedAr };
  const cash = byMethod.get("cash") || empty;
  const visa = byMethod.get("visa") || empty;
  const unknown = byMethod.get("unknown") || empty;
  const customerIds = new Set(items.map((item) => safeString(item.customerId)).filter(Boolean));
  const totalHalala = items.reduce((sum, item) => sum + normalizeHalala(item.amountHalala), 0);
  const vatHalala = items.reduce((sum, item) => sum + normalizeHalala(item.vatHalala), 0);
  const netBeforeVatHalala = items.reduce((sum, item) => sum + normalizeHalala(item.netBeforeVatHalala), 0);
  const canceledItems = items.filter((item) => item.subscriptionStatus === "canceled");
  const canceledTotalHalala = canceledItems.reduce((sum, item) => sum + normalizeHalala(item.amountHalala), 0);
  const reviewItems = items.filter((item) => item.needsReview);
  const activeItems = items.filter((item) => item.subscriptionStatus === "active");
  const activeTotalHalala = activeItems.reduce((sum, item) => sum + normalizeHalala(item.amountHalala), 0);
  const total = moneyValue(totalHalala);
  const vat = moneyValue(vatHalala);
  const net = moneyValue(netBeforeVatHalala);
  const canceled = moneyValue(canceledTotalHalala);
  const average = moneyValue(items.length ? Math.round(totalHalala / items.length) : 0);

  return {
    totalPaymentsCount: items.length,
    uniqueCustomersCount: customerIds.size,
    totalHalala,
    totalSar: total.amountSar,
    totalFormattedAr: total.formattedAr,
    grossCollectionsHalala: totalHalala,
    grossCollectionsSar: total.amountSar,
    grossCollectionsFormattedAr: total.formattedAr,
    netBeforeVatHalala,
    netBeforeVatSar: net.amountSar,
    netBeforeVatFormattedAr: net.formattedAr,
    vatIncluded: true,
    vatPercentage: VAT_PERCENTAGE,
    vatHalala,
    vatSar: vat.amountSar,
    vatFormattedAr: vat.formattedAr,
    refundsCount: null,
    refundsHalala: null,
    refundsFormattedAr: null,
    refundsTrackingStatus: "not_available",
    refundsTrackingStatusAr: "لا يوجد تاريخ استرداد مستقل في سجل الدفعة، لذلك لا يتم خصم المرتجعات من هذه الفترة تلقائيًا",
    netCashMovementHalala: null,
    netCashMovementFormattedAr: null,
    averagePaymentHalala: average.amountHalala,
    averagePaymentFormattedAr: average.formattedAr,
    cashCount: cash.count,
    cashCustomersCount: cash.uniqueCustomersCount,
    cashTotalHalala: cash.totalHalala,
    cashTotalSar: cash.totalSar,
    cashTotalFormattedAr: cash.totalFormattedAr,
    visaCount: visa.count,
    visaCustomersCount: visa.uniqueCustomersCount,
    visaTotalHalala: visa.totalHalala,
    visaTotalSar: visa.totalSar,
    visaTotalFormattedAr: visa.totalFormattedAr,
    unknownCount: unknown.count,
    unknownCustomersCount: unknown.uniqueCustomersCount,
    unknownTotalHalala: unknown.totalHalala,
    unknownTotalSar: unknown.totalSar,
    unknownTotalFormattedAr: unknown.totalFormattedAr,
    paymentMethodCoveragePercent: percentage(totalHalala - unknown.totalHalala, totalHalala),
    activeSubscriptionsPaymentsCount: activeItems.length,
    activeSubscriptionsTotalHalala: activeTotalHalala,
    activeSubscriptionsTotalFormattedAr: moneyValue(activeTotalHalala).formattedAr,
    canceledSubscriptionsPaymentsCount: canceledItems.length,
    canceledSubscriptionsTotalHalala: canceledTotalHalala,
    canceledSubscriptionsTotalFormattedAr: canceled.formattedAr,
    reviewItemsCount: reviewItems.length,
    byPaymentMethod,
  };
}

function buildWarnings(items, summary) {
  const warnings = [];
  if (summary.unknownCount > 0) {
    warnings.push({
      code: "UNKNOWN_PAYMENT_METHOD",
      titleAr: "طرق دفع غير مصنفة",
      message: `يوجد ${summary.unknownCount} دفعة لا يمكن تحديد هل هي نقدية أم بطاقة بنكية.`,
      messageAr: `يوجد ${summary.unknownCount} دفعة لا يمكن تحديد هل هي نقدية أم بطاقة بنكية.`,
      count: summary.unknownCount,
      totalHalala: summary.unknownTotalHalala,
      totalFormattedAr: summary.unknownTotalFormattedAr,
      severity: "warning",
    });
  }
  if (summary.canceledSubscriptionsPaymentsCount > 0) {
    warnings.push({
      code: "PAID_CANCELED_SUBSCRIPTION",
      titleAr: "اشتراكات ملغاة لها مبالغ محصلة",
      message: "الإلغاء لا يعني أن المبلغ تم رده. يجب مراجعة حالة المرتجع أو إثبات بقاء المبلغ مستحقًا.",
      messageAr: "الإلغاء لا يعني أن المبلغ تم رده. يجب مراجعة حالة المرتجع أو إثبات بقاء المبلغ مستحقًا.",
      count: summary.canceledSubscriptionsPaymentsCount,
      totalHalala: summary.canceledSubscriptionsTotalHalala,
      totalFormattedAr: summary.canceledSubscriptionsTotalFormattedAr,
      severity: "critical",
    });
  }
  const mismatchItems = items.filter((item) => item.reviewReasonsAr.includes("قيمة الدفعة لا تطابق إجمالي الاشتراك المحفوظ"));
  if (mismatchItems.length) {
    const mismatchTotal = mismatchItems.reduce((sum, item) => sum + item.amountHalala, 0);
    warnings.push({
      code: "PAYMENT_SUBSCRIPTION_TOTAL_MISMATCH",
      titleAr: "اختلاف بين الدفعة وإجمالي الاشتراك",
      message: `يوجد ${mismatchItems.length} دفعة تحتاج مراجعة تفاصيل التسعير.`,
      messageAr: `يوجد ${mismatchItems.length} دفعة تحتاج مراجعة تفاصيل التسعير.`,
      count: mismatchItems.length,
      totalHalala: mismatchTotal,
      totalFormattedAr: moneyValue(mismatchTotal).formattedAr,
      severity: "warning",
    });
  }
  const missingCustomers = items.filter((item) => !item.customerId).length;
  if (missingCustomers) {
    warnings.push({
      code: "PAYMENT_MISSING_CUSTOMER",
      titleAr: "دفعات غير مرتبطة بعميل",
      message: `يوجد ${missingCustomers} دفعة تحتاج ربطًا بالعميل.`,
      messageAr: `يوجد ${missingCustomers} دفعة تحتاج ربطًا بالعميل.`,
      count: missingCustomers,
      totalHalala: 0,
      totalFormattedAr: moneyValue(0).formattedAr,
      severity: "critical",
    });
  }
  return warnings;
}

function buildDashboardCards(summary) {
  return [
    {
      key: "gross_collections",
      titleAr: "إجمالي التحصيل",
      valueHalala: summary.grossCollectionsHalala,
      valueSar: summary.grossCollectionsSar,
      valueFormattedAr: summary.grossCollectionsFormattedAr,
      subtitleAr: `${summary.totalPaymentsCount} عملية دفع`,
      severity: "normal",
    },
    {
      key: "net_before_vat",
      titleAr: "صافي المبيعات قبل الضريبة",
      valueHalala: summary.netBeforeVatHalala,
      valueSar: summary.netBeforeVatSar,
      valueFormattedAr: summary.netBeforeVatFormattedAr,
      subtitleAr: "قبل ضريبة القيمة المضافة",
      severity: "normal",
    },
    {
      key: "vat",
      titleAr: "ضريبة القيمة المضافة",
      valueHalala: summary.vatHalala,
      valueSar: summary.vatSar,
      valueFormattedAr: summary.vatFormattedAr,
      subtitleAr: `ضريبة شاملة بنسبة ${summary.vatPercentage}%`,
      severity: "normal",
    },
    {
      key: "cash",
      titleAr: "التحصيل النقدي",
      valueHalala: summary.cashTotalHalala,
      valueSar: summary.cashTotalSar,
      valueFormattedAr: summary.cashTotalFormattedAr,
      subtitleAr: `${summary.cashCount} عملية`,
      severity: "normal",
    },
    {
      key: "cards",
      titleAr: "تحصيل البطاقات",
      valueHalala: summary.visaTotalHalala,
      valueSar: summary.visaTotalSar,
      valueFormattedAr: summary.visaTotalFormattedAr,
      subtitleAr: `${summary.visaCount} عملية`,
      severity: "normal",
    },
    {
      key: "unclassified",
      titleAr: "مبالغ غير مصنفة",
      valueHalala: summary.unknownTotalHalala,
      valueSar: summary.unknownTotalSar,
      valueFormattedAr: summary.unknownTotalFormattedAr,
      subtitleAr: `${summary.unknownCount} عملية تحتاج مراجعة`,
      severity: summary.unknownCount ? "warning" : "normal",
    },
    {
      key: "paid_canceled_subscriptions",
      titleAr: "مدفوعات اشتراكات ملغاة",
      valueHalala: summary.canceledSubscriptionsTotalHalala,
      valueSar: summary.canceledSubscriptionsTotalHalala / 100,
      valueFormattedAr: summary.canceledSubscriptionsTotalFormattedAr,
      subtitleAr: `${summary.canceledSubscriptionsPaymentsCount} اشتراك`,
      severity: summary.canceledSubscriptionsPaymentsCount ? "critical" : "normal",
    },
  ];
}

function buildReconciliation(summary, warnings) {
  const allocatedHalala = summary.cashTotalHalala + summary.visaTotalHalala + summary.unknownTotalHalala;
  const differenceHalala = summary.totalHalala - allocatedHalala;
  const needsReview = warnings.length > 0 || differenceHalala !== 0;
  return {
    status: needsReview ? "needs_review" : "balanced",
    statusLabelAr: needsReview ? "يحتاج مراجعة" : "متوازن",
    recordedCollectionsHalala: summary.totalHalala,
    recordedCollectionsFormattedAr: summary.totalFormattedAr,
    allocatedByPaymentMethodHalala: allocatedHalala,
    allocatedByPaymentMethodFormattedAr: moneyValue(allocatedHalala).formattedAr,
    differenceHalala,
    differenceFormattedAr: moneyValue(Math.abs(differenceHalala)).formattedAr,
    unresolvedPaymentsCount: summary.unknownCount,
    reviewItemsCount: summary.reviewItemsCount,
    noteAr: needsReview
      ? "راجع التحذيرات قبل إغلاق الفترة المحاسبية."
      : "إجمالي الدفعات يساوي مجموع طرق الدفع ولا توجد حالات معلقة.",
  };
}

async function loadSubscriptionPaymentItems({ periods, fulfillmentMethod }) {
  const rangeStart = periods[0].start;
  const rangeEnd = periods[periods.length - 1].end;
  const candidatePayments = await Payment.find({
    type: { $in: PAYMENT_TYPES },
    status: "paid",
    $or: [
      { paidAt: { $gte: rangeStart, $lte: rangeEnd } },
      { paidAt: null, createdAt: { $gte: rangeStart, $lte: rangeEnd } },
    ],
  }).sort({ paidAt: 1, createdAt: 1, _id: 1 }).lean();

  const paymentsWithPeriods = candidatePayments
    .map((payment) => ({ payment, period: findPeriodForPayment(payment, periods) }))
    .filter((row) => row.period);
  const subscriptionIds = Array.from(new Set(
    paymentsWithPeriods.map(({ payment }) => safeString(payment.subscriptionId)).filter(Boolean)
  ));
  const subscriptions = subscriptionIds.length
    ? await Subscription.find({ _id: { $in: subscriptionIds } })
      .select([
        "_id", "userId", "planId", "deliveryMode", "status", "startDate", "endDate", "validityEndDate",
        "selectedGrams", "selectedMealsPerDay", "totalMeals", "pickupLocationId", "deliveryZoneName",
        "basePlanPriceHalala", "basePlanGrossHalala", "basePlanNetHalala", "discountHalala",
        "subtotalBeforeVatHalala", "vatPercentage", "vatHalala", "totalPriceHalala", "deliveryFeeHalala",
      ].join(" "))
      .lean()
    : [];
  const subscriptionMap = new Map(subscriptions.map((row) => [String(row._id), row]));
  const filteredRows = paymentsWithPeriods.filter(({ payment }) => {
    const subscription = subscriptionMap.get(safeString(payment.subscriptionId));
    if (!subscription) return false;
    return fulfillmentMethod === "all" || safeString(subscription.deliveryMode).toLowerCase() === fulfillmentMethod;
  });

  const userIds = Array.from(new Set(filteredRows.map(({ payment }) => {
    const subscription = subscriptionMap.get(safeString(payment.subscriptionId));
    return safeString(payment.userId || subscription && subscription.userId);
  }).filter(Boolean)));
  const planIds = Array.from(new Set(filteredRows.map(({ payment }) => {
    const subscription = subscriptionMap.get(safeString(payment.subscriptionId));
    return safeString(subscription && subscription.planId);
  }).filter(Boolean)));
  const collectorIds = Array.from(new Set(filteredRows.map(({ payment }) => safeString(payment.collectedBy)).filter(Boolean)));
  const paymentIds = filteredRows.map(({ payment }) => String(payment._id));
  const relevantSubscriptionIds = Array.from(new Set(filteredRows.map(({ payment }) => safeString(payment.subscriptionId)).filter(Boolean)));

  const [users, plans, collectors, audits] = await Promise.all([
    userIds.length ? User.find({ _id: { $in: userIds } }).select("_id name phone").lean() : [],
    planIds.length ? Plan.find({ _id: { $in: planIds } }).select("_id name daysCount").lean() : [],
    collectorIds.length ? DashboardUser.find({ _id: { $in: collectorIds } }).select("_id email role").lean() : [],
    relevantSubscriptionIds.length ? ActivityLog.find({
      entityType: "subscription",
      action: { $in: PAYMENT_AUDIT_ACTIONS },
      $or: [
        { entityId: { $in: relevantSubscriptionIds } },
        { "meta.paymentId": { $in: paymentIds } },
      ],
    }).sort({ createdAt: -1, _id: -1 }).lean() : [],
  ]);
  const userMap = new Map(users.map((row) => [String(row._id), row]));
  const planMap = new Map(plans.map((row) => [String(row._id), row]));
  const collectorMap = new Map(collectors.map((row) => [String(row._id), row]));
  const auditIndex = buildAuditIndex(audits);

  return filteredRows.map(({ payment, period }) => {
    const subscriptionId = safeString(payment.subscriptionId);
    const subscription = subscriptionMap.get(subscriptionId);
    const customerId = safeString(payment.userId || subscription && subscription.userId);
    const planId = safeString(subscription && subscription.planId);
    const collectorId = safeString(payment.collectedBy);
    return serializePaymentItem({
      payment,
      subscription,
      user: userMap.get(customerId),
      plan: planMap.get(planId),
      collector: collectorMap.get(collectorId),
      audit: closestAuditForPayment(payment, subscriptionId, auditIndex),
      businessDate: period.businessDate,
    });
  });
}

function buildCommonReportSections(items) {
  const summary = buildPaymentMethodSummary(items);
  const warnings = buildWarnings(items, summary);
  const byPaymentMethod = summary.byPaymentMethod;
  const byFulfillmentMethod = buildBucketRows(items, "fulfillmentMethod", "fulfillmentMethod");
  const bySubscriptionStatus = buildBucketRows(items, "subscriptionStatus", "subscriptionStatus");
  const byPaymentType = buildBucketRows(items, "paymentType", "paymentType");
  return {
    summary,
    dashboardCards: buildDashboardCards(summary),
    byPaymentMethod,
    byFulfillmentMethod,
    bySubscriptionStatus,
    byPaymentType,
    reconciliation: buildReconciliation(summary, warnings),
    warnings,
  };
}

function buildAccountingPolicyAr() {
  return {
    basis: "أساس نقدي للتحصيل",
    basisDescription: "يتم إدراج الدفعة في تاريخ التحصيل الفعلي المسجل في paidAt، مع الرجوع إلى createdAt للسجلات القديمة فقط.",
    vatTreatment: `المبالغ شاملة ضريبة القيمة المضافة بنسبة ${VAT_PERCENTAGE}%، ويتم فصل الضريبة من الإجمالي لا إضافتها عليه.`,
    cancellationTreatment: "إلغاء الاشتراك لا يُعتبر مرتجعًا ماليًا تلقائيًا. تظل الدفعة ضمن التحصيل حتى يتم تسجيل عملية استرداد مستقلة.",
    paymentMethodTreatment: "طريقة الدفع تعتمد على حقل الدفعة أولًا، ثم بياناتها الوصفية، ثم سجل الحركة القديم لاسترجاع البيانات التاريخية.",
  };
}

async function buildDailySubscriptionPaymentReport({
  date,
  fulfillmentMethod = "all",
  includeDetails = true,
} = {}) {
  const selectedFulfillment = normalizeFulfillmentMethod(fulfillmentMethod);
  const details = parseIncludeDetails(includeDetails);
  const period = await accountingDailyReportService.resolveBusinessPeriod(date);
  const items = await loadSubscriptionPaymentItems({ periods: [period], fulfillmentMethod: selectedFulfillment });
  const sections = buildCommonReportSections(items);

  return {
    reportType: "daily",
    reportTypeLabelAr: "تقرير تحصيل الاشتراكات اليومي",
    titleAr: `تقرير تحصيل الاشتراكات — ${formatBusinessDateAr(period.businessDate)}`,
    locale: "ar-AE",
    businessDate: period.businessDate,
    businessDateLabelAr: formatBusinessDateAr(period.businessDate),
    timezone: period.timezone,
    timezoneLabelAr: "توقيت الرياض",
    currency: "SAR",
    currencyLabelAr: "ريال سعودي",
    moneyUnit: "halala",
    moneyUnitLabelAr: "هللة",
    filters: {
      date: period.businessDate,
      dateLabelAr: formatBusinessDateAr(period.businessDate),
      fulfillmentMethod: selectedFulfillment,
      fulfillmentMethodLabelAr: labelAr("fulfillmentMethod", selectedFulfillment),
      includeDetails: details,
      includeDetailsLabelAr: details ? "مع التفاصيل" : "ملخص فقط",
    },
    period: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      startLabelAr: formatDateTimeAr(period.start),
      endLabelAr: formatDateTimeAr(period.end),
      labelAr: `من ${formatDateTimeAr(period.start)} إلى ${formatDateTimeAr(period.end)}`,
    },
    ...sections,
    items: details ? items : [],
    accountingPolicyAr: buildAccountingPolicyAr(),
    generatedAt: new Date().toISOString(),
    generatedAtLabelAr: formatDateTimeAr(new Date()),
  };
}

function compactDailySummary(period, items) {
  const summary = buildPaymentMethodSummary(items);
  return {
    businessDate: period.businessDate,
    businessDateLabelAr: formatBusinessDateAr(period.businessDate),
    paymentsCount: summary.totalPaymentsCount,
    uniqueCustomersCount: summary.uniqueCustomersCount,
    totalHalala: summary.totalHalala,
    totalSar: summary.totalSar,
    totalFormattedAr: summary.totalFormattedAr,
    netBeforeVatHalala: summary.netBeforeVatHalala,
    netBeforeVatFormattedAr: summary.netBeforeVatFormattedAr,
    vatHalala: summary.vatHalala,
    vatFormattedAr: summary.vatFormattedAr,
    cashTotalHalala: summary.cashTotalHalala,
    cashTotalFormattedAr: summary.cashTotalFormattedAr,
    visaTotalHalala: summary.visaTotalHalala,
    visaTotalFormattedAr: summary.visaTotalFormattedAr,
    unknownTotalHalala: summary.unknownTotalHalala,
    unknownTotalFormattedAr: summary.unknownTotalFormattedAr,
    canceledSubscriptionsTotalHalala: summary.canceledSubscriptionsTotalHalala,
    canceledSubscriptionsTotalFormattedAr: summary.canceledSubscriptionsTotalFormattedAr,
    needsReview: summary.reviewItemsCount > 0,
  };
}

function buildMonthlyStatistics(dailyBreakdown) {
  const daysWithPayments = dailyBreakdown.filter((row) => row.paymentsCount > 0);
  const totalHalala = dailyBreakdown.reduce((sum, row) => sum + row.totalHalala, 0);
  const highest = daysWithPayments.reduce((best, row) => (!best || row.totalHalala > best.totalHalala ? row : best), null);
  const averageCalendar = moneyValue(dailyBreakdown.length ? Math.round(totalHalala / dailyBreakdown.length) : 0);
  const averageActive = moneyValue(daysWithPayments.length ? Math.round(totalHalala / daysWithPayments.length) : 0);
  return {
    daysInMonth: dailyBreakdown.length,
    daysWithPayments: daysWithPayments.length,
    daysWithoutPayments: dailyBreakdown.length - daysWithPayments.length,
    averagePerCalendarDayHalala: averageCalendar.amountHalala,
    averagePerCalendarDayFormattedAr: averageCalendar.formattedAr,
    averagePerActiveDayHalala: averageActive.amountHalala,
    averagePerActiveDayFormattedAr: averageActive.formattedAr,
    highestCollectionDay: highest ? {
      businessDate: highest.businessDate,
      businessDateLabelAr: highest.businessDateLabelAr,
      totalHalala: highest.totalHalala,
      totalFormattedAr: highest.totalFormattedAr,
    } : null,
  };
}

async function buildMonthlySubscriptionPaymentReport({
  month,
  fulfillmentMethod = "all",
  includeDetails = true,
} = {}) {
  const selectedMonth = normalizeMonth(month);
  const selectedFulfillment = normalizeFulfillmentMethod(fulfillmentMethod);
  const details = parseIncludeDetails(includeDetails);
  const dates = listMonthDates(selectedMonth);
  const periods = await Promise.all(dates.map((date) => accountingDailyReportService.resolveBusinessPeriod(date)));
  const items = await loadSubscriptionPaymentItems({ periods, fulfillmentMethod: selectedFulfillment });
  const sections = buildCommonReportSections(items);
  const itemsByDate = new Map();
  for (const item of items) {
    const rows = itemsByDate.get(item.businessDate) || [];
    rows.push(item);
    itemsByDate.set(item.businessDate, rows);
  }
  const dailyBreakdown = periods.map((period) => compactDailySummary(period, itemsByDate.get(period.businessDate) || []));

  return {
    reportType: "monthly",
    reportTypeLabelAr: "تقرير تحصيل الاشتراكات الشهري",
    titleAr: `تقرير تحصيل الاشتراكات — ${formatBusinessMonthAr(selectedMonth)}`,
    locale: "ar-AE",
    businessMonth: selectedMonth,
    businessMonthLabelAr: formatBusinessMonthAr(selectedMonth),
    timezone: periods[0].timezone,
    timezoneLabelAr: "توقيت الرياض",
    currency: "SAR",
    currencyLabelAr: "ريال سعودي",
    moneyUnit: "halala",
    moneyUnitLabelAr: "هللة",
    filters: {
      month: selectedMonth,
      monthLabelAr: formatBusinessMonthAr(selectedMonth),
      fulfillmentMethod: selectedFulfillment,
      fulfillmentMethodLabelAr: labelAr("fulfillmentMethod", selectedFulfillment),
      includeDetails: details,
      includeDetailsLabelAr: details ? "مع التفاصيل" : "ملخص فقط",
    },
    period: {
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      start: periods[0].start.toISOString(),
      end: periods[periods.length - 1].end.toISOString(),
      startLabelAr: formatDateTimeAr(periods[0].start),
      endLabelAr: formatDateTimeAr(periods[periods.length - 1].end),
      labelAr: `من ${formatBusinessDateAr(dates[0])} إلى ${formatBusinessDateAr(dates[dates.length - 1])}`,
    },
    ...sections,
    statistics: buildMonthlyStatistics(dailyBreakdown),
    dailyBreakdown,
    items: details ? items : [],
    accountingPolicyAr: buildAccountingPolicyAr(),
    generatedAt: new Date().toISOString(),
    generatedAtLabelAr: formatDateTimeAr(new Date()),
  };
}

module.exports = {
  AR_LABELS,
  buildDailySubscriptionPaymentReport,
  buildMonthlySubscriptionPaymentReport,
  buildPaymentMethodSummary,
  buildWarnings,
  formatBusinessDateAr,
  listMonthDates,
  moneyValue,
  normalizeMonth,
  normalizeRecordedPaymentMethod,
  resolvePaymentMethodClassification,
};
