#!/usr/bin/env node

require("dotenv").config();
const mongoose = require("mongoose");

const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const Addon = require("../src/models/Addon");
const BuilderProtein = require("../src/models/BuilderProtein");
const BuilderCategory = require("../src/models/BuilderCategory");
const { publishMenu } = require("../src/services/orders/menuCatalogService");

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
const now = new Date();
const SYSTEM_CURRENCY = "SAR";

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

// Data Definitions
const categoryRows = [
  ["custom_order", "اطلب على مزاجك", "Custom Order"],
  ["light_options", "اختيارات خفيفة", "Light Options"],
  ["cold_sandwiches", "الساندويتش البارد", "Cold Sandwiches"],
  ["sourdough", "الساندويشات", "Sourdough Sandwiches"],
  ["desserts", "الحلويات", "Desserts"],
  ["juices", "العصائر", "Juices"],
  ["drinks", "المشروبات", "Drinks"],
  ["ice_cream", "الايس كريم", "Ice Cream"],
];

const groupDefinitions = {
  leafy_greens: { name: name("ورقيات", "Leafy Greens"), options: ["خس", "جرجير", "ملفوف"] },
  vegetables_legumes: { name: name("خضراوات وبقوليات", "Vegetables & Legumes"), options: ["طماطم", "جزر", "خيار", "ذرة", "حمص", "هالبينو", "فاصوليا حمراء", "بنجر", "فلفل حار", "كزبرة", "فطر", "بروكلي", "خضار مشكل مشوي", "بصل احمر", "بصل اخضر", "زيتون اخضر", "زيتون اسود", "نعناع", "بصل مخلل"] },
  fruits: { name: name("فواكه", "Fruits"), options: ["مانجا", "تفاح اخضر", "رمان", "فراولة", "توت ازرق", "بطيخ", "شمام", "تمر", "عسل"] },
  proteins: { name: name("بروتينات", "Proteins"), options: ["بيض مسلوق", "تونا", "فاهيتا", "دجاج سبايسي", "دجاج توابل إيطالية", "دجاج تكا", "دجاج آسيوي", "استربس", "دجاج مشوي", "دجاج مكسيكي", "كرات لحم", "لحم استرغانوف", "ستيك لحم", "جمبري", "سمك فيليه", "سالمون", "دجاج زبدة", "دجاج كريمة", "دجاج كاري وجوز الهند"] },
  cheese_nuts: { name: name("الأجبان والمكسرات", "Cheese & Nuts"), options: ["كاجو", "عين الجمل", "سمسم", "فيتا", "بارميزان"] },
  sauces: { name: name("الصوصات", "Sauces"), options: ["رانش", "سبايسي رانش", "صوص بيستو", "بالسميك", "سيزر", "هاني ماستر", "زبادي بالنعناع", "عسل بالثوم"] },
  carbs: { name: name("كارب", "Carbs"), options: ["رز ابيض", "رز بالكركم", "رز برياني", "كينوا", "باستا الفريدو", "باستا بالصوص الأحمر", "بطاطس مشوي", "بطاطا حلوة", "خضار مشكل مشوي"] },
};

const premiumProteinsMap = {
  "ستيك لحم": { proteinFamilyKey: "beef", premiumKey: "beef_steak", displayCategoryKey: "premium", extraFeeHalala: 2200 },
  "جمبري": { proteinFamilyKey: "seafood", premiumKey: "shrimp", displayCategoryKey: "premium", extraFeeHalala: 2000 },
  "سالمون": { proteinFamilyKey: "seafood", premiumKey: "salmon", displayCategoryKey: "premium", extraFeeHalala: 2500 },
};

const productRows = [
  // Shared / Subscription Special
  { key: "basic_salad", category: "custom_order", itemType: "basic_salad", name: name("سلطة بيسك / كبيرة", "Basic / Large Salad"), pricingModel: "per_100g", priceHalala: 2900, availableFor: ["one_time", "subscription"], groups: [["leafy_greens", 2, 2], ["vegetables_legumes", 0, 19], ["fruits", 0, 4], ["proteins", 1, 1], ["cheese_nuts", 0, 2], ["sauces", 1, 1]] },
  { key: "premium_large_salad", category: "custom_order", itemType: "premium_large_salad", name: name("سلطة كبيرة مميزة", "Premium Large Salad"), pricingModel: "per_100g", priceHalala: 2900, availableFor: ["subscription"], groups: [["leafy_greens", 1, 2], ["vegetables_legumes", 0, 19], ["fruits", 0, 4], ["proteins", 1, 1], ["sauces", 1, 1]], optionNames: { proteins: ["ستيك لحم", "جمبري", "سالمون"] } },
  { key: "basic_meal", category: "custom_order", itemType: "basic_meal", name: name("وجبة بيسك", "Basic Meal"), pricingModel: "per_100g", priceHalala: 1900, availableFor: ["one_time", "subscription"], groups: [["carbs", 3, 3], ["proteins", 1, 1]] },
  
  // Custom One-Time
  { key: "fruit_salad", category: "custom_order", itemType: "fruit_salad", name: name("سلطة فواكه", "Fruit Salad"), pricingModel: "fixed", priceHalala: 1700, availableFor: ["one_time"], groups: [["fruits", 9, 9]] },
  { key: "greek_yogurt", category: "custom_order", itemType: "greek_yogurt", name: name("زبادي يوناني", "Greek Yogurt"), pricingModel: "fixed", priceHalala: 1700, availableFor: ["one_time"], groups: [["fruits", 5, 5], ["cheese_nuts", 0, 3]] },

  // Cold Sandwiches
  ...["boiled_egg", "turkey", "classic_halloumi", "tuna", "scrambled_egg", "chicken_fajita", "mexican_chicken", "grilled_chicken"].map(k => ({ key: `${k}_cold_sandwich`, category: "cold_sandwiches", itemType: "cold_sandwich", name: name(k), pricingModel: "fixed", priceHalala: 1300, availableFor: ["one_time", "subscription"] })),

  // Desserts / Snacks
  { key: "berry_cheesecake", category: "desserts", itemType: "dessert", name: name("تشيز كيك بالتوت", "Berry Cheesecake"), pricingModel: "fixed", priceHalala: 1900, availableFor: ["one_time", "subscription"] },
  { key: "protein_chocolate_cake", category: "desserts", itemType: "dessert", name: name("كيكة بروتين بالشوكولاتة", "Protein Chocolate Cake"), pricingModel: "fixed", priceHalala: 1900, availableFor: ["one_time", "subscription"] },

  // Juices
  { key: "berry_blast", category: "juices", itemType: "juice", name: name("بيري بلاست", "Berry Blast"), pricingModel: "fixed", priceHalala: 1100, availableFor: ["one_time", "subscription"] },
  { key: "berry_prot", category: "juices", itemType: "juice", name: name("بيري بروت", "Berry Prot"), pricingModel: "fixed", priceHalala: 1300, availableFor: ["one_time", "subscription"] },
];

async function seed() {
  if (!uri) throw new Error("MONGO_URI is required");
  await mongoose.connect(uri);
  console.log("Connected to MongoDB for Complete Seeding...");

  // 1. Categories
  const categoryMap = new Map();
  for (let i = 0; i < categoryRows.length; i++) {
    const row = categoryRows[i];
    const doc = await MenuCategory.findOneAndUpdate(
      { key: row[0] },
      { $set: { key: row[0], name: name(row[1], row[2]), isActive: true, sortOrder: (i + 1) * 10, publishedAt: now } },
      { upsert: true, new: true }
    );
    categoryMap.set(doc.key, doc);
  }

  // 2. Option Groups & Options
  const groupMap = new Map();
  const optionMap = new Map();
  for (const [gKey, def] of Object.entries(groupDefinitions)) {
    const group = await MenuOptionGroup.findOneAndUpdate(
      { key: gKey },
      { $set: { key: gKey, name: def.name, isActive: true, sortOrder: 10, publishedAt: now } },
      { upsert: true, new: true }
    );
    groupMap.set(gKey, group);

    for (let i = 0; i < def.options.length; i++) {
      const oNameAr = def.options[i];
      const oKey = key(`${gKey}_${oNameAr}`);
      const premium = premiumProteinsMap[oNameAr] || {};
      
      const option = await MenuOption.findOneAndUpdate(
        { groupId: group._id, key: oKey },
        { 
          $set: { 
            groupId: group._id, 
            key: oKey, 
            name: name(oNameAr), 
            isActive: true, 
            sortOrder: (i + 1) * 10, 
            publishedAt: now,
            availableFor: ["one_time", "subscription"],
            availableForSubscription: true,
            ...premium,
            selectionType: premium.premiumKey ? "premium" : "standard"
          } 
        },
        { upsert: true, new: true }
      );
      optionMap.set(`${gKey}:${oNameAr}`, option);

      // Backup to BuilderProtein
      if (premium.premiumKey) {
        await BuilderProtein.updateOne(
          { premiumKey: premium.premiumKey },
          { $set: { ...premium, name: name(oNameAr), isActive: true, isPremium: true } },
          { upsert: true }
        );
      }
    }
  }

  // 3. Products
  for (const p of productRows) {
    const product = await MenuProduct.findOneAndUpdate(
      { key: p.key },
      { 
        $set: { 
          categoryId: categoryMap.get(p.category)._id,
          key: p.key,
          name: p.name,
          itemType: p.itemType,
          pricingModel: p.pricingModel,
          priceHalala: p.priceHalala,
          isActive: true,
          publishedAt: now,
          availableFor: p.availableFor
        } 
      },
      { upsert: true, new: true }
    );

    // Linking
    if (p.groups) {
      await ProductOptionGroup.deleteMany({ productId: product._id });
      await ProductGroupOption.deleteMany({ productId: product._id });

      for (const [gKey, min, max] of p.groups) {
        const group = groupMap.get(gKey);
        if (!group) continue;

        await ProductOptionGroup.findOneAndUpdate(
          { productId: product._id, groupId: group._id },
          { 
            $set: { 
              productId: product._id, 
              groupId: group._id, 
              minSelections: min, 
              maxSelections: max, 
              isRequired: min > 0, 
              isActive: true 
            } 
          },
          { upsert: true }
        );
        
        let oNames = p.optionNames?.[gKey] || groupDefinitions[gKey].options;
        oNames = [...new Set(oNames)]; // Ensure unique names

        for (const oName of oNames) {
          const option = optionMap.get(`${gKey}:${oName}`);
          if (option) {
            await ProductGroupOption.findOneAndUpdate(
              { productId: product._id, groupId: group._id, optionId: option._id },
              { 
                $set: { 
                  productId: product._id, 
                  groupId: group._id, 
                  optionId: option._id, 
                  isActive: true 
                } 
              },
              { upsert: true }
            );
          }
        }
      }
    }

    // Sync to Addon collection if needed (for subscription items)
    if (p.availableFor.includes("subscription") && (p.itemType === "juice" || p.itemType === "dessert" || p.itemType === "snack" || p.key === "small_salad")) {
       await Addon.findOneAndUpdate(
         { name: p.name },
         { 
           $set: { 
             name: p.name, 
             priceHalala: p.priceHalala, 
             price: p.priceHalala / 100,
             kind: "item", 
             category: p.itemType === "juice" ? "juice" : "snack",
             isActive: true 
           } 
         },
         { upsert: true }
       );
    }
  }

  await publishMenu({ notes: "Unified Catalog Seeded Successfully" });
  console.log("Done!");
  await mongoose.disconnect();
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
