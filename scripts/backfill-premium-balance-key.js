const mongoose = require("mongoose");
const BuilderProtein = require("../src/models/BuilderProtein");
const Subscription = require("../src/models/Subscription");
const { resolvePremiumKeyFromName, CANONICAL_PREMIUM_KEYS } = require("../src/utils/subscription/premiumIdentity");
const { logger } = require("../src/utils/logger");
require("../src/db");

async function backfillPremiumBalanceKeys() {
  console.log("=== Starting Backfill: premiumBalance.premiumKey ===");

  const subscriptions = await Subscription.find({
    "premiumBalance": { $exists: true, $ne: [] },
  });

  console.log(`Found ${subscriptions.length} subscriptions with premiumBalance.`);

  const catalogProteins = await BuilderProtein.find({ isPremium: true }).lean();
  const catalogMap = new Map();
  catalogProteins.forEach(p => {
    if (p.premiumKey) {
      catalogMap.set(String(p._id), p.premiumKey);
    }
  });

  let subUpdatedCount = 0;
  let rowsUpdatedCount = 0;

  for (const sub of subscriptions) {
    let subModified = false;
    
    for (let i = 0; i < sub.premiumBalance.length; i++) {
      const row = sub.premiumBalance[i];
      
      if (!row.premiumKey) {
        // Attempt 1: From proteinId via catalog
        let resolvedKey = catalogMap.get(String(row.proteinId));
        
        // Attempt 2: From name fallback mapping
        if (!resolvedKey) {
          resolvedKey = resolvePremiumKeyFromName(row.name);
        }

        if (resolvedKey && CANONICAL_PREMIUM_KEYS.includes(resolvedKey)) {
          console.log(`  [UPDATE] Sub: ${sub._id} | Row: ${i} | ProteinId: ${row.proteinId} | Name: ${row.name} -> Key: ${resolvedKey}`);
          sub.premiumBalance[i].premiumKey = resolvedKey;
          subModified = true;
          rowsUpdatedCount++;
        } else {
          console.warn(`  [SKIP] Could not resolve premiumKey for Sub: ${sub._id} | Row: ${i} | ProteinId: ${row.proteinId} | Name: ${row.name}`);
        }
      }
    }

    if (subModified) {
      await sub.save();
      subUpdatedCount++;
    }
  }

  console.log("\n=== Backfill Summary ===");
  console.log(`Subscriptions updated: ${subUpdatedCount}`);
  console.log(`Total rows updated: ${rowsUpdatedCount}`);
}

async function main() {
  try {
    await backfillPremiumBalanceKeys();
    console.log("Migration finished successfully.");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

main();
