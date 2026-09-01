const { URL } = require("url");

const FORBIDDEN_TEST_DATABASE_NAMES = new Set([
  "admin",
  "basicdiet145",
  "basicdiet_staging",
  "config",
  "local",
  // Production currently resolves to MongoDB's default database named "test".
  // The name alone must never be treated as proof of test isolation.
  "test",
]);

const KNOWN_PRODUCTION_MONGO_HOSTS = new Set([
  "hayabusa.proxy.rlwy.net",
  "mongodb.railway.internal",
]);

/**
 * Extracts the database name from a MongoDB connection string.
 * Supports mongodb:// and mongodb+srv:// protocols.
 * 
 * @param {string} uri MongoDB connection string
 * @returns {string} Database name or empty string if not found
 */
function getDbNameFromUri(uri) {
  if (!uri || typeof uri !== "string") return "";
  try {
    // URL parser handles the path naturally
    // We replace mongodb+srv with http just for parsing if URL fails, 
    // but URL class usually handles mongodb:// fine in Node 20.
    const cleanUri = uri.startsWith("mongodb+srv://") 
      ? uri.replace("mongodb+srv://", "http://") 
      : uri.startsWith("mongodb://") 
        ? uri.replace("mongodb://", "http://")
        : uri;
        
    const parsed = new URL(cleanUri);
    const dbName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    // Strip query parameters if they somehow ended up in pathname
    return dbName.split("?")[0];
  } catch (e) {
    return "";
  }
}

function getMongoHostFromUri(uri) {
  if (!uri || typeof uri !== "string") return "";
  try {
    const parsed = new URL(uri);
    if (!["mongodb:", "mongodb+srv:"].includes(parsed.protocol)) return "";
    return String(parsed.hostname || "").trim().toLowerCase();
  } catch (_error) {
    return "";
  }
}

function configuredProductionHosts(env = process.env) {
  const configured = [
    env.PRODUCTION_MONGO_HOST,
    ...(String(env.PRODUCTION_MONGO_HOSTS || "").split(",")),
  ];
  return new Set([
    ...KNOWN_PRODUCTION_MONGO_HOSTS,
    ...configured.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean),
  ]);
}

function assertSafeTestMongoUri(uri, { env = process.env, databaseName = "" } = {}) {
  if (env.NODE_ENV !== "test") {
    throw new Error(`Safety block: NODE_ENV must be "test" before any test MongoDB connection.`);
  }

  const dbName = getDbNameFromUri(uri);
  const effectiveDbName = String(databaseName || dbName || "").trim();
  const host = getMongoHostFromUri(uri);
  if (!host) {
    throw new Error("Safety block: MONGO_URI_TEST must be a valid mongodb:// or mongodb+srv:// URI.");
  }
  if (!effectiveDbName) {
    throw new Error("Safety block: test MongoDB URI must include an explicit database name.");
  }

  if (configuredProductionHosts(env).has(host)) {
    throw new Error(`Safety block: MongoDB host "${host}" is a known production host.`);
  }

  const lowDb = effectiveDbName.toLowerCase();
  const configuredProductionDbNames = String(env.PRODUCTION_MONGO_DB_NAMES || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (FORBIDDEN_TEST_DATABASE_NAMES.has(lowDb) || configuredProductionDbNames.includes(lowDb)) {
    throw new Error(`Safety block: Database name "${effectiveDbName}" is reserved and is not allowed in test mode.`);
  }

  const hasSafeKeyword = lowDb.includes("test") || lowDb.includes("local") || lowDb.includes("ci");

  if (!hasSafeKeyword) {
    throw new Error(
      `Safety block: Database name "${effectiveDbName}" is not allowed in test mode. ` +
      `It must include "test", "local", or "ci" and must not be a reserved application database.`
    );
  }
}

/**
 * Resolves the appropriate MongoDB URI based on NODE_ENV and performs safety checks.
 * 
 * @returns {string} The resolved MongoDB URI
 * @throws {Error} If requirements are not met or safety checks fail
 */
function resolveMongoUri() {
  const isTest = process.env.NODE_ENV === "test";

  if (isTest) {
    const uri = process.env.MONGO_URI_TEST;
    if (!uri) {
      throw new Error("MONGO_URI_TEST is required when NODE_ENV=test");
    }

    assertSafeTestMongoUri(uri);

    return uri;
  }

  // Production / Development logic
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!uri) {
    throw new Error("Missing MongoDB connection string (set MONGO_URI, MONGODB_URI, or MONGO_URL)");
  }

  return uri;
}

module.exports = {
  assertSafeTestMongoUri,
  getDbNameFromUri,
  getMongoHostFromUri,
  resolveMongoUri,
};
