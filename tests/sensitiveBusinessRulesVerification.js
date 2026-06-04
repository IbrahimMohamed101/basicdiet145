const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const BuilderProtein = require("../src/models/BuilderProtein");
const BuilderCategory = require("../src/models/BuilderCategory");
const MenuProduct = require("../src/models/MenuProduct");
const CatalogItem = require("../src/models/CatalogItem");
const { buildMealSlotDraft } = require("../src/services/subscription/mealSlotPlannerService");
const { resolvePremiumLargeSaladPricing } = require("../src/services/catalog/premiumLargeSaladPricingService");

async function run() {
  console.log("=== SENSITIVE BUSINESS RULES VERIFICATION ===\n");
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);

  try {
    // 1. Setup Base Data
    const proteinCategory = await BuilderCategory.create({ key: "protein", dimension: "protein", isActive: true });
    
    // Standard Protein
    const chicken = await BuilderProtein.create({
      key: "chicken",
      name: { en: "Chicken" },
      isPremium: false,
      isActive: true,
      displayCategoryId: proteinCategory._id,
      displayCategoryKey: "standard",
      proteinFamilyKey: "chicken"
    });

    // Premium Protein
    const beefSteak = await BuilderProtein.create({
      key: "beef_steak",
      name: { en: "Beef Steak" },
      isPremium: true,
      isActive: true,
      displayCategoryId: proteinCategory._id,
      displayCategoryKey: "premium",
      proteinFamilyKey: "beef",
      premiumKey: "beef_steak",
      extraFeeHalala: 2000
    });

    // Salad Ingredient (Extra Protein)
    const extraProteinOption = await BuilderProtein.create({
      key: "extra_protein_50g",
      name: { en: "Extra Protein 50g" },
      isPremium: false,
      isActive: true,
      displayCategoryId: proteinCategory._id,
      displayCategoryKey: "other",
      proteinFamilyKey: "other"
    });

    console.log("✅ Base proteins seeded (chicken, beef_steak, extra_protein_50g)");

    // 2. Rule: subscription premium_large_salad excludes beef_steak (premium)
    const saladDraftWithPremium = await buildMealSlotDraft({
      mealSlots: [{
        slotIndex: 1,
        selectionType: "premium_large_salad",
        salad: { groups: { protein: [String(beefSteak._id)] } }
      }],
      mealsPerDayLimit: 1,
      subscription: { status: "active", plan: { mealsPerDay: 1 } }
    });

    if (!saladDraftWithPremium.valid && saladDraftWithPremium.errorCode === "SALAD_PROTEIN_NOT_ALLOWED") {
      console.log("✅ PASS: subscription premium_large_salad REJECTS beef_steak (premium protein)");
    } else {
      console.error("❌ FAIL: subscription premium_large_salad did not reject beef_steak correctly", saladDraftWithPremium);
      process.exit(1);
    }

    // 3. Rule: subscription premium_large_salad excludes extra_protein_50g
    const saladDraftWithExtra = await buildMealSlotDraft({
      mealSlots: [{
        slotIndex: 1,
        selectionType: "premium_large_salad",
        salad: { groups: { extra_protein_50g: [String(extraProteinOption._id)] } }
      }],
      mealsPerDayLimit: 1,
      subscription: { status: "active", plan: { mealsPerDay: 1 } }
    });

    if (!saladDraftWithExtra.valid && (saladDraftWithExtra.errorCode === "SALAD_UNKNOWN_GROUP" || saladDraftWithExtra.errorCode === "SALAD_OPTION_NOT_ALLOWED")) {
      console.log("✅ PASS: subscription premium_large_salad REJECTS extra_protein_50g group");
    } else {
      console.error("❌ FAIL: subscription premium_large_salad did not reject extra_protein_50g correctly", saladDraftWithExtra);
      process.exit(1);
    }

    // 4. Rule: Plate meal (standard_meal) rejects premium protein if restricted (implicitly via buildMealSlotDraft logic)
    const plateDraftWithPremium = await buildMealSlotDraft({
      mealSlots: [{
        slotIndex: 1,
        selectionType: "standard_meal",
        proteinId: String(beefSteak._id)
      }],
      mealsPerDayLimit: 1,
      subscription: { status: "active", plan: { mealsPerDay: 1 } }
    });

    if (!plateDraftWithPremium.valid && (plateDraftWithPremium.errorCode === "PREMIUM_PROTEIN_NOT_ALLOWED" || plateDraftWithPremium.errorCode === "INVALID_PROTEIN_TYPE")) {
      console.log("✅ PASS: standard_meal REJECTS beef_steak (premium protein)");
    } else {
      console.error("❌ FAIL: standard_meal did not reject beef_steak correctly", plateDraftWithPremium);
      process.exit(1);
    }

    const lightOptionsCategory = await BuilderCategory.create({ key: "light_options", dimension: "carb", name: { en: "Light Options" }, isActive: true });
    
    // 5. Rule: Catalog definitions for prices
    const saladProduct = await MenuProduct.create({
      key: "premium_large_salad",
      priceHalala: 3500,
      categoryId: lightOptionsCategory._id,
      isActive: true,
      isAvailable: true,
      publishedAt: new Date()
    });
    await CatalogItem.create({
      linkedDocId: saladProduct._id,
      linkedModel: "MenuProduct",
      nameI18n: { en: "Salad" },
      isActive: true,
      isAvailable: true
    });

    const pricing = await resolvePremiumLargeSaladPricing();
    if (pricing.priceHalala === 3500 && pricing.source === "menu_product_premium_large_salad") {
      console.log("✅ PASS: premium_large_salad pricing is driven by MenuProduct (3500 halala)");
    } else {
      console.error("❌ FAIL: premium_large_salad pricing did not follow catalog definition", pricing);
      process.exit(1);
    }

    console.log("\n=== ALL SENSITIVE RULES VERIFIED ===\n");

  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
