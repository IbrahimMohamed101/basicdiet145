"use strict";
const mongoose = require("mongoose");
const DashboardUser = require("../../models/DashboardUser");
const PosCatalog = require("../../models/PosCatalog");
const PosInvoice = require("../../models/PosInvoice");
const PosRefund = require("../../models/PosRefund");
const PosRefundBalance = require("../../models/PosRefundBalance");
const PosCounter = require("../../models/PosCounter");
const PosAudit = require("../../models/PosAudit");
const PosLedger = require("../../models/PosLedger");
const PosOperation = require("../../models/PosOperation");
const { beginOperation, commitOperation, rejectOperation } = require("./operationService");
const { PosFinancialError, pricePosCheckout } = require("./financialQuoteService");
const { requireFinancialStagingWrites, hasPosCapability } = require("./financialRuntime");
const { canonicalHash, validateIdempotencyKey, normalizeSaleIntent, normalizeRefundIntent } = require("./financialIntent");

const TRANSACTION_OPTIONS = {
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" },
  readPreference: "primary",
};
const conflict = (message) => { throw new PosFinancialError("POS_CONFLICT", message, 409); };
const malformed = (message) => { throw new PosFinancialError("POS_FINANCIAL_INVALID", message, 400); };
let readyPromise;
function ensureFinancialIndexes() {
  if (!readyPromise) readyPromise = Promise.all([
    PosInvoice.createIndexes(), PosRefund.createIndexes(),
    PosRefundBalance.createIndexes(), PosLedger.createIndexes(), PosOperation.createIndexes(),
  ]).then(async () => {
    // Preseed counters before transactions so the very first concurrent
    // issue cannot race two transactional counter upserts.
    for (const kind of ["sale", "refund"]) {
      await PosCounter.updateOne({ _id: kind },
        { $setOnInsert: { sequence: 0 } }, { upsert: true });
    }
  }).catch(error => { readyPromise = null; throw error; });
  return readyPromise;
}
async function verifiedActor(req) {
  if (!req?.dashboardUserId || !req.dashboardUserRole) {
    throw new PosFinancialError("UNAUTHORIZED", "الجلسة غير صالحة.", 401);
  }
  const user = await DashboardUser.findById(req.dashboardUserId)
    .select("_id email name role isActive").lean();
  if (!user || !user.isActive) {
    throw new PosFinancialError("UNAUTHORIZED", "حساب الموظف غير نشط.", 403);
  }
  if (!["cashier", "restaurant", "admin", "superadmin"].includes(user.role)) {
    throw new PosFinancialError("FORBIDDEN", "صلاحية نقطة البيع غير متاحة.", 403);
  }
  return {
    id: String(user._id), name: user.name?.trim() || null,
    email: user.email, role: user.role,
  };
}
async function nextNumber(session, kind) {
  const counter = await PosCounter.findOneAndUpdate(
    { _id: kind }, { $inc: { sequence: 1 } },
    { session, upsert: true, new: true }
  ).lean();
  if (!Number.isSafeInteger(counter.sequence) || counter.sequence < 1
    || counter.sequence > 999999999) malformed("عداد الفواتير تجاوز الحد الآمن.");
  return { sequence: counter.sequence,
    number: (kind === "sale" ? "STG-" : "STG-R-") + String(counter.sequence).padStart(6, "0") };
}
function receiptView(doc) {
  // Expose original immutable snapshot; caller strips no money data.
  return doc && typeof doc.toObject === "function" ? doc.toObject() : doc;
}
function samePayload(existing, hash) {
  if (existing.payloadHash !== hash) {
    conflict("مفتاح العملية مستخدم سابقًا ببيانات مختلفة.");
  }
  return existing;
}
async function afterUnknownOutcome(Model, key, hash, originalError) {
  // If the network dropped after commit, read-by-key resolves the uncertainty.
  const result = await Model.findOne({ idempotencyKey: key }).lean();
  if (result) return samePayload(result, hash);
  throw originalError;
}

async function issueStagingInvoice(req, body, key, options = {}) {
  requireFinancialStagingWrites(options);
  validateIdempotencyKey(key);
  const actor = await verifiedActor(req);
  await ensureFinancialIndexes();
  let intent, hash;
  try {
    intent = normalizeSaleIntent(body);
    hash = canonicalHash(intent);
  } catch (error) {
    if (error instanceof PosFinancialError && error.status >= 400 && error.status < 500) {
      const registered = await beginOperation(actor, "sale", key, canonicalHash(body));
      if (registered.replayed) return { invoice: registered.result, replayed: true };
      await rejectOperation(key, error.code);
    }
    throw error;
  }
  const registered = await beginOperation(actor, "sale", key, hash);
  if (registered.replayed) return { invoice: registered.result, replayed: true };
  const session = await mongoose.startSession();
  let saved = null;
  try {
    try {
      await session.withTransaction(async () => {
        saved = null;
        const operation = await PosOperation.findById(key).session(session).lean();
        if (!operation || operation.status !== "pending" || operation.kind !== "sale") {
          conflict("تم إغلاق محاولة البيع قبل إصدار الفاتورة.");
        }
        const existing = await PosInvoice.findOne({ idempotencyKey: key }).session(session).lean();
        if (existing) {
          saved = samePayload(existing, hash);
          await commitOperation(session, key, "sale", existing);
          return;
        }
        // The write fence serializes any concurrent menu publication against
        // this sale's catalog read. It does not bump the published revision.
        const catalog = await PosCatalog.findOneAndUpdate(
          { _id: "pos-menu", publishedRevision: intent.revision },
          { $inc: { saleFence: 1 } }, { session, new: true }
        ).lean();
        if (!catalog) {
          throw new PosFinancialError("POS_CATALOG_CONFLICT",
            "المنيو اتغيّر أثناء التأكيد. راجع أسعار الطلب الجديدة.", 409);
        }
        const priced = pricePosCheckout(catalog, intent, {
          cashierDiscountCapHalalas: null,
        });
        const due = priced.totals.grossHalalas;
        let tender, ledgerType, received = null, change = null;
        if (intent.channel === "restaurant") {
          if (intent.tender.method === "cash") {
            received = intent.tender.receivedHalalas;
            if (received < due) malformed("المبلغ النقدي المستلم أقل من إجمالي الفاتورة.");
            change = received - due;
            ledgerType = "restaurant_cash";
          } else {
            ledgerType = "restaurant_network";
          }
          tender = { method: intent.tender.method, receivedHalalas: received, changeHalalas: change };
        } else {
          ledgerType = "app_receivable";
          tender = { method: "app_receivable", reportedStatus: intent.appPaymentStatus };
        }
        const seq = await nextNumber(session, "sale");
        const now = new Date();
        const docs = await PosInvoice.create([{
          ...seq, idempotencyKey: key, payloadHash: hash,
          publishedRevision: intent.revision,
          channel: intent.channel, serviceMode: intent.serviceMode,
          externalOrderNumber: intent.externalOrderNumber || null,
          appPaymentStatus: intent.appPaymentStatus || null,
          actor, lines: priced.lines, totals: priced.totals,
          invoiceDiscount: intent.invoiceDiscount, tender,
          documentKind: "STAGING_TEST_NON_TAX", issuedAt: now,
        }], { session });
        const invoice = docs[0];
        await PosLedger.create([{
          invoiceId: invoice._id, invoiceNumber: invoice.number,
          type: ledgerType, amountHalalas: due,
          amountReceivedHalalas: received, cashChangeHalalas: change,
          channel: intent.channel, externalPaymentStatus: intent.appPaymentStatus ?? null,
          recordedAt: now,
        }], { session });
        // Pre-allocate balances transactionally so concurrent first refunds
        // can safely update one existing row instead of racing on upsert.
        await PosRefundBalance.insertMany(priced.lines.map(line => ({
          _id: invoice._id.toString() + ":" + line.id,
          invoiceId: invoice._id, lineId: line.id,
          refundedQuantity: 0, refundedGrossHalalas: 0,
          refundedVatHalalas: 0, refundedNetHalalas: 0,
        })), { session });
        const audit = [{ event: "POS_SALE_ISSUED", invoiceId: invoice._id,
          actor, at: now, details: {
            number: invoice.number, channel: intent.channel, totalHalalas: due,
            tender: ledgerType, publishedRevision: intent.revision,
          } }];
        for (const line of priced.lines) {
          if (line.lineDiscountHalalas > 0) audit.push({
            event: "POS_LINE_DISCOUNT", invoiceId: invoice._id, actor, at: now,
            details: { lineId: line.id, discount: line.discount,
              valueHalalas: line.lineDiscountHalalas },
          });
        }
        if (priced.totals.invoiceDiscountHalalas > 0) audit.push({
          event: "POS_INVOICE_DISCOUNT", invoiceId: invoice._id, actor, at: now,
          details: { discount: intent.invoiceDiscount,
            valueHalalas: priced.totals.invoiceDiscountHalalas },
        });
        await PosAudit.insertMany(audit, { session });
        await commitOperation(session, key, "sale", invoice);
        saved = receiptView(invoice);
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      if (error.code === 11000 || error.hasErrorLabel?.("UnknownTransactionCommitResult")
        || error.hasErrorLabel?.("TransientTransactionError")) {
        const original = await afterUnknownOutcome(PosInvoice, key, hash, error);
        return { invoice: original, replayed: true };
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof PosFinancialError && [400, 404, 409].includes(error.status)) {
      await rejectOperation(key, error.code);
    }
    throw error;
  } finally {
    await session.endSession();
  }
  if (!saved) malformed("تعذّر إصدار الفاتورة، لم يتم تسجيل أي عملية.");
  return { invoice: saved, replayed: false };
}

// HALF_UP on original line's total for the quantity being returned, not on
// unit prices; the last return receives exact remainder from original values.
function proportionalRefund(line, balance, quantity) {
  if (balance.refundedQuantity + quantity > line.quantity) {
    conflict("الكمية المرتجعة أكبر من المتبقي في السطر.");
  }
  const last = balance.refundedQuantity + quantity === line.quantity;
  const proportional = total => Math.floor((total * quantity * 2 + line.quantity) / (2 * line.quantity));
  const grossHalalas = last
    ? line.grossHalalas - balance.refundedGrossHalalas
    : proportional(line.grossHalalas);
  const vatHalalas = last
    ? line.vatHalalas - balance.refundedVatHalalas
    : proportional(line.vatHalalas);
  const netHalalas = grossHalalas - vatHalalas;
  if (grossHalalas < 0 || vatHalalas < 0 || netHalalas < 0
    || grossHalalas > line.grossHalalas - balance.refundedGrossHalalas
    || vatHalalas > line.vatHalalas - balance.refundedVatHalalas) {
    conflict("مبلغ المرتجع أكبر من الرصيد المتاح.");
  }
  return { grossHalalas, vatHalalas, netHalalas };
}
async function recordStagingRefund(req, body, key, options = {}) {
  requireFinancialStagingWrites(options);
  validateIdempotencyKey(key);
  const actor = await verifiedActor(req);
  if (!hasPosCapability(actor.role, "pos.refund")) {
    throw new PosFinancialError("FORBIDDEN", "الموظف ليس لديه صلاحية pos.refund.", 403);
  }
  await ensureFinancialIndexes();
  let intent, hash;
  try {
    intent = normalizeRefundIntent(body);
    hash = canonicalHash(intent);
  } catch (error) {
    if (error instanceof PosFinancialError && error.status >= 400 && error.status < 500) {
      const registered = await beginOperation(actor, "refund", key, canonicalHash(body));
      if (registered.replayed) return { refund: registered.result, replayed: true };
      await rejectOperation(key, error.code);
    }
    throw error;
  }
  const registered = await beginOperation(actor, "refund", key, hash);
  if (registered.replayed) return { refund: registered.result, replayed: true };
  const session = await mongoose.startSession();
  let saved = null;
  try {
    try {
      await session.withTransaction(async () => {
        saved = null;
        const operation = await PosOperation.findById(key).session(session).lean();
        if (!operation || operation.status !== "pending" || operation.kind !== "refund") {
          conflict("تم إغلاق محاولة المرتجع قبل تسجيله.");
        }
        const existing = await PosRefund.findOne({ idempotencyKey: key }).session(session).lean();
        if (existing) {
          saved = samePayload(existing, hash);
          await commitOperation(session, key, "refund", existing);
          return;
        }
        const invoice = await PosInvoice.findById(intent.invoiceId).session(session).lean();
        if (!invoice) {
          throw new PosFinancialError("POS_INVOICE_NOT_FOUND", "الفاتورة غير موجودة.", 404);
        }
        const resultLines = [];
        for (const entry of intent.lines) {
          const line = invoice.lines.find(l => l.id === entry.lineId);
          if (!line) malformed("سطر المرتجع غير موجود في الفاتورة.");
          const balanceId = invoice._id.toString() + ":" + line.id;
          const balance = await PosRefundBalance.findById(balanceId).session(session).lean();
          if (!balance) malformed("رصيد مرتجع السطر غير موجود.");
          const amounts = proportionalRefund(line, balance, entry.quantity);
          const updated = await PosRefundBalance.updateOne({
            _id: balanceId, refundedQuantity: balance.refundedQuantity,
          }, { $inc: {
            refundedQuantity: entry.quantity,
            refundedGrossHalalas: amounts.grossHalalas,
            refundedVatHalalas: amounts.vatHalalas,
            refundedNetHalalas: amounts.netHalalas,
          } }, { session });
          if (updated.modifiedCount !== 1) conflict("المرتجع تغير أثناء التأكيد؛ حاول مرة أخرى.");
          resultLines.push({
            lineId: line.id, productId: line.productId,
            parentLineId: line.parentLineId, name: line.name, variantLabel: line.variantLabel,
            quantity: entry.quantity, ...amounts,
          });
        }
        const totals = resultLines.reduce((out, line) => {
          out.grossHalalas += line.grossHalalas;
          out.vatHalalas += line.vatHalalas;
          out.netHalalas += line.netHalalas;
          return out;
        }, { grossHalalas: 0, vatHalalas: 0, netHalalas: 0 });
        if (totals.grossHalalas !== totals.vatHalalas + totals.netHalalas) {
          malformed("مجاميع المرتجع غير متسقة.");
        }
        const seq = await nextNumber(session, "refund");
        const now = new Date();
        const docs = await PosRefund.create([{
          ...seq, idempotencyKey: key, payloadHash: hash,
          invoiceId: invoice._id, invoiceNumber: invoice.number,
          actor, reason: intent.reason, method: intent.method,
          lines: resultLines, totals, documentKind: "STAGING_TEST_NON_TAX",
          recordedAt: now,
        }], { session });
        await PosAudit.create([{
          event: "POS_REFUND_RECORDED", invoiceId: invoice._id,
          refundId: docs[0]._id, actor, at: now,
          details: { number: docs[0].number, invoiceNumber: invoice.number,
            reason: intent.reason, method: intent.method,
            amountHalalas: totals.grossHalalas, externalOnly: true },
        }], { session });
        await commitOperation(session, key, "refund", docs[0]);
        saved = receiptView(docs[0]);
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      if (error.code === 11000 || error.hasErrorLabel?.("UnknownTransactionCommitResult")
        || error.hasErrorLabel?.("TransientTransactionError")) {
        const original = await afterUnknownOutcome(PosRefund, key, hash, error);
        return { refund: original, replayed: true };
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof PosFinancialError && [400, 404, 409].includes(error.status)) {
      await rejectOperation(key, error.code);
    }
    throw error;
  } finally {
    await session.endSession();
  }
  if (!saved) malformed("تعذّر تسجيل المرتجع.");
  return { refund: saved, replayed: false };
}
module.exports = {
  verifiedActor, issueStagingInvoice, recordStagingRefund,
  proportionalRefund, ensureFinancialIndexes,
};
