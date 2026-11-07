"use strict";
const mongoose = require("mongoose");
const PosOperation = require("../../models/PosOperation");
const PosInvoice = require("../../models/PosInvoice");
const PosRefund = require("../../models/PosRefund");
const { PosFinancialError } = require("./financialQuoteService");
const { validateIdempotencyKey } = require("./financialIntent");
const { requireFinancialStagingWrites } = require("./financialRuntime");

const error = (code, message, status = 409) => new PosFinancialError(code, message, status);
const PRIVILEGED = new Set(["admin", "superadmin"]);
const settings = { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" };

function assertKind(kind) {
  if (kind !== "sale" && kind !== "refund") throw error("POS_INTENT_INVALID", "نوع العملية غير صالح.", 400);
}
function assertOwner(operation, actor) {
  if (operation && operation.operatorId !== String(actor.id) && !PRIVILEGED.has(actor.role)) {
    throw error("FORBIDDEN", "هذه العملية تخص موظفًا آخر.", 403);
  }
}
async function getResult(operation) {
  if (operation.status !== "committed" || !operation.resultId) return null;
  const Model = operation.kind === "sale" ? PosInvoice : PosRefund;
  const value = await Model.findById(operation.resultId).lean();
  if (!value) throw error("POS_OPERATION_INCONSISTENT", "مستند العملية المعتمدة غير موجود.", 500);
  return value;
}
async function readOperation(key, actor) {
  requireFinancialStagingWrites();
  validateIdempotencyKey(key);
  const operation = await PosOperation.findById(key).lean();
  if (!operation) return null; // For display only; 404 never authorizes a new attempt.
  assertOwner(operation, actor);
  return { status: operation.status, resultId: operation.resultId, resultNumber: operation.resultNumber,
    errorCode: operation.errorCode, kind: operation.kind };
}
async function findOperationForActor(actor, kind) {
  requireFinancialStagingWrites();
  assertKind(kind);
  const operation = await PosOperation.findOne({
    kind, operatorId: String(actor.id), status: "pending",
  }).sort({ createdAt: 1 }).lean();
  return operation ? { key: operation._id, status: operation.status, kind: operation.kind } : null;
}
async function beginOperation(actor, kind, key, hash) {
  assertKind(kind);
  validateIdempotencyKey(key);
  const operatorId = String(actor.id);
  try {
    await PosOperation.create([{
      _id: key, kind, operatorId, payloadHash: hash, status: "pending",
    }], { writeConcern: { w: "majority" } });
    return { replayed: false, result: null };
  } catch (cause) {
    if (cause.code !== 11000) throw cause;
    const operation = await PosOperation.findById(key).lean();
    if (!operation) throw error("POS_OPERATION_PENDING",
      "لديك عملية من نفس النوع لم تُحسم. تحقق منها أولًا.");
    assertOwner(operation, actor);
    if (operation.kind !== kind || (operation.payloadHash && operation.payloadHash !== hash)) {
      throw error("POS_CONFLICT", "مفتاح العملية مستخدم ببيانات مختلفة.");
    }
    if (operation.status === "committed") {
      return { replayed: true, result: await getResult(operation) };
    }
    if (operation.status === "rejected" || operation.status === "abandoned") {
      throw error("POS_OPERATION_CLOSED", "هذه المحاولة انتهت. ابدأ محاولة جديدة.");
    }
    throw error("POS_OPERATION_PENDING",
      "المحاولة السابقة قيد المعالجة. تحقق من نتيجتها أو ألغها أولًا.");
  }
}
async function commitOperation(session, key, kind, doc) {
  const update = await PosOperation.updateOne({
    _id: key, kind, status: "pending",
  }, { $set: { status: "committed", resultId: doc._id, resultNumber: doc.number, errorCode: null } },
  { session });
  if (update.modifiedCount !== 1) {
    throw error("POS_OPERATION_CLOSED", "تم إلغاء أو حسم المحاولة قبل تسجيل المستند.");
  }
}
async function rejectOperation(key, code) {
  await PosOperation.updateOne({ _id: key, status: "pending" },
    { $set: { status: "rejected", errorCode: code } }, { writeConcern: { w: "majority" } });
}
async function abandonOperation(key, actor, kind) {
  requireFinancialStagingWrites();
  validateIdempotencyKey(key);
  assertKind(kind);
  // Every attempt is transactional. A concurrent commit updates the exact same
  // operation document, ensuring one of abandon / commit loses by write conflict.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const session = await mongoose.startSession();
    let settled;
    try {
      await session.withTransaction(async () => {
        const current = await PosOperation.findById(key).session(session).lean();
        if (current) {
          assertOwner(current, actor);
          if (current.kind !== kind) throw error("POS_CONFLICT", "نوع المحاولة غير مطابق.");
          if (current.status === "pending") {
            const changed = await PosOperation.updateOne({ _id: key, status: "pending" },
              { $set: { status: "abandoned" } }, { session });
            if (changed.modifiedCount !== 1) throw error("POS_OPERATION_PENDING", "جار حسم المحاولة.");
            settled = { status: "abandoned" };
          } else {
            settled = { status: current.status, resultId: current.resultId,
              resultNumber: current.resultNumber, errorCode: current.errorCode };
          }
        } else {
          // The tombstone wins even if the original HTTP POST arrives later.
          await PosOperation.create([{
            _id: key, kind, operatorId: String(actor.id), status: "abandoned",
            payloadHash: null,
          }], { session });
          settled = { status: "abandoned" };
        }
      }, settings);
      return settled;
    } catch (cause) {
      if (attempt === 4 || !(cause.code === 11000
        || cause.code === 112 || cause.hasErrorLabel?.("TransientTransactionError"))) throw cause;
    } finally {
      await session.endSession();
    }
  }
  throw error("POS_OPERATION_PENDING", "تعذر حسم العملية؛ تحقق مرة أخرى.");
}
module.exports = {
  beginOperation, commitOperation, rejectOperation, readOperation, abandonOperation, findOperationForActor,
};
