const mongoose = require("mongoose");
const { ensurePaymentIndexes } = require("./services/paymentIndexService");

/**
 * Mask MongoDB URI to prevent logging credentials.
 * Logs: protocol, hosts, port, and database name.
 */
const { resolveMongoUri, getDbNameFromUri } = require("./utils/mongoUriResolver");

/**
 * Mask MongoDB URI to prevent logging credentials.
 * Logs: protocol, hosts, port, and database name.
 */
function maskMongoUri(uri) {
  try {
    const url = new URL(uri.startsWith("mongodb+srv") ? uri.replace("mongodb+srv", "http") : uri.replace("mongodb", "http"));
    return `${uri.split("://")[0]}://${url.host}${url.pathname}`;
  } catch (e) {
    return "invalid-uri";
  }
}

async function connectDb() {
  const uri = resolveMongoUri();
  const dbName = getDbNameFromUri(uri);
  const maskedUri = maskMongoUri(uri);

  console.log(`[railway-startup] Connecting to MongoDB (db: ${dbName}, maskedUri: ${maskedUri})`);

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
