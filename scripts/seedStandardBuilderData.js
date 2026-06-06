require("dotenv").config();
const mongoose = require("mongoose");

const BuilderCategory = require("../src/models/BuilderCategory");
const BuilderCarb = require("../src/models/BuilderCarb");
const BuilderProtein = require("../src/models/BuilderProtein");
const {
  LARGE_SALAD_CATEGORY_KEY,
  MEAL_PLANNER_CATEGORY_DEFINITIONS,
  STANDARD_CARB_CATEGORY_KEY,
  SYSTEM_CURRENCY,
} = require("../src/config/mealPlannerContract");

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL;

if (!MONGO_URI) {
  console.error("Error: MONGO_URI, MONGODB_URI, or MONGO_URL must be set in .env");
  process.exit(1);
}

const CARB_CATEGORIES = MEAL_PLANNER_CATEGORY_DEFINITIONS.filter((category) => category.dimension === "carb");
const PROTEIN_CATEGORIES = MEAL_PLANNER_CATEGORY_DEFINITIONS.filter((category) => category.dimension === "protein");

const CARB_OPTIONS = [
  { key: "white_rice", name: { en: "White Rice", ar: "أرز أبيض" }, sortOrder: 1 },
  { key: "turmeric_rice", name: { en: "Turmeric Rice", ar: "أرز بالكركم" }, sortOrder: 2 },
  { key: "biryani_rice", name: { en: "Biryani Rice", ar: "أرز برياني" }, sortOrder: 3 },
  { key: "quinoa", name: { en: "Quinoa", ar: "كينوا" }, sortOrder: 4 },
  { key: "alfredo_pasta", name: { en: "Alfredo Pasta", ar: "باستا الفريدو" }, sortOrder: 5 },
  { key: "red_sauce_pasta", name: { en: "Red Sauce Pasta", ar: "باستا بالصوص الأحمر" }, sortOrder: 6 },
  { key: "roasted_potato", name: { en: "Roasted Potato", ar: "بطاطس مشوي" }, sortOrder: 7 },
  { key: "sweet_potato", name: { en: "Sweet Potato", ar: "بطاطا حلوة" }, sortOrder: 8 },
  { key: "grilled_mixed_vegetables", name: { en: "Grilled Mixed Vegetables", ar: "خضار مشكل مشوي" }, sortOrder: 9 },
];

const PROTEIN_OPTIONS = [
  { key: "boiled_eggs", name: { en: "Boiled Eggs", ar: "بيض مسلوق" }, sortOrder: 1, displayCategoryKey: "eggs", proteinFamilyKey: "eggs" },
  { key: "tuna", name: { en: "Tuna", ar: "تونا" }, sortOrder: 2, displayCategoryKey: "fish", proteinFamilyKey: "fish" },
  { key: "fajita", name: { en: "Fajita", ar: "فاهيتا" }, sortOrder: 3, displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "butter_chicken", name: { en: "Butter Chicken", ar: "دجاج زبدة" }, sortOrder: 4, displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "cream_chicken", name: { en: "Cream Chicken", ar: "دجاج كريمة" }, sortOrder: 5, displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "coconut_curry_chicken", name: { en: "Coconut Curry Chicken", ar: "دجاج كاري وجوز الهند" }, sortOrder: 6, displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "spicy_chicken", name: { en: "Spicy Chicken", ar: "دجاج سبايسي" }, sortOrder: 7, displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "italian_chicken", name: { en: "Italian Chicken", ar: "دجاج توابل إيطالية" }, sortOrder: 8, displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "chicken_tikka", name: { en: "Chicken Tikka", ar: "دجاج تكا" }, sortOrder: 9, displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "asian_chicken", name: { en: "Asian Chicken", ar: "دجاج آسيوي" }, sortOrder: 10, displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "strips", name: { en: "Strips", ar: "استربس" }, sortOrder: 11, displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "grilled_chicken", name: { en: "Grilled Chicken", ar: "دجاج مشوي" }, sortOrder: 12, displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "mexican_chicken", name: { en: "Mexican Chicken", ar: "دجاج مكسيكي" }, sortOrder: 13, displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "meatballs", name: { en: "Meatballs", ar: "كرات لحم" }, sortOrder: 14, displayCategoryKey: "beef", proteinFamilyKey: "beef" },
  { key: "beef_stroganoff", name: { en: "Beef Stroganoff", ar: "لحم استرغانوف" }, sortOrder: 15, displayCategoryKey: "beef", proteinFamilyKey: "beef" },
];

const PROTECTED_PREMIUM_PROTEIN_KEYS = new Set(["beef_steak", "salmon", "shrimp", "custom_premium_salad"]);

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
  assertUnique(CARB_OPTIONS, {
    label: "carb seed key",
    getKey: (item) => item.key,
  });
  assertUnique(PROTEIN_OPTIONS, {
    label: "protein seed key",
    getKey: (item) => item.key,
  });

  const proteinCategoryKeys = new Set(PROTEIN_CATEGORIES.map((category) => category.key));
  for (const protein of PROTEIN_OPTIONS) {
    if (protein.displayCategoryKey !== protein.proteinFamilyKey) {
      throw new Error(`Protein ${protein.key} must keep displayCategoryKey/proteinFamilyKey aligned`);
    }
    if (!proteinCategoryKeys.has(protein.displayCategoryKey)) {
      throw new Error(`Protein ${protein.key} references missing category ${protein.displayCategoryKey}`);
    }
  }
}

async function seedCategories() {
  console.log("\n=== Seeding Categories ===\n");

  for (const cat of CARB_CATEGORIES) {
    const query = { key: cat.key, dimension: "carb" };
    const update = {
      $set: {
        name: cat.name,
        description: cat.description || { ar: "", en: "" },
        rules: cat.rules || {},
        isActive: true,
        sortOrder: cat.sortOrder,
      },
      $setOnInsert: { key: cat.key, dimension: "carb" },
    };
    const result = await BuilderCategory.updateOne(query, update, { upsert: true });
    console.log(`Category (carb/${cat.key}): ${result.upserted ? "created" : "updated"}`);
  }

  for (const cat of PROTEIN_CATEGORIES) {
    const query = { key: cat.key, dimension: "protein" };
    const update = {
      $set: {
        name: cat.name,
        description: cat.description || { ar: "", en: "" },
        rules: cat.rules || {},
        isActive: true,
        sortOrder: cat.sortOrder,
      },
      $setOnInsert: { key: cat.key, dimension: "protein" },
    };
    const result = await BuilderCategory.updateOne(query, update, { upsert: true });
    console.log(`Category (protein/${cat.key}): ${result.upserted ? "created" : "updated"}`);
  }
}

async function seedCarbs() {
  console.log("\n=== Seeding BuilderCarb Options ===\n");

  const carbCategory = await BuilderCategory.findOne({ key: STANDARD_CARB_CATEGORY_KEY, dimension: "carb" });
  if (!carbCategory) {
    throw new Error("carbCategory not found - run seedCategories first");
  }

  let created = 0;
  let updated = 0;
  let skippedProtected = 0;

  for (const carb of CARB_OPTIONS) {
    const existing = await BuilderCarb.findOne({ key: carb.key }).lean();
    if (existing && (existing.isPremium || existing.premiumKey)) {
      console.log(`Skipped protected carb: ${carb.key}`);
      skippedProtected += 1;
      continue;
    }

    const query = { key: carb.key };
    const update = {
      $set: {
        name: carb.name,
        isActive: true,
        sortOrder: carb.sortOrder,
        availableForSubscription: true,
        displayCategoryKey: STANDARD_CARB_CATEGORY_KEY,
        displayCategoryId: carbCategory._id,
      },
      $setOnInsert: {
        description: { ar: "", en: "" },
        legacyMappings: {},
        nutrition: {},
      },
    };
    const opts = { upsert: true, new: false };

    const result = await BuilderCarb.updateOne(query, update, opts);
    if (result.upserted) {
      console.log(`Created carb: ${carb.key}`);
      created++;
    } else {
      console.log(`Updated carb: ${carb.key}`);
      updated++;
    }
  }

  const largeSaladCategory = await BuilderCategory.findOne({ key: LARGE_SALAD_CATEGORY_KEY, dimension: "carb" });
  if (!largeSaladCategory) {
    throw new Error(`Missing BuilderCategory for ${LARGE_SALAD_CATEGORY_KEY}`);
  }
  await BuilderCarb.updateOne(
    { key: LARGE_SALAD_CATEGORY_KEY },
    {
      $set: {
        name: { en: "Premium Large Salad", ar: "سلطة كبيرة مميزة" },
        description: { en: "Reference identity for premium large salad", ar: "هوية مرجعية للسلطة الكبيرة المميزة" },
        isActive: true,
        sortOrder: 999,
        availableForSubscription: true,
        displayCategoryKey: LARGE_SALAD_CATEGORY_KEY,
        displayCategoryId: largeSaladCategory._id,
      },
      $setOnInsert: {
        legacyMappings: {},
        nutrition: {},
      },
    },
    { upsert: true, new: false }
  );

  console.log(`\nCarbs: ${created} created, ${updated} updated, ${skippedProtected} protected skips`);
}

async function seedProteins() {
  console.log("\n=== Seeding BuilderProtein Options ===\n");

  let created = 0;
  let updated = 0;
  let skippedProtected = 0;

  for (const protein of PROTEIN_OPTIONS) {
    // Explicitly skip premium canonical identities
    if (PROTECTED_PREMIUM_PROTEIN_KEYS.has(protein.key)) {
      console.log(`Skipping premium identity: ${protein.key}`);
      continue;
    }

    const proteinCategory = await BuilderCategory.findOne({ key: protein.displayCategoryKey, dimension: "protein" });
    if (!proteinCategory) {
      throw new Error(`proteinCategory not found for key=${protein.displayCategoryKey} - run seedCategories first`);
    }

    const existing = await BuilderProtein.findOne({ key: protein.key }).lean();
    if (existing && (existing.isPremium || existing.premiumKey)) {
      console.log(`Skipped protected protein: ${protein.key}`);
      skippedProtected += 1;
      continue;
    }

    const query = { key: protein.key };
    const update = {
      $set: {
        name: protein.name,
        isActive: true,
        sortOrder: protein.sortOrder,
        proteinFamilyKey: protein.proteinFamilyKey,
        availableForSubscription: true,
        displayCategoryKey: protein.displayCategoryKey,
        displayCategoryId: proteinCategory._id,
        isPremium: false,
      },
      $unset: {
        premiumKey: "",
      },
      $setOnInsert: {
        description: { ar: "", en: "" },
        imageUrl: "",
        premiumCreditCost: 0,
        extraFeeHalala: 0,
        currency: SYSTEM_CURRENCY,
        ruleTags: [],
        nutrition: {},
      },
    };
    const opts = { upsert: true, new: false };

    const result = await BuilderProtein.updateOne(query, update, opts);
    if (result.upserted) {
      console.log(`Created protein: ${protein.key}`);
      created++;
    } else {
      console.log(`Updated protein: ${protein.key}`);
      updated++;
    }
  }

  console.log(`\nProteins: ${created} created, ${updated} updated, ${skippedProtected} protected skips`);
}

async function verifyData() {
  console.log("\n=== Verification ===\n");

  const carbKeys = CARB_OPTIONS.map(c => c.key);
  const proteinKeys = PROTEIN_OPTIONS.map(p => p.key);

  const carbs = await BuilderCarb.find({ key: { $in: carbKeys } })
    .select("key name displayCategoryKey isActive sortOrder")
    .lean();
  console.log(`Carbs found: ${carbs.length}/${carbKeys.length}`);
  const foundCarbKeys = carbs.map(c => c.key);
  const missingCarbs = carbKeys.filter(k => !foundCarbKeys.includes(k));
  if (missingCarbs.length > 0) {
    console.log(`  WARNING: Missing carbs: ${missingCarbs.join(", ")}`);
  }

  const proteins = await BuilderProtein.find({ key: { $in: proteinKeys } })
    .select("key name displayCategoryKey proteinFamilyKey isActive isPremium sortOrder")
    .lean();
  console.log(`Proteins found: ${proteins.length}/${proteinKeys.length}`);
  const foundProteinKeys = proteins.map(p => p.key);
  const missingProteins = proteinKeys.filter(k => !foundProteinKeys.includes(k));
  if (missingProteins.length > 0) {
    console.log(`  WARNING: Missing proteins: ${missingProteins.join(", ")}`);
  }

  const duplicateCarbs = await BuilderCarb.aggregate([
    { $match: { key: { $in: carbKeys } } },
    { $group: { _id: "$key", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  console.log(`Duplicate carb keys: ${duplicateCarbs.length}`);
  if (duplicateCarbs.length > 0) {
    console.log(`  WARNING: ${JSON.stringify(duplicateCarbs)}`);
  }

  const duplicateProteins = await BuilderProtein.aggregate([
    { $match: { key: { $in: proteinKeys } } },
    { $group: { _id: "$key", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  console.log(`Duplicate protein keys: ${duplicateProteins.length}`);
  if (duplicateProteins.length > 0) {
    console.log(`  WARNING: ${JSON.stringify(duplicateProteins)}`);
  }

  const premiumWithWrongFields = await BuilderProtein.find({
    key: { $in: proteinKeys },
    $or: [
      { isPremium: true },
      { premiumKey: { $exists: true, $ne: null } },
    ],
  }).lean();
  console.log(`Proteins with premium fields incorrectly set: ${premiumWithWrongFields.length}`);
  if (premiumWithWrongFields.length > 0) {
    console.log(`  WARNING: ${premiumWithWrongFields.map(p => p.key).join(", ")}`);
  }

  console.log("\n=== Seeded Data Summary ===\n");
  console.log("CARBS:");
  carbs.forEach(c => console.log(`  ${c.key}: ${c.name.ar} / ${c.name.en}`));

  console.log("\nPROTEINS:");
  proteins.forEach(p => console.log(`  ${p.key}: ${p.name.ar} / ${p.name.en} (${p.proteinFamilyKey})`));
}

async function seedStandardBuilderData() {
  console.log("Starting standard Builder data seed...");
  assertSeedIntegrity();

  await mongoose.connect(MONGO_URI);
  console.log(`Connected to MongoDB: ${MONGO_URI}`);

  await seedCategories();
  await seedCarbs();
  await seedProteins();
  await verifyData();

  await mongoose.disconnect();
  console.log("\nDone");
  process.exit(0);
}

seedStandardBuilderData().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
