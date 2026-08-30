"use strict";

const Payment = require("../../models/Payment");
const SubscriptionAdminOperation = require("../../models/SubscriptionAdminOperation");
const baseService = require("./subscriptionFinancialControlNoTxnService");

function serializePendingOperation(operation) {
  if (!operation) return null;
  return {
    operationKey: String(operation._id),
    type: operation.type,
    status: operation.status,
    refundMode: operation.refundMode || "none",
    requestedAmountHalala: Number(operation.requestedAmountHalala || 0),
    refundedAmountHalala: Number(operation.refundedAmountHalala || 0),
    reason: operation.reason || "",
    note: operation.note || "",
    lastStep: operation.lastStep || null,
    createdAt: operation.createdAt || null,
    updatedAt: operation.updatedAt || null,
  };
}

async function getFinancialControlPreview(args) {
  const preview = await baseService.getFinancialControlPreview(args);
  const paymentIds = preview.payments.map((payment) => payment.paymentId);
  if (!paymentIds.length) return preview;

  const paymentRows = await Payment.find({ _id: { $in: paymentIds } })
    .select("_id metadata.adminRefundLock")
    .lean();
  const lockByPayment = new Map();
  const operationKeys = [];

  for (const payment of paymentRows) {
    const lock = payment.metadata && payment.metadata.adminRefundLock;
    const operationKey = lock && String(lock.operationKey || "").trim();
    if (!operationKey) continue;
    lockByPayment.set(String(payment._id), operationKey);
    operationKeys.push(operationKey);
  }

  const operations = operationKeys.length
    ? await SubscriptionAdminOperation.find({ _id: { $in: operationKeys } }).lean()
    : [];
  const operationByKey = new Map(
    operations.map((operation) => [String(operation._id), operation])
  );

  return {
    ...preview,
    payments: preview.payments.map((payment) => {
      const operationKey = lockByPayment.get(payment.paymentId);
      return {
        ...payment,
        pendingOperation: operationKey
          ? serializePendingOperation(operationByKey.get(operationKey))
          : null,
      };
    }),
  };
}

module.exports = {
  ...baseService,
  getFinancialControlPreview,
};
