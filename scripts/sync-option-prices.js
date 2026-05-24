#!/usr/bin/env node

require("dotenv").config();
const mongoose = require("mongoose");
const MenuOption = require("../src/models/MenuOption");

const uri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet";

async function syncOptionPrices() {
  await mongoose.connect(uri);
  console.log(`Connected to MongoDB: ${uri}`);

  const options = await MenuOption.find({});
  let syncedCount = 0;
  let skippedCount = 0;
  const conflicts = [];

  for (const option of options) {
    const p = option.extraPriceHalala || 0;
    const f = option.extraFeeHalala || 0;

    if (p === f) {
      skippedCount++;
      continue;
    }

    if (p > 0 && f === 0) {
      // Sync p -> f
      option.extraFeeHalala = p;
      await option.save();
      syncedCount++;
    } else if (f > 0 && p === 0) {
      // Sync f -> p
      option.extraPriceHalala = f;
      await option.save();
      syncedCount++;
    } else if (p > 0 && f > 0 && p !== f) {
      // Conflict
      conflicts.push({
        id: option._id,
        name: option.name.en || option.name.ar || option.key,
        extraPriceHalala: p,
        extraFeeHalala: f,
      });
    } else {
      skippedCount++;
    }
  }

  console.log("\n=== Sync Report ===");
  console.log(`Total options processed: ${options.length}`);
  console.log(`Successfully synced: ${syncedCount}`);
  console.log(`Skipped (already equal or both zero): ${skippedCount}`);
  console.log(`Conflicts found: ${conflicts.length}`);

  if (conflicts.length > 0) {
    console.log("\n=== CONFLICTS (Manual resolution required) ===");
    for (const c of conflicts) {
      console.log(`Option: ${c.name} (${c.id})`);
      console.log(`  extraPriceHalala: ${c.extraPriceHalala}`);
      console.log(`  extraFeeHalala: ${c.extraFeeHalala}`);
    }
  }

  await mongoose.disconnect();
  console.log("\nDone");
}

syncOptionPrices().catch((err) => {
  console.error(err);
  process.exit(1);
});
