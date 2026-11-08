"use strict";
// Only synthetic fixtures; no Production connection, customer details or values printed.
const assert = require("node:assert/strict");
const { MongoClient } = require("mongodb");
const { safety } = require("./g2-mongo-manifest");
async function main() {
  if (process.env.G2_EXECUTION_SCOPE !== "ci-disposable") throw Error("G2_SYNTHETIC_ONLY");
  const { db: name, uri } = safety();
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(name);
    await db.collection("subscriptions").insertMany([
      { _id: "fixture-sub-001", durationDays: 7, mealsRemaining: 3 },
      { _id: "fixture-sub-002", durationDays: 26, mealsRemaining: 11 },
    ]);
    await db.collection("subscriptions").createIndex({ subscriptionKey: 1 }, { unique: true });
    await db.collection("payments").insertMany([
      { _id: "fixture-pay-001", providerPaymentId: "fixture-provider-001", amountHalala: 12500 },
      { _id: "fixture-pay-002", providerPaymentId: "fixture-provider-002", amountHalala: 25200 },
    ]);
    await db.collection("payments").createIndex({ providerPaymentId: 1 }, { unique: true });
    await db.collection("pos_invoices").insertOne({ _id: "fixture-invoice-001", grossHalala: 12500 });
    await db.collection("pos_invoices").createIndex({ invoiceKey: 1 }, { unique: true });
    await assert.rejects(() => db.collection("payments").insertOne({
      _id: "fixture-pay-duplicate", providerPaymentId: "fixture-provider-001",
    }), e => e.code === 11000, "unique payment index must reject duplicates");
    process.stdout.write("G2_SYNTHETIC_FIXTURE_COUNTS=5; UNIQUE_INDEXES=3\n");
  } finally { await client.close(); }
}
main().catch(e => { process.stderr.write("G2_SYNTHETIC_SEED_FAILED\n"); process.exitCode = 1; });
