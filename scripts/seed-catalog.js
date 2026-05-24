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
const Setting = require("../src/models/Setting");
const BuilderProtein = require("../src/models/BuilderProtein");
const BuilderCategory = require("../src/models/BuilderCategory");
const { publishMenu } = require("../src/services/orders/menuCatalogService");
const { pickupLocations, settings } = require("./fixtures/subscription-demo-data");

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
  leafy_greens: { 
    name: name("ورقيات", "Leafy Greens"), 
    options: [["خس", "Lettuce"], ["جرجير", "Arugula"], ["ملفوف", "Cabbage"]] 
  },
  vegetables_legumes: { 
    name: name("خضراوات وبقوليات", "Vegetables & Legumes"), 
    options: [
      ["طماطم", "Tomato"], ["جزر", "Carrots"], ["خيار", "Cucumber"], ["ذرة", "Corn"], ["حمص", "Chickpeas"], 
      ["هالبينو", "Jalapeno"], ["فاصوليا حمراء", "Red Beans"], ["بنجر", "Beets"], ["فلفل حار", "Hot Pepper"], 
      ["كزبرة", "Coriander"], ["فطر", "Mushrooms"], ["بروكلي", "Broccoli"], ["خضار مشكل مشوي", "Grilled Mixed Veg"], 
      ["بصل احمر", "Red Onion"], ["بصل اخضر", "Green Onion"], ["زيتون اخضر", "Green Olives"], ["زيتون اسود", "Black Olives"], 
      ["نعناع", "Mint"], ["بصل مخلل", "Pickled Onion"]
    ] 
  },
  fruits: { 
    name: name("فواكه", "Fruits"), 
    options: [
      ["مانجا", "Mango"], ["تفاح اخضر", "Green Apple"], ["رمان", "Pomegranate"], ["فراولة", "Strawberry"], 
      ["توت ازرق", "Blueberries"], ["بطيخ", "Watermelon"], ["شمام", "Melon"], ["تمر", "Dates"], ["عسل", "Honey"]
    ] 
  },
  proteins: { 
    name: name("بروتينات", "Proteins"), 
    options: [
      ["بيض مسلوق", "Boiled Egg"], ["تونا", "Tuna"], ["فاهيتا", "Fajita Chicken"], ["دجاج سبايسي", "Spicy Chicken"], 
      ["دجاج توابل إيطالية", "Italian Seasoned Chicken"], ["دجاج تكا", "Chicken Tikka"], ["دجاج آسيوي", "Asian Chicken"], 
      ["دجاج كاري وجوز الهند", "Curry Coconut Chicken"], ["كفتة غنم", "Lamb Kofta"], ["ستروجانوف دجاج", "Chicken Stroganoff"], 
      ["ستيك لحم", "Beef Steak"], ["جمبري", "Shrimp"], ["سالمون", "Salmon"]
    ] 
  },
  carbs: { 
    name: name("كارب", "Carbs"), 
    options: [
      ["ارز ابيض", "White Rice"], ["ارز اسمر", "Brown Rice"], ["بطاطس مهروسة (ماش بوتيتو)", "Mashed Potatoes"], 
      ["ارز بالخضار", "Vegetable Rice"], ["ارز مبهر", "Spiced Rice"], ["خضار مشكل مشوي", "Grilled Mixed Veg"]
    ] 
  },
  sauces: { 
    name: name("الصوصات", "Sauces"), 
    options: [
      ["ألف جزيرة", "Thousand Island"], ["خردل بالعسل", "Honey Mustard"], ["زبادي بالنعناع", "Mint Yogurt"], 
      ["سيزر", "Caesar"], ["ايطالي", "Italian"], ["حار", "Spicy"], ["طحينة", "Tahini"], ["عسل بالثوم", "Honey Garlic"]
    ] 
  },
  cheese_nuts: { 
    name: name("الأجبان والمكسرات", "Cheese & Nuts"), 
    options: [["فيتا", "Feta"], ["مازرولا", "Mozzarella"], ["قريش", "Cottage Cheese"], ["شيدر", "Cheddar"], ["بارميزان", "Parmesan"], ["كاجو", "Cashews"], ["لوز", "Almonds"], ["جوز", "Walnuts"]] 
  },
  nuts: { 
    name: name("المكسرات", "Nuts"), 
    options: [["كاجو", "Cashews"], ["لوز", "Almonds"], ["جوز", "Walnuts"], ["سمسم", "Sesame"]] 
  }
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

  // Default structure
  const result = {
    extraPriceHalala: 0,
    extraWeightUnitGrams: 0,
    extraWeightPriceHalala: 0,
  };

  if (["كرات لحم", "لحم استرغانوف"].includes(optionName)) {
    return { extraPriceHalala: 300, extraWeightUnitGrams: 50, extraWeightPriceHalala: 600 };
  }
  if (["ستيك لحم", "جمبري", "سالمون"].includes(optionName)) {
    return { 
      extraPriceHalala: isMeal ? 2000 : 1600, 
      extraWeightUnitGrams: 50, 
      extraWeightPriceHalala: 1000 
    };
  }
  if (chickenOptions.has(optionName)) {
    return { ...result, extraWeightUnitGrams: 50, extraWeightPriceHalala: 500 };
  }
  if (optionName.includes("لحم")) {
    return { ...result, extraWeightUnitGrams: 50, extraWeightPriceHalala: 600 };
  }
  return result;
}

const productRows = [
  // Shared / Subscription Special
  { key: "basic_salad", category: "custom_order", itemType: "basic_salad", name: name("سلطة بيسك", "Basic Salad"), pricingModel: "per_100g", priceHalala: 2900, availableFor: ["one_time", "subscription"], groups: [["leafy_greens", 2, 2], ["vegetables_legumes", 0, 19], ["fruits", 0, 4], ["proteins", 1, 1], ["cheese_nuts", 0, 2], ["sauces", 1, 1]] },
  { key: "basic_meal", category: "custom_order", itemType: "basic_meal", name: name("وجبة بيسك", "Basic Meal"), pricingModel: "per_100g", priceHalala: 1900, availableFor: ["one_time", "subscription"], groups: [["carbs", 3, 3], ["proteins", 1, 1]] },

  // Custom One-Time / Shared Addons
  { key: "small_salad", category: "custom_order", itemType: "small_salad", name: name("سلطة خضراء صغيرة", "Small Green Salad"), pricingModel: "fixed", priceHalala: 900, availableFor: ["one_time", "subscription"] },
  { key: "green_salad", category: "custom_order", itemType: "green_salad", name: name("سلطة خضرا", "Green Salad"), pricingModel: "per_100g", priceHalala: 1500, availableFor: ["one_time", "subscription"], groups: [["leafy_greens", 2, 2], ["vegetables_legumes", 0, 19], ["sauces", 1, 1]] },
  { key: "fruit_salad", category: "custom_order", itemType: "fruit_salad", name: name("سلطة فواكه", "Fruit Salad"), pricingModel: "fixed", priceHalala: 1700, defaultWeightGrams: 150, availableFor: ["one_time"], groups: [["fruits", 9, 9]] },
  { key: "greek_yogurt", category: "custom_order", itemType: "greek_yogurt", name: name("زبادي يوناني", "Greek Yogurt"), pricingModel: "fixed", priceHalala: 1700, defaultWeightGrams: 200, availableFor: ["one_time"], groups: [["fruits", 5, 5], ["nuts", 0, 3]] },

  // Cold Sandwiches
  ...[
    ["boiled_egg_cold_sandwich", "بيض مسلوق", "Boiled Egg", 900],
    ["turkey_cold_sandwich", "تركي", "Turkey", 1300],
    ["classic_halloumi_cold_sandwich", "حلوم كلاسيكي", "Classic Halloumi", 1300],
    ["tuna_cold_sandwich", "تونا", "Tuna", 1300],
    ["scrambled_egg_cold_sandwich", "بيض اسكرامبل", "Scrambled Egg", 1300],
    ["chicken_fajita_cold_sandwich", "دجاج فاهيتا", "Chicken Fajita", 1300],
    ["mexican_chicken_cold_sandwich", "دجاج مكسيكي", "Mexican Chicken", 1300],
    ["grilled_chicken_cold_sandwich", "دجاج مشوي", "Grilled Chicken", 1300],
  ].map(([productKey, ar, en, priceHalala]) => ({ key: productKey, category: "cold_sandwiches", itemType: "cold_sandwich", name: name(ar, en), pricingModel: "fixed", priceHalala, availableFor: ["one_time", "subscription"] })),

  // Sourdough
  ...[
    ["halloumi_sourdough", "ساوردو حلومي", "Halloumi Sourdough", 2300],
    ["turkey_sourdough", "ساوردو تركي", "Turkey Sourdough", 2300],
    ["tuna_sourdough", "ساوردو تونا", "Tuna Sourdough", 2300],
    ["grilled_chicken_sourdough", "ساوردو دجاج مشوي", "Grilled Chicken Sourdough", 2300],
  ].map(([productKey, ar, en, priceHalala]) => ({ key: productKey, category: "sourdough", itemType: "sourdough", name: name(ar, en), pricingModel: "fixed", priceHalala, availableFor: ["one_time", "subscription"] })),

  // Desserts
  ...[
    ["apple_cinnamon_muffin_2pcs", "مافن التفاح بالقرفة (قطعتين)", "Apple Cinnamon Muffin (2 pcs)", 1200],
    ["berry_cheesecake", "تشيز كيك بالتوت", "Berry Cheesecake", 1900],
    ["strawberry_cheesecake", "تشيز كيك بالفراولة", "Strawberry Cheesecake", 1900],
    ["dark_brownies", "براونيز داكن", "Dark Brownies", 1300],
    ["protein_bar", "بروتين بار", "Protein Bar", 1500],
    ["basic_classic", "بيسك كلاسيك", "Basic Classic", 1400],
    ["protein_chocolate_cake", "كيك شوكولاتة بروتين", "Protein Chocolate Cake", 1900],
  ].map(([productKey, ar, en, priceHalala]) => ({ key: productKey, category: "desserts", itemType: "dessert", name: name(ar, en), pricingModel: "fixed", priceHalala, availableFor: ["one_time", "subscription"] })),

  // Juices
  ...[
    ["berry_blast", "بيري بلاست", "Berry Blast", 1100],
    ["berry_prot", "بيري بروت", "Berry Prot", 1300],
    ["classic_green", "كلاسيك جرين", "Classic Green", 1100],
    ["beet_punch", "بيت بنش", "Beet Punch", 1100],
    ["orange_carrot", "برتقال وجزر", "Orange & Carrot", 1100],
    ["watermelon_mint", "بطيخ بالنعناع", "Watermelon Mint", 1100],
  ].map(([productKey, ar, en, priceHalala]) => ({ key: productKey, category: "juices", itemType: "juice", name: name(ar, en), pricingModel: "fixed", priceHalala, availableFor: ["one_time", "subscription"] })),

  // Drinks
  ...[
    ["protein_drink", "مشروب بروتين", "Protein Drink", 1900],
    ["diet_iced_tea", "ايس تى دايت", "Diet Iced Tea", 400],
    ["diet_soda", "صودا دايت", "Diet Soda", 300],
    ["water", "مياه عادية", "Water", 200],
  ].map(([productKey, ar, en, priceHalala]) => ({ key: productKey, category: "drinks", itemType: "drink", name: name(ar, en), pricingModel: "fixed", priceHalala, availableFor: ["one_time", "subscription"] })),

  // Ice Cream
  ...[
    ["vanilla_ice_cream", "ايس كريم فانيليا", "Vanilla Ice Cream", 1300],
    ["chocolate_ice_cream", "ايس كريم شوكولا", "Chocolate Ice Cream", 1300],
    ["ice_cream_add_on", "إضافة ايس كريم", "Ice Cream Add-on", 700],
  ].map(([productKey, ar, en, priceHalala]) => ({ key: productKey, category: "ice_cream", itemType: "ice_cream", name: name(ar, en), pricingModel: "fixed", priceHalala, availableFor: ["one_time", "subscription"] })),

  { 
    key: "premium_large_salad", 
    category: "custom_order", 
    itemType: "premium_large_salad", 
    name: name("سلطة كبيرة مميزة", "Premium Large Salad"), 
    pricingModel: "per_100g", 
    priceHalala: 2900, 
    availableFor: ["subscription"],
    groups: [["leafy_greens", 1, 2], ["vegetables_legumes", 0, 19], ["fruits", 0, 4], ["proteins", 1, 1], ["sauces", 1, 1]], 
    optionNames: { proteins: ["ستيك لحم", "جمبري", "سالمون"] } 
  },
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

    // Clean old options to avoid stale data/key collisions
    await MenuOption.deleteMany({ groupId: group._id });

    for (let i = 0; i < def.options.length; i++) {
      const [oNameAr, oNameEn] = def.options[i];
      const oKey = key(`${gKey}_${oNameEn}`);
      
      const proteinMetadataMap = {
        "ستيك لحم": { proteinFamilyKey: "beef", premiumKey: "beef_steak", displayCategoryKey: "premium", extraFeeHalala: 2000 },
        "جمبري": { proteinFamilyKey: "fish", premiumKey: "shrimp", displayCategoryKey: "premium", extraFeeHalala: 2000 },
        "سالمون": { proteinFamilyKey: "fish", premiumKey: "salmon", displayCategoryKey: "premium", extraFeeHalala: 2000 },
        "بيض مسلوق": { proteinFamilyKey: "eggs", displayCategoryKey: "eggs" },
        "تونا": { proteinFamilyKey: "fish", displayCategoryKey: "fish" },
        "كفتة غنم": { proteinFamilyKey: "beef", displayCategoryKey: "beef" },
        "فاهيتا": { proteinFamilyKey: "chicken", displayCategoryKey: "chicken" },
        "دجاج سبايسي": { proteinFamilyKey: "chicken", displayCategoryKey: "chicken" },
        "دجاج توابل إيطالية": { proteinFamilyKey: "chicken", displayCategoryKey: "chicken" },
        "دجاج تكا": { proteinFamilyKey: "chicken", displayCategoryKey: "chicken" },
        "دجاج آسيوي": { proteinFamilyKey: "chicken", displayCategoryKey: "chicken" },
        "دجاج كاري وجوز الهند": { proteinFamilyKey: "chicken", displayCategoryKey: "chicken" },
        "ستروجانوف دجاج": { proteinFamilyKey: "chicken", displayCategoryKey: "chicken" },
      };
      
      const metadata = proteinMetadataMap[oNameAr] || {};

      const option = await MenuOption.findOneAndUpdate(
        { groupId: group._id, key: oKey },
        {
          $set: {
            groupId: group._id,
            key: oKey,
            name: name(oNameAr, oNameEn),
            isActive: true,
            sortOrder: (i + 1) * 10,
            publishedAt: now,
            availableFor: ["one_time", "subscription"],
            availableForSubscription: true,
            
            extraFeeHalala: metadata.extraFeeHalala || 0,
            extraPriceHalala: 0, 
            extraWeightPriceHalala: 0,
            extraWeightUnitGrams: 0,
            premiumKey: metadata.premiumKey || null,
            isPremium: !!metadata.premiumKey,
            proteinFamilyKey: metadata.proteinFamilyKey || "",
            displayCategoryKey: metadata.displayCategoryKey || "",
            selectionType: metadata.premiumKey ? "premium" : "standard"
          }
        },
        { upsert: true, new: true }
      );
      optionMap.set(`${gKey}:${oNameAr}`, option);

      // Backup to BuilderProtein
      if (metadata.premiumKey) {
        await BuilderProtein.updateOne(
          { premiumKey: metadata.premiumKey },
          { $set: { ...metadata, name: name(oNameAr, oNameEn), isActive: true, isPremium: true } },
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
          baseUnitGrams: 100,
          defaultWeightGrams: p.defaultWeightGrams || (p.pricingModel === "per_100g" ? 100 : 0),
          minWeightGrams: p.pricingModel === "per_100g" ? 100 : 0,
          maxWeightGrams: p.maxWeightGrams || 0,
          weightStepGrams: 50,
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
                  ...(gKey === "proteins" ? proteinPricing(oName, p.key) : {}),
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
    const isSubscriptionAddon = p.availableFor.includes("subscription") &&
      (p.itemType === "juice" || p.itemType === "dessert" || p.itemType === "snack" || p.key === "small_salad" || p.category === "desserts" || p.category === "juices");

    if (isSubscriptionAddon) {
      await Addon.findOneAndUpdate(
        { name: p.name },
        {
          $set: {
            name: p.name,
            priceHalala: p.priceHalala,
            price: p.priceHalala / 100,
            kind: "item",
            category: p.category === "juices" ? "juice" : "snack",
            billingMode: "flat_once",
            isActive: true
          }
        },
        { upsert: true }
      );
    }
  }

  await publishMenu({ notes: "Unified Catalog Seeded Successfully" });

  // 4. Seeding Addon Plans (Subscription level categories)
  const planAddons = [
    { name: name("اشتراك العصير", "Juice Subscription"), priceHalala: 1100, category: "juice", sortOrder: 1 },
    { name: name("اشتراك السناك", "Snack Subscription"), priceHalala: 1200, category: "snack", sortOrder: 2 },
    { name: name("اشتراك السلطة الصغيرة", "Small Salad Subscription"), priceHalala: 1200, category: "small_salad", sortOrder: 3 },
  ];

  for (const plan of planAddons) {
    await Addon.findOneAndUpdate(
      { name: plan.name },
      {
        $set: {
          ...plan,
          price: plan.priceHalala / 100,
          kind: "plan",
          billingMode: "per_day",
          isActive: true
        }
      },
      { upsert: true }
    );
  }

  // 5. Sync Pickup Locations (Branches)
  if (Array.isArray(pickupLocations) && pickupLocations.length > 0) {
    await Setting.findOneAndUpdate(
      { key: "pickup_locations" },
      {
        $set: {
          key: "pickup_locations",
          value: pickupLocations,
          description: "System Pickup Locations (Branches)"
        }
      },
      { upsert: true }
    );
    console.log(`Synced ${pickupLocations.length} pickup locations.`);
  }

  // 6. Sync Base Settings (VAT, Pricing, Windows)
  if (settings && typeof settings === "object") {
    const settingEntries = Object.entries(settings);
    for (const [key, value] of settingEntries) {
      await Setting.findOneAndUpdate(
        { key },
        { $set: { key, value, description: "System Base Setting" } },
        { upsert: true }
      );
    }
    console.log(`Synced ${settingEntries.length} base settings (VAT, Pricing, etc.).`);
  }

  console.log("Done!");
  await mongoose.disconnect();
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
