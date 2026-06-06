#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");
const SaladIngredient = require("../src/models/SaladIngredient");
const {
  SALAD_SELECTION_GROUPS,
  normalizeSaladIngredientGroupKey,
} = require("../src/config/mealPlannerContract");

const VALID_GROUP_KEYS = new Set(
  SALAD_SELECTION_GROUPS
    .filter((group) => group.source === "ingredient")
    .map((group) => group.key)
);

const GROUP_ORDER = {
  leafy_greens: 10,
  vegetables: 20,
  cheese_nuts: 40,
  fruits: 50,
  sauce: 60,
};

const EXACT_NAME_GROUP_MAP = {
  "خس روماني": "leafy_greens",
  "خس": "leafy_greens",
  "جرجير": "leafy_greens",
  "سبانخ": "leafy_greens",
  "كرنب": "leafy_greens",
  "ميكس جرينز": "leafy_greens",
  "romaine lettuce": "leafy_greens",
  lettuce: "leafy_greens",
  arugula: "leafy_greens",
  spinach: "leafy_greens",
  kale: "leafy_greens",
  "mixed greens": "leafy_greens",

  "عسل بالليمون": "sauce",
  "زبادي بالنعناع": "sauce",
  "هاني ماستر": "sauce",
  "بالسمك": "sauce",
  "صوص بيستو": "sauce",
  "سيزر": "sauce",
  "رانش": "sauce",
  "honey lemon": "sauce",
  "yogurt mint": "sauce",
  "honey mustard": "sauce",
  "fish sauce": "sauce",
  "pesto sauce": "sauce",
  caesar: "sauce",
  ranch: "sauce",

  "سمسم": "cheese_nuts",
  "كاجو": "cheese_nuts",
  "عين الجمل": "cheese_nuts",
  sesame: "cheese_nuts",
  cashew: "cheese_nuts",
  walnut: "cheese_nuts",
  walnuts: "cheese_nuts",
  pecan: "cheese_nuts",
  parmesan: "cheese_nuts",
  feta: "cheese_nuts",
  "بارميزان": "cheese_nuts",
  "فيتا": "cheese_nuts",

  "تمر": "fruits",
  "شمام": "fruits",
  "بطيخ": "fruits",
  "توت أزرق": "fruits",
  "فراولة": "fruits",
  "رمان": "fruits",
  "تفاح أخضر": "fruits",
  "مانجا": "fruits",
  dates: "fruits",
  melon: "fruits",
  watermelon: "fruits",
  blueberry: "fruits",
  strawberry: "fruits",
  pomegranate: "fruits",
  mango: "fruits",

  "بصل مخلل": "vegetables",
  "نعناع": "vegetables",
  "زيتون أسود": "vegetables",
  "زيتون أخضر": "vegetables",
  "بصل أخضر": "vegetables",
  "بصل أحمر": "vegetables",
  "خضار مشكل مشوي": "vegetables",
  "بروكلي": "vegetables",
  "فطر": "vegetables",
  "كزبرة": "vegetables",
  "فلفل": "vegetables",
  "بنجر": "vegetables",
  "فاصوليا حمراء": "vegetables",
  "هالينو": "vegetables",
  "ه��لينو": "vegetables",
  "pickled onion": "vegetables",
  mint: "vegetables",
  "black olive": "vegetables",
  "green olive": "vegetables",
  "green onion": "vegetables",
  "red onion": "vegetables",
  "grilled vegetables": "vegetables",
  broccoli: "vegetables",
  mushroom: "vegetables",
  mushrooms: "vegetables",
  coriander: "vegetables",
  cilantro: "vegetables",
  pepper: "vegetables",
  peppers: "vegetables",
  beet: "vegetables",
  beetroot: "vegetables",
  "red beans": "vegetables",
  "kidney beans": "vegetables",
  jalapeno: "vegetables",
  "jalapeño": "vegetables",
  halapeno: "vegetables",
};

function fixString(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\ufffd/g, "").trim().toLowerCase();
}

function resolveGroupKey(doc) {
  const existing = normalizeSaladIngredientGroupKey(doc.groupKey);
  if (existing) return existing;

  const arName = fixString(doc.name && doc.name.ar ? doc.name.ar : "");
  const enName = fixString(doc.name && doc.name.en ? doc.name.en : "");

  if (EXACT_NAME_GROUP_MAP[arName]) return EXACT_NAME_GROUP_MAP[arName];
  if (EXACT_NAME_GROUP_MAP[enName]) return EXACT_NAME_GROUP_MAP[enName];

  if (
    arName.includes("خس")
    || arName.includes("جرجير")
    || arName.includes("سبانخ")
    || enName.includes("lettuce")
    || enName.includes("arugula")
    || enName.includes("spinach")
    || enName.includes("greens")
  ) {
    return "leafy_greens";
  }

  return null;
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!uri) {
    console.error("Missing MongoDB connection string (MONGO_URI, MONGODB_URI, or MONGO_URL)");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(uri);

  const docs = await SaladIngredient.find({}).lean();
  console.log(`Found ${docs.length} SaladIngredient documents\n`);

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of docs) {
    processed += 1;
    try {
      const resolvedGroupKey = resolveGroupKey(doc);
      if (!resolvedGroupKey || !VALID_GROUP_KEYS.has(resolvedGroupKey)) {
        console.warn(`  SKIPPED: unmapped ingredient '${doc.name?.ar || ""}' / '${doc.name?.en || ""}' (current='${doc.groupKey || ""}')`);
        skipped += 1;
        continue;
      }

      const sortOrder = Number(doc.sortOrder || 0) > 0
        ? Number(doc.sortOrder)
        : GROUP_ORDER[resolvedGroupKey];

      if (doc.groupKey === resolvedGroupKey && Number(doc.sortOrder || 0) === sortOrder) {
        skipped += 1;
        continue;
      }

      await SaladIngredient.updateOne(
        { _id: doc._id },
        {
          $set: {
            groupKey: resolvedGroupKey,
            sortOrder,
          },
        }
      );

      console.log(`  MAPPED: '${doc.name?.ar || ""}' / '${doc.name?.en || ""}' -> ${resolvedGroupKey}`);
      updated += 1;
    } catch (error) {
      console.warn(`  FAILED: '${doc.name?.ar || ""}' / '${doc.name?.en || ""}' -> ${error.message}`);
      failed += 1;
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Processed: ${processed}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
