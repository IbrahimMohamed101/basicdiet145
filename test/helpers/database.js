const mongoose = require("mongoose");

async function ensureConnected() {
  if (mongoose.connection.readyState === 1) {
    return true;
  }

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    return false;
  }

  try {
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 1000,
      connectTimeoutMS: 1000,
    });
    return true;
  } catch (error) {
    console.warn("Database connection unavailable in test environment:", error.message);
    return false;
  }
}

async function clearDatabase() {
  const connected = await ensureConnected();
  if (!connected) {
    // No DB configured in this environment, skip cleanup.
    return;
  }

  const collections = mongoose.connection.collections;
  for (const key in collections) {
    if (Object.prototype.hasOwnProperty.call(collections, key)) {
      await collections[key].deleteMany({});
    }
  }
}

async function seedDatabase() {
  // implement seeded fixtures if needed
  // currently no default load behavior (stubbed to satisfy imports)
  return;
}

module.exports = {
  clearDatabase,
  seedDatabase,
};
