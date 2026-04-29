require("dotenv").config();
const mongoose = require("mongoose");

const BuilderCategory = require("../src/models/BuilderCategory");
const BuilderProtein = require("../src/models/BuilderProtein");
const SaladIngredient = require("../src/models/SaladIngredient");
const {
  MEAL_PLANNER_CATEGORY_DEFINITIONS,
  PREMIUM_LARGE_SALAD_PREMIUM_KEY,
  SALAD_SELECTION_GROUPS,
  SYSTEM_CURRENCY,
} = require("../src/config/mealPlannerContract");

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL;

if (!MONGO_URI) {
  console.error("Error: MONGO_URI, MONGODB_URI, or MONGO_URL must be set in .env");
  process.exit(1);
}

const PREMIUM_MEALS = [
  {
    premiumKey: "beef_steak",
    name: { en: "Beef Steak", ar: "ستيك لحم" },
    displayCategoryKey: "premium",
    proteinFamilyKey: "beef",
    extraFeeHalala: 2200,
    currency: SYSTEM_CURRENCY,
    isActive: true,
    sortOrder: 10,
  },
  {
    premiumKey: "salmon",
    name: { en: "Salmon", ar: "سلمون" },
    displayCategoryKey: "premium",
    proteinFamilyKey: "fish",
    extraFeeHalala: 2500,
    currency: SYSTEM_CURRENCY,
    isActive: true,
    sortOrder: 20,
  },
  {
    premiumKey: "shrimp",
    name: { en: "Shrimp", ar: "روبيان" },
    displayCategoryKey: "premium",
    proteinFamilyKey: "fish",
    extraFeeHalala: 2000,
    currency: SYSTEM_CURRENCY,
    isActive: true,
    sortOrder: 30,
  },
];

const SALAD_INGREDIENTS = [
  { groupKey: "leafy_greens", name: { en: "Romaine Lettuce", ar: "خس روماني" }, sortOrder: 10 },
  { groupKey: "leafy_greens", name: { en: "Arugula", ar: "جرجير" }, sortOrder: 20 },
  { groupKey: "vegetables", name: { en: "Cucumber", ar: "خيار" }, sortOrder: 30 },
  { groupKey: "vegetables", name: { en: "Beet", ar: "بنجر" }, sortOrder: 40 },
  { groupKey: "cheese_nuts", name: { en: "Parmesan", ar: "بارميزان" }, sortOrder: 50 },
  { groupKey: "cheese_nuts", name: { en: "Walnut", ar: "عين الجمل" }, sortOrder: 60 },
  { groupKey: "fruits", name: { en: "Pomegranate", ar: "رمان" }, sortOrder: 70 },
  { groupKey: "fruits", name: { en: "Strawberry", ar: "فراولة" }, sortOrder: 80 },
  { groupKey: "sauce", name: { en: "Caesar", ar: "سيزر" }, sortOrder: 90 },
  { groupKey: "sauce", name: { en: "Honey Mustard", ar: "هاني ماستر" }, sortOrder: 100 },
];

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
  assertUnique(PREMIUM_MEALS, {
    label: "premium meal key",
    getKey: (item) => item.premiumKey,
  });
  assertUnique(SALAD_INGREDIENTS, {
    label: "salad ingredient seed name",
    getKey: (item) => `${item.name.en}::${item.name.ar}`,
  });
}

async function seedPremiumCatalog() {
  assertSeedIntegrity();
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  const categoryMap = new Map();
  for (const category of MEAL_PLANNER_CATEGORY_DEFINITIONS.filter((row) => row.dimension === "protein")) {
    const doc = await BuilderCategory.findOneAndUpdate(
      { key: category.key, dimension: category.dimension },
      {
        $set: {
          name: category.name,
          description: category.description || { ar: "", en: "" },
          rules: category.rules || {},
          sortOrder: category.sortOrder,
          isActive: true,
        },
      },
      { upsert: true, new: true, lean: true }
    );
    categoryMap.set(category.key, doc._id);
  }

  let created = 0;
  let updated = 0;

  for (const meal of PREMIUM_MEALS) {
    const premiumCategoryId = categoryMap.get(meal.displayCategoryKey);
    if (!premiumCategoryId) {
      throw new Error(`Missing BuilderCategory for ${meal.displayCategoryKey}`);
    }

    const result = await BuilderProtein.updateOne(
      {
        $or: [
          { premiumKey: meal.premiumKey },
          { key: meal.premiumKey, isPremium: true },
        ],
      },
      {
        $set: {
          name: meal.name,
          isPremium: true,
          premiumKey: meal.premiumKey,
          extraFeeHalala: meal.extraFeeHalala,
          currency: meal.currency,
          isActive: meal.isActive,
          sortOrder: meal.sortOrder,
          displayCategoryId: premiumCategoryId,
          displayCategoryKey: meal.displayCategoryKey,
          proteinFamilyKey: meal.proteinFamilyKey,
          availableForSubscription: true,
        },
      },
      { upsert: true, new: false }
    );
    if (result.upserted) {
      created += 1;
      console.log(`Created premium protein: ${meal.premiumKey}`);
    } else {
      updated += 1;
      console.log(`Updated premium protein: ${meal.premiumKey}`);
    }
  }

  console.log(`\nPremium meals seeded to BuilderProtein: ${created} created, ${updated} updated`);
  console.log(`Static premium meal preserved outside BuilderProtein: ${PREMIUM_LARGE_SALAD_PREMIUM_KEY}`);

  const validIngredientGroups = new Set(
    SALAD_SELECTION_GROUPS
      .filter((group) => group.source === "ingredient")
      .map((group) => group.key)
  );

  created = 0;
  updated = 0;

  for (const ingredient of SALAD_INGREDIENTS) {
    if (!validIngredientGroups.has(ingredient.groupKey)) {
      throw new Error(`Invalid salad ingredient group: ${ingredient.groupKey}`);
    }

    const result = await SaladIngredient.updateOne(
      {
        $or: [
          { "name.en": ingredient.name.en },
          { "name.ar": ingredient.name.ar },
        ],
      },
      {
        $set: {
          name: ingredient.name,
          groupKey: ingredient.groupKey,
          price: 0,
          calories: 0,
          isActive: true,
          sortOrder: ingredient.sortOrder,
        },
      },
      { upsert: true, new: false }
    );

    if (result.upserted) {
      created += 1;
      console.log(`Created salad ingredient: ${ingredient.name.en}`);
    } else {
      updated += 1;
      console.log(`Updated salad ingredient: ${ingredient.name.en}`);
    }
  }

  console.log(`\nSalad ingredients: ${created} created, ${updated} updated`);

  await mongoose.disconnect();
  console.log("\nDone");
  process.exit(0);
}

seedPremiumCatalog().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
