const mongoose = require("mongoose");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "../.env") });

const BuilderProtein = require("../src/models/BuilderProtein");
const MenuOption = require("../src/models/MenuOption");
const MenuProduct = require("../src/models/MenuProduct");
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");
const Meal = require("../src/models/Meal");
const { resolvePremiumLargeSaladPricing } = require("../src/services/catalog/premiumLargeSaladPricingService");
const {
  PREMIUM_LARGE_SALAD_KEY,
  resolvePremiumKeyFromName,
} = require("../src/utils/subscription/premiumIdentity");

async function backfillPremiumUpgrades() {
  console.log("Starting Premium Upgrade Config backfill...");

  const proteins = await BuilderProtein.find({ isPremium: true, isActive: true });
  console.log(`Found ${proteins.length} active premium proteins.`);

  let createdCount = 0;
  let skippedCount = 0;
  let mealIdentityBackfilledCount = 0;
  const unresolvedSources = [];
  const priceDiscrepancies = [];

  for (const protein of proteins) {
    const premiumKey = protein.premiumKey || protein.key;
    if (!premiumKey) {
      console.warn(`Protein ${protein._id} has no premiumKey, skipping.`);
      skippedCount++;
      continue;
    }

    const existing = await PremiumUpgradeConfig.findOne({ premiumKey });
    if (existing) {
      if (Number(existing.upgradeDeltaHalala || 0) !== Number(protein.extraFeeHalala || 0)) {
        priceDiscrepancies.push({
          premiumKey,
          legacyPriceHalala: Number(protein.extraFeeHalala || 0),
          configPriceHalala: Number(existing.upgradeDeltaHalala || 0),
        });
      }
      console.log(`Config for ${premiumKey} already exists. Skipping.`);
      skippedCount++;
      continue;
    }

    // Attempt to find matching MenuOption
    const option = await MenuOption.findOne({ key: premiumKey, isActive: true });
    if (!option) {
      console.warn(`Could not find active MenuOption for ${premiumKey}. Skipping.`);
      unresolvedSources.push({ premiumKey, sourceType: "menu_option" });
      skippedCount++;
      continue;
    }

    const config = new PremiumUpgradeConfig({
      sourceType: "menu_option",
      sourceId: option._id,
      selectionType: "premium_meal",
      premiumKey,
      displayGroupKey: "premium",
      upgradeDeltaHalala: protein.extraFeeHalala || 0,
      isEnabled: true,
      isVisible: true,
      status: "active",
      sourceSnapshot: {
        key: option.key,
        name: option.name,
        context: {}
      }
    });

    await config.save();
    console.log(`Created config for ${premiumKey} with delta ${config.upgradeDeltaHalala} halala.`);
    createdCount++;
  }

  // Compatibility migration only: convert legacy Flutter meal IDs to the
  // premiumKey consumed by canonical pricing. Runtime code never infers price
  // or eligibility from these legacy rows.
  const legacyPremiumMeals = await Meal.find({
    type: "premium",
    $or: [{ premiumKey: null }, { premiumKey: "" }, { premiumKey: { $exists: false } }],
  });
  for (const meal of legacyPremiumMeals) {
    const premiumKey = resolvePremiumKeyFromName(meal.name?.en || meal.name?.ar || "");
    if (!premiumKey) {
      unresolvedSources.push({ legacyMealId: String(meal._id), sourceType: "meal_identity" });
      continue;
    }
    meal.premiumKey = premiumKey;
    await meal.save();
    mealIdentityBackfilledCount++;
  }

  // Handle premium large salad
  console.log("Checking premium large salad...");
  const existingSalad = await PremiumUpgradeConfig.findOne({ premiumKey: PREMIUM_LARGE_SALAD_KEY });
  if (existingSalad) {
    try {
      const saladPricing = await resolvePremiumLargeSaladPricing();
      if (Number(existingSalad.upgradeDeltaHalala || 0) !== Number(saladPricing.extraFeeHalala || 0)) {
        priceDiscrepancies.push({
          premiumKey: PREMIUM_LARGE_SALAD_KEY,
          legacyPriceHalala: Number(saladPricing.extraFeeHalala || 0),
          configPriceHalala: Number(existingSalad.upgradeDeltaHalala || 0),
        });
      }
    } catch (err) {
      unresolvedSources.push({ premiumKey: PREMIUM_LARGE_SALAD_KEY, sourceType: "menu_product", error: err.message });
    }
    console.log(`Config for ${PREMIUM_LARGE_SALAD_KEY} already exists. Skipping.`);
    skippedCount++;
  } else {
    try {
      const saladPricing = await resolvePremiumLargeSaladPricing();
      if (saladPricing && saladPricing.productId) {
        const product = await MenuProduct.findById(saladPricing.productId);
        if (product) {
          const saladConfig = new PremiumUpgradeConfig({
            sourceType: "menu_product",
            sourceId: product._id,
            selectionType: "premium_large_salad",
            premiumKey: PREMIUM_LARGE_SALAD_KEY,
            displayGroupKey: "premium",
            upgradeDeltaHalala: saladPricing.extraFeeHalala || 0,
            isEnabled: true,
            isVisible: true,
            status: "active",
            sourceSnapshot: {
              key: product.key,
              name: product.name,
              context: {}
            }
          });
          await saladConfig.save();
          console.log(`Created config for ${PREMIUM_LARGE_SALAD_KEY} with delta ${saladConfig.upgradeDeltaHalala} halala.`);
          createdCount++;
        } else {
          console.warn("Could not find MenuProduct for premium large salad.");
          unresolvedSources.push({ premiumKey: PREMIUM_LARGE_SALAD_KEY, sourceType: "menu_product" });
          skippedCount++;
        }
      } else {
        console.warn("Could not resolve premium large salad pricing.");
        unresolvedSources.push({ premiumKey: PREMIUM_LARGE_SALAD_KEY, sourceType: "menu_product" });
        skippedCount++;
      }
    } catch (err) {
      console.error("Error creating salad config:", err);
      unresolvedSources.push({ premiumKey: PREMIUM_LARGE_SALAD_KEY, sourceType: "menu_product", error: err.message });
      skippedCount++;
    }
  }

  console.log(`Backfill complete. Created: ${createdCount}, Skipped: ${skippedCount}, Meal identities: ${mealIdentityBackfilledCount}`);
  if (unresolvedSources.length) {
    console.warn("Unresolved premium upgrade sources:", JSON.stringify(unresolvedSources, null, 2));
  }
  if (priceDiscrepancies.length) {
    console.warn("Legacy/config premium price discrepancies:", JSON.stringify(priceDiscrepancies, null, 2));
  }
  return { createdCount, skippedCount, mealIdentityBackfilledCount, unresolvedSources, priceDiscrepancies };
}

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    await backfillPremiumUpgrades();
    process.exit(0);
  } catch (error) {
    console.error("Backfill failed:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = { backfillPremiumUpgrades };
