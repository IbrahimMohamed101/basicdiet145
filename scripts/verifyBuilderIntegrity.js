require("dotenv").config();
const mongoose = require("mongoose");
const BuilderProtein = require("../src/models/BuilderProtein");
const BuilderCarb = require("../src/models/BuilderCarb");

async function verify() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGO_URL);
  const db = mongoose.connection.db;

  console.log("=== Verification Report ===\n");

  // 1. Check counts
  const carbCount = await BuilderCarb.countDocuments({});
  const proteinCount = await BuilderProtein.countDocuments({});
  const standardProteins = await BuilderProtein.countDocuments({ isPremium: false });
  const premiumProteins = await BuilderProtein.countDocuments({ isPremium: true });

  console.log(`BuilderCarb count: ${carbCount} (Expected: 9)`);
  console.log(`BuilderProtein total: ${proteinCount} (Expected: 18)`);
  console.log(`Standard proteins: ${standardProteins} (Expected: 15)`);
  console.log(`Premium proteins: ${premiumProteins} (Expected: 3)`);

  // 2. Check for custom_premium_salad in DB
  const saladInDb = await BuilderProtein.findOne({ premiumKey: "custom_premium_salad" });
  console.log(`custom_premium_salad in DB? ${!!saladInDb} (Expected: false)`);

  // 3. Check for specific premium records
  const premiumKeys = ["beef_steak", "salmon", "shrimp"];
  for (const key of premiumKeys) {
    const doc = await BuilderProtein.findOne({ premiumKey: key });
    console.log(`- ${key}: ${doc ? "Found" : "MISSING"} | isPremium: ${doc?.isPremium}`);
  }

  // 4. Check for null keys or premiumKeys that should be absent
  const proteinsWithNullKey = await BuilderProtein.countDocuments({ key: null });
  const proteinsWithNullPK = await BuilderProtein.countDocuments({ premiumKey: null });
  // Note: documents where the field is absent are NOT matched by { key: null } in recent Mongo/Mongoose versions usually,
  // but let's check for explicit nulls specifically.
  console.log(`Proteins with explicit key: null: ${proteinsWithNullKey} (Expected: 0)`);
  console.log(`Proteins with explicit premiumKey: null: ${proteinsWithNullPK} (Expected: 0)`);

  // 5. Check Indexes
  const bpIndexes = await db.collection("builderproteins").indexes();
  const bcIndexes = await db.collection("buildercarbs").indexes();

  console.log("\n=== BuilderProtein Index Audit ===");
  const pkIndex = bpIndexes.find(idx => idx.key.premiumKey === 1);
  const kIndex = bpIndexes.find(idx => idx.key.key === 1);

  if (pkIndex) {
    console.log("premiumKey index found:", JSON.stringify(pkIndex));
    const isPartial = !!pkIndex.partialFilterExpression;
    const isUnique = !!pkIndex.unique;
    console.log(`- Unique: ${isUnique} (Expected: true)`);
    console.log(`- Partial: ${isPartial} (Expected: true)`);
  } else {
    console.log("CRITICAL: premiumKey index MISSING");
  }

  if (kIndex) {
    console.log("key index found:", JSON.stringify(kIndex));
    const isPartial = !!kIndex.partialFilterExpression;
    const isUnique = !!kIndex.unique;
    console.log(`- Unique: ${isUnique} (Expected: true)`);
    console.log(`- Partial: ${isPartial} (Expected: true)`);
  } else {
    console.log("key index NOT found in BuilderProtein (May be okay if unused)");
  }

  console.log("\n=== BuilderCarb Index Audit ===");
  const carbKIndex = bcIndexes.find(idx => idx.key.key === 1);
  if (carbKIndex) {
    console.log("key index found:", JSON.stringify(carbKIndex));
    const isPartial = !!carbKIndex.partialFilterExpression;
    console.log(`- Partial: ${isPartial} (Expected: true)`);
  } else {
    console.log("CRITICAL: key index MISSING in BuilderCarb");
  }

  await mongoose.disconnect();
  console.log("\nVerification complete");
}

verify().catch(console.error);
