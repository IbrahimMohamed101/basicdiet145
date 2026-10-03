#!/usr/bin/env node
"use strict";

require("dotenv").config();
const { MongoClient } = require("mongodb");

const uri = process.env.MONGO_URI || process.env.MONGO_URI_TEST || "mongodb://localhost:27017";
const dbName = process.env.MONGO_DB || process.env.MONGO_DB_TEST || "basicdiet145";
const dryRun = process.argv.includes("--dry-run");

function normalizeCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function buildAggregateFromBatches(batches) {
  return batches.reduce(
    (summary, batch) => {
      summary.totalMeals += normalizeCount(batch.totalMeals);
      summary.remainingMeals += normalizeCount(batch.remainingMeals);
      summary.reservedMeals += normalizeCount(batch.reservedMeals);
      summary.consumedMeals += normalizeCount(batch.consumedMeals);
      summary.forfeitedMeals += normalizeCount(batch.forfeitedMeals);
      return summary;
    },
    {
      totalMeals: 0,
      remainingMeals: 0,
      reservedMeals: 0,
      consumedMeals: 0,
      forfeitedMeals: 0,
    }
  );
}

async function main() {
  console.log(`Connecting to ${uri} / db=${dbName}`);
  const client = new MongoClient(uri, { useUnifiedTopology: true });
  await client.connect();

  try {
    const db = client.db(dbName);
    const subs = db.collection("subscriptions");
    const batches = db.collection("subscriptionentitlementbatches");

    const cursor = subs.find({
      $or: [
        { "stacking.aggregateBalance": { $exists: false } },
        { "stacking.aggregateBalance": null },
        { "stacking.aggregateBalance": { $type: "number" } },
      ],
    });

    let processed = 0;
    let updated = 0;

    while (await cursor.hasNext()) {
      const sub = await cursor.next();
      processed += 1;

      const batchRows = await batches.find({
        containerSubscriptionId: sub._id,
        status: { $in: ["paid_scheduled", "active", "exhausted", "expired", "canceled"] },
      }).sort({ effectiveStartDate: 1, createdAt: 1, _id: 1 }).toArray();

      const aggregate = batchRows.length > 0
        ? buildAggregateFromBatches(batchRows)
        : {
            totalMeals: normalizeCount(sub.totalMeals),
            remainingMeals: normalizeCount(sub.remainingMeals),
            reservedMeals: normalizeCount(sub.reservedMeals),
            consumedMeals: normalizeCount(sub.consumedMeals),
            forfeitedMeals: normalizeCount(sub.forfeitedMeals),
          };

      // Never write an empty synthetic balance for a subscription with no source
      // data. Preserve such rows for manual review.
      if (aggregate.totalMeals <= 0) continue;

      const patch = {
        "stacking.aggregateBalance": aggregate,
        "stacking.hasEntitlementBatches": batchRows.length > 0,
        "stacking.isCombinedPackage": batchRows.length > 1,
        "stacking.packageCount": batchRows.length,
      };

      console.log(
        `Will set subscription ${sub._id} stacking.aggregateBalance=${JSON.stringify(aggregate)}`
      );

      if (!dryRun) {
        const result = await subs.updateOne({ _id: sub._id }, { $set: patch });
        if (result.modifiedCount > 0) updated += 1;
      }
    }

    console.log(
      `Processed ${processed} subscriptions. Updated ${updated} documents. dryRun=${dryRun}`
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
