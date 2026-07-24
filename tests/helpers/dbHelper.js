const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { logger } = require("../../src/utils/logger");

const { resolveMongoUri } = require("../../src/utils/mongoUriResolver");

let ownedMemoryServer = null;
let previousTestMongoUri;

async function ensureIsolatedTestMongoUri() {
  if (process.env.NODE_ENV !== "test" || process.env.MONGO_URI_TEST) return;

  const dbName = `basicdiet_helper_${process.pid}_${Date.now()}_test`;
  ownedMemoryServer = await MongoMemoryServer.create({
    instance: { dbName },
  });
  previousTestMongoUri = process.env.MONGO_URI_TEST;
  process.env.MONGO_URI_TEST = ownedMemoryServer.getUri(dbName);
}

async function connectDB() {
  if (mongoose.connection.readyState === 0) {
    try {
      await ensureIsolatedTestMongoUri();
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
  if (ownedMemoryServer) {
    await ownedMemoryServer.stop();
    ownedMemoryServer = null;
    if (previousTestMongoUri === undefined) delete process.env.MONGO_URI_TEST;
    else process.env.MONGO_URI_TEST = previousTestMongoUri;
    previousTestMongoUri = undefined;
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
