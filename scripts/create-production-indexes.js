require("dotenv").config();

const mongoose = require("mongoose");
const Payment = require("../src/models/Payment");
const User = require("../src/models/User");
const Addon = require("../src/models/Addon");
const BuilderProtein = require("../src/models/BuilderProtein");
const ActivityLog = require("../src/models/ActivityLog");
const EmailOtpChallenge = require("../src/models/EmailOtpChallenge");

const INDEX_DEFINITIONS = [
  {
    model: Payment,
    name: "operationIdempotencyKey_1",
    key: { operationIdempotencyKey: 1 },
    options: {
      unique: true,
      partialFilterExpression: { operationIdempotencyKey: { $type: "string", $gt: "" } },
    },
  },
  {
    model: User,
    name: "email_1_unique_sparse",
    key: { email: 1 },
    options: {
      unique: true,
      partialFilterExpression: { email: { $type: "string", $gt: "" } },
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
  {
    model: ActivityLog,
    name: "delivery_manual_subscription_deduction_once_per_day",
    key: { entityType: 1, action: 1, entityId: 1, "meta.businessDate": 1 },
    options: {
      unique: true,
      partialFilterExpression: {
        entityType: "subscription",
        action: "manual_subscription_meal_deduction",
        "meta.fulfillmentMethod": "delivery",
      },
    },
  },
  {
    model: EmailOtpChallenge,
    name: "challengeId_1",
    key: { challengeId: 1 },
    options: { unique: true },
  },
  {
    model: EmailOtpChallenge,
    name: "lookupKey_1",
    key: { lookupKey: 1 },
    options: { unique: true },
  },
  {
    model: EmailOtpChallenge,
    name: "cleanupAt_1",
    key: { cleanupAt: 1 },
    options: { expireAfterSeconds: 0 },
  },
  {
    model: EmailOtpChallenge,
    name: "resetTokenHash_1",
    key: { resetTokenHash: 1 },
    options: {
      unique: true,
      partialFilterExpression: { resetTokenHash: { $type: "string", $gt: "" } },
    },
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
      let existingIndexes = [];
      try {
        existingIndexes = await collection.indexes();
      } catch (err) {
        // The new OTP collection does not exist before first deployment.
        // createIndex below creates it atomically; all other errors still fail.
        if (err.code !== 26) throw err;
      }
      const existing = existingIndexes.find((idx) => idx.name === def.name);

      if (existing) {
        console.log(`[${modelName}] Index '${def.name}' already exists - skipping`);
        continue;
      }

      console.log(`[${modelName}] Creating index '${def.name}'...`);
      await collection.createIndex(def.key, { ...def.options, name: def.name });
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
