require("dotenv").config();
const mongoose = require("mongoose");

const BuilderProtein = require("../src/models/BuilderProtein");
const SaladIngredient = require("../src/models/SaladIngredient");

const MONGO_URI = process.env.MONGO_URI || process.env.MONGO_URL;

if (!MONGO_URI) {
  console.error("Error: MONGO_URI or MONGO_URL must be set in .env");
  process.exit(1);
}

const PREMIUM_MEALS = [
  {
    premiumKey: "beef_steak",
    name: { en: "Beef Steak", ar: "ستيك لحم" },
    type: "premium_meal",
    extraFeeHalala: 2200,
    currency: "SAR",
    isActive: true,
    sortOrder: 1,
  },
  {
    premiumKey: "salmon",
    name: { en: "Salmon", ar: "سلمون" },
    type: "premium_meal",
    extraFeeHalala: 2500,
    currency: "SAR",
    isActive: true,
    sortOrder: 2,
  },
  {
    premiumKey: "shrimp",
    name: { en: "Shrimp", ar: "روبيان" },
    type: "premium_meal",
    extraFeeHalala: 2000,
    currency: "SAR",
    isActive: true,
    sortOrder: 3,
  },
  {
    premiumKey: "custom_premium_salad",
    name: { en: "Custom Premium Salad", ar: "سلطة مميزة مخصصة" },
    type: "custom_premium_salad",
    extraFeeHalala: 3000,
    currency: "SAR",
    isActive: true,
    sortOrder: 4,
  },
];

const SALAD_GROUPS = [
  { groupKey: "vegetables", name: { en: "Vegetables", ar: "الخضروات" }, sortOrder: 1 },
  { groupKey: "addons", name: { en: "Add-ons", ar: "الإضافات" }, sortOrder: 2 },
  { groupKey: "fruits", name: { en: "Fruits", ar: "الفواكه" }, sortOrder: 3 },
  { groupKey: "nuts", name: { en: "Nuts", ar: "المكسرات" }, sortOrder: 4 },
  { groupKey: "sauce", name: { en: "Sauce", ar: "الصوص" }, sortOrder: 5 },
];

async function seedPremiumCatalog() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  let created = 0;
  let updated = 0;

  for (const meal of PREMIUM_MEALS) {
    const query = { premiumKey: meal.premiumKey };
    const update = {
      $set: {
        name: meal.name,
        isPremium: true,
        premiumKey: meal.premiumKey,
        extraFeeHalala: meal.extraFeeHalala,
        currency: meal.currency,
        isActive: meal.isActive,
        sortOrder: meal.sortOrder,
        displayCategoryKey: "premium",
        proteinFamilyKey: "other",
        availableForSubscription: true,
      },
      $setOnInsert: {
        displayCategoryId: new mongoose.Types.ObjectId(),
      },
    };
    const opts = { upsert: true, new: false };

    const result = await BuilderProtein.updateOne(query, update, opts);
    if (result.upserted) {
      console.log(`Created: ${meal.premiumKey}`);
      created++;
    } else {
      console.log(`Updated: ${meal.premiumKey}`);
      updated++;
    }
  }

  console.log(`\nPremium meals: ${created} created, ${updated} updated`);

  created = 0;
  updated = 0;

  for (const group of SALAD_GROUPS) {
    const query = { groupKey: group.groupKey };
    const update = {
      $set: {
        name: group.name,
        groupKey: group.groupKey,
        price: 0,
        isActive: true,
        sortOrder: group.sortOrder,
      },
    };
    const opts = { upsert: true, new: false };

    const result = await SaladIngredient.updateOne(query, update, opts);
    if (result.upserted) {
      console.log(`Created group: ${group.groupKey}`);
      created++;
    } else {
      console.log(`Updated group: ${group.groupKey}`);
      updated++;
    }
  }

  console.log(`\nSalad groups: ${created} created, ${updated} updated`);

  const docs = await BuilderProtein.find({ premiumKey: { $in: PREMIUM_MEALS.map(m => m.premiumKey) } })
    .select("premiumKey name extraFeeHalala isActive")
    .lean();

  console.log("\nSeeded premium meals:");
  console.log(JSON.stringify(docs.map(d => ({
    premiumKey: d.premiumKey,
    name: d.name,
    extraFeeHalala: d.extraFeeHalala,
    isActive: d.isActive,
  })), null, 2));

  await mongoose.disconnect();
  console.log("\nDone");
  process.exit(0);
}

seedPremiumCatalog().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});