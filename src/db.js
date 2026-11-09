const mongoose = require("mongoose");
const { isMaintenanceMode } = require("./middleware/maintenanceMode");
const { ensurePaymentIndexes } = require("./services/paymentIndexService");
const {
  resolveMongooseIndexRuntimePolicy,
} = require("./utils/mongooseIndexRuntimePolicy");

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
  const indexPolicy = resolveMongooseIndexRuntimePolicy(process.env);
  const maintenanceMode = isMaintenanceMode();
  const autoIndex = !maintenanceMode && indexPolicy.autoIndex;

  console.log(`[railway-startup] Connecting to MongoDB (db: ${dbName}, maskedUri: ${maskedUri}, autoIndex: ${autoIndex})`);

  const connection = await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    autoIndex,
    ...(maintenanceMode ? { autoCreate: false } : {}),
  });
  console.log("[railway-startup] MongoDB connected");

  if (maintenanceMode) return connection;

  console.log("[railway-startup] Ensuring payment indexes");
  await ensurePaymentIndexes();
  console.log("[railway-startup] Payment indexes ensured");

  return connection;
}

module.exports = { connectDb };
