require("dotenv").config();
const mongoose = require("mongoose");
const BuilderProtein = require("../src/models/BuilderProtein");
const BuilderCarb = require("../src/models/BuilderCarb");

const MONGO_URI = process.env.MONGO_URI || process.env.MONGO_URL;

async function repair() {
  if (!MONGO_URI) {
    throw new Error("MONGO_URI or MONGO_URL not set");
  }

  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB for repair");

  const db = mongoose.connection.db;

  // 1. Remove custom_premium_salad from BuilderProtein
  console.log("Cleaning up custom_premium_salad...");
  const saladResult = await BuilderProtein.deleteMany({ premiumKey: "custom_premium_salad" });
  console.log(`Deleted ${saladResult.deletedCount} instances of custom_premium_salad from BuilderProtein`);

  // 2. Remove premiumKey: null or premiumKey: "" from records to allow partial index
  console.log("Cleaning up premiumKey fields...");
  const pkCleanup = await BuilderProtein.updateMany(
    { $or: [{ premiumKey: null }, { premiumKey: "" }, { premiumKey: { $exists: false }, isPremium: false }] },
    { $unset: { premiumKey: "" } }
  );
  console.log(`Unset premiumKey in ${pkCleanup.modifiedCount} records`);

  // 3. Remove key: null or key: "" from BuilderProtein and BuilderCarb
  console.log("Cleaning up key fields in BuilderProtein...");
  const proteinKeyCleanup = await BuilderProtein.updateMany(
    { $or: [{ key: null }, { key: "" }] },
    { $unset: { key: "" } }
  );
  console.log(`Unset key in ${proteinKeyCleanup.modifiedCount} proteins`);

  console.log("Cleaning up key fields in BuilderCarb...");
  const carbKeyCleanup = await BuilderCarb.updateMany(
    { $or: [{ key: null }, { key: "" }] },
    { $unset: { key: "" } }
  );
  console.log(`Unset key in ${carbKeyCleanup.modifiedCount} carbs`);

  // 4. Drop old indexes to allow Mongoose to recreate them
  console.log("Dropping old indexes...");
  try {
    await db.collection("builderproteins").dropIndex("premiumKey_1");
    console.log("Dropped index: builderproteins.premiumKey_1");
  } catch (e) {
    console.log("Index premiumKey_1 not found or already dropped");
  }

  try {
    await db.collection("builderproteins").dropIndex("key_1");
    console.log("Dropped index: builderproteins.key_1");
  } catch (e) {
    console.log("Index key_1 not found or already dropped");
  }

  try {
    await db.collection("buildercarbs").dropIndex("key_1");
    console.log("Dropped index: buildercarbs.key_1");
  } catch (e) {
    console.log("Index buildercarbs.key_1 not found or already dropped");
  }

  console.log("Syncing indexes...");
  await BuilderProtein.syncIndexes();
  await BuilderCarb.syncIndexes();
  console.log("Indexes synced");

  await mongoose.disconnect();
  console.log("Repair finished successfully");
}

repair().catch(err => {
  console.error("Repair failed:", err);
  process.exit(1);
});
