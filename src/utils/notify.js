const { getFirebaseAdmin } = require("./firebase");
const User = require("../models/User");
const NotificationLog = require("../models/NotificationLog");

async function notifyUser(userId, { title, body, data }, options = {}) {
  const { skipLog = false, logFields = {} } = options;
  const user = await User.findById(userId).lean();
  if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
    if (!skipLog) {
      await NotificationLog.create({
        userId,
        title,
        body,
        data: data || {},
        status: "no_tokens",
        sentAt: new Date(),
        ...logFields,
      });
    }
    return {
      sent: false,
      noTokens: true,
      successCount: 0,
      failureCount: 0,
      errorCodes: [],
      retryCount: 0,
    };
  }

  const admin = getFirebaseAdmin();
  const response = await admin.messaging().sendEachForMulticast({
    tokens: user.fcmTokens,
    notification: { title, body },
    data: data || {},
  });

  const invalidTokens = [];
  const retryTokens = [];
  const errorCodes = [];
  response.responses.forEach((r, idx) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (code) errorCodes.push(code);
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
        invalidTokens.push(user.fcmTokens[idx]);
      } else {
        retryTokens.push(user.fcmTokens[idx]);
      }
    }
  });

  if (invalidTokens.length > 0) {
    await User.findByIdAndUpdate(userId, { $pull: { fcmTokens: { $in: invalidTokens } } });
  }

  let retryCount = 0;
  let retrySuccess = 0;
  let retryFailure = 0;
  if (retryTokens.length > 0) {
    retryCount = 1;
    const retryResponse = await admin.messaging().sendEachForMulticast({
      tokens: retryTokens,
      notification: { title, body },
      data: data || {},
    });
    retrySuccess = retryResponse.successCount || 0;
    retryFailure = retryResponse.failureCount || 0;
  }

  const successCount = (response.successCount || 0) + retrySuccess;
  const failureCount = (response.failureCount || 0) + retryFailure;

  if (!skipLog) {
    await NotificationLog.create({
      userId,
      title,
      body,
      data: data || {},
      sentAt: new Date(),
      status: "sent",
      successCount,
      failureCount,
      errorCodes,
      retryCount,
      ...logFields,
    });
  }

  return {
    sent: successCount > 0,
    noTokens: false,
    successCount,
    failureCount,
    errorCodes,
    retryCount,
  };
}

module.exports = { notifyUser };
