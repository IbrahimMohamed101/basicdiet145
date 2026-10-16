"use strict";

// Firebase Admin was used exclusively by the legacy FCM push path.
// Production has no FIREBASE_CLIENT_EMAIL configured, so that sender has
// already been unable to initialize. Keep the API explicit and fail closed
// instead of making scheduler/notification imports crash at startup.
// Restoring FCM requires a separately reviewed messaging integration.
function getFirebaseAdmin() {
  const error = new Error("FCM push delivery is disabled; Firebase Admin is not configured.");
  error.code = "FIREBASE_MESSAGING_DISABLED";
  throw error;
}

module.exports = { getFirebaseAdmin };
