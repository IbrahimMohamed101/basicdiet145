const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const BuilderProtein = require("../../models/BuilderProtein");
const { resolvePremiumKeyFromName, CANONICAL_PREMIUM_KEYS } = require("../../utils/subscription/premiumIdentity");
const { logger } = require("../../utils/logger");

async function backfillPremiumKeys() {
  console.log("Starting backfill for premiumBalance.premiumKey...");

  // Load all premium proteins to build a lookup map
  const premiumProteins = await BuilderProtein.find({ isPremium: true }).select("_id name premiumKey").lean();
  const proteinMap = new Map();
  premiumProteins.forEach(p => {
    proteinMap.set(String(p._id), p);
  });

  const subscriptions = await Subscription.find({
    "premiumBalance.premiumKey": null
  });

  console.log(`Found ${subscriptions.length} subscriptions requiring backfill.`);

  let totalUpdated = 0;
  let totalRowsFixed = 0;

  for (const sub of subscriptions) {
    let subModified = false;
    
    for (const row of sub.premiumBalance) {
      if (row.premiumKey === null || row.premiumKey === undefined) {
        const proteinId = String(row.proteinId);
        const catalogItem = proteinMap.get(proteinId);
        
        let resolvedKey = null;
        
        // 1. Try from catalog
        if (catalogItem && catalogItem.premiumKey) {
          resolvedKey = catalogItem.premiumKey;
        }
        
        // 2. Try inferring from name in catalog
        if (!resolvedKey && catalogItem && catalogItem.name) {
          const name = catalogItem.name.en || catalogItem.name.ar || "";
          resolvedKey = resolvePremiumKeyFromName(name);
        }
        
        if (resolvedKey && CANONICAL_PREMIUM_KEYS.includes(resolvedKey)) {
          row.premiumKey = resolvedKey;
          subModified = true;
          totalRowsFixed++;
        } else {
          console.warn(`Could not resolve premiumKey for proteinId: ${proteinId} in subscription ${sub._id}`);
        }
      }
    }
    
    if (subModified) {
      await sub.save();
      totalUpdated++;
    }
  }

  console.log(`Done. Updated ${totalUpdated} subscriptions. Fixed ${totalRowsFixed} rows.`);
}

// Support running directly or importing
if (require.main === module) {
  require("dotenv").config();
  const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/basicdiet";
  
  mongoose.connect(MONGO_URI)
    .then(async () => {
      console.log("Connected to MongoDB");
      await backfillPremiumKeys();
      process.exit(0);
    })
    .catch(err => {
      console.error("Failed to connect to MongoDB", err);
      process.exit(1);
    });
}

module.exports = { backfillPremiumKeys };
