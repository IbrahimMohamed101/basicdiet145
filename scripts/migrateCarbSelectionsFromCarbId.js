require("dotenv").config();
const mongoose = require("mongoose");
const { connectDb } = require("../src/db");
const SubscriptionDay = require("../src/models/SubscriptionDay");

async function migrate() {
  const isDryRun = process.argv.includes("--dry-run");

  try {
    await connectDb();
    console.log(`Connected to DB. Mode: ${isDryRun ? "DRY RUN" : "WRITE"}`);

    const days = await SubscriptionDay.find({
      "mealSlots.carbId": { $ne: null },
      $or: [
        { "mealSlots.carbSelections": { $exists: false } },
        { "mealSlots.carbSelections": { $size: 0 } },
      ]
    });

    console.log(`Found ${days.length} days with un-migrated carb selections.`);

    if (days.length === 0) {
      console.log("Nothing to migrate. Exiting.");
      process.exit(0);
    }

    let modifiedCount = 0;
    const bulkOps = [];

    for (const day of days) {
      let changed = false;
      
      const newMealSlots = day.mealSlots.map(slot => {
        if (slot.carbId && (!Array.isArray(slot.carbSelections) || slot.carbSelections.length === 0)) {
          slot.carbSelections = [{
            carbId: slot.carbId,
            grams: 300
          }];
          changed = true;
          modifiedCount++;
        }
        return slot;
      });

      if (changed) {
        bulkOps.push({
          updateOne: {
            filter: { _id: day._id },
            update: { $set: { mealSlots: newMealSlots } }
          }
        });
      }
    }

    if (isDryRun) {
      console.log(`[DRY RUN] Would update ${days.length} days, migrating ${modifiedCount} total individual slots.`);
      console.log(`[DRY RUN] First 2 bulk operations would be:\n`, JSON.stringify(bulkOps.slice(0, 2), null, 2));
    } else {
      if (bulkOps.length > 0) {
        // Execute in batches to prevent hitting BSON size limits
        const BATCH_SIZE = 500;
        let totalUpdated = 0;
        
        for (let i = 0; i < bulkOps.length; i += BATCH_SIZE) {
          const batch = bulkOps.slice(i, i + BATCH_SIZE);
          const result = await SubscriptionDay.bulkWrite(batch);
          totalUpdated += result.modifiedCount;
          console.log(`Processed batch ${Math.floor(i / BATCH_SIZE) + 1}... Updated ${result.modifiedCount} days.`);
        }
        
        console.log(`[SUCCESS] Migrated ${totalUpdated} days total, touching roughly ${modifiedCount} individual slots.`);
      } else {
        console.log("No valid operations to run.");
      }
    }
    
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

migrate();
