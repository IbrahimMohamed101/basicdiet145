require("dotenv").config();
const { connectDb } = require("../src/db");
const BuilderCategory = require("../src/models/BuilderCategory");
const BuilderCarb = require("../src/models/BuilderCarb");
const BuilderProtein = require("../src/models/BuilderProtein");
const {
  LARGE_SALAD_CATEGORY_KEY,
  MEAL_PLANNER_CATEGORY_DEFINITIONS,
  STANDARD_CARB_CATEGORY_KEY,
  SYSTEM_CURRENCY,
} = require("../src/config/mealPlannerContract");

/**
 * Reusable seed script for Builder catalog data.
 * Safe, idempotent, and protective of premium records.
 */

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
  { key: "boiled_eggs", name: { ar: "بيض مسلوق", en: "Boiled Eggs" }, sortOrder: 1, categoryKey: "eggs", family: "eggs" },
  // Fish
  { key: "tuna", name: { ar: "تونا", en: "Tuna" }, sortOrder: 1, categoryKey: "fish", family: "fish" },
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

const PROTECTED_PREMIUM_PROTEIN_KEYS = new Set(["beef_steak", "salmon", "shrimp", "custom_premium_salad"]);
const CANONICAL_STANDARD_PROTEIN_GROUP_KEYS = new Set(["chicken", "beef", "fish", "eggs", "other"]);

function assertUnique(items, { label, getKey }) {
  const seen = new Set();

  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) {
      throw new Error(`Duplicate ${label}: ${key}`);
    }
    seen.add(key);
  }
}

function assertSeedIntegrity() {
  assertUnique(MEAL_PLANNER_CATEGORY_DEFINITIONS, {
    label: "category definition",
    getKey: (item) => `${item.dimension}:${item.key}`,
  });
  assertUnique(CARB_OPTIONS, {
    label: "carb seed key",
    getKey: (item) => item.key,
  });
  assertUnique(PROTEIN_OPTIONS, {
    label: "protein seed key",
    getKey: (item) => item.key,
  });

  const proteinCategoryKeys = new Set(
    MEAL_PLANNER_CATEGORY_DEFINITIONS
      .filter((item) => item.dimension === "protein")
      .map((item) => item.key)
  );

  for (const protein of PROTEIN_OPTIONS) {
    if (!CANONICAL_STANDARD_PROTEIN_GROUP_KEYS.has(protein.categoryKey)) {
      throw new Error(`Protein ${protein.key} has unsupported categoryKey: ${protein.categoryKey}`);
    }
    if (protein.family !== protein.categoryKey) {
      throw new Error(`Protein ${protein.key} must keep family/category aligned: ${protein.family} vs ${protein.categoryKey}`);
    }
    if (!proteinCategoryKeys.has(protein.categoryKey)) {
      throw new Error(`Protein ${protein.key} references missing category definition: ${protein.categoryKey}`);
    }
  }
}

async function seed() {
  try {
    assertSeedIntegrity();
    await connectDb();
    console.log("Connected to database.");

    // 1. Seed Categories
    console.log("\n--- Seeding Categories ---");
    const categoryIdMap = new Map();
    for (const cat of MEAL_PLANNER_CATEGORY_DEFINITIONS) {
      const result = await BuilderCategory.findOneAndUpdate(
        { key: cat.key, dimension: cat.dimension },
        { 
          $set: { 
            name: cat.name, 
            description: cat.description || { ar: "", en: "" },
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
    const carbCatId = categoryIdMap.get(STANDARD_CARB_CATEGORY_KEY);
    if (!carbCatId) {
      throw new Error(`Missing BuilderCategory for ${STANDARD_CARB_CATEGORY_KEY}`);
    }
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
            displayCategoryKey: STANDARD_CARB_CATEGORY_KEY,
            sortOrder: carb.sortOrder,
            isActive: true,
            availableForSubscription: true,
          }
        },
        { upsert: true }
      );
      console.log(`Carb ${carb.key}: ${carb.name.en}`);
    }

    const largeSaladCategoryId = categoryIdMap.get(LARGE_SALAD_CATEGORY_KEY);
    if (!largeSaladCategoryId) {
      throw new Error(`Missing BuilderCategory for ${LARGE_SALAD_CATEGORY_KEY}`);
    }
    await BuilderCarb.updateOne(
      { key: LARGE_SALAD_CATEGORY_KEY },
      {
        $set: {
          name: { ar: "سلطة كبيرة مميزة", en: "Premium Large Salad" },
          description: { ar: "هوية مرجعية للسلطة الكبيرة المميزة", en: "Reference identity for premium large salad" },
          displayCategoryId: largeSaladCategoryId,
          displayCategoryKey: LARGE_SALAD_CATEGORY_KEY,
          sortOrder: 999,
          isActive: true,
          availableForSubscription: true,
        },
      },
      { upsert: true }
    );
    console.log(`Carb ${LARGE_SALAD_CATEGORY_KEY}: Premium Large Salad identity`);

    // 3. Seed Proteins
    console.log("\n--- Seeding Proteins ---");
    for (const protein of PROTEIN_OPTIONS) {
      const catId = categoryIdMap.get(protein.categoryKey);
      if (!catId) {
        throw new Error(`Missing BuilderCategory for protein category ${protein.categoryKey}`);
      }

      // Explicit protect legacy premium keys
      if (PROTECTED_PREMIUM_PROTEIN_KEYS.has(protein.key)) {
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
            currency: SYSTEM_CURRENCY,
          },
          $unset: { premiumKey: "" }
        },
        { upsert: true }
      );
      console.log(`Protein [${protein.categoryKey}] ${protein.key}: ${protein.name.en}`);
    }

    // 4. Verification
    console.log("\n--- Verification ---");
    const canonicalStandardCarbKeys = new Set(CARB_OPTIONS.map((row) => row.key));
    const canonicalStandardProteinKeys = new Set(PROTEIN_OPTIONS.map((row) => row.key));
    const [selectableStandardCarbs, activeLargeSaladCarbs, activeStandardProteins, proteinCatCount, carbCatCount] = await Promise.all([
      BuilderCarb.find({
        displayCategoryKey: STANDARD_CARB_CATEGORY_KEY,
        isActive: true,
        availableForSubscription: { $ne: false },
      }).select("key name").lean(),
      BuilderCarb.find({
        displayCategoryKey: LARGE_SALAD_CATEGORY_KEY,
        isActive: true,
        availableForSubscription: { $ne: false },
      }).select("key name sortOrder").lean(),
      BuilderProtein.find({
        isPremium: false,
        isActive: true,
      }).select("key name premiumKey").lean(),
      BuilderCategory.countDocuments({ dimension: "protein", isActive: true }),
      BuilderCategory.countDocuments({ dimension: "carb", isActive: true }),
    ]);

    const canonicalSelectableStandardCarbs = selectableStandardCarbs.filter((row) => canonicalStandardCarbKeys.has(String(row.key || "").trim()));
    const extraSelectableStandardCarbs = selectableStandardCarbs.filter((row) => !canonicalStandardCarbKeys.has(String(row.key || "").trim()));
    const canonicalLargeSaladIdentity = activeLargeSaladCarbs.find((row) => String(row.key || "").trim() === LARGE_SALAD_CATEGORY_KEY) || null;
    const extraActiveLargeSaladRows = activeLargeSaladCarbs.filter((row) => String(row.key || "").trim() !== LARGE_SALAD_CATEGORY_KEY);

    const canonicalActiveStandardProteins = activeStandardProteins.filter((row) => canonicalStandardProteinKeys.has(String(row.key || "").trim()));
    const extraLegacyActiveStandardProteins = activeStandardProteins.filter((row) => !canonicalStandardProteinKeys.has(String(row.key || "").trim()));

    console.log(`Selectable standard carbs: ${canonicalSelectableStandardCarbs.length}/${CARB_OPTIONS.length}`);
    console.log(`large_salad identity carb present: ${canonicalLargeSaladIdentity ? "yes" : "no"}`);
    console.log(`Canonical standard proteins active: ${canonicalActiveStandardProteins.length}/${PROTEIN_OPTIONS.length}`);
    console.log(`Protein categories found: ${proteinCatCount}/${MEAL_PLANNER_CATEGORY_DEFINITIONS.filter((row) => row.dimension === "protein").length}`);
    console.log(`Carb categories found: ${carbCatCount}/${MEAL_PLANNER_CATEGORY_DEFINITIONS.filter((row) => row.dimension === "carb").length}`);

    if (!canonicalLargeSaladIdentity) {
      throw new Error("Missing canonical large_salad identity carb after seed");
    }
    if (canonicalSelectableStandardCarbs.length !== CARB_OPTIONS.length) {
      console.warn(`WARNING: Canonical selectable standard carb count mismatch: ${canonicalSelectableStandardCarbs.length}/${CARB_OPTIONS.length}`);
    }
    if (canonicalActiveStandardProteins.length !== PROTEIN_OPTIONS.length) {
      console.warn(`WARNING: Canonical active standard protein count mismatch: ${canonicalActiveStandardProteins.length}/${PROTEIN_OPTIONS.length}`);
    }

    if (extraSelectableStandardCarbs.length > 0) {
      console.warn(`WARNING: Extra selectable standard carbs outside canonical seed: ${extraSelectableStandardCarbs.length}`);
      extraSelectableStandardCarbs.forEach((row) => {
        console.warn(` - ${(row.name && row.name.en) || "(unnamed)"} [key=${row.key || "missing"}]`);
      });
    }

    if (extraActiveLargeSaladRows.length > 0) {
      console.warn(`WARNING: Extra active large_salad rows outside canonical identity: ${extraActiveLargeSaladRows.length}`);
      extraActiveLargeSaladRows.forEach((row) => {
        console.warn(` - ${(row.name && row.name.en) || "(unnamed)"} [key=${row.key || "missing"}]`);
      });
    }

    if (extraLegacyActiveStandardProteins.length > 0) {
      console.warn(`WARNING: Extra legacy active standard proteins: ${extraLegacyActiveStandardProteins.length}`);
      extraLegacyActiveStandardProteins.forEach((row) => {
        console.warn(` - ${(row.name && row.name.en) || "(unnamed)"} [key=${row.key || "missing"}]`);
      });
    }

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

    const invalidCanonicalStandardProteins = canonicalActiveStandardProteins.filter((row) => String(row.premiumKey || "").trim());
    const invalidLegacyStandardProteins = extraLegacyActiveStandardProteins.filter((row) => String(row.premiumKey || "").trim());

    if (invalidCanonicalStandardProteins.length > 0) {
      throw new Error(`Canonical standard proteins must not have premiumKey: ${invalidCanonicalStandardProteins.map((row) => row.key).join(", ")}`);
    }
    console.log("Canonical standard proteins with invalid premiumKey: 0");

    if (invalidLegacyStandardProteins.length > 0) {
      console.warn(`WARNING: Legacy standard proteins with invalid premiumKey: ${invalidLegacyStandardProteins.length}`);
      invalidLegacyStandardProteins.forEach((row) => {
        console.warn(` - ${(row.name && row.name.en) || "(unnamed)"} [key=${row.key || "missing"}] premiumKey=${row.premiumKey}`);
      });
    }

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
