const mongoose = require("mongoose");
const { ensurePaymentIndexes } = require("./services/paymentIndexService");

/**
 * Mask MongoDB URI to prevent logging credentials.
 * Logs: protocol, hosts, port, and database name.
 */
function maskMongoUri(uri) {
  try {
    const url = new URL(uri);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch (e) {
    return "invalid-uri";
  }
}

async function connectDb() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  const hasMongoUri = Boolean(process.env.MONGO_URI);
  const hasMongodbUri = Boolean(process.env.MONGODB_URI);
  const maskedUri = maskMongoUri(uri);

  console.log(`[railway-startup] Connecting to MongoDB (hasMongoUri: ${hasMongoUri}, hasMongodbUri: ${hasMongodbUri}, maskedUri: ${maskedUri})`);

  if (!uri) {
    throw new Error("Missing MongoDB connection string (set MONGO_URI or MONGODB_URI)");
  }

  const connection = await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000
  });
  console.log("[railway-startup] MongoDB connected");

  console.log("[railway-startup] Ensuring payment indexes");
  await ensurePaymentIndexes();
  console.log("[railway-startup] Payment indexes ensured");

  return connection;
}

module.exports = { connectDb };
