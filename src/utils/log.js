const ActivityLog = require("../models/ActivityLog");

async function writeLog({ entityType, entityId, action, byUserId, byRole, meta }) {
  return ActivityLog.create({
    entityType,
    entityId,
    action,
    byUserId,
    byRole,
    meta,
  });
}

module.exports = { writeLog };
