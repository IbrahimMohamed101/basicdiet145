const mongoose = require("mongoose");

/**
 * Validates if the current database connection is safe for destructive operations.
 * A connection is considered safe if:
 * 1. NODE_ENV is "test" AND the database name ends with "_test"
 * 2. The explicit CLI flag "--force-test-db" is present
 * 
 * @param {string} operationName Name of the operation for error logging
 * @throws {Error} if the operation is not allowed on the current connection
 */
function ensureSafeForDestructiveOp(operationName = "destructive operation") {
  const isForce = process.argv.includes("--force-test-db");
  const isTestEnv = process.env.NODE_ENV === "test";
  
  const connection = mongoose.connection;
  const dbName = connection.name || (connection.db && connection.db.databaseName) || "";
  const isTestDb = dbName.toLowerCase().endsWith("_test");

  // Force flag bypasses all checks
  if (isForce) {
    console.warn(`\n⚠️  SAFETY BYPASS: Forced execution of ${operationName} on database "${dbName}"\n`);
    return;
  }

  // Strict enforcement: Must be test env AND test database
  if (isTestEnv && isTestDb) {
    return;
  }

  const errorMessage = `
❌ SAFETY BLOCK: ${operationName} was REJECTED on database "${dbName}".

Requirements:
- NODE_ENV must be "test" (Current: ${process.env.NODE_ENV || "not set"})
- Database name must end with "_test" (Current: ${dbName})

To bypass this safety guard (USE WITH EXTREME CAUTION), run the command with:
  <command> --force-test-db
`;

  console.error(errorMessage);
  throw new Error(`Safety block: ${operationName} rejected.`);
}

module.exports = {
  ensureSafeForDestructiveOp,
};
