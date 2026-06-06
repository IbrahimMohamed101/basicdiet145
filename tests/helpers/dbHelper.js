const mongoose = require("mongoose");
const { logger } = require("../../src/utils/logger");

const { resolveMongoUri } = require("../../src/utils/mongoUriResolver");

async function connectDB() {
  if (mongoose.connection.readyState === 0) {
    try {
      const uri = resolveMongoUri();
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
      });
      // logger.info("Connected to test database");
    } catch (err) {
      console.error("Failed to connect to MongoDB in test helper", err.message);
      process.exit(1);
    }
  }
}

async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

const { ensureSafeForDestructiveOp } = require("../../src/utils/dbSafety");

async function resetDB() {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    ensureSafeForDestructiveOp("resetDB");
    await mongoose.connection.db.dropDatabase();
  }
}

module.exports = {
  connectDB,
  disconnectDB,
  resetDB,
};
