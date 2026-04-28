#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const SaladIngredient = require("../src/models/SaladIngredient");

const VALID_GROUP_KEYS = new Set(["vegetables", "addons", "fruits", "nuts", "sauce"]);

const NAME_TO_GROUP_MAP = {
  "عسل بالليمون": "sauce",
  "زبادي بالنعناع": "sauce",
  "هاني ماستر": "sauce",
  "بالسمك": "sauce",
  "صوص بيستو": "sauce",
  "سيزر": "sauce",
  "رانش": "sauce",
  "سمسم": "nuts",
  "كاجو": "nuts",
  "عين الجمل": "nuts",
  "تمر": "fruits",
  "شمام": "fruits",
  "بطيخ": "fruits",
  "توت أزرق": "fruits",
  "فراولة": "fruits",
  "رمان": "fruits",
  "تفاح أخضر": "fruits",
  "مانجا": "fruits",
  "بارميزان": "addons",
  "فيتا": "addons",
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
  "هالينو": "vegetables",
};

const GROUP_ORDER = {
  vegetables: 1,
  addons: 2,
  fruits: 3,
  nuts: 4,
  sauce: 5,
};

function fixString(str) {
  if (typeof str !== "string") return str;
  let fixed = str;
  fixed = fixed.replace(/\ufffd/g, "");
  return fixed;
}

function resolveGroupKey(doc) {
  const arName = fixString(doc.name && doc.name.ar ? doc.name.ar.trim() : "");
  const enName = fixString(doc.name && doc.name.en ? doc.name.en.trim() : "");

  if (NAME_TO_GROUP_MAP[arName]) {
    return NAME_TO_GROUP_MAP[arName];
  }
  if (NAME_TO_GROUP_MAP[enName]) {
    return NAME_TO_GROUP_MAP[enName];
  }

  const enLower = enName.toLowerCase().trim();
  const arLower = arName.toLowerCase().trim();

  if (enLower === "honey lemon" || enLower === "honey with lemon") return "sauce";
  if (enLower === "yogurt mint" || enLower === "yogurt with mint") return "sauce";
  if (enLower === "honey mustard" || enLower === "honey musturd") return "sauce";
  if (enLower === "fish sauce" || enLower === "with fish") return "sauce";
  if (enLower === "pesto sauce" || enLower === "besto") return "sauce";
  if (enLower === "caesar") return "sauce";
  if (enLower === "ranch") return "sauce";
  if (enLower === "sesame" || enLower === "tahini") return "nuts";
  if (enLower === "cashew") return "nuts";
  if (enLower === "walnut" || enLower === "walnuts" || enLower === "pecan") return "nuts";
  if (enLower === "date" || enLower === "dates") return "fruits";
  if (enLower === "melon" || enLower === "canteloupe") return "fruits";
  if (enLower === "watermelon") return "fruits";
  if (enLower === "blueberry" || enLower === "blue berries") return "fruits";
  if (enLower === "strawberry" || enLower === "strawberries") return "fruits";
  if (enLower === "pomegranate") return "fruits";
  if (enLower === "green apple" || enLower === "apple green") return "fruits";
  if (enLower === "mango") return "fruits";
  if (enLower === "parmesan" || enLower === "parmigiano") return "addons";
  if (enLower === "feta") return "addons";
  if (enLower === "pickled onion" || enLower === "pickled onions") return "vegetables";
  if (enLower === "mint") return "vegetables";
  if (enLower === "black olive" || enLower === "black olives") return "vegetables";
  if (enLower === "green olive" || enLower === "green olives") return "vegetables";
  if (enLower === "green onion" || enLower === "green onions") return "vegetables";
  if (enLower === "red onion" || enLower === "onion") return "vegetables";
  if (enLower === "grilled vegetables" || enLower === "mixed grill vegetables") return "vegetables";
  if (enLower === "broccoli") return "vegetables";
  if (enLower === "mushroom" || enLower === "mushrooms" || enLower === "fungi") return "vegetables";
  if (enLower === "coriander" || enLower === "cilantro") return "vegetables";
  if (enLower === "pepper" || enLower === "peppers") return "vegetables";
  if (enLower === "beet" || enLower === "beetroot") return "vegetables";
  if (enLower === "red beans" || enLower === "kidney beans") return "vegetables";
  if (enLower === "jalapeno" || enLower === "jalape\u00f1o" || enLower === "halapeno") return "vegetables";

  if (arLower === "\u0647\u0627\u0644\u064a\u0646\u0648" || arLower === "\u0647\u0644\u064a\u0646\u0648" || arLower === "\u0647\u0644\u064a\u0646") return "vegetables";
  if (arLower === "\u0641\u0644\u0641" || arLower === "\u0641\u0644\u0641%") return "vegetables";

  return null;
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("Missing MongoDB connection string (MONGO_URI or MONGODB_URI)");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(uri);

  const docs = await SaladIngredient.find({}).lean();
  console.log(`Found ${docs.length} SaladIngredient documents\n`);

  let assigned = 0;
  let skipped = 0;
  let errors = 0;

  for (const doc of docs) {
    const arName = doc.name && doc.name.ar ? doc.name.ar : "";
    const enName = doc.name && doc.name.en ? doc.name.en : "";
    const currentGroupKey = doc.groupKey || "";

    if (currentGroupKey && VALID_GROUP_KEYS.has(currentGroupKey)) {
      skipped++;
      continue;
    }

    const resolved = resolveGroupKey(doc);

    if (!resolved) {
      console.log(`  UNKNOWN: ${arName} / ${enName} (current: '${currentGroupKey}')`);
      errors++;
      continue;
    }

    await SaladIngredient.findByIdAndUpdate(doc._id, {
      groupKey: resolved,
      sortOrder: GROUP_ORDER[resolved] || 0,
    });

    console.log(`  MAPPED: '${arName}' / '${enName}' -> ${resolved}`);
    assigned++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total: ${docs.length}`);
  console.log(`Assigned groupKey: ${assigned}`);
  console.log(`Already had valid groupKey: ${skipped}`);
  console.log(`Unknown (not mapped): ${errors}`);

  await mongoose.disconnect();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});