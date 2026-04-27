require("dotenv").config();

const mongoose = require("mongoose");
const Payment = require("../src/models/Payment");
const User = require("../src/models/User");
const Addon = require("../src/models/Addon");
const BuilderProtein = require("../src/models/BuilderProtein");

const INDEX_DEFINITIONS = [
  {
    model: Payment,
    name: "operationIdempotencyKey_1",
    key: { operationIdempotencyKey: 1 },
    options: {
      unique: true,
      partialFilterExpression: { operationIdempotencyKey: { $type: "string", $ne: "" } },
    },
  },
  {
    model: User,
    name: "email_1_unique_sparse",
    key: { email: 1 },
    options: {
      unique: true,
      sparse: true,
      partialFilterExpression: { email: { $type: "string", $ne: "" } },
    },
  },
  {
    model: Addon,
    name: "kind_1_category_1_isActive_1",
    key: { kind: 1, category: 1, isActive: 1 },
    options: {},
  },
  {
    model: Addon,
    name: "isActive_1_sortOrder_1",
    key: { isActive: 1, sortOrder: 1 },
    options: {},
  },
  {
    model: BuilderProtein,
    name: "isActive_1_isPremium_1_sortOrder_1",
    key: { isActive: 1, isPremium: 1, sortOrder: 1 },
    options: {},
  },
];

async function ensureProductionIndexes() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("ERROR: Missing MONGO_URI or MONGODB_URI environment variable");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(uri);
  console.log("Connected.");

  console.log("\nEnsuring production indexes...\n");

  for (const def of INDEX_DEFINITIONS) {
    const collection = def.model.collection;
    const modelName = def.model.modelName;

    try {
      const existingIndexes = await collection.indexes();
      const existing = existingIndexes.find((idx) => idx.name === def.name);

      if (existing) {
        console.log(`[${modelName}] Index '${def.name}' already exists - skipping`);
        continue;
      }

      console.log(`[${modelName}] Creating index '${def.name}'...`);
      await collection.createIndex(def.key, def.options);
      console.log(`[${modelName}] Created index '${def.name}' successfully`);
    } catch (err) {
      if (err.code === 85 || err.code === 86) {
        console.warn(`[${modelName}] Index creation failed: duplicate key error - ${err.message}`);
      } else {
        console.error(`[${modelName}] Index creation failed: ${err.message}`);
      }
    }
  }

  console.log("\nVerifying indexes...");

  for (const def of INDEX_DEFINITIONS) {
    const collection = def.model.collection;
    const modelName = def.model.modelName;
    const indexes = await collection.indexes();
    const exists = indexes.some((idx) => idx.name === def.name);

    if (exists) {
      console.log(`[${modelName}] '${def.name}': OK`);
    } else {
      console.warn(`[${modelName}] '${def.name}': MISSING`);
    }
  }

  await mongoose.disconnect();
  console.log("\nDone.");
}

ensureProductionIndexes().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});