const mongoose = require("mongoose");
const BuilderProtein = require("../src/models/BuilderProtein");
const Subscription = require("../src/models/Subscription");
require("../src/db");

const PREMIUM_KEY_MAP = {
  "جمبري": "shrimp",
  "shrimp": "shrimp",
  "gambari": "shrimp",
  "ستيك لحم": "beef_steak",
  "beef steak": "beef_steak",
  "steak": "beef_steak",
  "سالمون": "salmon",
  "salmon": "salmon",
  "سمك سالمون": "salmon",
  "دجاج": "chicken",
  "chicken": "chicken",
  "لحم": "beef",
  "beef": "beef",
  " Meatballs": "meatballs",
  "كفتة": "meatballs",
  " Beef Stroganoff": "beef_stroganoff",
};

function generatePremiumKeyFromName(name) {
  if (!name) return null;
  const nameStr = typeof name === "object" ? (name.ar || name.en || "") : String(name);
  const normalized = nameStr.toLowerCase().trim().replace(/\s+/g, " ");

  const direct = PREMIUM_KEY_MAP[normalized];
  if (direct) return direct;

  if (normalized.includes("جمبري") || normalized.includes("shrimp") || normalized.includes("gambari")) {
    return "shrimp";
  }
  if (normalized.includes("ستيك") || normalized.includes("steak") || normalized.includes("beef steak")) {
    return "beef_steak";
  }
  if (normalized.includes("سالمون") || normalized.includes("salmon")) {
    return "salmon";
  }
  if (normalized.includes("دجاج") || normalized.includes("chicken")) {
    return "chicken";
  }
  if (normalized.includes("كفتة") || normalized.includes("meatball")) {
    return "meatballs";
  }
  if (normalized.includes("ستروغانوف") || normalized.includes("stroganoff")) {
    return "beef_stroganoff";
  }

  return null;
}

async function backfillCatalogPremiumKeys() {
  console.log("=== Step 1: Backfill premiumKey for BuilderProtein catalog ===");

  const premiumProteins = await BuilderProtein.find({ isPremium: true }).lean();
  console.log(`Found ${premiumProteins.length} premium proteins in catalog`);

  let updated = 0;
  for (const protein of premiumProteins) {
    const currentKey = protein.premiumKey;
    if (currentKey) {
      console.log(`  [SKIP] ${protein._id} already has premiumKey: ${currentKey}`);
      continue;
    }

    const generatedKey = generatePremiumKeyFromName(protein.name);
    if (!generatedKey) {
      console.log(`  [WARN] Could not generate premiumKey for protein: ${protein._id}`);
      continue;
    }

    const existingWithKey = await BuilderProtein.findOne({ premiumKey: generatedKey });
    if (existingWithKey) {
      console.log(`  [WARN] premiumKey '${generatedKey}' already exists for protein: ${existingWithKey._id}, skipping ${protein._id}`);
      continue;
    }

    await BuilderProtein.findByIdAndUpdate(protein._id, { premiumKey: generatedKey });
    console.log(`  [OK] Set premiumKey='${generatedKey}' for protein ${protein._id}`);
    updated++;
  }

  console.log(`Updated ${updated} premium proteins`);
}

async function backfillPremiumBalanceKeys() {
  console.log("\n=== Step 2: Backfill premiumKey for Subscription.premiumBalance ===");

  const subscriptions = await Subscription.find({
    "premiumBalance": { $exists: true, $ne: [] },
  }).lean();

  console.log(`Found ${subscriptions.length} subscriptions with premiumBalance`);

  const catalogMap = new Map();
  const allPremiumProteins = await BuilderProtein.find({ isPremium: true, premiumKey: { $ne: null } }).lean();
  for (const p of allPremiumProteins) {
    catalogMap.set(String(p._id), p.premiumKey);
  }

  let totalUpdated = 0;

  for (const sub of subscriptions) {
    const balance = sub.premiumBalance || [];
    const updates = [];

    for (let i = 0; i < balance.length; i++) {
      const row = balance[i];
      if (row.premiumKey) {
        continue;
      }

      const proteinIdStr = String(row.proteinId);
      const mappedKey = catalogMap.get(proteinIdStr);

      if (mappedKey) {
        updates.push({ index: i, premiumKey: mappedKey });
      } else {
        const generatedKey = generatePremiumKeyFromName(row.name);
        if (generatedKey) {
          updates.push({ index: i, premiumKey: generatedKey });
        }
      }
    }

    if (updates.length > 0) {
      for (const upd of updates) {
        await Subscription.updateOne(
          { _id: sub._id, "premiumBalance.proteinId": balance[upd.index].proteinId },
          { $set: { "premiumBalance.$.premiumKey": upd.premiumKey } }
        );
      }
      console.log(`  [OK] Updated ${updates.length} rows for subscription ${sub._id}`);
      totalUpdated += updates.length;
    }
  }

  console.log(`Updated ${totalUpdated} premiumBalance rows`);
}

async function main() {
  try {
    console.log("Starting premiumKey backfill migration...\n");
    await backfillCatalogPremiumKeys();
    await backfillPremiumBalanceKeys();
    console.log("\n=== Migration complete ===");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

main();