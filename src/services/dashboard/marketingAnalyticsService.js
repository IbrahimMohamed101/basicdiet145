"use strict";

const User = require("../../models/User");
const CheckoutDraft = require("../../models/CheckoutDraft");
const Payment = require("../../models/Payment");
const Subscription = require("../../models/Subscription");
const PromoUsage = require("../../models/PromoUsage");
const accountingDailyReportService = require("./accountingDailyReportService");

const TIMEZONE = "Asia/Riyadh";
const SUBSCRIPTION_PAYMENT_TYPES = ["subscription_activation", "subscription_renewal"];
const ABANDONED_DRAFT_STATUSES = new Set(["failed", "canceled", "expired"]);
const MAX_RANGE_DAYS = 366;

class MarketingAnalyticsError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "MarketingAnalyticsError";
    this.code = code;
    this.status = status;
  }
}

function ksaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const pick = (type) => parts.find((part) => part.type === type)?.value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function isDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function shiftDateString(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function rangeDaysInclusive(from, to) {
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  return Math.floor((end - start) / 86400000) + 1;
}

function resolveRange(from, to) {
  const selectedTo = String(to || ksaToday());
  const selectedFrom = String(from || shiftDateString(selectedTo, -29));

  if (!isDateString(selectedFrom) || !isDateString(selectedTo)) {
    throw new MarketingAnalyticsError(
      "INVALID_DATE_RANGE",
      "Use YYYY-MM-DD for from and to."
    );
  }
  if (selectedFrom > selectedTo) {
    throw new MarketingAnalyticsError(
      "INVALID_DATE_RANGE",
      "from must be on or before to."
    );
  }

  const days = rangeDaysInclusive(selectedFrom, selectedTo);
  if (days > MAX_RANGE_DAYS) {
    throw new MarketingAnalyticsError(
      "DATE_RANGE_TOO_LARGE",
      `Maximum range is ${MAX_RANGE_DAYS} days.`
    );
  }

  const startPeriod = accountingDailyReportService.resolveFullDayPeriod(selectedFrom);
  const endPeriod = accountingDailyReportService.resolveFullDayPeriod(selectedTo);

  return {
    from: selectedFrom,
    to: selectedTo,
    days,
    start: startPeriod.start,
    end: endPeriod.end,
  };
}

function resolvePreviousRange(period) {
  const previousTo = shiftDateString(period.from, -1);
  const previousFrom = shiftDateString(previousTo, -(period.days - 1));
  return resolveRange(previousFrom, previousTo);
}

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new MarketingAnalyticsError("INVALID_BOOLEAN", "Invalid boolean value.");
}

function optionalInt(value, field, min, max) {
  if (value === undefined || value === null || value === "" || value === "all") {
    return null;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new MarketingAnalyticsError(
      "INVALID_FILTER",
      `${field} must be an integer between ${min} and ${max}.`
    );
  }
  return number;
}

function normalizeFilters(input = {}) {
  const fulfillmentMethod = String(input.fulfillmentMethod || "all").trim().toLowerCase();
  if (!["all", "delivery", "pickup"].includes(fulfillmentMethod)) {
    throw new MarketingAnalyticsError(
      "INVALID_FILTER",
      "fulfillmentMethod must be all, delivery, or pickup."
    );
  }

  const paymentProvider = String(input.paymentProvider || "all").trim().toLowerCase();
  if (!["all", "moyasar", "cash", "manual"].includes(paymentProvider)) {
    throw new MarketingAnalyticsError(
      "INVALID_FILTER",
      "paymentProvider must be all, moyasar, cash, or manual."
    );
  }

  return {
    promoCode: String(input.promoCode || "").trim().toUpperCase(),
    fulfillmentMethod,
    paymentProvider,
    daysCount: optionalInt(input.daysCount, "daysCount", 1, 365),
    grams: optionalInt(input.grams, "grams", 1, 1000),
    mealsPerDay: optionalInt(input.mealsPerDay, "mealsPerDay", 1, 20),
  };
}

function draftSegmentMatch(filters) {
  const match = {};
  if (filters.promoCode) match["promo.code"] = filters.promoCode;
  if (filters.fulfillmentMethod !== "all") {
    match["delivery.type"] = filters.fulfillmentMethod;
  }
  if (filters.daysCount !== null) match.daysCount = filters.daysCount;
  if (filters.grams !== null) match.grams = filters.grams;
  if (filters.mealsPerDay !== null) match.mealsPerDay = filters.mealsPerDay;
  return match;
}

function activeClientMatch(extra = {}) {
  return {
    role: "client",
    $and: [
      {
        $or: [
          { mergedIntoUserId: null },
          { mergedIntoUserId: { $exists: false } },
        ],
      },
    ],
    ...extra,
  };
}

function paymentDateStages(prefix = "") {
  const paidAt = prefix ? `$${prefix}.paidAt` : "$paidAt";
  const createdAt = prefix ? `$${prefix}.createdAt` : "$createdAt";
  return {
    $addFields: {
      _effectivePaidAt: { $ifNull: [paidAt, createdAt] },
    },
  };
}

function appPaidPipeline(period, filters, paymentCollectionName) {
  const pipeline = [
    { $match: draftSegmentMatch(filters) },
    {
      $lookup: {
        from: paymentCollectionName,
        localField: "paymentId",
        foreignField: "_id",
        as: "_payment",
      },
    },
    { $unwind: "$_payment" },
    paymentDateStages("_payment"),
    {
      $match: {
        "_payment.status": "paid",
        "_payment.type": { $in: SUBSCRIPTION_PAYMENT_TYPES },
        _effectivePaidAt: { $gte: period.start, $lte: period.end },
      },
    },
  ];

  if (filters.paymentProvider !== "all") {
    pipeline.push({ $match: { "_payment.provider": filters.paymentProvider } });
  }
  return pipeline;
}

function safeCount(row) {
  return Number(row?.count || 0);
}

function safeAmount(row, key = "amountHalala") {
  return Number(row?.[key] || 0);
}

function rate(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((Number(numerator || 0) / Number(denominator)) * 100).toFixed(1));
}

function dateInPeriod(value, period) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime())
    && date.getTime() >= period.start.getTime()
    && date.getTime() <= period.end.getTime();
}

function sourceChannelExpression() {
  return {
    $cond: [
      { $ne: [{ $ifNull: ["$checkoutDraftId", null] }, null] },
      "app",
      {
        $cond: [
          {
            $or: [
              { $in: ["$provider", ["cash", "manual"]] },
              {
                $regexMatch: {
                  input: { $ifNull: ["$source", ""] },
                  regex: "^dashboard_",
                },
              },
            ],
          },
          "dashboard",
          "other",
        ],
      },
    ],
  };
}

async function buildPeriodSummary(period, filters, models) {
  const {
    UserModel,
    CheckoutDraftModel,
    PaymentModel,
    SubscriptionModel,
  } = models;
  const paymentCollectionName = PaymentModel.collection?.name || "payments";
  const checkoutMatch = {
    ...draftSegmentMatch(filters),
    createdAt: { $gte: period.start, $lte: period.end },
  };

  const paidPipeline = appPaidPipeline(period, filters, paymentCollectionName);

  const [
    registrationRows,
    loggedInUsers,
    checkoutStarted,
    checkoutUserRows,
    checkoutStatusRows,
    appPaidRows,
    failedPayments,
    cancellations,
    sourceRows,
  ] = await Promise.all([
    UserModel.aggregate([
      {
        $match: activeClientMatch({
          createdAt: { $gte: period.start, $lte: period.end },
        }),
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          userIds: { $addToSet: "$_id" },
        },
      },
    ]),
    UserModel.countDocuments(
      activeClientMatch({
        lastLoginAt: { $gte: period.start, $lte: period.end },
      })
    ),
    CheckoutDraftModel.countDocuments(checkoutMatch),
    CheckoutDraftModel.aggregate([
      { $match: checkoutMatch },
      { $group: { _id: "$userId" } },
      { $count: "count" },
    ]),
    CheckoutDraftModel.aggregate([
      { $match: checkoutMatch },
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    CheckoutDraftModel.aggregate([
      ...paidPipeline,
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          amountHalala: { $sum: "$_payment.amount" },
          userIds: { $addToSet: "$userId" },
        },
      },
    ]),
    PaymentModel.countDocuments({
      type: { $in: SUBSCRIPTION_PAYMENT_TYPES },
      status: "failed",
      createdAt: { $gte: period.start, $lte: period.end },
    }),
    SubscriptionModel.countDocuments({
      canceledAt: { $gte: period.start, $lte: period.end },
    }),
    PaymentModel.aggregate([
      {
        $match: {
          status: "paid",
          type: { $in: SUBSCRIPTION_PAYMENT_TYPES },
        },
      },
      paymentDateStages(),
      {
        $match: {
          _effectivePaidAt: { $gte: period.start, $lte: period.end },
        },
      },
      { $addFields: { _sourceChannel: sourceChannelExpression() } },
      {
        $group: {
          _id: "$_sourceChannel",
          count: { $sum: 1 },
          customers: { $addToSet: "$userId" },
          amountHalala: { $sum: "$amount" },
        },
      },
      { $sort: { amountHalala: -1 } },
    ]),
  ]);

  const registration = registrationRows[0] || { count: 0, userIds: [] };
  const appPaid = appPaidRows[0] || { count: 0, amountHalala: 0, userIds: [] };
  const registeredIds = new Set((registration.userIds || []).map(String));
  const paidUserIds = (appPaid.userIds || []).filter(Boolean);
  const paidIdSet = new Set(paidUserIds.map(String));
  const newRegistrationsPaid = [...registeredIds].filter((id) => paidIdSet.has(id)).length;

  let firstTimeSubscribers = 0;
  if (paidUserIds.length) {
    const firstPurchaseRows = await PaymentModel.aggregate([
      {
        $match: {
          status: "paid",
          type: { $in: SUBSCRIPTION_PAYMENT_TYPES },
          userId: { $in: paidUserIds },
        },
      },
      {
        $group: {
          _id: "$userId",
          firstPaidAt: { $min: { $ifNull: ["$paidAt", "$createdAt"] } },
        },
      },
    ]);
    firstTimeSubscribers = firstPurchaseRows.filter((row) =>
      dateInPeriod(row.firstPaidAt, period)
    ).length;
  }

  const checkoutUsers = safeCount(checkoutUserRows[0]);
  const paidTransactions = safeCount(appPaid);
  const paidCustomers = paidUserIds.length;
  const appRevenueHalala = safeAmount(appPaid);
  const checkoutStatuses = checkoutStatusRows.map((row) => ({
    key: row._id || "unknown",
    count: Number(row.count || 0),
  }));
  const pendingCheckouts = checkoutStatuses
    .filter((row) => row.key === "pending_payment")
    .reduce((sum, row) => sum + row.count, 0);
  const abandonedCheckouts = checkoutStatuses
    .filter((row) => ABANDONED_DRAFT_STATUSES.has(row.key))
    .reduce((sum, row) => sum + row.count, 0);

  const sourceChannels = sourceRows.map((row) => ({
    key: row._id || "other",
    count: Number(row.count || 0),
    customersCount: Array.isArray(row.customers) ? row.customers.length : 0,
    amountHalala: Number(row.amountHalala || 0),
  }));
  const totalSubscriptionRevenueHalala = sourceChannels.reduce(
    (sum, row) => sum + row.amountHalala,
    0
  );

  return {
    kpis: {
      registrations: Number(registration.count || 0),
      loggedInUsers: Number(loggedInUsers || 0),
      checkoutStarted: Number(checkoutStarted || 0),
      checkoutUsers,
      pendingCheckouts,
      abandonedCheckouts,
      failedPayments: Number(failedPayments || 0),
      paidTransactions,
      paidCustomers,
      firstTimeSubscribers,
      repeatSubscribers: Math.max(0, paidCustomers - firstTimeSubscribers),
      newRegistrationsPaid,
      cancellations: Number(cancellations || 0),
      appRevenueHalala,
      totalSubscriptionRevenueHalala,
      aovHalala: paidTransactions
        ? Math.round(appRevenueHalala / paidTransactions)
        : 0,
      registerToPaidRate: rate(newRegistrationsPaid, Number(registration.count || 0)),
      checkoutToPaidRate: rate(paidCustomers, checkoutUsers),
      repeatCustomerRate: rate(
        Math.max(0, paidCustomers - firstTimeSubscribers),
        paidCustomers
      ),
    },
    checkoutStatuses,
    sourceChannels,
  };
}

function bucketLabel(key) {
  const labels = {
    app: "التطبيق",
    dashboard: "لوحة التحكم",
    other: "مصدر آخر",
    delivery: "توصيل",
    pickup: "استلام",
    moyasar: "Moyasar",
    cash: "نقدي",
    manual: "بطاقة/تسجيل يدوي",
    pending_payment: "بانتظار الدفع",
    completed: "مكتمل",
    failed: "فشل",
    canceled: "ملغي",
    expired: "منتهي",
  };
  return labels[key] || key || "غير مصنف";
}

async function buildBreakdowns(period, filters, models) {
  const {
    UserModel,
    CheckoutDraftModel,
    PaymentModel,
    PromoUsageModel,
  } = models;
  const paymentCollectionName = PaymentModel.collection?.name || "payments";
  const paidPipeline = appPaidPipeline(period, filters, paymentCollectionName);
  const promoMatch = {
    createdAt: { $gte: period.start, $lte: period.end },
  };
  if (filters.promoCode) promoMatch.code = filters.promoCode;

  const [
    promoRows,
    planRows,
    fulfillmentRows,
    providerRows,
    registrationsDaily,
    checkoutsDaily,
    paidDaily,
  ] = await Promise.all([
    PromoUsageModel.aggregate([
      { $match: promoMatch },
      {
        $lookup: {
          from: paymentCollectionName,
          localField: "paymentId",
          foreignField: "_id",
          as: "_payment",
        },
      },
      { $unwind: { path: "$_payment", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: "$code",
          attempts: { $sum: 1 },
          consumed: {
            $sum: { $cond: [{ $eq: ["$status", "consumed"] }, 1, 0] },
          },
          reserved: {
            $sum: { $cond: [{ $eq: ["$status", "reserved"] }, 1, 0] },
          },
          cancelled: {
            $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
          },
          discountHalala: {
            $sum: {
              $cond: [
                { $eq: ["$status", "consumed"] },
                "$discountAmountHalala",
                0,
              ],
            },
          },
          paidCount: {
            $sum: {
              $cond: [{ $eq: ["$_payment.status", "paid"] }, 1, 0],
            },
          },
          revenueHalala: {
            $sum: {
              $cond: [
                { $eq: ["$_payment.status", "paid"] },
                { $ifNull: ["$_payment.amount", 0] },
                0,
              ],
            },
          },
        },
      },
      { $sort: { revenueHalala: -1, attempts: -1 } },
      { $limit: 25 },
    ]),
    CheckoutDraftModel.aggregate([
      ...paidPipeline,
      {
        $group: {
          _id: {
            daysCount: "$daysCount",
            grams: "$grams",
            mealsPerDay: "$mealsPerDay",
          },
          paidTransactions: { $sum: 1 },
          customers: { $addToSet: "$userId" },
          revenueHalala: { $sum: "$_payment.amount" },
          discountHalala: { $sum: { $ifNull: ["$breakdown.discountHalala", 0] } },
        },
      },
      { $sort: { revenueHalala: -1 } },
      { $limit: 20 },
    ]),
    CheckoutDraftModel.aggregate([
      ...paidPipeline,
      {
        $group: {
          _id: "$delivery.type",
          paidTransactions: { $sum: 1 },
          customers: { $addToSet: "$userId" },
          revenueHalala: { $sum: "$_payment.amount" },
        },
      },
      { $sort: { revenueHalala: -1 } },
    ]),
    CheckoutDraftModel.aggregate([
      ...paidPipeline,
      {
        $group: {
          _id: "$_payment.provider",
          paidTransactions: { $sum: 1 },
          customers: { $addToSet: "$userId" },
          revenueHalala: { $sum: "$_payment.amount" },
        },
      },
      { $sort: { revenueHalala: -1 } },
    ]),
    UserModel.aggregate([
      {
        $match: activeClientMatch({
          createdAt: { $gte: period.start, $lte: period.end },
        }),
      },
      {
        $group: {
          _id: {
            $dateToString: {
              date: "$createdAt",
              format: "%Y-%m-%d",
              timezone: TIMEZONE,
            },
          },
          count: { $sum: 1 },
        },
      },
    ]),
    CheckoutDraftModel.aggregate([
      {
        $match: {
          ...draftSegmentMatch(filters),
          createdAt: { $gte: period.start, $lte: period.end },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              date: "$createdAt",
              format: "%Y-%m-%d",
              timezone: TIMEZONE,
            },
          },
          count: { $sum: 1 },
        },
      },
    ]),
    CheckoutDraftModel.aggregate([
      ...paidPipeline,
      {
        $group: {
          _id: {
            $dateToString: {
              date: "$_effectivePaidAt",
              format: "%Y-%m-%d",
              timezone: TIMEZONE,
            },
          },
          count: { $sum: 1 },
          revenueHalala: { $sum: "$_payment.amount" },
        },
      },
    ]),
  ]);

  const dailyByDate = new Map();
  for (let date = period.from; date <= period.to; date = shiftDateString(date, 1)) {
    dailyByDate.set(date, {
      date,
      registrations: 0,
      checkouts: 0,
      paidTransactions: 0,
      revenueHalala: 0,
    });
  }
  for (const row of registrationsDaily) {
    const item = dailyByDate.get(row._id);
    if (item) item.registrations = Number(row.count || 0);
  }
  for (const row of checkoutsDaily) {
    const item = dailyByDate.get(row._id);
    if (item) item.checkouts = Number(row.count || 0);
  }
  for (const row of paidDaily) {
    const item = dailyByDate.get(row._id);
    if (item) {
      item.paidTransactions = Number(row.count || 0);
      item.revenueHalala = Number(row.revenueHalala || 0);
    }
  }

  return {
    promoPerformance: promoRows.map((row) => ({
      code: row._id || "UNKNOWN",
      attempts: Number(row.attempts || 0),
      consumed: Number(row.consumed || 0),
      reserved: Number(row.reserved || 0),
      cancelled: Number(row.cancelled || 0),
      paidCount: Number(row.paidCount || 0),
      discountHalala: Number(row.discountHalala || 0),
      revenueHalala: Number(row.revenueHalala || 0),
      conversionRate: rate(row.paidCount, row.attempts),
    })),
    planPerformance: planRows.map((row) => ({
      daysCount: Number(row._id?.daysCount || 0),
      grams: Number(row._id?.grams || 0),
      mealsPerDay: Number(row._id?.mealsPerDay || 0),
      paidTransactions: Number(row.paidTransactions || 0),
      customersCount: Array.isArray(row.customers) ? row.customers.length : 0,
      revenueHalala: Number(row.revenueHalala || 0),
      discountHalala: Number(row.discountHalala || 0),
    })),
    fulfillmentPerformance: fulfillmentRows.map((row) => ({
      key: row._id || "unknown",
      labelAr: bucketLabel(row._id),
      paidTransactions: Number(row.paidTransactions || 0),
      customersCount: Array.isArray(row.customers) ? row.customers.length : 0,
      revenueHalala: Number(row.revenueHalala || 0),
    })),
    paymentProviders: providerRows.map((row) => ({
      key: row._id || "unknown",
      labelAr: bucketLabel(row._id),
      paidTransactions: Number(row.paidTransactions || 0),
      customersCount: Array.isArray(row.customers) ? row.customers.length : 0,
      revenueHalala: Number(row.revenueHalala || 0),
    })),
    daily: Array.from(dailyByDate.values()),
  };
}

function metricComparison(current, previous) {
  const delta = Number(current || 0) - Number(previous || 0);
  const changePercent = Number(previous || 0)
    ? Number(((delta / Number(previous)) * 100).toFixed(1))
    : null;
  return {
    current: Number(current || 0),
    previous: Number(previous || 0),
    delta,
    changePercent,
    trend: delta > 0 ? "positive" : delta < 0 ? "negative" : "flat",
  };
}

function buildComparison(currentKpis, previousKpis, previousRange) {
  const keys = [
    "registrations",
    "loggedInUsers",
    "checkoutStarted",
    "checkoutUsers",
    "paidTransactions",
    "paidCustomers",
    "firstTimeSubscribers",
    "repeatSubscribers",
    "cancellations",
    "appRevenueHalala",
    "totalSubscriptionRevenueHalala",
    "aovHalala",
  ];
  return {
    enabled: true,
    previousRange: {
      from: previousRange.from,
      to: previousRange.to,
      days: previousRange.days,
    },
    metrics: Object.fromEntries(
      keys.map((key) => [
        key,
        metricComparison(currentKpis[key], previousKpis[key]),
      ])
    ),
  };
}

async function buildMarketingAnalyticsReport(input = {}, runtimeOverrides = {}) {
  const period = resolveRange(input.from, input.to);
  const filters = normalizeFilters(input);
  const comparePrevious = parseBoolean(input.comparePrevious, true);

  const models = {
    UserModel: runtimeOverrides.UserModel || User,
    CheckoutDraftModel: runtimeOverrides.CheckoutDraftModel || CheckoutDraft,
    PaymentModel: runtimeOverrides.PaymentModel || Payment,
    SubscriptionModel: runtimeOverrides.SubscriptionModel || Subscription,
    PromoUsageModel: runtimeOverrides.PromoUsageModel || PromoUsage,
  };

  const [current, breakdowns] = await Promise.all([
    buildPeriodSummary(period, filters, models),
    buildBreakdowns(period, filters, models),
  ]);

  let comparison = { enabled: false };
  if (comparePrevious) {
    const previousRange = resolvePreviousRange(period);
    const previous = await buildPeriodSummary(previousRange, filters, models);
    comparison = buildComparison(current.kpis, previous.kpis, previousRange);
  }

  return {
    reportType: "marketing_analytics",
    titleAr: "تحليلات التسويق والتحويل",
    timezone: TIMEZONE,
    currency: "SAR",
    moneyUnit: "halala",
    range: {
      from: period.from,
      to: period.to,
      days: period.days,
      labelAr: `من ${period.from} إلى ${period.to}`,
    },
    filters,
    kpis: current.kpis,
    comparison,
    checkoutStatuses: current.checkoutStatuses.map((row) => ({
      ...row,
      labelAr: bucketLabel(row.key),
    })),
    sourceChannels: current.sourceChannels.map((row) => ({
      ...row,
      labelAr: bucketLabel(row.key),
    })),
    ...breakdowns,
    notes: [
      "الأرقام تعتمد على بيانات الخادم وMongoDB فقط؛ لا يتم تقدير عدد تثبيتات التطبيق أو first_open.",
      "قمع Checkout والدفع يعتمد على CheckoutDraft والمدفوعات المرتبطة به، لذلك يمثل مسار الشراء داخل التطبيق.",
      "إجمالي إيراد الاشتراكات يشمل قنوات التطبيق ولوحة التحكم والقنوات الأخرى المسجلة في Payment.",
      "المستخدم النشط هنا يعني حساب عميل لديه lastLoginAt داخل الفترة، وليس screen/session analytics.",
    ],
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  MAX_RANGE_DAYS,
  MarketingAnalyticsError,
  buildMarketingAnalyticsReport,
  buildComparison,
  metricComparison,
  normalizeFilters,
  rangeDaysInclusive,
  resolvePreviousRange,
  resolveRange,
  shiftDateString,
};
