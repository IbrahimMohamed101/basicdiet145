require("dotenv").config();
const mongoose = require("mongoose");
const { connectDb } = require("../src/db");
const BuilderCategory = require("../src/models/BuilderCategory");
const BuilderCarb = require("../src/models/BuilderCarb");
const BuilderProtein = require("../src/models/BuilderProtein");

/**
 * Reusable seed script for Builder catalog data.
 * Safe, idempotent, and protective of premium records.
 */

const CATEGORIES = [
  {
    key: "standard_carbs",
    dimension: "carb",
    name: { ar: "كارب", en: "Carbs" },
    rules: { maxTypes: 2, maxTotalGrams: 300, unit: "grams" },
    sortOrder: 1,
  },
  {
    key: "eggs",
    dimension: "protein",
    name: { ar: "بيض", en: "Eggs" },
    rules: { dailyLimit: 1 },
    sortOrder: 2,
  },
  {
    key: "chicken",
    dimension: "protein",
    name: { ar: "فراخ", en: "Chicken" },
    rules: { dailyLimit: 1 },
    sortOrder: 3,
  },
  {
    key: "beef",
    dimension: "protein",
    name: { ar: "لحم", en: "Beef" },
    rules: { dailyLimit: 1 },
    sortOrder: 4,
  },
  {
    key: "fish",
    dimension: "protein",
    name: { ar: "سمك", en: "Fish" },
    rules: { dailyLimit: 1 },
    sortOrder: 5,
  },
];

const CARB_OPTIONS = [
  { key: "white_rice", name: { ar: "رز أبيض", en: "White Rice" }, sortOrder: 1 },
  { key: "turmeric_rice", name: { ar: "رز بالكركم", en: "Turmeric Rice" }, sortOrder: 2 },
  { key: "biryani_rice", name: { ar: "رز برياني", en: "Biryani Rice" }, sortOrder: 3 },
  { key: "quinoa", name: { ar: "كينوا", en: "Quinoa" }, sortOrder: 4 },
  { key: "alfredo_pasta", name: { ar: "باستا الفريدو", en: "Alfredo Pasta" }, sortOrder: 5 },
  { key: "red_sauce_pasta", name: { ar: "باستا بالصوص الأحمر", en: "Red Sauce Pasta" }, sortOrder: 6 },
  { key: "roasted_potato", name: { ar: "بطاطس مشوي", en: "Roasted Potato" }, sortOrder: 7 },
  { key: "sweet_potato", name: { ar: "بطاطا حلوة", en: "Sweet Potato" }, sortOrder: 8 },
  { key: "grilled_mixed_vegetables", name: { ar: "خضار مشكل مشوي", en: "Grilled Mixed Vegetables" }, sortOrder: 9 },
];

const PROTEIN_OPTIONS = [
  // Eggs
  { key: "boiled_eggs", name: { ar: "بيض مسلوق", en: "Boiled Eggs" }, sortOrder: 1, categoryKey: "eggs", family: "other" },
  // Fish
  { key: "tuna", name: { ar: "تونا", en: "Tuna" }, sortOrder: 1, categoryKey: "fish", family: "seafood" },
  // Chicken
  { key: "fajita", name: { ar: "فاهيتا", en: "Fajita" }, sortOrder: 1, categoryKey: "chicken", family: "chicken" },
  { key: "butter_chicken", name: { ar: "دجاج زبدة", en: "Butter Chicken" }, sortOrder: 2, categoryKey: "chicken", family: "chicken" },
  { key: "cream_chicken", name: { ar: "دجاج كريمة", en: "Cream Chicken" }, sortOrder: 3, categoryKey: "chicken", family: "chicken" },
  { key: "coconut_curry_chicken", name: { ar: "دجاج كاري وجوز الهند", en: "Coconut Curry Chicken" }, sortOrder: 4, categoryKey: "chicken", family: "chicken" },
  { key: "spicy_chicken", name: { ar: "دجاج سبايسي", en: "Spicy Chicken" }, sortOrder: 5, categoryKey: "chicken", family: "chicken" },
  { key: "italian_chicken", name: { ar: "دجاج توابل إيطالية", en: "Italian Chicken" }, sortOrder: 6, categoryKey: "chicken", family: "chicken" },
  { key: "chicken_tikka", name: { ar: "دجاج تكا", en: "Chicken Tikka" }, sortOrder: 7, categoryKey: "chicken", family: "chicken" },
  { key: "asian_chicken", name: { ar: "دجاج آسيوي", en: "Asian Chicken" }, sortOrder: 8, categoryKey: "chicken", family: "chicken" },
  { key: "strips", name: { ar: "استربس", en: "Strips" }, sortOrder: 9, categoryKey: "chicken", family: "chicken" },
  { key: "grilled_chicken", name: { ar: "دجاج مشوي", en: "Grilled Chicken" }, sortOrder: 10, categoryKey: "chicken", family: "chicken" },
  { key: "mexican_chicken", name: { ar: "دجاج مكسيكي", en: "Mexican Chicken" }, sortOrder: 11, categoryKey: "chicken", family: "chicken" },
  // Beef
  { key: "meatballs", name: { ar: "كرات لحم", en: "Meatballs" }, sortOrder: 1, categoryKey: "beef", family: "beef" },
  { key: "beef_stroganoff", name: { ar: "لحم استرغانوف", en: "Beef Stroganoff" }, sortOrder: 2, categoryKey: "beef", family: "beef" },
];

async function seed() {
  try {
    await connectDb();
    console.log("Connected to database.");

    // 1. Seed Categories
    console.log("\n--- Seeding Categories ---");
    const categoryIdMap = new Map();
    for (const cat of CATEGORIES) {
      const result = await BuilderCategory.findOneAndUpdate(
        { key: cat.key, dimension: cat.dimension },
        { 
          $set: { 
            name: cat.name, 
            rules: cat.rules, 
            sortOrder: cat.sortOrder,
            isActive: true 
          } 
        },
        { upsert: true, new: true, lean: true }
      );
      categoryIdMap.set(cat.key, result._id);
      console.log(`Category [${cat.dimension}] ${cat.key}: ${result.name.en}`);
    }

    // 2. Seed Carbs
    console.log("\n--- Seeding Carbs ---");
    const carbCatId = categoryIdMap.get("standard_carbs");
    for (const carb of CARB_OPTIONS) {
      // Protect premium records
      const existing = await BuilderCarb.findOne({ key: carb.key }).lean();
      // BuilderCarb doesn't strictly have isPremium in schema but better safe than sorry
      if (existing && (existing.isPremium || existing.premiumKey)) {
        console.log(`Skipping protected carb: ${carb.key}`);
        continue;
      }

      await BuilderCarb.updateOne(
        { key: carb.key },
        {
          $set: {
            name: carb.name,
            displayCategoryId: carbCatId,
            displayCategoryKey: "standard_carbs",
            sortOrder: carb.sortOrder,
            isActive: true,
            availableForSubscription: true,
          }
        },
        { upsert: true }
      );
      console.log(`Carb ${carb.key}: ${carb.name.en}`);
    }

    // 3. Seed Proteins
    console.log("\n--- Seeding Proteins ---");
    for (const protein of PROTEIN_OPTIONS) {
      const catId = categoryIdMap.get(protein.categoryKey);
      
      // Explicit protect legacy premium keys
      if (["beef_steak", "salmon", "shrimp", "custom_premium_salad"].includes(protein.key)) {
          console.log(`Skipping premium canonical identity: ${protein.key}`);
          continue;
      }

      const existing = await BuilderProtein.findOne({ key: protein.key }).lean();
      if (existing && (existing.isPremium || existing.premiumKey)) {
        console.log(`Skipping protected protein: ${protein.key}`);
        continue;
      }

      await BuilderProtein.updateOne(
        { key: protein.key },
        {
          $set: {
            name: protein.name,
            displayCategoryId: catId,
            displayCategoryKey: protein.categoryKey,
            proteinFamilyKey: protein.family,
            sortOrder: protein.sortOrder,
            isActive: true,
            availableForSubscription: true,
            isPremium: false,
            extraFeeHalala: 0,
            premiumCreditCost: 0,
            currency: "SAR",
          },
          $unset: { premiumKey: "" }
        },
        { upsert: true }
      );
      console.log(`Protein [${protein.categoryKey}] ${protein.key}: ${protein.name.en}`);
    }

    // 4. Verification
    console.log("\n--- Verification ---");
    const carbCount = await BuilderCarb.countDocuments({ displayCategoryKey: "standard_carbs", isActive: true });
    const proteinCount = await BuilderProtein.countDocuments({ isPremium: false, isActive: true });
    const proteinCatCount = await BuilderCategory.countDocuments({ dimension: "protein", isActive: true });
    const carbCatCount = await BuilderCategory.countDocuments({ dimension: "carb", isActive: true });

    console.log(`Carbs found: ${carbCount} (expected 9)`);
    console.log(`Standard Proteins found: ${proteinCount} (expected 15)`);
    console.log(`Protein categories found: ${proteinCatCount} (expected 4+)`);
    console.log(`Carb categories found: ${carbCatCount} (expected 1+)`);

    // Specific Premium Checks
    const premiumProteins = await BuilderProtein.find({ 
        premiumKey: { $in: ["beef_steak", "salmon", "shrimp"] },
        isPremium: true 
    }).lean();
    console.log(`Premium proteins preserved: ${premiumProteins.length}/3`);
    premiumProteins.forEach(p => {
        console.log(` - ${p.premiumKey}: isPremium=${p.isPremium}`);
    });

    const customSaladInProteins = await BuilderProtein.findOne({ 
        $or: [{ key: "custom_premium_salad" }, { premiumKey: "custom_premium_salad" }] 
    }).lean();
    console.log(`Custom premium salad in proteins: ${customSaladInProteins ? "FOUND (Unexpected!)" : "NOT FOUND (Good)"}`);

    const invalidStandardProteins = await BuilderProtein.find({
        isPremium: false,
        $or: [
            { premiumKey: { $exists: true, $ne: null, $ne: "" } }
        ]
    }).lean();
    console.log(`Standard proteins with invalid premiumKey: ${invalidStandardProteins.length} (expected 0)`);

    const duplicates = await BuilderProtein.aggregate([
        { $group: { _id: "$key", count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 }, _id: { $ne: null } } }
    ]);
    console.log(`Duplicate proteins: ${duplicates.length}`);

    console.log("\nSeed completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("Seed failed:", error);
    process.exit(1);
  }
}

seed();
