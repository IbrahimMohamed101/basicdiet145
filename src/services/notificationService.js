const NotificationLog = require("../models/NotificationLog");
const { notifyUser } = require("../utils/notify");
const { logger } = require("../utils/logger");

async function sendUserNotificationWithDedupe({
  userId,
  title,
  body,
  data,
  type,
  dedupeKey,
  entityType,
  entityId,
  scheduledFor,
}) {
  let logDoc;
  try {
    logDoc = await NotificationLog.create({
      userId,
      type,
      dedupeKey,
      entityType,
      entityId,
      title,
      body,
      data: data || {},
      scheduledFor: scheduledFor || null,
      status: "processing",
    });
  } catch (err) {
    if (err && err.code === 11000) {
      const existing = await NotificationLog.findOne({ dedupeKey }).select("status").lean();
      if (!existing) {
        return { status: "failed" };
      }
      if (existing.status === "processing") {
        return { status: "in_progress" };
      }
      if (existing.status === "failed") {
        return { status: "failed" };
      }
      return { status: "duplicate" };
    }
    throw err;
  }

  try {
    const result = await notifyUser(userId, { title, body, data }, { skipLog: true });
    const status = result.noTokens ? "no_tokens" : "sent";

    await NotificationLog.updateOne(
      { _id: logDoc._id, status: "processing" },
      {
        $set: {
          sentAt: new Date(),
          status,
          successCount: result.successCount || 0,
          failureCount: result.failureCount || 0,
          errorCodes: result.errorCodes || [],
          retryCount: result.retryCount || 0,
        },
      }
    );

    return { status, result };
  } catch (err) {
    await NotificationLog.updateOne(
      { _id: logDoc._id },
      {
        $set: {
          sentAt: new Date(),
          status: "failed",
          error: err.message || "Notification send failed",
        },
        $unset: { dedupeKey: 1 },
      }
    );
    logger.error("Notification send failed", { dedupeKey, error: err.message, stack: err.stack });
    return { status: "failed", error: err };
  }
}

module.exports = { sendUserNotificationWithDedupe };
