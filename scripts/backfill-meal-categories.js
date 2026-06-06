#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");

const { connectDb } = require("../src/db");
const Meal = require("../src/models/Meal");
const MealCategory = require("../src/models/MealCategory");
const { normalizeCategoryKey, humanizeCategoryKey } = require("../src/utils/mealCategoryCatalog");

async function main() {
  await connectDb();

  const meals = await Meal.find({ category: { $exists: true, $ne: "" } })
    .select("category")
    .lean();

  const categoryKeys = Array.from(
    new Set(
      meals
        .map((meal) => normalizeCategoryKey(meal.category))
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

  let createdCount = 0;

  for (let index = 0; index < categoryKeys.length; index += 1) {
    const key = categoryKeys[index];
    const exists = await MealCategory.findOne({ key }).lean();
    if (exists) continue;

    await MealCategory.create({
      key,
      name: {
        ar: humanizeCategoryKey(key, "ar"),
        en: humanizeCategoryKey(key, "en"),
      },
      description: { ar: "", en: "" },
      isActive: true,
      sortOrder: index,
    });

    createdCount += 1;
  }

  console.log(`Meal category backfill completed. Created ${createdCount} categories from ${categoryKeys.length} keys.`);
}

main()
  .then(async () => {
    await mongoose.connection.close();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Meal category backfill failed:", err);
    await mongoose.connection.close();
    process.exit(1);
  });
