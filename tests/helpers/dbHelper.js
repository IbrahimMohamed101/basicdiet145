const mongoose = require("mongoose");
const { logger } = require("../../src/utils/logger");

async function connectDB() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("FATAL: MONGO_URI is not defined in environment variables.");
    process.exit(1);
  }

  if (mongoose.connection.readyState === 0) {
    try {
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
      });
      // logger.info("Connected to test database");
    } catch (err) {
      console.error("Failed to connect to MongoDB", err);
      process.exit(1);
    }
  }
}

async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

async function resetDB() {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    await mongoose.connection.db.dropDatabase();
  }
}

module.exports = {
  connectDB,
  disconnectDB,
  resetDB,
};
