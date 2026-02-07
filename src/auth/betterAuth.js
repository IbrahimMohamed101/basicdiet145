const { MongoClient } = require("mongodb");
const { betterAuth } = require("better-auth");
const { mongodbAdapter } = require("better-auth/adapters/mongodb");
const { logger } = require("../utils/logger");

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  throw new Error("Missing MONGO_URI for Better Auth");
}

const dbName = process.env.MONGO_DB || "basicdiet145";
const client = new MongoClient(mongoUri);
client.connect().catch((err) => {
  logger.error("Better Auth MongoDB connection failed", { error: err.message, stack: err.stack });
});

const db = client.db(dbName);
const baseURL = process.env.BETTER_AUTH_BASE_URL || process.env.APP_URL;
const secret = process.env.BETTER_AUTH_SECRET;

const auth = betterAuth({
  baseURL,
  secret,
  database: mongodbAdapter(db),
  emailAndPassword: { enabled: true },
});

module.exports = { auth };
