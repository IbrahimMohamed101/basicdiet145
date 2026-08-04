"use strict";

const Payment = require("../../models/Payment");
const Plan = require("../../models/Plan");
const Subscription = require("../../models/Subscription");
const User = require("../../models/User");
const { calculateVatBreakdownFromInclusiveTotal, VAT_PERCENTAGE } = require("../../config/vat");
const accountingDailyReportService = require("./accountingDailyReportService");
const originalService = require("./subscriptionPaymentMethodReportService");

const originalBuildDailySubscriptionPaymentReport =
  originalService.buildDailySubscriptionPaymentReport.bind(originalService);
const originalBuildMonthlySubscriptionPaymentReport =
  originalService.buildMonthlySubscriptionPaymentReport.bind(originalService);

const PAYMENT_TYPES = ["subscription_activation", "subscription_renewal"];

function safeString(value, fallback = "") {
  const normalized = value === undefined || value === null ? "" : String(value).trim();
  return normalized || fallback;
}

function normalizeHalala(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function signedHalala(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function moneyValue(amountHalala) {
  const amount = signedHalala(amountHalala);
  return {
    amountHalala: amount,
    amountSar: amount / 100,
    formattedAr: new Intl.NumberFormat("ar-AE", {
      style: "currency",
      currency: "SAR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount / 100),
  };
}

function parseDetails(value) {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "boolean") return value;
  const normalized = safeString(value).toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new accountingDailyReportService.AccountingReportError(
    "INVALID_INCLUDE_DETAILS",
    "قيمة عرض التفاصيل غير صحيحة",
    400
  );
}

function normalizeFulfillment(value) {
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

function snapshotFor(payment = {}) {
  const metadata = payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  return metadata.accountingSnapshot && typeof metadata.accountingSnapshot === "object"
    ? metadata.accountingSnapshot
    : {};
}

function resolveSourceChannelFromPayment(payment = {}) {
  const metadata = payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  const source = safeString(payment.source).toLowerCase();
  const origin = safeString(metadata.paymentOrigin || metadata.source).toLowerCase();
  const provider = safeString(payment.provider).toLowerCase();
  if (
    source.startsWith("dashboard_")
    || origin === "dashboard"
    || metadata.recordingMode === "dashboard_manual"
    || payment.collectedBy
  ) return "dashboard";
  if (
    source === "mobile_app_subscription"
    || origin === "mobile_app"
    || origin === "app"
    || metadata.recordingMode === "moyasar_gateway"
    || provider === "moyasar"
    || safeString(payment.providerPaymentId)
    || safeString(payment.providerInvoiceId)
  ) return "app";
  return "unknown";
}

function resolvePaymentProviderFromPayment(payment = {}, paymentMethod = "unknown") {
  const metadata = payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  const provider = safeString(payment.provider).toLowerCase();
  if (
    provider === "moyasar"
    || metadata.recordingMode === "moyasar_gateway"
    || safeString(payment.providerPaymentId)
    || safeString(payment.providerInvoiceId)
  ) return "moyasar";
  if (provider === "manual" || metadata.recordingMode === "dashboard_manual") return "manual_gateway";
  if (provider === "cash" || paymentMethod === "cash") return "none";
  return "unknown";
}

function paymentMethodLabelAr(method) {
  if (method === "cash") return "نقدي";
  if (method === "card") return "بطاقة / بوابة إلكترونية";
  if (method === "bank_transfer") return "تحويل بنكي";
  return "غير محدد";
}

function sourceChannelLabelAr(channel) {
  if (channel === "app") return "التطبيق";
  if (channel === "dashboard") return "لوحة التحكم";
  return "غير محدد";
}

function paymentProviderLabelAr(provider) {
  if (provider === "moyasar") return "ميسر";
  if (provider === "manual_gateway") return "بوابة مسجلة يدويًا";
  if (provider === "none") return "بدون مزود — نقدي";
  return "غير محدد";
}

function canonicalPaymentMethod(payment = {}) {
  const classification = originalService.resolvePaymentMethodClassification(payment, null);
  if (classification.method === "cash") return "cash";
  if (["visa", "moyasar"].includes(classification.method)) return "card";
  return "unknown";
}

function normalizeExistingItemAxes(item = {}) {
  const provider = safeString(item.paymentProvider || item.provider).toLowerCase();
  let paymentProvider = safeString(item.paymentProvider, "unknown").toLowerCase();
  let sourceChannel = safeString(item.sourceChannel, "unknown").toLowerCase();
  let paymentMethod = safeString(item.paymentMethod, "unknown").toLowerCase();

  if (
    provider === "moyasar"
    || safeString(item.providerPaymentId)
    || safeString(item.providerInvoiceId)
    || item.recordingMode === "moyasar_gateway"
  ) paymentProvider = "moyasar";
  if (provider === "manual" || item.recordingMode === "dashboard_manual") {
    paymentProvider = paymentProvider === "moyasar" ? "moyasar" : "manual_gateway";
  }
  if (provider === "cash" || paymentMethod === "cash") paymentProvider = "none";

  if (
    paymentProvider === "moyasar"
    || safeString(item.source).toLowerCase() === "mobile_app_subscription"
  ) sourceChannel = "app";
  if (
    safeString(item.source).toLowerCase().startsWith("dashboard_")
    || item.recordingMode === "dashboard_manual"
    || item.collectedBy
  ) sourceChannel = "dashboard";

  if (["visa", "moyasar"].includes(paymentMethod)) paymentMethod = "card";

  return {
    ...item,
    paymentMethod,
    paymentMethodLabelAr: paymentMethodLabelAr(paymentMethod),
    sourceChannel,
    sourceChannelLabelAr: sourceChannelLabelAr(sourceChannel),
    paymentProvider,
    paymentProviderLabelAr: paymentProviderLabelAr(paymentProvider),
  };
}

function findPeriodForPayment(payment, periods) {
  const occurredAt = payment.paidAt || payment.createdAt;
  if (!occurredAt) return null;
  const instant = new Date(occurredAt);
  if (Number.isNaN(instant.getTime())) return null;
  return periods.find((period) => instant >= period.start && instant <= period.end) || null;
}

async function loadOrphanPaymentItems({ periods, fulfillmentMethod }) {
  const rangeStart = periods[0].start;
  const rangeEnd = periods[periods.length - 1].end;
  const payments = await Payment.find({
    type: { $in: PAYMENT_TYPES },
    status: { $in: ["paid", "refunded"] },
    $or: [
      { paidAt: { $gte: rangeStart, $lte: rangeEnd } },
      { paidAt: null, createdAt: { $gte: rangeStart, $lte: rangeEnd } },
    ],
  }).sort({ paidAt: 1, createdAt: 1, _id: 1 }).lean();

  const subscriptionIds = Array.from(new Set(
    payments.map((payment) => safeString(payment.subscriptionId)).filter(Boolean)
  ));
  const existingSubscriptions = subscriptionIds.length
    ? await Subscription.find({ _id: { $in: subscriptionIds } }).select("_id").lean()
    : [];
  const existingSubscriptionIds = new Set(existingSubscriptions.map((row) => String(row._id)));
  const orphanPayments = payments.filter((payment) => {
    const subscriptionId = safeString(payment.subscriptionId);
    return !subscriptionId || !existingSubscriptionIds.has(subscriptionId);
  });

  const userIds = Array.from(new Set(
    orphanPayments.map((payment) => safeString(payment.userId)).filter(Boolean)
  ));
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select("_id name phone").lean()
    : [];
  const userMap = new Map(users.map((user) => [String(user._id), user]));

  const snapshotPlanIds = Array.from(new Set(orphanPayments
    .map((payment) => safeString(snapshotFor(payment).planId))
    .filter(Boolean)));
  const plans = snapshotPlanIds.length
    ? await Plan.find({ _id: { $in: snapshotPlanIds } }).select("_id name").lean()
    : [];
  const planMap = new Map(plans.map((plan) => [String(plan._id), plan]));

  return orphanPayments.flatMap((payment) => {
    const period = findPeriodForPayment(payment, periods);
    if (!period) return [];
    const snapshot = snapshotFor(payment);
    const metadata = payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
    const resolvedFulfillment = safeString(
      snapshot.fulfillmentMethod || metadata.fulfillmentMethod,
      "unknown"
    ).toLowerCase();
    if (fulfillmentMethod !== "all" && resolvedFulfillment !== fulfillmentMethod) return [];

    const paymentMethod = canonicalPaymentMethod(payment);
    const sourceChannel = resolveSourceChannelFromPayment(payment);
    const paymentProvider = resolvePaymentProviderFromPayment(payment, paymentMethod);
    const user = userMap.get(safeString(payment.userId));
    const plan = planMap.get(safeString(snapshot.planId));
    const amountHalala = normalizeHalala(payment.amount);
    const vat = calculateVatBreakdownFromInclusiveTotal(amountHalala);
    const paidAt = payment.paidAt ? new Date(payment.paidAt).toISOString() : null;
    const createdAt = payment.createdAt ? new Date(payment.createdAt).toISOString() : null;
    const subscriptionStatus = safeString(snapshot.subscriptionStatus, "unknown").toLowerCase();
    const reviewReasonsAr = ["سجل الاشتراك المرتبط بالدفعة غير موجود"];
    if (paymentMethod === "unknown") reviewReasonsAr.push("طريقة الدفع غير مصنفة");

    return [{
      movementId: `orphan-payment:${String(payment._id)}`,
      movementType: "collection",
      movementTypeLabelAr: "تحصيل",
      paymentId: String(payment._id),
      paymentReference: safeString(
        payment.providerPaymentId || payment.providerInvoiceId,
        `PAY-${String(payment._id).slice(-8).toUpperCase()}`
      ),
      subscriptionId: safeString(payment.subscriptionId),
      subscriptionRecordPresent: false,
      subscriptionRecordPresentLabelAr: "لا",
      customerId: safeString(payment.userId),
      customerName: user ? safeString(user.name, user.phone) : safeString(snapshot.customerName),
      customerPhone: user ? safeString(user.phone) : safeString(snapshot.customerPhone),
      planId: safeString(snapshot.planId),
      planNameAr: plan && plan.name
        ? safeString(plan.name.ar || plan.name.en)
        : safeString(snapshot.planNameAr),
      paymentType: safeString(payment.type, "subscription_activation"),
      paymentTypeLabelAr: payment.type === "subscription_renewal" ? "تجديد اشتراك" : "تفعيل اشتراك",
      paymentMethod,
      paymentMethodLabelAr: paymentMethodLabelAr(paymentMethod),
      provider: safeString(payment.provider, "unknown").toLowerCase(),
      providerLabelAr: paymentProviderLabelAr(paymentProvider),
      sourceChannel,
      sourceChannelLabelAr: sourceChannelLabelAr(sourceChannel),
      paymentProvider,
      paymentProviderLabelAr: paymentProviderLabelAr(paymentProvider),
      status: safeString(payment.status, "paid"),
      statusLabelAr: payment.status === "refunded" ? "مسترد — يحتاج مراجعة" : "مدفوع",
      amountHalala,
      amountSar: amountHalala / 100,
      amountFormattedAr: moneyValue(amountHalala).formattedAr,
      grossCollectionHalala: amountHalala,
      grossCollectionFormattedAr: moneyValue(amountHalala).formattedAr,
      refundsHalala: 0,
      refundsFormattedAr: moneyValue(0).formattedAr,
      netMovementHalala: amountHalala,
      netMovementFormattedAr: moneyValue(amountHalala).formattedAr,
      currency: safeString(payment.currency, "SAR").toUpperCase(),
      vatIncluded: true,
      vatPercentage: Number(vat.vatPercentage || VAT_PERCENTAGE),
      vatHalala: normalizeHalala(vat.vatHalala),
      vatSar: normalizeHalala(vat.vatHalala) / 100,
      vatFormattedAr: moneyValue(vat.vatHalala).formattedAr,
      netBeforeVatHalala: normalizeHalala(vat.subtotalExcludingVatHalala),
      netBeforeVatSar: normalizeHalala(vat.subtotalExcludingVatHalala) / 100,
      netBeforeVatFormattedAr: moneyValue(vat.subtotalExcludingVatHalala).formattedAr,
      vatCalculationSource: "system_fallback",
      vatCalculationSourceAr: "احتساب النظام لضريبة شاملة",
      fulfillmentMethod: resolvedFulfillment,
      fulfillmentMethodLabelAr: resolvedFulfillment === "pickup"
        ? "استلام من الفرع"
        : resolvedFulfillment === "delivery" ? "توصيل" : "غير محدد",
      subscriptionStatus,
      subscriptionStatusLabelAr: subscriptionStatus === "active" ? "نشط وقت الدفع" : "غير محدد",
      gatewayUsed: paymentProvider === "moyasar",
      gatewayUsedLabelAr: paymentProvider === "moyasar" ? "نعم" : "لا",
      recordingMode: safeString(metadata.recordingMode, paymentProvider === "moyasar" ? "moyasar_gateway" : "unknown"),
      recordingModeLabelAr: paymentProvider === "moyasar" ? "تحصيل إلكتروني عبر ميسر" : "غير محدد",
      source: safeString(payment.source),
      providerInvoiceId: safeString(payment.providerInvoiceId) || null,
      providerPaymentId: safeString(payment.providerPaymentId) || null,
      businessDate: period.businessDate,
      businessDateLabelAr: originalService.formatBusinessDateAr(period.businessDate),
      paidAt,
      createdAt,
      accountingTreatmentAr: "دفعة محصلة محفوظة ماليًا رغم فقد سجل الاشتراك المرتبط",
      countedInTotals: true,
      needsReview: true,
      reviewReasonsAr,
      subscriptionPricing: {
        storedTotalHalala: normalizeHalala(snapshot.totalPriceHalala),
        storedTotalFormattedAr: moneyValue(snapshot.totalPriceHalala).formattedAr,
      },
    }];
  });
}

function buildBucketRows(items, key, labels) {
  const buckets = new Map();
  for (const item of items) {
    const value = safeString(item[key], "unknown");
    const current = buckets.get(value) || {
      key: value,
      count: 0,
      totalHalala: 0,
      customers: new Set(),
    };
    current.count += 1;
    current.totalHalala += normalizeHalala(item.amountHalala);
    if (item.customerId) current.customers.add(String(item.customerId));
    buckets.set(value, current);
  }
  return Array.from(buckets.values())
    .map((bucket) => ({
      key: bucket.key,
      [key]: bucket.key,
      labelAr: labels(bucket.key),
      count: bucket.count,
      uniqueCustomersCount: bucket.customers.size,
      customersCount: bucket.customers.size,
      totalHalala: bucket.totalHalala,
      totalSar: bucket.totalHalala / 100,
      totalFormattedAr: moneyValue(bucket.totalHalala).formattedAr,
    }))
    .sort((left, right) => right.totalHalala - left.totalHalala);
}

function buildDashboardCards(summary) {
  const cards = [
    {
      key: "gross_collections",
      titleAr: "إجمالي تحصيل الاشتراكات",
      valueHalala: summary.grossCollectionHalala,
      valueFormattedAr: summary.grossCollectionFormattedAr,
      subtitleAr: `${summary.totalPaymentsCount || 0} عملية دفع`,
    },
    {
      key: "refunds",
      titleAr: "المرتجعات",
      valueHalala: summary.refundsHalala,
      valueFormattedAr: summary.refundsFormattedAr,
      subtitleAr: `${summary.refundsCount || 0} حركة استرداد`,
    },
    {
      key: "net_collection",
      titleAr: "صافي الحركة",
      valueHalala: summary.netCollectionHalala,
      valueFormattedAr: summary.netCollectionFormattedAr,
      subtitleAr: "التحصيل ناقص المرتجعات",
    },
    {
      key: "cash",
      titleAr: "التحصيل النقدي",
      valueHalala: summary.cashTotalHalala,
      valueFormattedAr: summary.cashTotalFormattedAr,
      subtitleAr: `${summary.cashCount || 0} عملية`,
    },
    {
      key: "cards",
      titleAr: "تحصيل البطاقات (يشمل ميسر)",
      valueHalala: summary.cardTotalHalala ?? summary.visaTotalHalala,
      valueFormattedAr: summary.cardTotalFormattedAr ?? summary.visaTotalFormattedAr,
      subtitleAr: `${summary.cardCount ?? summary.visaCount ?? 0} عملية`,
    },
    {
      key: "moyasar",
      titleAr: "منها عبر ميسر",
      valueHalala: summary.moyasarTotalHalala,
      valueFormattedAr: summary.moyasarTotalFormattedAr,
      subtitleAr: `${summary.moyasarCount || 0} عملية ضمن البطاقات — لا تُجمع مرة أخرى`,
    },
    {
      key: "review_items",
      titleAr: "حركات تحتاج مراجعة",
      value: summary.reviewItemsCount || 0,
      count: summary.reviewItemsCount || 0,
      subtitleAr: "دفعات ناقصة الربط أو التصنيف",
    },
  ];
  return cards.map((card) => ({
    ...card,
    amountHalala: card.valueHalala,
    amountFormattedAr: card.valueFormattedAr,
    descriptionAr: card.subtitleAr,
  }));
}

function buildReconciliation(summary, warnings) {
  const allocated = (summary.byPaymentMethod || []).reduce(
    (sum, bucket) => sum + normalizeHalala(bucket.totalHalala),
    0
  );
  const difference = signedHalala(summary.grossCollectionHalala) - allocated;
  const movementDifference = signedHalala(summary.netCollectionHalala)
    - (signedHalala(summary.grossCollectionHalala) - signedHalala(summary.refundsHalala));
  const vatDifference = signedHalala(summary.netCollectionHalala)
    - (signedHalala(summary.netBeforeVatHalala) + signedHalala(summary.netVatHalala));
  const isBalanced = difference === 0 && movementDifference === 0 && vatDifference === 0;
  return {
    status: isBalanced && warnings.length === 0 ? "balanced" : "needs_review",
    statusLabelAr: isBalanced && warnings.length === 0 ? "متوازن" : "يحتاج مراجعة",
    isBalanced,
    differenceHalala: difference,
    differenceFormattedAr: moneyValue(difference).formattedAr,
    movementDifferenceHalala: movementDifference,
    vatDifferenceHalala: vatDifference,
    noteAr: isBalanced
      ? "الإجمالي موزع مرة واحدة حسب طريقة الدفع؛ ميسر تفصيل داخل البطاقات وليس إجماليًا إضافيًا."
      : "راجع الحركات المعلّمة قبل اعتماد الفترة.",
  };
}

function monthlyStatistics(dailyBreakdown) {
  const activeDays = dailyBreakdown.filter((row) =>
    signedHalala(row.grossCollectionHalala ?? row.totalHalala) !== 0
      || signedHalala(row.refundsHalala) !== 0
  );
  const totalNet = dailyBreakdown.reduce(
    (sum, row) => sum + signedHalala(row.netCollectionHalala ?? row.totalHalala),
    0
  );
  return {
    daysInMonth: dailyBreakdown.length,
    daysWithPayments: activeDays.length,
    daysWithoutPayments: dailyBreakdown.length - activeDays.length,
    averageDailyHalala: dailyBreakdown.length ? Math.round(totalNet / dailyBreakdown.length) : 0,
    averageDailyFormattedAr: moneyValue(
      dailyBreakdown.length ? Math.round(totalNet / dailyBreakdown.length) : 0
    ).formattedAr,
  };
}

function rebuildDailyBreakdown(report, items) {
  if (report.reportType !== "monthly") return report.dailyBreakdown;
  const dates = originalService.listMonthDates(report.businessMonth || report.month);
  return dates.map((businessDate) => {
    const dateItems = items.filter((item) => item.businessDate === businessDate);
    const collections = dateItems.filter((item) => item.movementType !== "refund");
    const refunds = dateItems.filter((item) => item.movementType === "refund");
    const summary = originalService.buildPaymentMethodSummary(collections, refunds);
    return {
      businessDate,
      businessDateLabelAr: originalService.formatBusinessDateAr(businessDate),
      paymentsCount: summary.totalPaymentsCount,
      totalPaymentsCount: summary.totalPaymentsCount,
      uniqueCustomersCount: summary.uniqueCustomersCount,
      totalHalala: summary.totalHalala,
      totalFormattedAr: summary.totalFormattedAr,
      grossCollectionHalala: summary.grossCollectionHalala,
      grossCollectionFormattedAr: summary.grossCollectionFormattedAr,
      refundsHalala: summary.refundsHalala,
      refundsFormattedAr: summary.refundsFormattedAr,
      netCollectionHalala: summary.netCollectionHalala,
      netCollectionFormattedAr: summary.netCollectionFormattedAr,
      cashTotalHalala: summary.cashTotalHalala,
      cashTotalFormattedAr: summary.cashTotalFormattedAr,
      visaTotalHalala: summary.visaTotalHalala,
      visaTotalFormattedAr: summary.visaTotalFormattedAr,
      moyasarTotalHalala: summary.moyasarTotalHalala,
      moyasarTotalFormattedAr: summary.moyasarTotalFormattedAr,
    };
  });
}

function decorateReport(report, orphanItems, includeDetails) {
  const normalizedExisting = (report.items || []).map(normalizeExistingItemAxes);
  const existingMovementIds = new Set(normalizedExisting.map((item) => item.movementId || item.paymentId));
  const appendedOrphans = orphanItems.filter(
    (item) => !existingMovementIds.has(item.movementId) && !existingMovementIds.has(item.paymentId)
  );
  const allItems = [...normalizedExisting, ...appendedOrphans].sort((left, right) =>
    safeString(left.refundedAt || left.paidAt || left.createdAt)
      .localeCompare(safeString(right.refundedAt || right.paidAt || right.createdAt))
  );
  const collections = allItems.filter((item) => item.movementType !== "refund");
  const refunds = allItems.filter((item) => item.movementType === "refund");
  const summary = originalService.buildPaymentMethodSummary(collections, refunds);
  const warnings = originalService.buildWarnings(allItems, summary);
  if (appendedOrphans.length) {
    const orphanTotal = appendedOrphans.reduce(
      (sum, item) => sum + normalizeHalala(item.amountHalala),
      0
    );
    warnings.unshift({
      code: "PAYMENT_SUBSCRIPTION_RECORD_MISSING",
      titleAr: "دفعات محفوظة بلا سجل اشتراك",
      message: `يوجد ${appendedOrphans.length} دفعة مالية محفوظة لكن سجل الاشتراك المرتبط بها غير موجود.`,
      messageAr: `يوجد ${appendedOrphans.length} دفعة مالية محفوظة لكن سجل الاشتراك المرتبط بها غير موجود.`,
      count: appendedOrphans.length,
      totalHalala: orphanTotal,
      totalFormattedAr: moneyValue(orphanTotal).formattedAr,
      severity: "critical",
    });
  }

  const bySourceChannel = buildBucketRows(
    collections,
    "sourceChannel",
    sourceChannelLabelAr
  );
  const byPaymentProvider = buildBucketRows(
    collections,
    "paymentProvider",
    paymentProviderLabelAr
  );
  const dailyBreakdown = rebuildDailyBreakdown(report, allItems);

  return {
    ...report,
    titleAr: report.reportType === "daily"
      ? `تقرير تحصيل الاشتراكات اليومي — ${report.businessDateLabelAr || report.businessDate}`
      : report.titleAr,
    summary,
    dashboardCards: buildDashboardCards(summary),
    byPaymentMethod: summary.byPaymentMethod,
    bySourceChannel,
    byPaymentProvider,
    warnings,
    reconciliation: buildReconciliation(summary, warnings),
    dailyBreakdown,
    statistics: report.reportType === "monthly"
      ? monthlyStatistics(dailyBreakdown || [])
      : report.statistics,
    items: includeDetails ? allItems : [],
    accountingPolicyAr: {
      ...(report.accountingPolicyAr || {}),
      paymentMethodTreatment:
        "طريقة الدفع وقناة المصدر ومزود الدفع محاور مستقلة؛ ميسر يظهر كمزود داخل تحصيل البطاقات ولا يُجمع مرتين.",
      missingSubscriptionTreatment:
        "الدفعة المالية لا تُحذف من التقرير عند فقد سجل الاشتراك؛ تظهر ضمن الإجمالي مع تحذير مراجعة واضح.",
    },
  };
}

async function buildDailySubscriptionPaymentReport({
  date,
  fulfillmentMethod = "all",
  includeDetails = true,
} = {}) {
  const details = parseDetails(includeDetails);
  const selectedFulfillment = normalizeFulfillment(fulfillmentMethod);
  const period = accountingDailyReportService.resolveFullDayPeriod(date);
  const [report, orphanItems] = await Promise.all([
    originalBuildDailySubscriptionPaymentReport({
      date,
      fulfillmentMethod: selectedFulfillment,
      includeDetails: true,
    }),
    loadOrphanPaymentItems({ periods: [period], fulfillmentMethod: selectedFulfillment }),
  ]);
  return decorateReport(report, orphanItems, details);
}

async function buildMonthlySubscriptionPaymentReport({
  month,
  fulfillmentMethod = "all",
  includeDetails = true,
} = {}) {
  const details = parseDetails(includeDetails);
  const selectedFulfillment = normalizeFulfillment(fulfillmentMethod);
  const dates = originalService.listMonthDates(month);
  const periods = dates.map((date) => accountingDailyReportService.resolveFullDayPeriod(date));
  const [report, orphanItems] = await Promise.all([
    originalBuildMonthlySubscriptionPaymentReport({
      month,
      fulfillmentMethod: selectedFulfillment,
      includeDetails: true,
    }),
    loadOrphanPaymentItems({ periods, fulfillmentMethod: selectedFulfillment }),
  ]);
  return decorateReport(report, orphanItems, details);
}

// Mutate the already-loaded legacy module so the range report, which imports
// its monthly builder from that module, receives the corrected data as well.
originalService.buildDailySubscriptionPaymentReport = buildDailySubscriptionPaymentReport;
originalService.buildMonthlySubscriptionPaymentReport = buildMonthlySubscriptionPaymentReport;

module.exports = {
  ...originalService,
  buildDailySubscriptionPaymentReport,
  buildMonthlySubscriptionPaymentReport,
  decorateReport,
  normalizeExistingItemAxes,
  resolvePaymentProviderFromPayment,
  resolveSourceChannelFromPayment,
};
