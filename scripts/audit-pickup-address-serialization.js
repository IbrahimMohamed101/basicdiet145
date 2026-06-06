#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");

const CheckoutDraft = require("../src/models/CheckoutDraft");
const Subscription = require("../src/models/Subscription");

const SENTINEL = "[object Object]";

async function countAffected(Model, paths) {
  const counts = {};
  for (const path of paths) {
    counts[path] = await Model.countDocuments({ [path]: SENTINEL });
  }
  counts.any = await Model.countDocuments({
    $or: paths.map((path) => ({ [path]: SENTINEL })),
  });
  return counts;
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Missing MongoDB connection string (set MONGO_URI or MONGODB_URI)");
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const [subscriptions, checkoutDrafts] = await Promise.all([
    countAffected(Subscription, [
      "deliveryAddress.line1",
      "contractSnapshot.delivery.address.line1",
    ]),
    countAffected(CheckoutDraft, [
      "delivery.address.line1",
      "contractSnapshot.delivery.address.line1",
    ]),
  ]);

  console.log(JSON.stringify({
    sentinel: SENTINEL,
    subscriptions,
    checkoutDrafts,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
