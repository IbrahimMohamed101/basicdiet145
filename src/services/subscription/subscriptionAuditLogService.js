"use strict";

const SubscriptionAuditLog = require("../../models/SubscriptionAuditLog");
const { logger } = require("../../utils/logger");

async function writeAuditLog({
  entityType,
  entityId,
  action,
  fromStatus,
  toStatus,
  actorType,
  actorId,
  note,
  meta,
  session,
}) {
  try {
    const doc = {
      entityType,
      entityId,
      action,
      fromStatus,
      toStatus,
      actorType,
      actorId,
      note,
      meta,
    };
    
    // Fire and forget behavior locally if no session, otherwise part of the tx
    if (session) {
      await SubscriptionAuditLog.create([doc], { session });
    } else {
      await SubscriptionAuditLog.create(doc);
    }
  } catch (err) {
    logger.error("Failed to write subscription audit log", {
      error: err.message,
      entityId,
      action,
    });
    // Swallow the error as logging failure must not block business logic
  }
}

async function bulkWriteAuditLogs(logs, session) {
  try {
    if (!logs || !logs.length) return;
    
    if (session) {
      await SubscriptionAuditLog.insertMany(logs, { session });
    } else {
      await SubscriptionAuditLog.insertMany(logs);
    }
  } catch (err) {
    logger.error("Failed to implicitly bulk write subscription audit logs", {
      error: err.message,
      count: logs.length,
    });
    // Swallowing to prevent failure loops matching business req (#6)
  }
}

module.exports = {
  writeAuditLog,
  bulkWriteAuditLogs,
};
