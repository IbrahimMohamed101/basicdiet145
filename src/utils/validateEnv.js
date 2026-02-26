const { logger } = require("./logger");

function validateEnv() {
  const hasMongoUri = Boolean(process.env.MONGO_URI || process.env.MONGODB_URI);
  const missing = [];
  if (!hasMongoUri) missing.push("MONGO_URI or MONGODB_URI");
  if (!process.env.JWT_SECRET) missing.push("JWT_SECRET");

  if (missing.length) {
    logger.error("Missing required environment variables", { missing });
    return { ok: false, missing };
  }

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  const isValidMongoUri = typeof mongoUri === "string" && /^mongodb(\+srv)?:\/\//.test(mongoUri);
  if (!isValidMongoUri) {
    logger.error("Invalid MongoDB URI: must start with mongodb:// or mongodb+srv://");
    return { ok: false, invalid: ["MONGO_URI or MONGODB_URI"] };
  }

  return { ok: true };
}

module.exports = { validateEnv };
