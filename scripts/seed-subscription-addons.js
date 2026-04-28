#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");

const { connectDb } = require("../src/db");
const Addon = require("../src/models/Addon");

const TARGET_CATEGORIES = ["juice", "snack", "small_salad"];
const SYSTEM_CURRENCY = "SAR";

const PLAN_ADDONS = [
  {
    name: { ar: "اشتراك العصير", en: "Juice Subscription" },
    description: {
      ar: "خطة إضافية يومية لفئة العصائر ضمن الاشتراك.",
      en: "A daily add-on plan for the juice category.",
    },
    imageUrl: "",
    priceHalala: 1100,
    price: 11,
    currency: SYSTEM_CURRENCY,
    kind: "plan",
    category: "juice",
    billingMode: "per_day",
    isActive: true,
    sortOrder: 1,
  },
  {
    name: { ar: "اشتراك السناك", en: "Snack Subscription" },
    description: {
      ar: "خطة إضافية يومية لفئة السناك ضمن الاشتراك.",
      en: "A daily add-on plan for the snack category.",
    },
    imageUrl: "",
    priceHalala: 1200,
    price: 12,
    currency: SYSTEM_CURRENCY,
    kind: "plan",
    category: "snack",
    billingMode: "per_day",
    isActive: true,
    sortOrder: 2,
  },
  {
    name: { ar: "اشتراك السلطة الصغيرة", en: "Small Salad Subscription" },
    description: {
      ar: "خطة إضافية يومية لفئة السلطة الصغيرة ضمن الاشتراك.",
      en: "A daily add-on plan for the small salad category.",
    },
    imageUrl: "",
    priceHalala: 1200,
    price: 12,
    currency: SYSTEM_CURRENCY,
    kind: "plan",
    category: "small_salad",
    billingMode: "per_day",
    isActive: true,
    sortOrder: 3,
  },
];

const ITEM_ADDONS = [
  {
    name: { ar: "بيري بلاست", en: "Berry Blast" },
    description: { ar: "عصير ضمن فئة العصير.", en: "Juice item in the juice category." },
    imageUrl: "",
    priceHalala: 1100,
    price: 11,
    currency: SYSTEM_CURRENCY,
    kind: "item",
    category: "juice",
    billingMode: "flat_once",
    isActive: true,
    sortOrder: 10,
  },
  {
    name: { ar: "بيري بروت", en: "Berry Brute" },
    description: { ar: "عصير ضمن فئة العصير.", en: "Juice item in the juice category." },
    imageUrl: "",
    priceHalala: 1300,
    price: 13,
    currency: SYSTEM_CURRENCY,
    kind: "item",
    category: "juice",
    billingMode: "flat_once",
    isActive: true,
    sortOrder: 11,
  },
  {
    name: { ar: "كلاسيك جرين", en: "Classic Green" },
    description: { ar: "عصير ضمن فئة العصير.", en: "Juice item in the juice category." },
    imageUrl: "",
    priceHalala: 1100,
    price: 11,
    currency: SYSTEM_CURRENCY,
    kind: "item",
    category: "juice",
    billingMode: "flat_once",
    isActive: true,
    sortOrder: 12,
  },
  {
    name: { ar: "بيت بانش", en: "Beet Punch" },
    description: { ar: "عصير ضمن فئة العصير.", en: "Juice item in the juice category." },
    imageUrl: "",
    priceHalala: 1100,
    price: 11,
    currency: SYSTEM_CURRENCY,
    kind: "item",
    category: "juice",
    billingMode: "flat_once",
    isActive: true,
    sortOrder: 13,
  },
  {
    name: { ar: "أورانج كاروت", en: "Orange Carrot" },
    description: { ar: "عصير ضمن فئة العصير.", en: "Juice item in the juice category." },
    imageUrl: "",
    priceHalala: 1100,
    price: 11,
    currency: SYSTEM_CURRENCY,
    kind: "item",
    category: "juice",
    billingMode: "flat_once",
    isActive: true,
    sortOrder: 14,
  },
  {
    name: { ar: "واترميلون منت", en: "Watermelon Mint" },
    description: { ar: "عصير ضمن فئة العصير.", en: "Juice item in the juice category." },
    imageUrl: "",
    priceHalala: 1100,
    price: 11,
    currency: SYSTEM_CURRENCY,
    kind: "item",
    category: "juice",
    billingMode: "flat_once",
    isActive: true,
    sortOrder: 15,
  },
  {
    name: { ar: "بروتين درينك", en: "Protein Drink" },
    description: { ar: "مشروب ضمن فئة العصير.", en: "Drink item in the juice category." },
    imageUrl: "",
    priceHalala: 1900,
    price: 19,
    currency: SYSTEM_CURRENCY,
    kind: "item",
    category: "juice",
    billingMode: "flat_once",
    isActive: true,
    sortOrder: 16,
  },
  {
    name: { ar: "دايت آيسد تي", en: "Diet Iced Tea" },
    description: { ar: "مشروب ضمن فئة العصير.", en: "Drink item in the juice category." },
    imageUrl: "",
    priceHalala: 400,
    price: 4,
    currency: SYSTEM_CURRENCY,
    kind: "item",
    category: "juice",
    billingMode: "flat_once",
    isActive: true,
    sortOrder: 17,
  },
  {
    name: { ar: "دايت صودا", en: "Diet Soda" },
    description: { ar: "مشروب ضمن فئة العصير.", en: "Drink item in the juice category." },
    imageUrl: "",
    priceHalala: 300,
    price: 3,
    currency: SYSTEM_CURRENCY,
    kind: "item",
    category: "juice",
    billingMode: "flat_once",
    isActive: true,
    sortOrder: 18,
  },
  {
    name: { ar: "ماء", en: "Water" },
    description: { ar: "مياه ضمن فئة العصير.", en: "Water item in the juice category." },
    imageUrl: "",
    priceHalala: 200,
    price: 2,
    currency: SYSTEM_CURRENCY,
    kind: "item",
    category: "juice",
    billingMode: "flat_once",
    isActive: true,
    sortOrder: 19,
  },
  {
    name: { ar: "مافن تفاح بالقرفة (قطعتان)", en: "Cinnamon Apple Muffin (2 pieces)" },
    description: { ar: "سناك ضمن فئة السناك.", en: "Snack item in the snack category." },
    imageUrl: "",
    priceHalala: 1200,
    price: 12,
    currency: SYSTEM_CURRENCY,
    kind: "item",
    category: "snack",
    billingMode: "flat_once",
    isActive: true,
    sortOrder: 30,
  },
  {
    name: { ar: "بلو بيري تشيزكيك", en: "Blueberry Cheesecake" },
    description: { ar: "سناك ضمن فئة السناك.", en: "Snack item in the snack category." },
    imageUrl: "",
    priceHalala: 1900,
    price: 19,
    currency: SYSTEM_CURRENCY,
    kind: "item",
    category: "snack",
    billingMode: "flat_once",
    isActive: true,
    sortOrder: 31,
  },
  {
    name: { ar: "ستروبيري تشيزكيك", en: "Strawberry Cheesecake" },
    description: { ar: "سناك ضمن فئة السناك.", en: "Snack item in the snack category." },
    imageUrl: "",
    priceHalala: 1900,
    price: 19,
    currency: SYSTEM_CURRENCY,
    kind: "item",
    category: "snack",
    billingMode: "flat_once",
    isActive: true,
    sortOrder: 32,
  },
  {
    name: { ar: "دارك براونيز", en: "Dark Brownies" },
    description: { ar: "سناك ضمن فئة السناك.", en: "Snack item in the snack category." },
    imageUrl: "",
    priceHalala: 1300,
    price: 13,
    currency: SYSTEM_CURRENCY,
    kind: "item",
    category: "snack",
    billingMode: "flat_once",
    isActive: true,
    sortOrder: 33,
  },
  {
    name: { ar: "بروتين بار", en: "Protein Bar" },
    description: { ar: "سناك ضمن فئة السناك.", en: "Snack item in the snack category." },
    imageUrl: "",
    priceHalala: 1500,
    price: 15,
    currency: SYSTEM_CURRENCY,
    kind: "item",
    category: "snack",
    billingMode: "flat_once",
    isActive: true,
    sortOrder: 34,
  },
  {
    name: { ar: "كلاسيك بيسك", en: "Classic Bisc" },
    description: { ar: "سناك ضمن فئة السناك.", en: "Snack item in the snack category." },
    imageUrl: "",
    priceHalala: 1400,
    price: 14,
    currency: SYSTEM_CURRENCY,
    kind: "item",
    category: "snack",
    billingMode: "flat_once",
    isActive: true,
    sortOrder: 35,
  },
  {
    name: { ar: "كيكة بروتين بالشوكولاتة", en: "Protein Chocolate Cake" },
    description: { ar: "سناك ضمن فئة السناك.", en: "Snack item in the snack category." },
    imageUrl: "",
    priceHalala: 400,
    price: 4,
    currency: SYSTEM_CURRENCY,
    kind: "item",
    category: "snack",
    billingMode: "flat_once",
    isActive: true,
    sortOrder: 36,
  },
  {
    name: { ar: "سلطة صغيرة", en: "Small Salad" },
    description: { ar: "سلطة ضمن فئة السلطة الصغيرة.", en: "Salad item in the small salad category." },
    imageUrl: "",
    priceHalala: 1200,
    price: 12,
    currency: SYSTEM_CURRENCY,
    kind: "item",
    category: "small_salad",
    billingMode: "flat_once",
    isActive: true,
    sortOrder: 50,
  },
];

function summarizeByKey(rows, key) {
  return rows.reduce((acc, row) => {
    const value = String(row[key] || "");
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

async function main() {
  let connection = null;
  try {
    console.log("Seeding subscription add-ons only...");
    connection = await connectDb();

    const deleteResult = await Addon.deleteMany({
      category: { $in: TARGET_CATEGORIES },
    });

    const docs = [...PLAN_ADDONS, ...ITEM_ADDONS];
    const inserted = await Addon.insertMany(docs, { ordered: true });

    const plans = inserted.filter((row) => row.kind === "plan");
    const items = inserted.filter((row) => row.kind === "item");

    const storedRows = await Addon.find({
      category: { $in: TARGET_CATEGORIES },
    }).lean();

    console.log(`Deleted count: ${Number(deleteResult.deletedCount || 0)}`);
    console.log(`Inserted plan count: ${plans.length}`);
    console.log(`Inserted item count: ${items.length}`);
    console.log("Counts by kind:");
    console.log(JSON.stringify(summarizeByKey(storedRows, "kind"), null, 2));
    console.log("Counts by category:");
    console.log(JSON.stringify(summarizeByKey(storedRows, "category"), null, 2));
    console.log("Counts by billingMode:");
    console.log(JSON.stringify(summarizeByKey(storedRows, "billingMode"), null, 2));
    console.log(`Total stored in target categories: ${storedRows.length}`);
  } catch (err) {
    console.error("Subscription add-ons seed failed:", err.message);
    process.exitCode = 1;
  } finally {
    if (connection || mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

main();
