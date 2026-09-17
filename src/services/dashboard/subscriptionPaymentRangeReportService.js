"use strict";

const accountingDailyReportService = require("./accountingDailyReportService");
const {
  buildMonthlySubscriptionPaymentReport,
  buildPaymentMethodSummary,
  buildWarnings,
  formatBusinessDateAr,
  moneyValue,
} = require("./subscriptionPaymentMethodReportService");

const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

function safeString(value, fallback = "") {
  const normalized = value === undefined || value === null ? "" : String(value).trim();
  return normalized || fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = safeString(value).toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new accountingDailyReportService.AccountingReportError(
    "INVALID_BOOLEAN",
    "قيمة الخيار غير صحيحة",
    400
  );
}

function parseDate(value, fieldName) {
  const normalized = safeString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new accountingDailyReportService.AccountingReportError(
      "INVALID_DATE_RANGE",
      `صيغة ${fieldName} غير صحيحة. استخدم YYYY-MM-DD`,
      400
    );
  }
  const [year, month, day] = normalized.split("-").map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(instant.getTime())
    || instant.getUTCFullYear() !== year
    || instant.getUTCMonth() !== month - 1
    || instant.getUTCDate() !== day
  ) {
    throw new accountingDailyReportService.AccountingReportError(
      "INVALID_DATE_RANGE",
      `${fieldName} غير صالح`,
      400
    );
  }
  return { value: normalized, instant };
}

function toDateString(instant) {
  return instant.toISOString().slice(0, 10);
}

function addDays(dateString, amount) {
  const parsed = parseDate(dateString, "التاريخ");
  return toDateString(new Date(parsed.instant.getTime() + Number(amount) * DAY_MS));
}

function rangeDaysInclusive(from, to) {
  const start = parseDate(from, "تاريخ البداية");
  const end = parseDate(to, "تاريخ النهاية");
  if (start.instant > end.instant) {
    throw new accountingDailyReportService.AccountingReportError(
      "INVALID_DATE_RANGE",
      "تاريخ البداية يجب ألا يكون بعد تاريخ النهاية",
      400
    );
  }
  const days = Math.floor((end.instant.getTime() - start.instant.getTime()) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new accountingDailyReportService.AccountingReportError(
      "DATE_RANGE_TOO_LARGE",
      `الحد الأقصى للنطاق هو ${MAX_RANGE_DAYS} يومًا`,
      400
    );
  }
  return days;
}

function listRangeDates(from, to) {
  const days = rangeDaysInclusive(from, to);
  return Array.from({ length: days }, (_, index) => addDays(from, index));
}

function listRangeMonths(from, to) {
  const dates = listRangeDates(from, to);
  return Array.from(new Set(dates.map((date) => date.slice(0, 7))));
}

function resolvePreviousRange(from, to) {
  const days = rangeDaysInclusive(from, to);
  const previousTo = addDays(from, -1);
  return {
    from: addDays(previousTo, -(days - 1)),
    to: previousTo,
    days,
  };
}

function normalizeHalala(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function signedMoneyValue(amountHalala) {
  const amount = normalizeHalala(amountHalala);
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

function itemDate(item) {
  return safeString(item && item.businessDate);
}

function itemTimestamp(item) {
  return safeString(item && (item.refundedAt || item.paidAt || item.createdAt));
}

function withinRange(date, from, to) {
  return Boolean(date) && date >= from && date <= to;
}

function dedupeMovements(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = safeString(item && (item.movementId || (
      item.movementType === "refund"
        ? `refund:${item.refundId || item.providerRefundId || item.paymentId}:${item.refundedAt || ""}`
        : `collection:${item.paymentId || item.paymentReference || itemTimestamp(item)}`
    )));
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function labelForBucket(item, key) {
  const labels = {
    fulfillmentMethod: item.fulfillmentMethodLabelAr,
    subscriptionStatus: item.subscriptionStatusLabelAr,
    paymentType: item.paymentTypeLabelAr,
    sourceChannel: item.sourceChannelLabelAr,
    paymentProvider: item.paymentProviderLabelAr,
  };
  return safeString(labels[key], "غير مصنف");
}

function buildBucketRows(items, key) {
  const rows = new Map();
  for (const item of items) {
    const bucketKey = safeString(item && item[key], "unknown");
    const current = rows.get(bucketKey) || {
      key: bucketKey,
      labelAr: labelForBucket(item || {}, key),
      count: 0,
      customers: new Set(),
      totalHalala: 0,
    };
    current.count += 1;
    if (item && item.customerId) current.customers.add(String(item.customerId));
    current.totalHalala += normalizeHalala(item && item.amountHalala);
    rows.set(bucketKey, current);
  }
  return Array.from(rows.values())
    .map((row) => ({
      key: row.key,
      labelAr: row.labelAr,
      count: row.count,
      customersCount: row.customers.size,
      totalHalala: row.totalHalala,
      totalSar: row.totalHalala / 100,
      totalFormattedAr: moneyValue(row.totalHalala).formattedAr,
    }))
    .sort((left, right) => right.totalHalala - left.totalHalala);
}

function makeDashboardCard({ key, titleAr, amountHalala, subtitleAr, severity = "normal" }) {
  const money = signedMoneyValue(amountHalala);
  return {
    key,
    titleAr,
    valueHalala: money.amountHalala,
    valueSar: money.amountSar,
    valueFormattedAr: money.formattedAr,
    amountHalala: money.amountHalala,
    amountSar: money.amountSar,
    amountFormattedAr: money.formattedAr,
    subtitleAr,
    descriptionAr: subtitleAr,
    severity,
  };
}

function buildDashboardCards(summary, statistics) {
  return [
    makeDashboardCard({
      key: "gross_collections",
      titleAr: "إجمالي التحصيل",
      amountHalala: summary.grossCollectionHalala,
      subtitleAr: `${summary.totalPaymentsCount || 0} عملية تحصيل`,
    }),
    makeDashboardCard({
      key: "refunds",
      titleAr: "المرتجعات",
      amountHalala: summary.refundsHalala,
      subtitleAr: `${summary.refundsCount || 0} حركة استرداد`,
      severity: summary.refundsHalala > 0 ? "warning" : "normal",
    }),
    makeDashboardCard({
      key: "net_collection",
      titleAr: "صافي الحركة",
      amountHalala: summary.netCollectionHalala,
      subtitleAr: "التحصيل ناقص المرتجعات",
      severity: summary.netCollectionHalala < 0 ? "critical" : "normal",
    }),
    makeDashboardCard({
      key: "average_daily_net",
      titleAr: "متوسط صافي اليوم",
      amountHalala: statistics.averageDailyHalala,
      subtitleAr: `متوسط على ${statistics.totalDays} يوم`,
    }),
    {
      key: "customers",
      titleAr: "العملاء",
      value: summary.uniqueCustomersCount || 0,
      count: summary.uniqueCustomersCount || 0,
      subtitleAr: "عملاء فريدون داخل الفترة",
      descriptionAr: "عملاء فريدون داخل الفترة",
      severity: "normal",
    },
    {
      key: "active_days",
      titleAr: "أيام بها حركة",
      value: statistics.daysWithActivity,
      count: statistics.daysWithActivity,
      subtitleAr: `من أصل ${statistics.totalDays} يوم`,
      descriptionAr: `من أصل ${statistics.totalDays} يوم`,
      severity: "normal",
    },
    {
      key: "review_items",
      titleAr: "تحتاج مراجعة",
      value: summary.reviewItemsCount || 0,
      count: summary.reviewItemsCount || 0,
      subtitleAr: "حركات أو تصنيفات غير مكتملة",
      descriptionAr: "حركات أو تصنيفات غير مكتملة",
      severity: summary.reviewItemsCount ? "warning" : "normal",
    },
  ];
}

function buildReconciliation(summary, warnings) {
  const allocatedHalala = (summary.byPaymentMethod || []).reduce(
    (sum, bucket) => sum + normalizeHalala(bucket.totalHalala),
    0
  );
  const differenceHalala = normalizeHalala(summary.grossCollectionHalala) - allocatedHalala;
  const movementDifferenceHalala = normalizeHalala(summary.netCollectionHalala)
    - (normalizeHalala(summary.grossCollectionHalala) - normalizeHalala(summary.refundsHalala));
  const vatDifferenceHalala = normalizeHalala(summary.netCollectionHalala)
    - (normalizeHalala(summary.netBeforeVatHalala) + normalizeHalala(summary.netVatHalala));
  const isBalanced = differenceHalala === 0
    && movementDifferenceHalala === 0
    && vatDifferenceHalala === 0;
  return {
    status: isBalanced && warnings.length === 0 ? "balanced" : "needs_review",
    statusLabelAr: isBalanced && warnings.length === 0 ? "متوازن" : "يحتاج مراجعة",
    isBalanced,
    allocatedByPaymentMethodHalala: allocatedHalala,
    allocatedByPaymentMethodFormattedAr: moneyValue(allocatedHalala).formattedAr,
    differenceHalala,
    differenceFormattedAr: signedMoneyValue(differenceHalala).formattedAr,
    grossCollectionHalala: summary.grossCollectionHalala,
    refundsHalala: summary.refundsHalala,
    netCollectionHalala: summary.netCollectionHalala,
    movementDifferenceHalala,
    movementDifferenceFormattedAr: signedMoneyValue(movementDifferenceHalala).formattedAr,
    netBeforeVatHalala: summary.netBeforeVatHalala,
    netVatHalala: summary.netVatHalala,
    vatDifferenceHalala,
    vatDifferenceFormattedAr: signedMoneyValue(vatDifferenceHalala).formattedAr,
    reviewItemsCount: summary.reviewItemsCount || 0,
    noteAr: isBalanced
      ? "معادلات التحصيل والمرتجعات والضريبة متوازنة داخل النطاق المحدد."
      : "يوجد فرق في إحدى معادلات التسوية ويجب مراجعته قبل اعتماد الفترة.",
  };
}

function emptyDailyRow(date) {
  return {
    businessDate: date,
    businessDateLabelAr: formatBusinessDateAr(date),
    paymentsCount: 0,
    totalPaymentsCount: 0,
    totalHalala: 0,
    totalFormattedAr: moneyValue(0).formattedAr,
    grossCollectionHalala: 0,
    grossCollectionFormattedAr: moneyValue(0).formattedAr,
    refundsHalala: 0,
    refundsFormattedAr: moneyValue(0).formattedAr,
    netCollectionHalala: 0,
    netCollectionFormattedAr: moneyValue(0).formattedAr,
    cashTotalHalala: 0,
    cashTotalFormattedAr: moneyValue(0).formattedAr,
    cardTotalHalala: 0,
    cardTotalFormattedAr: moneyValue(0).formattedAr,
  };
}

function buildDailyBreakdown(reports, from, to) {
  const byDate = new Map();
  for (const report of reports) {
    for (const row of report.dailyBreakdown || []) {
      const date = safeString(row.businessDate);
      if (withinRange(date, from, to)) byDate.set(date, row);
    }
  }
  return listRangeDates(from, to).map((date) => byDate.get(date) || emptyDailyRow(date));
}

function buildStatistics(dailyBreakdown) {
  const totalDays = dailyBreakdown.length;
  const daysWithActivity = dailyBreakdown.filter(
    (row) => normalizeHalala(row.grossCollectionHalala ?? row.totalHalala) !== 0
      || normalizeHalala(row.refundsHalala) !== 0
  ).length;
  const totalNetHalala = dailyBreakdown.reduce(
    (sum, row) => sum + normalizeHalala(row.netCollectionHalala ?? row.totalHalala),
    0
  );
  const averageDailyHalala = totalDays ? Math.round(totalNetHalala / totalDays) : 0;
  const averageActiveDayHalala = daysWithActivity
    ? Math.round(totalNetHalala / daysWithActivity)
    : 0;
  const ordered = [...dailyBreakdown].sort(
    (left, right) => normalizeHalala(right.netCollectionHalala) - normalizeHalala(left.netCollectionHalala)
  );
  return {
    totalDays,
    daysWithActivity,
    daysWithoutActivity: totalDays - daysWithActivity,
    averageDailyHalala,
    averageDailyFormattedAr: signedMoneyValue(averageDailyHalala).formattedAr,
    averageActiveDayHalala,
    averageActiveDayFormattedAr: signedMoneyValue(averageActiveDayHalala).formattedAr,
    highestDay: ordered[0] || null,
    lowestDay: ordered[ordered.length - 1] || null,
  };
}

function percentageChange(current, previous) {
  const currentValue = normalizeHalala(current);
  const previousValue = normalizeHalala(previous);
  if (previousValue === 0) return currentValue === 0 ? 0 : null;
  return Number((((currentValue - previousValue) / Math.abs(previousValue)) * 100).toFixed(2));
}

function comparisonMetric(current, previous, positiveDirection = "up") {
  const deltaHalala = normalizeHalala(current) - normalizeHalala(previous);
  const percent = percentageChange(current, previous);
  let trend = "flat";
  if (deltaHalala > 0) trend = positiveDirection === "up" ? "positive" : "negative";
  if (deltaHalala < 0) trend = positiveDirection === "up" ? "negative" : "positive";
  return {
    currentHalala: normalizeHalala(current),
    previousHalala: normalizeHalala(previous),
    deltaHalala,
    deltaFormattedAr: signedMoneyValue(deltaHalala).formattedAr,
    changePercent: percent,
    trend,
  };
}

function buildComparison(current, previous, previousRange) {
  return {
    enabled: true,
    labelAr: `مقارنة بالفترة السابقة من ${formatBusinessDateAr(previousRange.from)} إلى ${formatBusinessDateAr(previousRange.to)}`,
    previousPeriod: previousRange,
    grossCollection: comparisonMetric(
      current.summary.grossCollectionHalala,
      previous.summary.grossCollectionHalala,
      "up"
    ),
    refunds: comparisonMetric(
      current.summary.refundsHalala,
      previous.summary.refundsHalala,
      "down"
    ),
    netCollection: comparisonMetric(
      current.summary.netCollectionHalala,
      previous.summary.netCollectionHalala,
      "up"
    ),
    averageDailyNet: comparisonMetric(
      current.statistics.averageDailyHalala,
      previous.statistics.averageDailyHalala,
      "up"
    ),
    paymentsCount: {
      current: current.summary.totalPaymentsCount || 0,
      previous: previous.summary.totalPaymentsCount || 0,
      delta: (current.summary.totalPaymentsCount || 0) - (previous.summary.totalPaymentsCount || 0),
    },
    customersCount: {
      current: current.summary.uniqueCustomersCount || 0,
      previous: previous.summary.uniqueCustomersCount || 0,
      delta: (current.summary.uniqueCustomersCount || 0) - (previous.summary.uniqueCustomersCount || 0),
    },
  };
}

function buildAccountingPolicyAr() {
  return {
    basis: "أساس نقدي للتحصيل",
    basisDescription: "تُدرج الدفعة في paidAt والمرتجع في refundedAt داخل الأيام الكاملة بتوقيت الرياض.",
    vatTreatment: "المبالغ شاملة ضريبة القيمة المضافة، ويتم عكس ضريبة المرتجعات في تاريخ الاسترداد الفعلي.",
    cancellationTreatment: "إلغاء الاشتراك لا يُعتبر مرتجعًا ماليًا دون حركة استرداد مستقلة.",
    refundTreatment: "كل مرتجع حركة مستقلة، والمرتجعات بلا تاريخ فعلي تظهر للمراجعة ولا تُخصم تلقائيًا.",
    paymentMethodTreatment: "طريقة الدفع وقناة المصدر ومزود الدفع محاور منفصلة في التحليل.",
    rangeTreatment: `يدعم التقرير نطاقًا مخصصًا حتى ${MAX_RANGE_DAYS} يومًا ويقارن تلقائيًا بالفترة السابقة المساوية.`,
  };
}

async function loadMonthlyReports({
  from,
  to,
  fulfillmentMethod,
  monthlyReportBuilder,
}) {
  const months = listRangeMonths(from, to);
  return Promise.all(months.map((month) => monthlyReportBuilder({
    month,
    fulfillmentMethod,
    includeDetails: true,
  })));
}

async function buildRangeCore({
  from,
  to,
  fulfillmentMethod,
  monthlyReportBuilder,
}) {
  const days = rangeDaysInclusive(from, to);
  const reports = await loadMonthlyReports({
    from,
    to,
    fulfillmentMethod,
    monthlyReportBuilder,
  });
  const items = dedupeMovements(
    reports.flatMap((report) => report.items || [])
      .filter((item) => withinRange(itemDate(item), from, to))
  ).sort((left, right) => itemTimestamp(left).localeCompare(itemTimestamp(right)));

  const collectionItems = items.filter((item) => item.movementType !== "refund");
  const refundItems = items.filter((item) => item.movementType === "refund");
  const summary = buildPaymentMethodSummary(collectionItems, refundItems);
  const warnings = buildWarnings(items, summary);
  const dailyBreakdown = buildDailyBreakdown(reports, from, to);
  const statistics = buildStatistics(dailyBreakdown);
  const byPaymentMethod = summary.byPaymentMethod || [];

  return {
    from,
    to,
    days,
    items,
    collectionItems,
    refundItems,
    summary,
    warnings,
    dailyBreakdown,
    statistics,
    byPaymentMethod,
    byFulfillmentMethod: buildBucketRows(collectionItems, "fulfillmentMethod"),
    bySubscriptionStatus: buildBucketRows(collectionItems, "subscriptionStatus"),
    byPaymentType: buildBucketRows(collectionItems, "paymentType"),
    bySourceChannel: buildBucketRows(collectionItems, "sourceChannel"),
    byPaymentProvider: buildBucketRows(collectionItems, "paymentProvider"),
    reconciliation: buildReconciliation(summary, warnings),
    dashboardCards: buildDashboardCards(summary, statistics),
  };
}

async function buildRangeSubscriptionPaymentReport({
  from,
  to,
  fulfillmentMethod = "all",
  includeDetails = true,
  comparePrevious = true,
} = {}, runtimeOverrides = {}) {
  const selectedFrom = parseDate(from, "تاريخ البداية").value;
  const selectedTo = parseDate(to, "تاريخ النهاية").value;
  const days = rangeDaysInclusive(selectedFrom, selectedTo);
  const details = parseBoolean(includeDetails, true);
  const comparisonEnabled = parseBoolean(comparePrevious, true);
  const monthlyReportBuilder = runtimeOverrides.buildMonthlySubscriptionPaymentReport
    || buildMonthlySubscriptionPaymentReport;

  const current = await buildRangeCore({
    from: selectedFrom,
    to: selectedTo,
    fulfillmentMethod,
    monthlyReportBuilder,
  });

  let comparison = { enabled: false };
  if (comparisonEnabled) {
    const previousRange = resolvePreviousRange(selectedFrom, selectedTo);
    const previous = await buildRangeCore({
      from: previousRange.from,
      to: previousRange.to,
      fulfillmentMethod,
      monthlyReportBuilder,
    });
    comparison = buildComparison(current, previous, previousRange);
  }

  const startPeriod = accountingDailyReportService.resolveFullDayPeriod(selectedFrom);
  const endPeriod = accountingDailyReportService.resolveFullDayPeriod(selectedTo);
  const generatedAt = new Date();
  const rangeLabelAr = `من ${formatBusinessDateAr(selectedFrom)} إلى ${formatBusinessDateAr(selectedTo)}`;

  return {
    reportType: "range",
    reportTypeLabelAr: "تقرير تحصيل الاشتراكات لنطاق مخصص",
    titleAr: `تحليل التحصيل والمرتجعات — ${rangeLabelAr}`,
    locale: "ar-AE",
    timezone: startPeriod.timezone,
    timezoneLabelAr: "توقيت الرياض",
    currency: "SAR",
    currencyLabelAr: "ريال سعودي",
    moneyUnit: "halala",
    moneyUnitLabelAr: "هللة",
    range: {
      from: selectedFrom,
      to: selectedTo,
      days,
      labelAr: rangeLabelAr,
    },
    businessMonth: `${selectedFrom}:${selectedTo}`,
    businessMonthLabelAr: rangeLabelAr,
    filters: {
      from: selectedFrom,
      to: selectedTo,
      fulfillmentMethod,
      includeDetails: details,
      comparePrevious: comparisonEnabled,
    },
    period: {
      timezone: startPeriod.timezone,
      openTime: startPeriod.openTime,
      closeTime: startPeriod.closeTime,
      startDate: selectedFrom,
      endDate: selectedTo,
      start: startPeriod.start.toISOString(),
      end: endPeriod.end.toISOString(),
      startLabelAr: formatBusinessDateAr(selectedFrom),
      endLabelAr: formatBusinessDateAr(selectedTo),
      labelAr: rangeLabelAr,
    },
    summary: current.summary,
    dashboardCards: current.dashboardCards,
    byPaymentMethod: current.byPaymentMethod,
    byFulfillmentMethod: current.byFulfillmentMethod,
    bySubscriptionStatus: current.bySubscriptionStatus,
    byPaymentType: current.byPaymentType,
    bySourceChannel: current.bySourceChannel,
    byPaymentProvider: current.byPaymentProvider,
    reconciliation: current.reconciliation,
    warnings: current.warnings,
    statistics: current.statistics,
    dailyBreakdown: current.dailyBreakdown,
    comparison,
    items: details ? current.items : [],
    accountingPolicyAr: buildAccountingPolicyAr(),
    generatedAt: generatedAt.toISOString(),
    generatedAtLabelAr: new Intl.DateTimeFormat("ar-AE", {
      timeZone: "Asia/Riyadh",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(generatedAt),
  };
}

module.exports = {
  MAX_RANGE_DAYS,
  addDays,
  buildRangeSubscriptionPaymentReport,
  listRangeDates,
  listRangeMonths,
  rangeDaysInclusive,
  resolvePreviousRange,
};
