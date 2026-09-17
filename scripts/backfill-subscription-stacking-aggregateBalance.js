#!/usr/bin/env node
"use strict";

require("dotenv").config();
const { MongoClient, ObjectId } = require("mongodb");

const uri = process.env.MONGO_URI || process.env.MONGO_URI_TEST || "mongodb://localhost:27017";
const dbName = process.env.MONGO_DB || process.env.MONGO_DB_TEST || "basicdiet145";
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

async function main() {
  console.log(`Connecting to ${uri} / db=${dbName}`);
  const client = new MongoClient(uri, { useUnifiedTopology: true });
  await client.connect();
  try {
    const db = client.db(dbName);
    const subs = db.collection("subscriptions");

    const cursor = subs.find({ $or: [{ "stacking.aggregateBalance": { $exists: false } }, { "stacking.aggregateBalance": null }] });
    let processed = 0;
    let updated = 0;
    while (await cursor.hasNext()) {
      const sub = await cursor.next();
      processed += 1;

      const premiumSum = Array.isArray(sub.premiumBalance)
        ? sub.premiumBalance.reduce((s, r) => s + Math.max(0, Number(r && r.remainingQty) || 0), 0)
        : 0;
      const addonSum = Array.isArray(sub.addonBalance)
        ? sub.addonBalance.reduce((s, r) => s + Math.max(0, Number(r && r.remainingQty) || 0), 0)
        : 0;

      let remaining = null;
      if (typeof sub.remainingMeals === "number") {
        remaining = Math.max(0, Math.floor(sub.remainingMeals));
      } else {
        // fallback: premium + addon remaining
        remaining = Math.max(0, premiumSum + addonSum);
      }

      if (!force && remaining === 0) {
        // skip empty balances by default
        continue;
      }

      console.log(`Will set subscription ${sub._id} stacking.aggregateBalance = ${remaining}`);
      if (!dryRun) {
        const res = await subs.updateOne({ _id: sub._id }, { $set: { stacking: { aggregateBalance: remaining } } });
        if (res.modifiedCount > 0) updated += 1;
      }
    }

    console.log(`Processed ${processed} subscriptions. Updated ${updated} documents. dryRun=${dryRun} force=${force}`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
