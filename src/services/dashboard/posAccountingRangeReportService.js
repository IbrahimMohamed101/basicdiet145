"use strict";

// Read-only financial reporting. POS amounts are immutable server-issued halalas.
// Refund documents are NOT evidence that money was physically paid back.
const PosInvoice = require("../../models/PosInvoice");
const PosRefund = require("../../models/PosRefund");
const MAX_DAYS = 366;
const MAX_PAGE = 250;

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = "POS_ACCOUNTING_INVALID_RANGE";
  throw error;
}
function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    invalid("التاريخ مطلوب بصيغة YYYY-MM-DD.");
  }
  const time = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    invalid("التاريخ غير صالح.");
  }
  return time;
}
function parsePosReportQuery(query = {}) {
  const from = String(query.from ?? "");
  const to = String(query.to ?? "");
  const start = parseDate(from);
  const end = parseDate(to);
  const days = Math.round((end - start) / 86400000) + 1;
  if (days < 1 || days > MAX_DAYS) invalid("النطاق يجب أن يكون من يوم إلى 366 يومًا.");
  const limit = query.limit === undefined ? 100 : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
    invalid("التصفح غير صالح.");
  }
  return { from, to, days, limit, offset };
}
const money = (value) => Number.isSafeInteger(Number(value)) ? Number(value) : 0;
function makeBucket(channel) {
  return { channel, invoiceCount: 0, grossHalalas: 0, vatHalalas: 0,
    cashGrossHalalas: 0, networkGrossHalalas: 0, appReceivableGrossHalalas: 0,
    refundCount: 0, refundDocumentsHalalas: 0, refundVatHalalas: 0,
    netAfterRefundDocumentsHalalas: 0 };
}
function summarizePosRows(invoiceRows, refundRows) {
  const summary = { invoiceCount: 0, grossHalalas: 0, vatHalalas: 0,
    netBeforeVatHalalas: 0, cashGrossHalalas: 0, networkGrossHalalas: 0,
    appReceivableGrossHalalas: 0, otherTenderGrossHalalas: 0, refundCount: 0,
    refundDocumentsHalalas: 0, refundVatHalalas: 0,
    cashRefundDocumentsHalalas: 0, networkRefundDocumentsHalalas: 0,
    externalRefundDocumentsHalalas: 0, netAfterRefundDocumentsHalalas: 0 };
  const channels = new Map();
  const dates = new Map();
  const getChannel = (id) => {
    const key = typeof id === "string" && id ? id : "unknown";
    if (!channels.has(key)) channels.set(key, makeBucket(key));
    return channels.get(key);
  };
  const getDay = (date) => {
    if (!dates.has(date)) dates.set(date, { businessDate: date, grossHalalas: 0,
      refundDocumentsHalalas: 0, invoiceCount: 0, refundCount: 0,
      netAfterRefundDocumentsHalalas: 0 });
    return dates.get(date);
  };
  for (const row of invoiceRows) {
    const gross = money(row.grossHalalas);
    const vat = money(row.vatHalalas);
    const count = money(row.count);
    const bucket = getChannel(row._id.channel);
    const day = getDay(row._id.businessDate);
    bucket.grossHalalas += gross;
    bucket.vatHalalas += vat;
    bucket.invoiceCount += count;
    day.grossHalalas += gross;
    day.invoiceCount += count;
    summary.invoiceCount += count;
    summary.grossHalalas += gross;
    summary.vatHalalas += vat;
    summary.netBeforeVatHalalas += money(row.netHalalas);
    if (row._id.tender === "cash") {
      summary.cashGrossHalalas += gross;
      bucket.cashGrossHalalas += gross;
    } else if (row._id.tender === "network") {
      summary.networkGrossHalalas += gross;
      bucket.networkGrossHalalas += gross;
    } else if (row._id.tender === "app_receivable") {
      summary.appReceivableGrossHalalas += gross;
      bucket.appReceivableGrossHalalas += gross;
    } else summary.otherTenderGrossHalalas += gross;
  }
  for (const row of refundRows) {
    const gross = money(row.grossHalalas);
    const vat = money(row.vatHalalas);
    const count = money(row.count);
    const bucket = getChannel(row._id.channel);
    const day = getDay(row._id.businessDate);
    bucket.refundDocumentsHalalas += gross;
    bucket.refundVatHalalas += vat;
    bucket.refundCount += count;
    day.refundDocumentsHalalas += gross;
    day.refundCount += count;
    summary.refundDocumentsHalalas += gross;
    summary.refundVatHalalas += vat;
    summary.refundCount += count;
    if (row._id.method === "cash") summary.cashRefundDocumentsHalalas += gross;
    else if (row._id.method === "network") summary.networkRefundDocumentsHalalas += gross;
    else summary.externalRefundDocumentsHalalas += gross;
  }
  summary.netAfterRefundDocumentsHalalas = summary.grossHalalas - summary.refundDocumentsHalalas;
  for (const bucket of channels.values()) {
    bucket.netAfterRefundDocumentsHalalas = bucket.grossHalalas - bucket.refundDocumentsHalalas;
  }
  for (const day of dates.values()) {
    day.netAfterRefundDocumentsHalalas = day.grossHalalas - day.refundDocumentsHalalas;
  }
  return {
    summary,
    channels: [...channels.values()].sort((a, b) => b.grossHalalas - a.grossHalalas),
    daily: [...dates.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate)),
  };
}
const invoiceGrouping = [
  { $group: {
    _id: { businessDate: "$businessDate", channel: "$channel", tender: "$tender.method" },
    count: { $sum: 1 },
    grossHalalas: { $sum: "$totals.grossHalalas" },
    vatHalalas: { $sum: "$totals.vatHalalas" },
    netHalalas: { $sum: "$totals.netHalalas" },
  } },
];
const refundLookup = [
  { $lookup: { from: "pos_invoices", localField: "invoiceId",
    foreignField: "_id", as: "originalInvoice" } },
  { $set: { sourceChannel: {
    $ifNull: [{ $arrayElemAt: ["$originalInvoice.channel", 0] }, "unknown"],
  } } },
];
const refundGrouping = [
  ...refundLookup,
  { $group: {
    _id: { businessDate: "$businessDate", channel: "$sourceChannel", method: "$method" },
    count: { $sum: 1 },
    grossHalalas: { $sum: "$totals.grossHalalas" },
    vatHalalas: { $sum: "$totals.vatHalalas" },
  } },
];
async function buildPosAccountingRange(query = {}) {
  const { from, to, days, limit, offset } = parsePosReportQuery(query);
  const match = { businessDate: { $gte: from, $lte: to } };
  const [invoiceRows, refundRows] = await Promise.all([
    PosInvoice.aggregate([{ $match: match }, ...invoiceGrouping]),
    PosRefund.aggregate([{ $match: match }, ...refundGrouping]),
  ]);
  const report = summarizePosRows(invoiceRows, refundRows);
  // Financial detail pages contain no idempotency keys, personal data,
  // QR, invoice lines or mutable cash drawer state.
  const [invoices, refunds] = await Promise.all([
    PosInvoice.find(match)
      .select("number businessDate issuedAt channel externalOrderNumber appPaymentStatus tender.method totals documentType")
      .sort({ issuedAt: -1, _id: -1 }).skip(offset).limit(limit).lean(),
    PosRefund.aggregate([
      { $match: match },
      { $sort: { recordedAt: -1, _id: -1 } },
      { $skip: offset }, { $limit: limit }, ...refundLookup,
      { $project: { _id: 0, number: 1, invoiceNumber: 1, businessDate: 1,
        recordedAt: 1, method: 1, reason: 1, totals: 1, channel: "$sourceChannel" } },
    ]),
  ]);
  return {
    reportType: "pos-range",
    range: { from, to, days, timezone: "Asia/Riyadh", basis: "immutable POS businessDate" },
    summary: report.summary,
    channels: report.channels,
    daily: report.daily,
    invoices,
    refunds,
    pagination: {
      offset, limit,
      invoicesTotal: report.summary.invoiceCount,
      refundsTotal: report.summary.refundCount,
      invoicesHasMore: offset + invoices.length < report.summary.invoiceCount,
      refundsHasMore: offset + refunds.length < report.summary.refundCount,
    },
    generatedAt: new Date().toISOString(),
    notes: [
      "POS gross includes server-issued invoices only.",
      "App-channel invoice tender is a platform receivable, NOT cash collected by restaurant.",
      "Refund totals represent recorded credit notes, NOT verified money transfers.",
      "Subscription collections are NOT included; show the separate subscription accounting report.",
    ],
  };
}
module.exports = { parsePosReportQuery, summarizePosRows, buildPosAccountingRange };
