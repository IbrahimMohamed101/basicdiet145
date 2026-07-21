const { URL } = require("url");

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

function assertSafeTestMongoUri(uri) {
  const dbName = getDbNameFromUri(uri);
  const lowDb = dbName.toLowerCase();

  const hasSafeKeyword = lowDb.includes("test") || lowDb.includes("local") || lowDb.includes("ci");
  const isPrimaryDb = lowDb === "basicdiet145";

  if (!hasSafeKeyword || isPrimaryDb) {
    throw new Error(
      `Safety block: Database name "${dbName}" is not allowed in test mode. ` +
      `It must include "test", "local", or "ci", and cannot be "basicdiet145".`
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
  resolveMongoUri,
};
