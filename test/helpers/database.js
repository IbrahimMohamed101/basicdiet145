const mongoose = require("mongoose");

function getDatabaseUri() {
  return process.env.MONGO_URI || process.env.MONGODB_URI;
}

async function connectDatabase() {
  if (mongoose.connection.readyState === 1) {
    return true;
  }

  const uri = getDatabaseUri();
  if (!uri) {
    console.warn("Database URI not configured for tests. Set MONGO_URI or MONGODB_URI.");
    return false;
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 1000,
      connectTimeoutMS: 1000,
    });
    return true;
  } catch (error) {
    console.warn("Database connection unavailable in test environment:", error.message);
    return false;
  }
}

async function ensureConnected() {
  if (mongoose.connection.readyState === 1) {
    return true;
  }

  return connectDatabase();
}

async function clearDatabase() {
  const connected = await ensureConnected();
  if (!connected) {
    return;
  }

  const collections = mongoose.connection.collections;
  const collectionKeys = Object.keys(collections);
  for (const key of collectionKeys) {
    const collection = collections[key];
    try {
      await collection.deleteMany({});
    } catch (error) {
      console.warn(`Failed to clear collection ${key}:`, error.message);
    }
  }
}

async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

async function seedDatabase() {
  // implement seeded fixtures if needed
  return;
}

module.exports = {
  connectDatabase,
  ensureConnected,
  clearDatabase,
  disconnectDatabase,
  seedDatabase,
};

