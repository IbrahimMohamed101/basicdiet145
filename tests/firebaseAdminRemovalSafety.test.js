"use strict";

process.env.NODE_ENV = "test";
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const User = require("../src/models/User");
const NotificationLog = require("../src/models/NotificationLog");
const { getFirebaseAdmin } = require("../src/utils/firebase");
const { sendUserNotificationWithDedupe } = require("../src/services/notificationService");

async function main() {
  assert.throws(
    () => getFirebaseAdmin(),
    (error) => error.code === "FIREBASE_MESSAGING_DISABLED",
    "Unconfigured push delivery must fail explicitly instead of pretending to send"
  );
  const mongo = await MongoMemoryServer.create({ instance: { dbName: "fcm_disabled_fallback_test" } });
  try {
    await mongoose.connect(mongo.getUri(), { autoIndex: false });
    const user = await User.create({ phone: "+966501120001", role: "client" });
    const base = {
      userId: user._id,
      title: "Delivery Update",
      body: "Test message",
      data: { type: "test" },
      type: "order_paid",
      entityType: "order",
      entityId: new mongoose.Types.ObjectId(),
      scheduledFor: new Date(),
    };
    const noTokens = await sendUserNotificationWithDedupe({
      ...base,
      dedupeKey: "fcm-disabled:no-tokens",
    });
    assert.equal(noTokens.status, "no_tokens");
    assert.equal((await NotificationLog.findOne({ dedupeKey: "fcm-disabled:no-tokens" }).lean()).status, "no_tokens");

    await User.updateOne({ _id: user._id }, { $set: { fcmTokens: ["legacy-registration-token"] } });
    const withTokens = await sendUserNotificationWithDedupe({
      ...base,
      dedupeKey: "fcm-disabled:existing-token",
    });
    assert.equal(withTokens.status, "failed");
    assert.equal(withTokens.error.code, "FIREBASE_MESSAGING_DISABLED");
    const failedLog = await NotificationLog.findOne({ userId: user._id, status: "failed" }).lean();
    assert.ok(failedLog, "Failed FCM dispatch must be auditable");
    assert.notEqual(failedLog.status, "sent");
    assert.equal(await NotificationLog.countDocuments({ userId: user._id, status: "sent" }), 0);
    const savedUser = await User.findById(user._id).lean();
    assert.deepEqual(savedUser.fcmTokens, ["legacy-registration-token"], "Do not alter saved client device tokens");
    console.log("Unconfigured FCM is safely disabled without marking customer notifications as sent");
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
