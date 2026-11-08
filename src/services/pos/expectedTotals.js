"use strict";

const PosInvoice = require("../../models/PosInvoice");
const PosRefund = require("../../models/PosRefund");
const Payment = require("../../models/Payment");
const { boundsForBusinessDate } = require("./businessDate");
const { getBusinessDayCutoff } = require("./businessDaySetting");

function amount(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Expected nonnegative integer amount in halalas");
  }
  return value;
}
function checkedAdd(left, right) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError("Unsafe money aggregation");
  return result;
}
function sumMap(map) {
  return Object.values(map).reduce(checkedAdd, 0);
}
function pushAmount(map, key, delta) {
  map[key] = checkedAdd(map[key] || 0, delta);
}

// Pure reducer makes expected totals reproducible in unit tests, independent
// of whether the current connection supports multi-document transactions.
// This is a snapshot of recorded financial events, not an instruction to
// collect or refund money.
function summarizeExpectedTotals({ businessDate, invoices, refunds, relatedInvoices, payments }) {
  const salesById = new Map([...relatedInvoices, ...invoices]
    .map(invoice => [String(invoice._id), invoice]));
  const perChannel = {};
  const byCollector = {};
  let restaurantCashHalalas = 0;
  let restaurantNetworkHalalas = 0;
  let restaurantExternalRefundHalalas = 0;
  let appReceivableHalalas = 0;
  let posGrossHalalas = 0;
  let posRefundHalalas = 0;
  let posVatHalalas = 0;
  let unknownRefunds = 0;

  for (const invoice of invoices) {
    const gross = amount(invoice.totals?.grossHalalas);
    posGrossHalalas = checkedAdd(posGrossHalalas, gross);
    posVatHalalas = checkedAdd(posVatHalalas, amount(invoice.totals?.vatHalalas ?? 0));
    if (invoice.channel !== "restaurant") {
      pushAmount(perChannel, String(invoice.channel), gross);
      appReceivableHalalas = checkedAdd(appReceivableHalalas, gross);
    } else if (invoice.tender?.method === "cash") {
      restaurantCashHalalas = checkedAdd(restaurantCashHalalas, gross);
    } else if (invoice.tender?.method === "network") {
      restaurantNetworkHalalas = checkedAdd(restaurantNetworkHalalas, gross);
    } else {
      throw new TypeError("Unknown POS restaurant tender");
    }
  }
  for (const refund of refunds) {
    const gross = amount(refund.totals?.grossHalalas);
    posRefundHalalas = checkedAdd(posRefundHalalas, gross);
    posVatHalalas = checkedAdd(posVatHalalas, -amount(refund.totals?.vatHalalas ?? 0));
    const invoice = salesById.get(String(refund.invoiceId));
    if (!invoice) {
      unknownRefunds += 1;
      continue;
    }
    if (invoice.channel !== "restaurant") {
      pushAmount(perChannel, String(invoice.channel), -gross);
      appReceivableHalalas = checkedAdd(appReceivableHalalas, -gross);
    } else if (refund.method === "cash") {
      restaurantCashHalalas = checkedAdd(restaurantCashHalalas, -gross);
    } else if (refund.method === "network") {
      restaurantNetworkHalalas = checkedAdd(restaurantNetworkHalalas, -gross);
    } else if (refund.method === "external") {
      restaurantExternalRefundHalalas = checkedAdd(restaurantExternalRefundHalalas, gross);
    } else {
      throw new TypeError("Unknown POS refund method");
    }
  }

  let subscriptionCashHalalas = 0, subscriptionVisaHalalas = 0;
  for (const payment of payments) {
    const gross = amount(payment.amount);
    const source = String(payment.source || "");
    if (source === "dashboard_subscription_cash" || source === "dashboard_cashier") {
      subscriptionCashHalalas = checkedAdd(subscriptionCashHalalas, gross);
    } else if (source === "dashboard_subscription_visa") {
      subscriptionVisaHalalas = checkedAdd(subscriptionVisaHalalas, gross);
    } else {
      // Not from cashier subscriptions: exclude Moyasar and all POS orders.
      continue;
    }
    const collector = payment.collectedBy ? String(payment.collectedBy) : "unattributed";
    if (!byCollector[collector]) byCollector[collector] = { cashHalalas: 0, visaHalalas: 0, paymentCount: 0 };
    byCollector[collector].paymentCount += 1;
    if (source === "dashboard_subscription_cash" || source === "dashboard_cashier")
      byCollector[collector].cashHalalas = checkedAdd(byCollector[collector].cashHalalas, gross);
    else byCollector[collector].visaHalalas = checkedAdd(byCollector[collector].visaHalalas, gross);
  }
  const expectedCashHalalas = checkedAdd(restaurantCashHalalas, subscriptionCashHalalas);
  const expectedNetworkHalalas = checkedAdd(restaurantNetworkHalalas, subscriptionVisaHalalas);
  const totalPosNetHalalas = checkedAdd(posGrossHalalas, -posRefundHalalas);
  const expectedTotalHalalas = checkedAdd(
    checkedAdd(expectedCashHalalas, expectedNetworkHalalas),
    checkedAdd(appReceivableHalalas, -restaurantExternalRefundHalalas));
  return {
    businessDate, currency: "SAR", moneyUnit: "halala",
    pos: {
      invoiceCount: invoices.length, refundCount: refunds.length,
      grossHalalas: posGrossHalalas, refundsHalalas: posRefundHalalas,
      netHalalas: totalPosNetHalalas, vatHalalas: posVatHalalas,
      restaurantCashHalalas, restaurantNetworkHalalas, restaurantExternalRefundHalalas,
      appReceivableHalalas, appReceivableByChannelHalalas: perChannel,
      unresolvedRefundInvoiceCount: unknownRefunds,
    },
    subscriptions: {
      paymentCount: payments.length,
      cashHalalas: subscriptionCashHalalas,
      visaHalalas: subscriptionVisaHalalas,
      byCollector,
    },
    expected: {
      cashHalalas: expectedCashHalalas,
      networkHalalas: expectedNetworkHalalas,
      appReceivableHalalas,
      totalHalalas: expectedTotalHalalas,
    },
  };
}

async function expectedTotals(businessDate) {
  const cutoff = await getBusinessDayCutoff();
  const { start, end } = boundsForBusinessDate(businessDate, cutoff);
  const invoices = await PosInvoice.find({ $or: [
    { businessDate },
    { businessDate: { $exists: false }, issuedAt: { $gte: start, $lt: end } },
  ] }).select("_id channel tender totals issuedAt businessDate").lean();
  const refunds = await PosRefund.find({ $or: [
    { businessDate },
    { businessDate: { $exists: false }, recordedAt: { $gte: start, $lt: end } },
  ] }).select("_id invoiceId method totals recordedAt businessDate").lean();
  const known = new Set(invoices.map(row => String(row._id)));
  const extraIds = [...new Set(refunds.map(r => String(r.invoiceId)).filter(id => !known.has(id)))];
  const relatedInvoices = extraIds.length
    ? await PosInvoice.find({ _id: { $in: extraIds } }).select("_id channel tender").lean()
    : [];
  const payments = await Payment.find({
    type: { $in: ["subscription_activation", "subscription_renewal"] },
    status: "paid",
    source: { $in: ["dashboard_subscription_cash", "dashboard_subscription_visa", "dashboard_cashier"] },
    paidAt: { $gte: start, $lt: end },
  }).select("_id amount source collectedBy paidAt").lean();
  const result = summarizeExpectedTotals({ businessDate, invoices, refunds, relatedInvoices, payments });
  if (result.pos.unresolvedRefundInvoiceCount > 0) {
    const error = new Error("POS refund references missing invoice; closing is blocked");
    error.code = "POS_REFUND_ORPHANED";
    throw error;
  }
  return result;
}

module.exports = { expectedTotals, summarizeExpectedTotals };
