"use strict";

const STAGING_ENVIRONMENT_ID = "90700265-e775-4075-a99c-8d04508a7d98";
const STAGING_API_SERVICE_ID = "9a6d629e-c9f4-4687-bf83-613011606018";
const STAGING_DATABASE_HOST = "mongodb-qxhu.railway.internal";
const STAGING_DATABASE_NAME = "basicdiet_pos_staging_test";
const STAGING_DASHBOARD_ORIGIN = "https://clientdashbourd-staging.up.railway.app";
const STAGING_API_ORIGIN = "https://basicdiet145-staging-2882.up.railway.app";

function isPosStagingRuntime(env = process.env) {
  return env.POS_STAGING_ISOLATED === "true"
    && env.RAILWAY_ENVIRONMENT_ID === STAGING_ENVIRONMENT_ID
    && env.RAILWAY_SERVICE_ID === STAGING_API_SERVICE_ID;
}

function preparePosStagingRuntime(env = process.env) {
  if (env.RAILWAY_ENVIRONMENT_ID !== STAGING_ENVIRONMENT_ID
    && env.POS_STAGING_ISOLATED !== "true") return false;
  if (!isPosStagingRuntime(env)) {
    throw new Error("POS Staging isolation requires the dedicated Railway environment and API service");
  }

  let mongo;
  try {
    mongo = new URL(env.POS_STAGING_MONGO_URL);
  } catch {
    throw new Error("POS Staging requires the private connection for its dedicated MongoDB");
  }
  if (mongo.protocol !== "mongodb:" || mongo.hostname !== STAGING_DATABASE_HOST
    || (mongo.port && mongo.port !== "27017") || !mongo.username || !mongo.password) {
    throw new Error("POS Staging MongoDB host, port, or credentials are invalid");
  }
  mongo.pathname = `/${STAGING_DATABASE_NAME}`;
  mongo.search = new URLSearchParams({
    authSource: "admin",
    replicaSet: "rs0",
    directConnection: "true",
  }).toString();
  mongo.hash = "";

  for (const role of ["ADMIN", "CASHIER"]) {
    if (!String(env[`DASHBOARD_DEFAULT_${role}_EMAIL`] || "").endsWith("@pos-staging.invalid")
      || String(env[`DASHBOARD_DEFAULT_${role}_PASSWORD`] || "").length < 20) {
      throw new Error("POS Staging requires dedicated dashboard test accounts");
    }
  }

  const fixtureKeys = new Set([
    "DASHBOARD_DEFAULT_ADMIN_EMAIL",
    "DASHBOARD_DEFAULT_ADMIN_PASSWORD",
    "DASHBOARD_DEFAULT_CASHIER_EMAIL",
    "DASHBOARD_DEFAULT_CASHIER_PASSWORD",
  ]);
  for (const key of Object.keys(env)) {
    if (/^(MOYASAR_|GMAIL_|TWILIO_|CLOUDINARY_|FIREBASE_|FCM_)/.test(key)
      || (key.startsWith("DASHBOARD_DEFAULT_") && !fixtureKeys.has(key))) {
      delete env[key];
    }
  }

  Object.assign(env, {
    NODE_ENV: "staging",
    APP_ENV: "staging",
    DEPLOY_ENV: "staging",
    ENVIRONMENT: "staging",
    MONGO_URI: mongo.toString(),
    MONGODB_URI: mongo.toString(),
    MONGO_URL: mongo.toString(),
    MONGO_URI_TEST: mongo.toString(),
    APP_URL: STAGING_API_ORIGIN,
    BASE_URL: STAGING_API_ORIGIN,
    BETTER_AUTH_BASE_URL: STAGING_API_ORIGIN,
    DASHBOARD_URL: STAGING_DASHBOARD_ORIGIN,
    FRONTEND_URL: STAGING_DASHBOARD_ORIGIN,
    CORS_ORIGINS: STAGING_DASHBOARD_ORIGIN,
    AUTH_OTP_ENABLED: "false",
    AUTH_EMAIL_OTP_ENABLED: "false",
    ALLOW_STAGING_TEST_AUTH: "false",
    ALLOW_TEST_AUTH: "false",
    OTP_TEST_MODE: "false",
    EMAIL_OTP_TEST_MODE: "false",
    STAGING_DATABASE_ISOLATION_CONFIRMED: "true",
    STAGING_PAYMENT_MODE: "mock",
    STAGING_PAYMENT_SANDBOX_CONFIRMED: "false",
    SUBSCRIPTION_STACKING_PRODUCTION_CONFIRMED: "false",
    SUBSCRIPTION_STACKING_SHADOW_ENABLED: "false",
    SUBSCRIPTION_STACKING_READ_ENABLED: "false",
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "false",
    SUBSCRIPTION_STACKING_ALLOW_ALL_USERS: "false",
    SUBSCRIPTION_STACKING_EXTRA_ACTIVATION_ENABLED: "false",
    SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED: "false",
    SUBSCRIPTION_STACKING_EXTRA_ACTIVATION_USER_IDS: "",
    SUBSCRIPTION_STACKING_EXTRA_SELECTION_USER_IDS: "",
  });
  return true;
}

module.exports = { isPosStagingRuntime, preparePosStagingRuntime };
