const { logger } = require("./logger");

function validateEnv() {
  const required = [
    "MONGO_URI",
    "MONGO_DB",
    "JWT_SECRET",
    "APP_TIMEZONE",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "APP_URL",
    "MOYASAR_SECRET_KEY",
    "MOYASAR_WEBHOOK_SECRET",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_BASE_URL",
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    logger.error("Missing required environment variables", { missing });
    return { ok: false, missing };
  }

  return { ok: true };
}

module.exports = { validateEnv };
