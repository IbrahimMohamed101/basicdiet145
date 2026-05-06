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

const uri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet";
const now = new Date();
const PRODUCTION_SEED_OVERRIDE = "MENU_SEED_ALLOW_PRODUCTION";

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

function optionKey(groupKey, index) {
  return key(`${groupKey}_${String(index + 1).padStart(2, "0")}`);
}

function isExplicitlyAllowed(value) {
  return String(value || "").trim().toLowerCase() === "true";
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

const categories = [
  ["salads", "السلطات", "Salads"],
  ["meals", "الوجبات", "Meals"],
  ["cold_sandwiches", "الساندويتش البارد", "Cold Sandwiches"],
  ["sourdough", "ساوردو", "Sourdough"],
  ["desserts", "الحلويات", "Desserts"],
  ["juices", "العصائر", "Juices"],
  ["drinks", "المشروبات", "Drinks"],
  ["ice_cream", "الآيس كريم", "Ice Cream"],
];

const groups = {
  leafy_greens: ["ورقيات", ["خس", "جرجير", "ملفوف"]],
  vegetables: ["خضراوات وبقوليات", ["طماطم", "جزر", "خيار", "ذرة", "حمص", "هالبينو", "فاصوليا حمراء", "بنجر", "فلفل حار", "كزبرة", "فطر", "بروكلي", "خضار مشكل مشوي", "بصل احمر", "بصل اخضر", "زيتون اخضر", "زيتون اسود", "نعناع", "بصل مخلل"]],
  fruits: ["فواكه", ["مانجا", "تفاح اخضر", "رمان", "فراولة", "توت ازرق", "بطيخ", "شمام", "تمر", "عسل"]],
  proteins: ["بروتينات", ["بيض مسلوق", "تونا", "فاهيتا", "دجاج سبايسي", "دجاج توابل إيطالية", "دجاج تكا", "دجاج آسيوي", "استربس", "دجاج مشوي", "دجاج مكسيكي", "كرات لحم", "لحم استرغانوف", "ستيك لحم", "جمبري", "سمك فيليه", "سالمون", "دجاج زبدة", "دجاج كريمة", "دجاج كاري وجوز الهند"]],
  cheese_nuts: ["الأجبان والمكسرات", ["كاجو", "عين الجمل", "سمسم", "فيتا", "بارميزان"]],
  sauces: ["الصوصات", ["رانش", "سبايسي رانش", "صوص بيستو", "بالسميك", "سيزر", "هاني ماستر", "زبادي بالنعناع", "عسل بالثوم"]],
  carbs: ["كارب", ["رز ابيض", "رز بالكركم", "رز برياني", "كينوا", "باستا الفريدو", "باستا بالصوص الأحمر", "بطاطس مشوي", "بطاطا حلوة", "خضار مشكل مشوي"]],
  nuts: ["المكسرات", ["كاجو", "عين الجمل", "سمسم"]],
};

const BASIC_SALAD_FRUITS = ["مانجا", "تفاح اخضر", "رمان", "فراولة", "توت ازرق", "بطيخ", "شمام", "تمر"];
const BASIC_SALAD_PROTEINS = ["بيض مسلوق", "تونا", "فاهيتا", "دجاج سبايسي", "دجاج توابل إيطالية", "دجاج تكا", "دجاج آسيوي", "استربس", "دجاج مشوي", "دجاج مكسيكي", "كرات لحم", "لحم استرغانوف", "ستيك لحم", "جمبري", "سمك فيليه", "سالمون"];
const BASIC_MEAL_PROTEINS = ["بيض مسلوق", "تونا", "فاهيتا", "دجاج زبدة", "دجاج كريمة", "دجاج كاري وجوز الهند", "دجاج سبايسي", "دجاج توابل إيطالية", "دجاج تكا", "دجاج آسيوي", "استربس", "دجاج مشوي", "دجاج مكسيكي", "كرات لحم", "لحم استرغانوف", "ستيك لحم", "جمبري", "سمك فيليه", "سالمون"];

const products = [
  { key: "basic_salad", category: "salads", itemType: "basic_salad", name: "سلطة بيسك", pricingModel: "per_100g", priceHalala: 2900, groups: [["leafy_greens", 0, 2], ["vegetables", 0, 19], ["fruits", 0, 4], ["proteins", 0, 1], ["cheese_nuts", 0, 2], ["sauces", 0, 1]], optionNames: { fruits: BASIC_SALAD_FRUITS, proteins: BASIC_SALAD_PROTEINS } },
  { key: "basic_meal", category: "meals", itemType: "basic_meal", name: "وجبة بيسك", pricingModel: "per_100g", priceHalala: 1900, groups: [["carbs", 0, 3], ["proteins", 0, 1]], optionNames: { proteins: BASIC_MEAL_PROTEINS } },
  { key: "fruit_salad", category: "salads", itemType: "fruit_salad", name: "سلطة فواكه", pricingModel: "fixed", priceHalala: 1700, defaultWeightGrams: 150, groups: [["fruits", 0, 9]] },
  { key: "greek_yogurt", category: "salads", itemType: "greek_yogurt", name: "زبادي يوناني", pricingModel: "fixed", priceHalala: 1700, defaultWeightGrams: 200, groups: [["fruits", 0, 5], ["nuts", 0, null]] },
  { key: "green_salad", category: "salads", itemType: "green_salad", name: "سلطة خضرا", pricingModel: "per_100g", priceHalala: 1500, groups: [["leafy_greens", 0, 2], ["vegetables", 0, 19], ["sauces", 0, 1]] },
  ...[
    ["cold_boiled_egg", "بيض مسلوق", 900],
    ["cold_turkey", "تركي", 1300],
    ["cold_halloumi_classic", "حلوم كلاسيكي", 1300],
    ["cold_tuna", "تونا", 1300],
    ["cold_scrambled_egg", "بيض اسكرامبل", 1300],
    ["cold_chicken_fajita", "دجاج فاهيتا", 1300],
    ["cold_mexican_chicken", "دجاج مكسيكي", 1300],
    ["cold_grilled_chicken", "دجاج مشوي", 1300],
  ].map(([productKey, ar, priceHalala]) => ({ key: productKey, category: "cold_sandwiches", itemType: "cold_sandwich", name: ar, pricingModel: "fixed", priceHalala })),
  ...[
    ["sourdough_halloumi", "ساوردو حلومي", 2300],
    ["sourdough_turkey", "ساوردو تركي", 2300],
    ["sourdough_tuna", "ساوردو تونا", 2300],
    ["sourdough_grilled_chicken", "ساوردو دجاج مشوي", 2300],
  ].map(([productKey, ar, priceHalala]) => ({ key: productKey, category: "sourdough", itemType: "sourdough", name: ar, pricingModel: "fixed", priceHalala })),
  ...[
    ["apple_cinnamon_muffin_2pcs", "مافن التفاح بالقرفة قطعتين", 1200],
    ["berry_cheesecake", "تشيز كيك بالتوت", 1900],
    ["strawberry_cheesecake", "تشيز كيك بالفراولة", 1900],
    ["dark_brownies", "براونيز داكن", 1300],
    ["protein_bar", "بروتين بار", 1500],
    ["basic_classic", "بيسك كلاسيك", 1400],
    ["protein_chocolate_cake", "كيك شوكولاتة بروتين", 1900],
  ].map(([productKey, ar, priceHalala]) => ({ key: productKey, category: "desserts", itemType: "dessert", name: ar, pricingModel: "fixed", priceHalala })),
  ...[
    ["berry_blast", "بيري بلاست", 1100],
    ["berry_prot", "بيري بروت", 1300],
    ["classic_green", "كلاسيك جرين", 1100],
    ["beet_punch", "بيت بنش", 1100],
    ["orange_carrot", "برتقال وجزر", 1100],
    ["watermelon_mint", "بطيخ بالنعناع", 1100],
  ].map(([productKey, ar, priceHalala]) => ({ key: productKey, category: "juices", itemType: "juice", name: ar, pricingModel: "fixed", priceHalala })),
  ...[
    ["protein_drink", "مشروب بروتين", 1900],
    ["diet_iced_tea", "ايس تى دايت", 400],
    ["diet_soda", "صودا دايت", 300],
    ["water", "مياه عادية", 200],
  ].map(([productKey, ar, priceHalala]) => ({ key: productKey, category: "drinks", itemType: "drink", name: ar, pricingModel: "fixed", priceHalala })),
  ...[
    ["vanilla_ice_cream", "ايس كريم فانيليا", 1300],
    ["chocolate_ice_cream", "ايس كريم شوكولا", 1300],
    ["ice_cream_addon", "إضافة ايس كريم", 700],
  ].map(([productKey, ar, priceHalala]) => ({ key: productKey, category: "ice_cream", itemType: "ice_cream", name: ar, pricingModel: "fixed", priceHalala })),
];

function proteinPricing(optionName, productKey) {
  const isMeal = productKey === "basic_meal";
  if (["كرات لحم", "لحم استرغانوف"].includes(optionName)) return { extraPriceHalala: 300, extraWeightUnitGrams: 50, extraWeightPriceHalala: 600 };
  if (["ستيك لحم"].includes(optionName)) return { extraPriceHalala: isMeal ? 2000 : 1600, extraWeightUnitGrams: 50, extraWeightPriceHalala: 1000 };
  if (["جمبري", "سالمون"].includes(optionName)) return { extraPriceHalala: isMeal ? 2000 : 1600, extraWeightUnitGrams: 50, extraWeightPriceHalala: 1000 };
  if (optionName.includes("دجاج")) return { extraWeightUnitGrams: 50, extraWeightPriceHalala: 500 };
  if (optionName.includes("لحم")) return { extraWeightUnitGrams: 50, extraWeightPriceHalala: 600 };
  return {};
}

async function upsertCategory(row, sortOrder) {
  return MenuCategory.findOneAndUpdate(
    { key: row[0] },
    { $set: { key: row[0], name: name(row[1], row[2]), isActive: true, sortOrder, publishedAt: now } },
    { upsert: true, new: true }
  );
}

async function main() {
  assertSafeSeedTarget();
  await mongoose.connect(uri);
  const categoryMap = new Map();
  for (let i = 0; i < categories.length; i += 1) {
    const category = await upsertCategory(categories[i], (i + 1) * 10);
    categoryMap.set(category.key, category);
  }

  const groupMap = new Map();
  const optionMap = new Map();
  let groupSort = 10;
  for (const [groupKey, [groupName, optionNames]] of Object.entries(groups)) {
    const group = await MenuOptionGroup.findOneAndUpdate(
      { key: groupKey },
      { $set: { key: groupKey, name: name(groupName), isActive: true, sortOrder: groupSort, publishedAt: now } },
      { upsert: true, new: true }
    );
    groupMap.set(groupKey, group);
    let optionSort = 10;
    for (let optionIndex = 0; optionIndex < optionNames.length; optionIndex += 1) {
      const optionName = optionNames[optionIndex];
      const optionSeedKey = optionKey(groupKey, optionIndex);
      const option = await MenuOption.findOneAndUpdate(
        { groupId: group._id, key: optionSeedKey },
        { $set: { groupId: group._id, key: optionSeedKey, name: name(optionName), extraWeightUnitGrams: groupKey === "proteins" ? 50 : 0, isActive: true, sortOrder: optionSort, publishedAt: now } },
        { upsert: true, new: true }
      );
      optionMap.set(`${groupKey}:${optionName}`, option);
      optionSort += 10;
    }
    groupSort += 10;
  }

  let productSort = 10;
  for (const productData of products) {
    const product = await MenuProduct.findOneAndUpdate(
      { key: productData.key },
      {
        $set: {
          categoryId: categoryMap.get(productData.category)._id,
          key: productData.key,
          name: name(productData.name),
          itemType: productData.itemType,
          pricingModel: productData.pricingModel,
          priceHalala: productData.priceHalala,
          baseUnitGrams: 100,
          defaultWeightGrams: productData.defaultWeightGrams || (productData.pricingModel === "per_100g" ? 100 : 0),
          minWeightGrams: productData.pricingModel === "per_100g" ? 100 : 0,
          weightStepGrams: 50,
          isActive: true,
          sortOrder: productSort,
          publishedAt: now,
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
          sortOrder: (optionIndex + 1) * 10,
        });
      }
    }
  }

  await publishMenu({ actor: { role: "script" }, notes: "Seed one-time pickup menu" });
  console.log(`Seeded one-time menu: ${products.length} products`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
