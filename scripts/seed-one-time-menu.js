#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");

const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const { publishMenu } = require("../src/services/orders/menuCatalogService");
const {
  testWeightPricingEligibility,
  testWeightPricingUpdate,
} = require("./lib/test-weight-pricing");

const uri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet";
const now = new Date();
const PRODUCTION_SEED_OVERRIDE = "MENU_SEED_ALLOW_PRODUCTION";
const SEED_MODES = new Set(["initial", "force", "local", "dev", "test"]);

function name(ar, en = ar) {
  return { ar, en };
}

function key(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function optionKey(groupKey, optionName, index) {
  const suffix = optionName && optionName.en ? optionName.en : String(index + 1).padStart(2, "0");
  return key(`${groupKey}_${suffix}`);
}

function isExplicitlyAllowed(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function productIsCustomizable(row) {
  return row.pricingModel === "per_100g" || (Array.isArray(row.groups) && row.groups.length > 0);
}

function assertSafeSeedTarget() {
  const isProduction = process.env.NODE_ENV === "production";
  if (!isProduction) return;

  if (isExplicitlyAllowed(process.env[PRODUCTION_SEED_OVERRIDE])) {
    console.warn(
      `[seed-one-time-menu] WARNING: NODE_ENV=production. Continuing only because ${PRODUCTION_SEED_OVERRIDE}=true.`
    );
    return;
  }

  console.error(
    [
      "[seed-one-time-menu] Refusing to seed one-time menu while NODE_ENV=production.",
      "Use a local or staging database for validation.",
      `If this is an intentional production menu seed, rerun with ${PRODUCTION_SEED_OVERRIDE}=true.`,
    ].join("\n")
  );
  process.exit(1);
}

function resolveSeedMode(value = process.env.MENU_SEED_MODE) {
  const requested = String(value || "").trim().toLowerCase();
  if (requested) {
    if (!SEED_MODES.has(requested)) {
      throw new Error("MENU_SEED_MODE must be one of: initial, force, local, dev, test");
    }
    return requested;
  }
  return process.env.NODE_ENV === "production" ? "initial" : "local";
}

async function hasExistingCatalogData() {
  const [categories, products, groups, options] = await Promise.all([
    MenuCategory.estimatedDocumentCount(),
    MenuProduct.estimatedDocumentCount(),
    MenuOptionGroup.estimatedDocumentCount(),
    MenuOption.estimatedDocumentCount(),
  ]);
  return categories + products + groups + options > 0;
}

const categoryRows = [
  ["custom_order", "اطلب على مزاجك", "Custom Order", "hero_builder_collection"],
  ["light_options", "اختيارات خفيفة", "Light Options", "compact_builder_collection"],
  ["cold_sandwiches", "الساندويتش البارد", "Cold Sandwiches", "sandwich_collection"],
  ["sourdough", "الساندويشات", "Sourdough Sandwiches", "sandwich_collection"],
  ["desserts", "الحلويات", "Desserts", "addon_collection"],
  ["juices", "العصائر", "Juices", "addon_collection"],
  ["drinks", "المشروبات", "Drinks", "addon_collection"],
  ["ice_cream", "الايس كريم", "Ice Cream", "addon_collection"],
];

const optionNameMap = {
  "خس": "Lettuce",
  "جرجير": "Arugula",
  "ملفوف": "Cabbage",
  "طماطم": "Tomato",
  "جزر": "Carrot",
  "خيار": "Cucumber",
  "ذرة": "Corn",
  "حمص": "Chickpeas",
  "هالبينو": "Jalapeno",
  "فاصوليا حمراء": "Red Beans",
  "بنجر": "Beetroot",
  "فلفل حار": "Chili Pepper",
  "كزبرة": "Coriander",
  "فطر": "Mushroom",
  "بروكلي": "Broccoli",
  "خضار مشكل مشوي": "Mixed Grilled Vegetables",
  "بصل احمر": "Red Onion",
  "بصل اخضر": "Green Onion",
  "زيتون اخضر": "Green Olives",
  "زيتون اسود": "Black Olives",
  "نعناع": "Mint",
  "بصل مخلل": "Pickled Onion",
  "مانجا": "Mango",
  "تفاح اخضر": "Green Apple",
  "رمان": "Pomegranate",
  "فراولة": "Strawberry",
  "توت ازرق": "Blueberry",
  "بطيخ": "Watermelon",
  "شمام": "Cantaloupe",
  "تمر": "Dates",
  "عسل": "Honey",
  "بيض مسلوق": "Boiled Egg",
  "تونا": "Tuna",
  "فاهيتا": "Fajita",
  "دجاج زبدة": "Butter Chicken",
  "دجاج كريمة": "Cream Chicken",
  "دجاج كاري وجوز الهند": "Coconut Curry Chicken",
  "دجاج سبايسي": "Spicy Chicken",
  "دجاج توابل إيطالية": "Italian Herb Chicken",
  "دجاج تكا": "Chicken Tikka",
  "دجاج آسيوي": "Asian Chicken",
  "استربس": "Chicken Strips",
  "دجاج مشوي": "Grilled Chicken",
  "دجاج مكسيكي": "Mexican Chicken",
  "كرات لحم": "Meatballs",
  "لحم استرغانوف": "Beef Stroganoff",
  "ستيك لحم": "Steak",
  "جمبري": "Shrimp",
  "سمك فيليه": "Fish Fillet",
  "سالمون": "Salmon",
  "كاجو": "Cashew",
  "عين الجمل": "Walnut",
  "سمسم": "Sesame",
  "فيتا": "Feta",
  "بارميزان": "Parmesan",
  "رانش": "Ranch",
  "سبايسي رانش": "Spicy Ranch",
  "صوص بيستو": "Pesto Sauce",
  "بالسميك": "Balsamic",
  "سيزر": "Caesar",
  "هاني ماستر": "Honey Mustard",
  "زبادي بالنعناع": "Mint Yogurt",
  "عسل بالثوم": "Honey Garlic",
  "رز ابيض": "White Rice",
  "رز بالكركم": "Turmeric Rice",
  "رز برياني": "Biryani Rice",
  "كينوا": "Quinoa",
  "باستا الفريدو": "Alfredo Pasta",
  "باستا بالصوص الأحمر": "Red Sauce Pasta",
  "بطاطس مشوي": "Roasted Potato",
  "بطاطا حلوة": "Sweet Potato",
};

function option(ar) {
  return { ar, en: optionNameMap[ar] || ar };
}

const groupDefinitions = {
  leafy_greens: { name: name("ورقيات", "Leafy Greens"), options: ["خس", "جرجير", "ملفوف"].map(option) },
  vegetables_legumes: { name: name("خضراوات وبقوليات", "Vegetables & Legumes"), options: ["طماطم", "جزر", "خيار", "ذرة", "حمص", "هالبينو", "فاصوليا حمراء", "بنجر", "فلفل حار", "كزبرة", "فطر", "بروكلي", "خضار مشكل مشوي", "بصل احمر", "بصل اخضر", "زيتون اخضر", "زيتون اسود", "نعناع", "بصل مخلل"].map(option) },
  fruits: { name: name("فواكه", "Fruits"), options: ["مانجا", "تفاح اخضر", "رمان", "فراولة", "توت ازرق", "بطيخ", "شمام", "تمر", "عسل"].map(option) },
  proteins: { name: name("بروتينات", "Proteins"), options: ["بيض مسلوق", "تونا", "فاهيتا", "دجاج سبايسي", "دجاج توابل إيطالية", "دجاج تكا", "دجاج آسيوي", "استربس", "دجاج مشوي", "دجاج مكسيكي", "كرات لحم", "لحم استرغانوف", "ستيك لحم", "جمبري", "سمك فيليه", "سالمون", "دجاج زبدة", "دجاج كريمة", "دجاج كاري وجوز الهند"].map(option) },
  cheese_nuts: { name: name("الأجبان والمكسرات", "Cheese & Nuts"), options: ["كاجو", "عين الجمل", "سمسم", "فيتا", "بارميزان"].map(option) },
  sauces: { name: name("الصوصات", "Sauces"), options: ["رانش", "سبايسي رانش", "صوص بيستو", "بالسميك", "سيزر", "هاني ماستر", "زبادي بالنعناع", "عسل بالثوم"].map(option) },
  carbs: { name: name("كارب", "Carbs"), options: ["رز ابيض", "رز بالكركم", "رز برياني", "كينوا", "باستا الفريدو", "باستا بالصوص الأحمر", "بطاطس مشوي", "بطاطا حلوة", "خضار مشكل مشوي"].map(option) },
  nuts: { name: name("المكسرات", "Nuts"), options: ["كاجو", "عين الجمل", "سمسم"].map(option) },
};

const BASIC_SALAD_FRUITS = ["مانجا", "تفاح اخضر", "رمان", "فراولة", "توت ازرق", "بطيخ", "شمام", "تمر"];
const BASIC_SALAD_PROTEINS = ["بيض مسلوق", "تونا", "فاهيتا", "دجاج سبايسي", "دجاج توابل إيطالية", "دجاج تكا", "دجاج آسيوي", "استربس", "دجاج مشوي", "دجاج مكسيكي", "كرات لحم", "لحم استرغانوف", "ستيك لحم", "جمبري", "سمك فيليه", "سالمون"];
const BASIC_MEAL_PROTEINS = ["بيض مسلوق", "تونا", "فاهيتا", "دجاج زبدة", "دجاج كريمة", "دجاج كاري وجوز الهند", "دجاج سبايسي", "دجاج توابل إيطالية", "دجاج تكا", "دجاج آسيوي", "استربس", "دجاج مشوي", "دجاج مكسيكي", "كرات لحم", "لحم استرغانوف", "ستيك لحم", "جمبري", "سمك فيليه", "سالمون"];

const productRows = [
  { key: "basic_salad", category: "custom_order", name: name("سلطة بيسك", "Basic Salad"), pricingModel: "per_100g", priceHalala: 2900, groups: [["leafy_greens", 2, 2], ["vegetables_legumes", 0, 19], ["fruits", 0, 4], ["proteins", 1, 1], ["cheese_nuts", 0, 2], ["sauces", 1, 1]], optionNames: { fruits: BASIC_SALAD_FRUITS, proteins: BASIC_SALAD_PROTEINS } },
  { key: "basic_meal", category: "custom_order", itemType: "basic_meal", name: name("وجبة بيسك", "Basic Meal"), pricingModel: "per_100g", priceHalala: 1900, groups: [["carbs", 3, 3], ["proteins", 1, 1]], optionNames: { proteins: BASIC_MEAL_PROTEINS } },
  { key: "fruit_salad", category: "light_options", name: name("سلطة فواكه", "Fruit Salad"), pricingModel: "fixed", priceHalala: 1700, defaultWeightGrams: 150, groups: [["fruits", 9, 9]] },
  { key: "greek_yogurt", category: "light_options", name: name("زبادي يوناني", "Greek Yogurt"), pricingModel: "fixed", priceHalala: 1700, defaultWeightGrams: 200, groups: [["fruits", 5, 5], ["nuts", 0, 3]] },
  { key: "green_salad", category: "light_options", name: name("سلطة خضرا", "Green Salad"), pricingModel: "per_100g", priceHalala: 1500, groups: [["leafy_greens", 2, 2], ["vegetables_legumes", 0, 19], ["sauces", 1, 1]] },
  ...[
    ["boiled_egg_cold_sandwich", "بيض مسلوق", "Boiled Egg", 900],
    ["turkey_cold_sandwich", "تركي", "Turkey", 1300],
    ["classic_halloumi_cold_sandwich", "حلوم كلاسيكي", "Classic Halloumi", 1300],
    ["tuna_cold_sandwich", "تونا", "Tuna", 1300],
    ["scrambled_egg_cold_sandwich", "بيض اسكرامبل", "Scrambled Egg", 1300],
    ["chicken_fajita_cold_sandwich", "دجاج فاهيتا", "Chicken Fajita", 1300],
    ["mexican_chicken_cold_sandwich", "دجاج مكسيكي", "Mexican Chicken", 1300],
    ["grilled_chicken_cold_sandwich", "دجاج مشوي", "Grilled Chicken", 1300],
  ].map(([productKey, ar, en, priceHalala]) => ({
    key: productKey,
    category: "cold_sandwiches",
    itemType: "cold_sandwich",
    name: name(ar, en),
    pricingModel: "fixed",
    priceHalala,
  })),
  ...[
    ["halloumi_sourdough", "ساوردو حلومي", "Halloumi Sourdough", 2300],
    ["turkey_sourdough", "ساوردو تركي", "Turkey Sourdough", 2300],
    ["tuna_sourdough", "ساوردو تونا", "Tuna Sourdough", 2300],
    ["grilled_chicken_sourdough", "ساوردو دجاج مشوي", "Grilled Chicken Sourdough", 2300],
  ].map(([productKey, ar, en, priceHalala]) => ({ key: productKey, category: "sourdough", name: name(ar, en), pricingModel: "fixed", priceHalala })),
  ...[
    ["apple_cinnamon_muffin_2pcs", "مافن التفاح بالقرفة (قطعتين)", "Apple Cinnamon Muffin (2 pcs)", 1200],
    ["berry_cheesecake", "تشيز كيك بالتوت", "Berry Cheesecake", 1900],
    ["strawberry_cheesecake", "تشيز كيك بالفراولة", "Strawberry Cheesecake", 1900],
    ["dark_brownies", "براونيز داكن", "Dark Brownies", 1300],
    ["protein_bar", "بروتين بار", "Protein Bar", 1500],
    ["basic_classic", "بيسك كلاسيك", "Basic Classic", 1400],
    ["protein_chocolate_cake", "كيك شوكولاتة بروتين", "Protein Chocolate Cake", 1900],
  ].map(([productKey, ar, en, priceHalala]) => ({ key: productKey, category: "desserts", name: name(ar, en), pricingModel: "fixed", priceHalala })),
  ...[
    ["berry_blast", "بيري بلاست", "Berry Blast", 1100],
    ["berry_prot", "بيري بروت", "Berry Prot", 1300],
    ["classic_green", "كلاسيك جرين", "Classic Green", 1100],
    ["beet_punch", "بيت بنش", "Beet Punch", 1100],
    ["orange_carrot", "برتقال وجزر", "Orange & Carrot", 1100],
    ["watermelon_mint", "بطيخ بالنعناع", "Watermelon Mint", 1100],
  ].map(([productKey, ar, en, priceHalala]) => ({ key: productKey, category: "juices", name: name(ar, en), pricingModel: "fixed", priceHalala })),
  ...[
    ["protein_drink", "مشروب بروتين", "Protein Drink", 1900],
    ["diet_iced_tea", "ايس تى دايت", "Diet Iced Tea", 400],
    ["diet_soda", "صودا دايت", "Diet Soda", 300],
    ["water", "مياه عادية", "Water", 200],
  ].map(([productKey, ar, en, priceHalala]) => ({ key: productKey, category: "drinks", name: name(ar, en), pricingModel: "fixed", priceHalala })),
  ...[
    ["vanilla_ice_cream", "ايس كريم فانيليا", "Vanilla Ice Cream", 1300],
    ["chocolate_ice_cream", "ايس كريم شوكولا", "Chocolate Ice Cream", 1300],
    ["ice_cream_add_on", "إضافة ايس كريم", "Ice Cream Add-on", 700],
  ].map(([productKey, ar, en, priceHalala]) => ({ key: productKey, category: "ice_cream", name: name(ar, en), pricingModel: "fixed", priceHalala })),
  {
    key: "premium_large_salad", 
    itemType: "premium_large_salad",
    category: "custom_order", 
    name: name("سلطة كبيرة مميزة", "Premium Large Salad"), 
    pricingModel: "per_100g", 
    priceHalala: 2900, 
    availableFor: ["subscription"],
    groups: [["leafy_greens", 1, 2], ["vegetables_legumes", 0, 19], ["proteins", 1, 1], ["cheese_nuts", 0, 2], ["fruits", 0, 4], ["sauces", 1, 1]],
    optionNames: { proteins: ["ستيك لحم", "جمبري", "سالمون"] } 
  },
];

const groups = Object.fromEntries(
  Object.entries(groupDefinitions).map(([groupKey, definition]) => [
    groupKey,
    [definition.name.ar, definition.options.map((item) => item.ar)],
  ])
);

const products = productRows.map((product) => ({
  ...product,
  name: product.name.ar,
}));

const groupKeyAliases = {
  vegetables: "vegetables_legumes",
};

const legacyCategoryKeys = [
  "salads",
  "meals",
];

const productKeyAliases = {
  cold_boiled_egg: "boiled_egg_cold_sandwich",
  cold_turkey: "turkey_cold_sandwich",
  cold_halloumi_classic: "classic_halloumi_cold_sandwich",
  cold_tuna: "tuna_cold_sandwich",
  cold_scrambled_egg: "scrambled_egg_cold_sandwich",
  cold_chicken_fajita: "chicken_fajita_cold_sandwich",
  cold_mexican_chicken: "mexican_chicken_cold_sandwich",
  cold_grilled_chicken: "grilled_chicken_cold_sandwich",
  sourdough_halloumi: "halloumi_sourdough",
  sourdough_turkey: "turkey_sourdough",
  sourdough_tuna: "tuna_sourdough",
  sourdough_grilled_chicken: "grilled_chicken_sourdough",
  ice_cream_addon: "ice_cream_add_on",
};

function proteinPricing(optionName, productKey) {
  const isMeal = productKey === "basic_meal";
  const chickenOptions = new Set([
    "فاهيتا",
    "دجاج زبدة",
    "دجاج كريمة",
    "دجاج كاري وجوز الهند",
    "دجاج سبايسي",
    "دجاج توابل إيطالية",
    "دجاج تكا",
    "دجاج آسيوي",
    "استربس",
    "دجاج مشوي",
    "دجاج مكسيكي",
  ]);
  if (["كرات لحم", "لحم استرغانوف"].includes(optionName)) return { extraPriceHalala: 300, extraWeightUnitGrams: 50, extraWeightPriceHalala: 600 };
  if (["ستيك لحم"].includes(optionName)) return { extraPriceHalala: isMeal ? 2000 : 1600, extraWeightUnitGrams: 50, extraWeightPriceHalala: 1000 };
  if (["جمبري", "سالمون"].includes(optionName)) return { extraPriceHalala: isMeal ? 2000 : 1600, extraWeightUnitGrams: 50, extraWeightPriceHalala: 1000 };
  if (chickenOptions.has(optionName)) return { extraWeightUnitGrams: 50, extraWeightPriceHalala: 500 };
  if (optionName.includes("لحم")) return { extraWeightUnitGrams: 50, extraWeightPriceHalala: 600 };
  return {};
}

function productCardSize(productData) {
  if (["basic_meal", "basic_salad", "premium_large_salad"].includes(productData.key)) return "large";
  if (["green_salad", "fruit_salad", "greek_yogurt"].includes(productData.key)) return "medium";
  return "small";
}

async function upsertCategory(row, sortOrder) {
  return MenuCategory.findOneAndUpdate(
    { key: row[0] },
    { $set: { key: row[0], name: name(row[1], row[2]), isActive: true, isVisible: true, isAvailable: true, sortOrder, publishedAt: now, "ui.cardVariant": row[3] || "addon_collection" } },
    { upsert: true, new: true }
  );
}

async function renameOrDeactivateKey(Model, oldKey, newKey) {
  const oldDoc = await Model.findOne({ key: oldKey });
  if (!oldDoc) return;
  const newDoc = await Model.findOne({ key: newKey });
  if (!newDoc) {
    oldDoc.key = newKey;
    await oldDoc.save();
    return;
  }
  if (String(oldDoc._id) !== String(newDoc._id)) {
    oldDoc.isActive = false;
    oldDoc.publishedAt = null;
    await oldDoc.save();
  }
}

async function applySeedAliases() {
  await Promise.all([
    ...Object.entries(groupKeyAliases).map(([oldKey, newKey]) => renameOrDeactivateKey(MenuOptionGroup, oldKey, newKey)),
    ...Object.entries(productKeyAliases).map(([oldKey, newKey]) => renameOrDeactivateKey(MenuProduct, oldKey, newKey)),
  ]);
}

async function deactivateLegacyCategories() {
  await MenuCategory.updateMany(
    { key: { $in: legacyCategoryKeys } },
    { $set: { isActive: false, publishedAt: null } }
  );
}

async function seedOneTimeMenu({ actor = { role: "script" }, notes = "Seed one-time pickup menu", mode } = {}) {
  const seedMode = resolveSeedMode(mode);
  if (process.env.NODE_ENV === "production" && !["initial", "force"].includes(seedMode)) {
    throw new Error("Production one-time menu seed requires MENU_SEED_MODE=initial or MENU_SEED_MODE=force");
  }
  if (seedMode === "initial" && await hasExistingCatalogData()) {
    return { products: 0, categories: 0, skipped: true, mode: seedMode };
  }

  await applySeedAliases();

  const categoryMap = new Map();
  for (let i = 0; i < categoryRows.length; i += 1) {
    const category = await upsertCategory(categoryRows[i], (i + 1) * 10);
    categoryMap.set(category.key, category);
  }

  const groupMap = new Map();
  const optionMap = new Map();
  let groupSort = 10;
  for (const [groupKey, groupDefinition] of Object.entries(groupDefinitions)) {
    const group = await MenuOptionGroup.findOneAndUpdate(
      { key: groupKey },
      { $set: { key: groupKey, name: groupDefinition.name, isActive: true, isVisible: true, isAvailable: true, sortOrder: groupSort, publishedAt: now } },
      { upsert: true, new: true }
    );
    groupMap.set(groupKey, group);
    let optionSort = 10;
    for (let optionIndex = 0; optionIndex < groupDefinition.options.length; optionIndex += 1) {
      const optionName = groupDefinition.options[optionIndex];
      const optionSeedKey = optionKey(groupKey, optionName, optionIndex);
      const premiumDetailsMap = {
        "ستيك لحم": { extraPriceHalala: 1600, extraFeeHalala: 1600, proteinFamilyKey: "beef", premiumKey: "beef_steak", displayCategoryKey: "premium", availableForSubscription: true, selectionType: "premium" },
        "جمبري": { extraPriceHalala: 1600, extraFeeHalala: 1600, proteinFamilyKey: "fish", premiumKey: "shrimp", displayCategoryKey: "premium", availableForSubscription: true, selectionType: "premium" },
        "سالمون": { extraPriceHalala: 1600, extraFeeHalala: 1600, proteinFamilyKey: "fish", premiumKey: "salmon", displayCategoryKey: "premium", availableForSubscription: true, selectionType: "premium" },
      };
      const premiumFields = premiumDetailsMap[optionName.ar] || {};

      const option = await MenuOption.findOneAndUpdate(
        { groupId: group._id, key: optionSeedKey },
        { 
          $set: { 
            groupId: group._id, 
            key: optionSeedKey, 
            name: optionName, 
            extraWeightUnitGrams: groupKey === "proteins" ? 50 : 0, 
            isActive: true, 
            isVisible: true, 
            isAvailable: true, 
            sortOrder: optionSort, 
            publishedAt: now,
            availableFor: ["one_time", "subscription"],
            ...premiumFields
          } 
        },
        { upsert: true, new: true }
      );
      optionMap.set(`${groupKey}:${optionName.ar}`, option);
      optionSort += 10;
    }
    groupSort += 10;
  }

  let productSort = 10;
  for (const productData of productRows) {
    const optionGroupKeys = Array.isArray(productData.groups)
      ? productData.groups.map(([groupKey]) => groupKey)
      : [];
    const weightPricing = testWeightPricingEligibility(
      productData,
      productData.category,
      optionGroupKeys
    ).eligible
      ? testWeightPricingUpdate()
      : {};
    const product = await MenuProduct.findOneAndUpdate(
      { key: productData.key },
      {
        $set: {
          categoryId: categoryMap.get(productData.category)._id,
          key: productData.key,
          name: productData.name,
          itemType: productData.itemType || "product",
          pricingModel: productData.pricingModel,
          priceHalala: productData.priceHalala,
          baseUnitGrams: 100,
          defaultWeightGrams: productData.defaultWeightGrams || (productData.pricingModel === "per_100g" ? 100 : 0),
          minWeightGrams: productData.pricingModel === "per_100g" ? 100 : 0,
          maxWeightGrams: productData.maxWeightGrams || 0,
          weightStepGrams: 50,
          ...weightPricing,
          isActive: true,
          isVisible: true,
          isAvailable: true,
          sortOrder: productSort,
          publishedAt: now,
          ui: { cardSize: productCardSize(productData) },
          isCustomizable: productIsCustomizable(productData),
          availableFor: productData.availableFor || (["fruit_salad", "greek_yogurt"].includes(productData.key) || productData.category === "ice_cream" ? ["one_time"] : ["one_time", "subscription"])
        },
      },
      { upsert: true, new: true }
    );
    productSort += 10;
    await ProductOptionGroup.deleteMany({ productId: product._id });
    await ProductGroupOption.deleteMany({ productId: product._id });
    for (let index = 0; index < (productData.groups || []).length; index += 1) {
      const [groupKey, minSelections, maxSelections] = productData.groups[index];
      const group = groupMap.get(groupKey);
      await ProductOptionGroup.create({
        productId: product._id,
        groupId: group._id,
        minSelections,
        maxSelections,
        isRequired: minSelections > 0,
        sortOrder: (index + 1) * 10,
        isActive: true,
        isVisible: true,
        isAvailable: true,
      });
      const optionNames = (productData.optionNames && productData.optionNames[groupKey]) || groups[groupKey][1];
      for (let optionIndex = 0; optionIndex < optionNames.length; optionIndex += 1) {
        const optionName = optionNames[optionIndex];
        const option = optionMap.get(`${groupKey}:${optionName}`);
        await ProductGroupOption.create({
          productId: product._id,
          groupId: group._id,
          optionId: option._id,
          ...((groupKey === "proteins") ? proteinPricing(optionName, productData.key) : {}),
          isActive: true,
          isVisible: true,
          isAvailable: true,
          sortOrder: (optionIndex + 1) * 10,
        });
      }
    }
  }

  await deactivateLegacyCategories();

  const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");
  const plsProduct = await MenuProduct.findOne({ key: "premium_large_salad" });
  if (plsProduct) {
    await PremiumUpgradeConfig.updateOne(
      { premiumKey: "premium_large_salad" },
      {
        $set: {
          sourceType: "menu_product",
          sourceId: plsProduct._id,
          selectionType: "premium_large_salad",
          upgradeDeltaHalala: 2900,
          currency: "SAR",
          status: "active",
          isEnabled: true,
          isVisible: true,
        }
      },
      { upsert: true }
    );
  }

  await publishMenu({ actor, notes });
  return { products: productRows.length, categories: categoryRows.length, skipped: false, mode: seedMode };
}

async function main() {
  assertSafeSeedTarget();
  await mongoose.connect(uri);
  const result = await seedOneTimeMenu();
  if (result.skipped) {
    console.log(`Skipped one-time menu seed because catalog data already exists (mode=${result.mode})`);
  } else {
    console.log(`Seeded one-time menu: ${result.products} products (mode=${result.mode})`);
  }
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = {
  categoryRows,
  groupDefinitions,
  productRows,
  productKeyAliases,
  groupKeyAliases,
  legacyCategoryKeys,
  proteinPricing,
  resolveSeedMode,
  seedOneTimeMenu,
};
