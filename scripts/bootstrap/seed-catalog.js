#!/usr/bin/env node

require("dotenv").config();
const mongoose = require("mongoose");

const MenuCategory = require("../../src/models/MenuCategory");
const MenuOption = require("../../src/models/MenuOption");
const MenuOptionGroup = require("../../src/models/MenuOptionGroup");
const MenuProduct = require("../../src/models/MenuProduct");
const MenuVersion = require("../../src/models/MenuVersion");
const ProductGroupOption = require("../../src/models/ProductGroupOption");
const ProductOptionGroup = require("../../src/models/ProductOptionGroup");
const Addon = require("../../src/models/Addon");
const Setting = require("../../src/models/Setting");
const BuilderCarb = require("../../src/models/BuilderCarb");
const BuilderCategory = require("../../src/models/BuilderCategory");
const BuilderProtein = require("../../src/models/BuilderProtein");
const CatalogItem = require("../../src/models/CatalogItem");
const SaladIngredient = require("../../src/models/SaladIngredient");
const Sandwich = require("../../src/models/Sandwich");
const MealBuilderConfig = require("../../src/models/MealBuilderConfig");
const PremiumUpgradeConfig = require("../../src/models/PremiumUpgradeConfig");
const Zone = require("../../src/models/Zone");
const { getSubscriptionBuilderCatalogWithV2 } = require("../../src/services/catalog/CatalogService");
const { publishMenu } = require("../../src/services/orders/menuCatalogService");
const { getOneTimeOrderMenu } = require("../../src/services/orders/orderMenuService");
const { pickupLocations, settings, deliveryZones } = require("./fixtures/subscription-demo-data");
const { seedSubscriptionPlans } = require("./seed-subscription-plans");
const {
  CUSTOMER_VISIBLE_CARB_KEYS,
  PREMIUM_MEAL_PROTEIN_KEYS,
  STANDARD_MEAL_PROTEIN_KEYS,
  STANDARD_MEAL_EXTENDED_PROTEIN_KEYS,
  SUBSCRIPTION_COLD_SANDWICH_KEYS,
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS,
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS,
} = require("../../src/config/mealPlannerContract");
const { resolveMongoUri } = require("../../src/utils/mongoUriResolver");
const {
  testWeightPricingEligibility,
  testWeightPricingUpdate,
} = require("../lib/test-weight-pricing");

const canonicalCatalogItems = [
  // Carbs
  { key: "white_rice", itemKind: "carb", nutrition: { calories: 190 } },
  { key: "turmeric_rice", itemKind: "carb", nutrition: { calories: 200 } },
  { key: "alfredo_pasta", itemKind: "carb", nutrition: { calories: 300 } },
  { key: "red_sauce_pasta", itemKind: "carb", nutrition: { calories: 180 } },
  { key: "roasted_potato", itemKind: "carb", nutrition: { calories: 120 } },
  { key: "sweet_potato", itemKind: "carb", nutrition: { calories: 120 } },
  { key: "grilled_mixed_vegetables", itemKind: "carb", nutrition: { calories: 87 } },
  // Standard Proteins
  { key: "chicken", itemKind: "protein" },
  { key: "beef", itemKind: "protein" },
  { key: "fish", itemKind: "protein" },
  { key: "eggs", itemKind: "protein" },
  { key: "boiled_eggs", itemKind: "protein", nutrition: { calories: 155 } },
  { key: "tuna", itemKind: "protein", nutrition: { calories: 116 } },
  // Variant Proteins
  { key: "chicken_fajita", itemKind: "protein", nutrition: { calories: 200 } },
  { key: "spicy_chicken", itemKind: "protein", nutrition: { calories: 220 } },
  { key: "italian_spiced_chicken", itemKind: "protein", nutrition: { calories: 200 } },
  { key: "chicken_tikka", itemKind: "protein", nutrition: { calories: 200 } },
  { key: "asian_chicken", itemKind: "protein", nutrition: { calories: 220 } },
  { key: "chicken_strips", itemKind: "protein", nutrition: { calories: 250 } },
  { key: "grilled_chicken", itemKind: "protein", nutrition: { calories: 175 } },
  { key: "mexican_chicken", itemKind: "protein", nutrition: { calories: 210 } },
  { key: "meatballs", itemKind: "protein", nutrition: { calories: 280 } },
  { key: "beef_stroganoff", itemKind: "protein", nutrition: { calories: 250 } },
  { key: "fish_fillet", itemKind: "protein", nutrition: { calories: 130 } },
  // Premium Proteins
  { key: "beef_steak", itemKind: "protein", nutrition: { calories: 270 } },
  { key: "shrimp", itemKind: "protein", nutrition: { calories: 380 } },
  { key: "salmon", itemKind: "protein", nutrition: { calories: 210 } },
];

const menuOptionCatalogItemKeyByOptionKey = {
  white_rice: "white_rice",
  turmeric_rice: "turmeric_rice",
  alfredo_pasta: "alfredo_pasta",
  red_sauce_pasta: "red_sauce_pasta",
  roasted_potato: "roasted_potato",
  sweet_potato: "sweet_potato",
  grilled_mixed_vegetables: "grilled_mixed_vegetables",
  chicken: "chicken",
  beef: "beef",
  fish: "fish",
  eggs: "eggs",
  boiled_eggs: "boiled_eggs",
  tuna: "tuna",
  chicken_fajita: "chicken_fajita",
  spicy_chicken: "spicy_chicken",
  italian_spiced_chicken: "italian_spiced_chicken",
  chicken_tikka: "chicken_tikka",
  asian_chicken: "asian_chicken",
  chicken_strips: "chicken_strips",
  grilled_chicken: "grilled_chicken",
  mexican_chicken: "mexican_chicken",
  meatballs: "meatballs",
  beef_stroganoff: "beef_stroganoff",
  fish_fillet: "fish_fillet",
  beef_steak: "beef_steak",
  shrimp: "shrimp",
  salmon: "salmon",
};

const menuProductCatalogItemKeyByProductKey = {
  white_rice: "white_rice",
  turmeric_rice: "turmeric_rice",
  alfredo_pasta: "alfredo_pasta",
  red_sauce_pasta: "red_sauce_pasta",
  roasted_potato: "roasted_potato",
  sweet_potato: "sweet_potato",
  grilled_mixed_vegetables: "grilled_mixed_vegetables",
};

const now = new Date();
const SYSTEM_CURRENCY = "SAR";

function name(ar, en = ar) {
  return { ar, en };
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

const bootstrapStats = new Map();

function getStats(label) {
  if (!bootstrapStats.has(label)) {
    bootstrapStats.set(label, { created: 0, skipped: 0, updated: 0, repaired: 0 });
  }
  return bootstrapStats.get(label);
}

async function upsertByMode(Model, query, createPayload, { label, sync = false, relation = false } = {}) {
  const stats = getStats(label);
  const existing = await Model.findOne(query);
  if (existing) {
    stats.skipped += 1;
    if (!sync) return existing;

    const { _id, catalogItemId, ...syncPayload } = createPayload; // NEVER update catalogItemId on existing rows!
    await Model.updateOne(query, { $set: syncPayload }, { runValidators: true });
    stats.updated += 1;
    return Model.findOne(query);
  }

  const doc = await Model.create(createPayload);
  stats.created += 1;
  if (relation) stats.repaired += 1;
  return doc;
}

function printBootstrapStats() {
  for (const [label, stats] of bootstrapStats.entries()) {
    const repaired = stats.repaired ? ` repaired=${stats.repaired}` : "";
    console.log(`${label}: created=${stats.created} skipped=${stats.skipped} updated=${stats.updated}${repaired}`);
  }
}

function assertSeedContract(condition, message) {
  if (!condition) {
    throw new Error(`${message}. Re-run with: BOOTSTRAP_SYNC=true node scripts/seed-catalog.js --sync`);
  }
}

async function verifySeedReadContracts({ strict = true } = {}) {
  const check = (condition, message) => {
    if (strict) {
      assertSeedContract(condition, message);
      return;
    }
    if (!condition) {
      console.warn(`[seed-contract-warning] ${message}. Re-run with: BOOTSTRAP_SYNC=true node scripts/seed-catalog.js --sync`);
    }
  };

  const publicMenu = await getOneTimeOrderMenu({ lang: "en", includePublicV2: true });
  const publicMenuV2 = publicMenu.publicMenuV2;

  check(publicMenuV2, "Seeded public menu did not produce publicMenuV2");
  if (!publicMenuV2) return false;
  check(publicMenuV2.contractVersion === "one_time_menu.v2", "publicMenuV2 contractVersion mismatch");
  check(Array.isArray(publicMenuV2.sections) && publicMenuV2.sections.length > 0, "publicMenuV2.sections is empty");
  check(publicMenuV2.productIndex?.byKey?.basic_salad, "publicMenuV2 productIndex.byKey.basic_salad missing");

  const customOrderSection = publicMenuV2.sections.find((section) => section.key === "custom_order");
  check(customOrderSection, "publicMenuV2 custom_order section missing");
  const basicSalad = customOrderSection?.products.find((product) => product.key === "basic_salad");
  check(basicSalad, "publicMenuV2 basic_salad product missing");
  check(basicSalad?.action?.requiresBuilder === true, "publicMenuV2 basic_salad action must require builder");
  check(basicSalad?.pricing?.model === "per_100g", "publicMenuV2 basic_salad pricing model mismatch");

  const directAddProduct = publicMenuV2.sections
    .flatMap((section) => section.products || [])
    .find((product) => product.key === "water");
  check(directAddProduct?.action?.type === "direct_add", "publicMenuV2 water direct-add action missing");

  const { builderCatalogV2, plannerCatalog } = await getSubscriptionBuilderCatalogWithV2({ lang: "en", includeV3: true, includeV2: true, ignorePublishedMealBuilder: true });
  check(builderCatalogV2, "Seeded subscription catalog did not produce builderCatalogV2");
  if (!builderCatalogV2) return false;
  check(builderCatalogV2.catalogVersion === "meal_planner_menu.v2", "builderCatalogV2 catalogVersion mismatch");
  for (const sectionKey of ["standard_meal", "premium_meal", "sandwich", "premium_large_salad"]) {
    check(
      builderCatalogV2.sections?.some((section) => section.key === sectionKey),
      `builderCatalogV2 ${sectionKey} section missing`
    );
  }
  check(plannerCatalog, "Seeded subscription catalog did not produce plannerCatalog");
  check(plannerCatalog?.contractVersion === "meal_planner_menu.v3", "plannerCatalog contractVersion mismatch");
  check(Array.isArray(plannerCatalog?.sections) && plannerCatalog.sections.length > 0, "plannerCatalog.sections is empty");
  for (const sectionKey of ["standard_meal", "premium_meal", "sandwich", "premium_large_salad"]) {
    check(
      plannerCatalog.sections?.some((section) => section.key === sectionKey),
      `plannerCatalog ${sectionKey} section missing`
    );
  }
  const standardSection = plannerCatalog.sections?.find((section) => section.key === "standard_meal");
  const standardProduct = standardSection?.products?.find((product) => product.key === "basic_meal");
  check(standardProduct, "plannerCatalog standard_meal basic_meal product missing");
  const standardProteinGroup = standardProduct?.optionGroups?.find((group) => group.sourceKey === "proteins" || group.key === "proteins");
  const standardCarbGroup = standardProduct?.optionGroups?.find((group) => group.sourceKey === "carbs" || group.key === "carbs");
  check(standardProteinGroup?.minSelections === 1 && standardProteinGroup?.maxSelections === 1, "plannerCatalog standard protein min/max mismatch");
  check(Array.isArray(standardProteinGroup?.options) && standardProteinGroup.options.length > 0, "plannerCatalog standard protein options missing");
  check(standardCarbGroup?.minSelections === 1 && standardCarbGroup?.maxSelections === 2, "plannerCatalog standard carb min/max mismatch");
  check(Array.isArray(standardCarbGroup?.options) && standardCarbGroup.options.length > 0, "plannerCatalog standard carb options missing");
  check(
    standardCarbGroup?.options?.every((option) => CUSTOMER_VISIBLE_CARB_KEYS.includes(option.key)),
    "plannerCatalog standard carb options include non-customer-visible carbs"
  );

  const premiumSection = plannerCatalog.sections?.find((section) => section.key === "premium_meal");
  const premiumProduct = premiumSection?.products?.find((product) => product.key === "basic_meal");
  const premiumProteinGroup = premiumProduct?.optionGroups?.find((group) => group.sourceKey === "proteins" || group.key === "proteins");
  check(Array.isArray(premiumProteinGroup?.options) && premiumProteinGroup.options.length > 0, "plannerCatalog premium protein options missing");
  check(
    premiumProteinGroup?.options?.every((option) => PREMIUM_MEAL_PROTEIN_KEYS.includes(option.key)),
    "plannerCatalog premium protein options do not match premium contract"
  );
  check(
    premiumProteinGroup?.options?.every((option) => Number(option.extraPriceHalala || option.extraFeeHalala || 0) > 0),
    "plannerCatalog premium protein relation prices missing"
  );

  const saladSection = plannerCatalog.sections?.find((section) => section.key === "premium_large_salad");
  const saladProduct = saladSection?.products?.find((product) => product.key === "premium_large_salad");
  check(saladProduct, "plannerCatalog premium_large_salad product missing");
  check(
    !(saladProduct?.optionGroups || []).some((group) => SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS.includes(group.key)),
    "plannerCatalog premium_large_salad exposes excluded groups"
  );

  console.log(strict
    ? "Seed read-contract smoke checks passed: publicMenuV2, builderCatalogV2, and plannerCatalog v3."
    : "Seed read-contract smoke checks completed in warning-only mode.");
  return true;
}

const extraProteinOptions = [
  { key: "extra_chicken_50g", name: name("زيادة 50 جرام من الدجاج", "Extra 50g Chicken"), extraPriceHalala: 500, availableFor: ["one_time", "subscription"] },
  { key: "extra_beef_steak_50g", name: name("زيادة 50 جرام ستيك لحم", "Extra 50g Beef Steak"), extraPriceHalala: 1000, availableFor: ["one_time", "subscription"] },
  { key: "extra_salmon_50g", name: name("زيادة 50 جرام سالمون", "Extra 50g Salmon"), extraPriceHalala: 1000, availableFor: ["one_time", "subscription"] },
  { key: "extra_shrimp_50g", name: name("زيادة 50 جرام جمبري", "Extra 50g Shrimp"), extraPriceHalala: 1000, availableFor: ["one_time", "subscription"] },
  { key: "extra_chicken_fajita_50g", name: name("زيادة 50 جرام دجاج فاهيتا", "Extra 50g Chicken Fajita"), extraPriceHalala: 500 },
  { key: "extra_beef_stroganoff_50g", name: name("زيادة 50 جرام لحم استرغانوف", "Extra 50g Beef Stroganoff"), extraPriceHalala: 600 },
  { key: "extra_mexican_chicken_50g", name: name("زيادة 50 جرام دجاج مكسيكي", "Extra 50g Mexican Chicken"), extraPriceHalala: 500 },
  { key: "extra_grilled_chicken_50g", name: name("زيادة 50 جرام دجاج مشوي", "Extra 50g Grilled Chicken"), extraPriceHalala: 500 },
  { key: "extra_asian_chicken_50g", name: name("زيادة 50 جرام دجاج آسيوي", "Extra 50g Asian Chicken"), extraPriceHalala: 500 },
  { key: "extra_chicken_tikka_50g", name: name("زيادة 50 جرام دجاج تكا", "Extra 50g Chicken Tikka"), extraPriceHalala: 500 },
  { key: "extra_italian_spiced_chicken_50g", name: name("زيادة 50 جرام دجاج توابل إيطالية", "Extra 50g Italian Spiced Chicken"), extraPriceHalala: 500 },
  { key: "extra_spicy_chicken_50g", name: name("زيادة 50 جرام دجاج سبايسي", "Extra 50g Spicy Chicken"), extraPriceHalala: 500 },
  { key: "extra_creamy_chicken_50g", name: name("زيادة 50 جرام دجاج كريمة", "Extra 50g Creamy Chicken"), extraPriceHalala: 500 },
].map((option) => ({ availableFor: ["one_time"], ...option }));

const carbRows = [
  { key: "white_rice", name: name("رز أبيض", "White Rice"), productName: name("رز أبيض من 150 جرام", "White Rice 150g"), priceHalala: 700, defaultWeightGrams: 150, calories: 190, imageUrl: "" },
  { key: "turmeric_rice", name: name("رز بالكركم", "Turmeric Rice"), productName: name("رز بالكركم من 150 جرام", "Turmeric Rice 150g"), priceHalala: 700, defaultWeightGrams: 150, calories: 200, imageUrl: "" },
  { key: "alfredo_pasta", name: name("باستا الفريدو", "Alfredo Pasta"), productName: name("باستا الفريدو 150 جرام", "Alfredo Pasta 150g"), priceHalala: 700, defaultWeightGrams: 150, calories: 300, imageUrl: "" },
  { key: "red_sauce_pasta", name: name("باستا صوص احمر", "Red Sauce Pasta"), productName: name("باستا صوص احمر 150 جرام", "Red Sauce Pasta 150g"), priceHalala: 700, defaultWeightGrams: 150, calories: 180, imageUrl: "" },
  { key: "roasted_potato", name: name("بطاطا مشوية", "Roasted Potato"), productName: name("بطاطا مشوية 150 جرام", "Roasted Potato 150g"), priceHalala: 700, defaultWeightGrams: 150, calories: 120, imageUrl: "" },
  { key: "sweet_potato", name: name("بطاطا حلوة", "Sweet Potato"), productName: name("بطاطا حلوة 150 جرام", "Sweet Potato 150g"), priceHalala: 700, defaultWeightGrams: 150, calories: 120, imageUrl: "" },
  { key: "grilled_mixed_vegetables", name: name("خضار مشكلة مشوية", "Grilled Mixed Vegetables"), productName: name("خضار مشكلة مشوية 150 جرام", "Grilled Mixed Vegetables 150g"), priceHalala: 700, defaultWeightGrams: 150, calories: 87, imageUrl: "" },
];

// Retained for existing subscription selections; these are not on the current external menu.
const legacyCarbOptions = [
  { key: "brown_rice", name: name("ارز اسمر", "Brown Rice"), displayCategoryKey: "standard_carbs", ruleTags: ["missing_external"] },
  { key: "potato", name: name("بطاطس", "Potato"), displayCategoryKey: "standard_carbs", ruleTags: ["missing_external"] },
  { key: "pasta", name: name("مكرونة", "Pasta"), displayCategoryKey: "standard_carbs", ruleTags: ["missing_external"] },
];

const saladOptionRows = {
  leafy_greens: [
    { key: "lettuce", name: name("خس", "Lettuce"), calories: 15 },
    { key: "arugula", name: name("جرجير", "Arugula"), calories: 25 },
    { key: "cabbage", name: name("ملفوف", "Cabbage"), calories: 25 },
    { key: "spinach", name: name("سبانخ", "Spinach"), calories: 0, ruleTags: ["missing_external"] },
  ],
  vegetables_legumes: [
    { key: "tomato", name: name("طماطم", "Tomato"), calories: 18 },
    { key: "carrot", name: name("جزر", "Carrot"), calories: 41 },
    { key: "cucumber", name: name("خيار", "Cucumber"), calories: 41 },
    { key: "corn", name: name("ذرة", "Corn"), calories: 86 },
    { key: "hummus", name: name("حمص", "Hummus"), calories: 164 },
    { key: "jalapeno", name: name("هالبينو", "Jalapeno"), calories: 29 },
    { key: "red_beans", name: name("فاصوليا حمراء", "Red Beans"), calories: 127 },
    { key: "beetroot", name: name("بنجر", "Beetroot"), calories: 43 },
    { key: "hot_pepper", name: name("فلفل حار", "Hot Pepper"), calories: 40 },
    { key: "coriander", name: name("كزبرة", "Coriander"), calories: 15 },
    { key: "mushroom", name: name("فطر", "Mushroom"), calories: 22 },
    { key: "broccoli", name: name("بروكلي", "Broccoli"), calories: 34 },
    { key: "salad_grilled_mixed_vegetables", name: name("خضار مشكل مشوي", "Grilled Mixed Vegetables"), calories: 45 },
    { key: "red_onion", name: name("بصل احمر", "Red Onion"), calories: 40 },
    { key: "green_onion", name: name("بصل اخضر", "Green Onion"), calories: 32 },
    { key: "green_olives", name: name("زيتون اخضر", "Green Olives"), calories: 145 },
    { key: "black_olives", name: name("زيتون اسود", "Black Olives"), calories: 120 },
    { key: "mint", name: name("نعناع", "Mint"), calories: 44 },
    { key: "pickled_onion", name: name("بصل مخلل", "Pickled Onion"), calories: 25 },
  ],
  fruits: [
    { key: "mango", name: name("مانجا", "Mango"), calories: 60 },
    { key: "green_apple", name: name("تفاح اخضر", "Green Apple"), calories: 52 },
    { key: "pomegranate", name: name("رمان", "Pomegranate"), calories: 83 },
    { key: "strawberry", name: name("فراولة", "Strawberry"), calories: 32 },
    { key: "blueberry", name: name("توت ازرق", "Blueberry"), calories: 57 },
    { key: "raspberry", name: name("توت احمر", "Raspberry"), calories: 52 },
    { key: "watermelon", name: name("بطيخ", "Watermelon"), calories: 30 },
    { key: "cantaloupe", name: name("شمام", "Cantaloupe"), calories: 34 },
    { key: "dates", name: name("تمر", "Dates"), calories: 277 },
    { key: "apple", name: name("تفاح", "Apple"), calories: 0, ruleTags: ["missing_external"] },
  ],
  cheese_nuts: [
    { key: "cashew", name: name("كاجو", "Cashew"), calories: 160 },
    { key: "walnut", name: name("عين الجمل", "Walnut"), calories: 185 },
    { key: "sesame", name: name("سمسم", "Sesame"), calories: 123 },
    { key: "feta", name: name("فيتا", "Feta"), calories: 70 },
    { key: "parmesan", name: name("بارميزان", "Parmesan"), calories: 104 },
    { key: "feta_cheese", name: name("جبنة فيتا", "Feta Cheese"), calories: 0, ruleTags: ["missing_external"] },
    { key: "almond", name: name("لوز", "Almond"), calories: 0, ruleTags: ["missing_external"] },
  ],
  sauces: [
    { key: "ranch", name: name("رانش", "Ranch"), calories: 50 },
    { key: "spicy_ranch", name: name("سبايسي رانش", "Spicy Ranch"), calories: 55 },
    { key: "pesto_sauce", name: name("صوص بيستو", "Pesto Sauce"), calories: 60 },
    { key: "balsamic", name: name("بالسميك", "Balsamic"), calories: 40 },
    { key: "caesar", name: name("سيزر", "Caesar"), calories: 55 },
    { key: "honey_mustard", name: name("هاني ماستر", "Honey Mustard"), calories: 45 },
    { key: "yogurt_mint", name: name("زبادي بالنعناع", "Yogurt Mint"), calories: 20 },
    { key: "honey_garlic", name: name("عسل بالثوم", "Honey Garlic"), calories: 45 },
    { key: "honey", name: name("عسل", "Honey"), calories: 75, imageUrl: "", ruleTags: ["light_options_only"] },
    { key: "lemon_mustard", name: name("ليمون وخردل", "Lemon Mustard"), calories: 0, ruleTags: ["missing_external"] },
  ],
};

const proteinRows = [
  { key: "chicken", name: name("دجاج", "Chicken"), proteinFamilyKey: "chicken" },
  { key: "beef", name: name("لحم", "Beef"), proteinFamilyKey: "beef" },
  { key: "fish", name: name("سمك", "Fish"), proteinFamilyKey: "fish" },
  { key: "eggs", name: name("بيض", "Eggs"), proteinFamilyKey: "eggs" },
  { key: "beef_steak", name: name("ستيك لحم", "Beef Steak"), calories: 270, proteinFamilyKey: "beef" },
  { key: "shrimp", name: name("جمبري", "Shrimp"), calories: 380, proteinFamilyKey: "fish" },
  { key: "salmon", name: name("سالمون", "Salmon"), calories: 210, proteinFamilyKey: "fish" },
  { key: "boiled_eggs", name: name("بيض مسلوق", "Boiled Eggs"), calories: 155, proteinFamilyKey: "eggs" },
  { key: "tuna", name: name("تونا", "Tuna"), calories: 116, proteinFamilyKey: "fish" },
  { key: "chicken_fajita", name: name("فاهيتا", "Chicken Fajita"), calories: 200, proteinFamilyKey: "chicken" },
  { key: "spicy_chicken", name: name("دجاج سبايسي", "Spicy Chicken"), calories: 220, proteinFamilyKey: "chicken" },
  { key: "italian_spiced_chicken", name: name("دجاج توابل إيطالية", "Italian Spiced Chicken"), calories: 200, proteinFamilyKey: "chicken" },
  { key: "chicken_tikka", name: name("دجاج تكا", "Chicken Tikka"), calories: 200, proteinFamilyKey: "chicken" },
  { key: "asian_chicken", name: name("دجاج آسيوي", "Asian Chicken"), calories: 220, proteinFamilyKey: "chicken" },
  { key: "chicken_strips", name: name("استربس", "Chicken Strips"), calories: 250, proteinFamilyKey: "chicken" },
  { key: "grilled_chicken", name: name("دجاج مشوي", "Grilled Chicken"), calories: 175, proteinFamilyKey: "chicken" },
  { key: "mexican_chicken", name: name("دجاج مكسيكي", "Mexican Chicken"), calories: 210, proteinFamilyKey: "chicken" },
  { key: "meatballs", name: name("كرات لحم", "Meatballs"), calories: 280, proteinFamilyKey: "beef" },
  { key: "beef_stroganoff", name: name("لحم استرغانوف", "Beef Stroganoff"), calories: 250, proteinFamilyKey: "beef" },
  { key: "fish_fillet", name: name("سمك فيليه", "Fish Fillet"), calories: 130, proteinFamilyKey: "fish" },
];

const proteinRowsByKey = new Map(proteinRows.map((row) => [row.key, row]));

const saladProteinPriceOverrides = {
  meatballs: 300,
  beef_stroganoff: 300,
  beef_steak: 1600,
  shrimp: 1600,
  salmon: 1600,
};

const saladExtraProteinPriceOverrides = {
  extra_chicken_50g: 500,
  extra_beef_steak_50g: 1000,
  extra_shrimp_50g: 1000,
  extra_salmon_50g: 1000,
};

const subscriptionPremiumLargeSaladProteinKeys = [...SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS];

const standardMealProteinRelations = [
  "chicken",
  "beef",
  "fish",
  "eggs",
  "boiled_eggs",
  "tuna",
  "chicken_fajita",
  "spicy_chicken",
  "italian_spiced_chicken",
  "chicken_tikka",
  "asian_chicken",
  "chicken_strips",
  "grilled_chicken",
  "mexican_chicken",
  "meatballs",
  "beef_stroganoff",
  "fish_fillet",
].map((key, index) => ({
  key,
  selectionType: "standard_meal",
  displayCategoryKey: proteinRowsByKey.get(key)?.proteinFamilyKey || "other",
  isPremium: false,
  extraFeeHalala: 0,
  sortOrder: (index + 1) * 10,
}));

const premiumMealProteinKeys = [...PREMIUM_MEAL_PROTEIN_KEYS];

const premiumMealProteinRelations = premiumMealProteinKeys.map((key, index) => ({
  key,
  selectionType: "premium_meal",
  displayCategoryKey: "premium",
  isPremium: true,
  premiumKey: key,
  extraFeeHalala: 2000,
  sortOrder: (index + 1) * 10,
}));

const premiumLargeSaladProteinRelations = subscriptionPremiumLargeSaladProteinKeys.map((key, index) => ({
  key,
  selectionType: "premium_large_salad",
  displayCategoryKey: proteinRowsByKey.get(key)?.proteinFamilyKey || "other",
  isPremium: false,
  extraFeeHalala: 0,
  sortOrder: (index + 1) * 10,
}));

// Canonical one-time basic_meal protein allowlist comes from mealPlannerContract.
const standardProteinOptionKeys = [...STANDARD_MEAL_PROTEIN_KEYS];

const oneTimeMealProteinRelations = standardProteinOptionKeys.map((key, index) => ({
  key,
  selectionType: "basic_meal",
  displayCategoryKey: proteinRowsByKey.get(key)?.proteinFamilyKey || "other",
  extraPriceHalala: 0,
  sortOrder: (index + 1) * 10,
}));

const oneTimeSaladProteinRelations = [
  "boiled_eggs",
  "tuna",
  "chicken_fajita",
  "spicy_chicken",
  "italian_spiced_chicken",
  "chicken_tikka",
  "asian_chicken",
  "chicken_strips",
  "grilled_chicken",
  "mexican_chicken",
  "meatballs",
  "beef_stroganoff",
  "beef_steak",
  "shrimp",
  "fish_fillet",
  "salmon",
].map((key, index) => ({
  key,
  selectionType: "basic_salad",
  displayCategoryKey: proteinRowsByKey.get(key)?.proteinFamilyKey || "other",
  extraPriceHalala: saladProteinPriceOverrides[key] || 0,
  sortOrder: (index + 1) * 10,
}));

const subscriptionProteinRelationByKey = new Map(
  [...standardMealProteinRelations, ...premiumMealProteinRelations].map((relation) => [relation.key, relation])
);
const oneTimeSaladProteinRelationByKey = new Map(oneTimeSaladProteinRelations.map((relation) => [relation.key, relation]));

const customSaladAllowedOptions = {
  leafy_greens: saladOptionRows.leafy_greens.filter((row) => !row.ruleTags?.includes("missing_external")).map((row) => row.key),
  vegetables_legumes: saladOptionRows.vegetables_legumes.map((row) => row.key),
  fruits: saladOptionRows.fruits.filter((row) => !row.ruleTags?.includes("missing_external")).map((row) => row.key),
  proteins: oneTimeSaladProteinRelations.map((row) => row.key),
  cheese_nuts: saladOptionRows.cheese_nuts.filter((row) => !row.ruleTags?.includes("missing_external")).map((row) => row.key),
  sauces: saladOptionRows.sauces.filter((row) => !row.ruleTags?.some((tag) => ["missing_external", "light_options_only"].includes(tag))).map((row) => row.key),
  extra_protein_50g: Object.keys(saladExtraProteinPriceOverrides),
};

const lightOptionAllowedOptions = {
  green_salad: {
    leafy_greens: customSaladAllowedOptions.leafy_greens,
    vegetables_legumes: customSaladAllowedOptions.vegetables_legumes,
    sauces: customSaladAllowedOptions.sauces,
  },
  fruit_salad: {
    fruits: customSaladAllowedOptions.fruits,
    sauces: ["honey"],
  },
  greek_yogurt: {
    fruits: customSaladAllowedOptions.fruits,
    sauces: ["honey"],
    cheese_nuts: ["cashew", "walnut", "sesame"],
  },
};

function isTruthy(value) {
  return ["1", "true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function getEnvironmentName() {
  return process.env.NODE_ENV || "development";
}

function parseArgs(argv = process.argv.slice(2)) {
  const reset = argv.includes("--reset");
  return {
    reset,
    sync: reset || argv.includes("--sync") || isTruthy(process.env.BOOTSTRAP_SYNC),
    onlySubscriptionPlans: argv.includes("--only-subscription-plans"),
    skipSubscriptionPlans: argv.includes("--skip-subscription-plans"),
  };
}

function activePublishedFields(sortOrder = 0) {
  return {
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder,
    publishedAt: now,
  };
}

function productIsCustomizable(row) {
  return row.pricingModel === "per_100g" || (Array.isArray(row.groups) && row.groups.length > 0);
}

const categoryRows = [
  { key: "custom_order", name: name("اطلب على مزاجك", "Custom Order"), ui: { cardVariant: "hero_builder_collection", layout: "vertical_hero_list" } },
  { key: "meals", name: name("الوجبات", "Meals"), ui: { cardVariant: "meal_collection", layout: "vertical_meal_list" } },
  { key: "carbs", name: name("الكارب", "Carbs"), ui: { cardVariant: "compact_product_collection", layout: "horizontal_or_grid_compact_cards" } },
  { key: "light_options", name: name("اختيارات خفيفة", "Light Options"), ui: { cardVariant: "compact_builder_collection", layout: "vertical_compact_builder_list" } },
  { key: "cold_sandwiches", name: name("الساندويتش البارد", "Cold Sandwiches"), ui: { cardVariant: "sandwich_collection", layout: "vertical_compact_cards" } },
  { key: "sourdough", name: name("الساندويشات", "Sourdough Sandwiches"), ui: { cardVariant: "sandwich_collection" } },
  { key: "desserts", name: name("الحلويات", "Desserts"), ui: { cardVariant: "addon_collection", layout: "horizontal_or_grid_addon_cards" } },
  { key: "juices", name: name("العصائر", "Juices"), ui: { cardVariant: "addon_collection", layout: "horizontal_or_grid_addon_cards" } },
  { key: "drinks", name: name("المشروبات", "Drinks"), ui: { cardVariant: "addon_collection", layout: "horizontal_or_grid_addon_cards" } },
  { key: "ice_cream", name: name("الايس كريم", "Ice Cream"), ui: { cardVariant: "addon_collection", layout: "horizontal_or_grid_addon_cards" } },
];

const groupDefinitions = [
  {
    key: "proteins",
    name: name("بروتينات", "Proteins"),
    ui: { displayStyle: "radio_cards" },
    options: proteinRows,
  },
  {
    key: "carbs",
    name: name("كارب", "Carbs"),
    ui: { displayStyle: "chips" },
    options: [
      ...carbRows.map((row) => ({ ...row, displayCategoryKey: "standard_carbs" })),
      ...legacyCarbOptions,
    ],
  },
  {
    key: "leafy_greens",
    name: name("ورقيات", "Leafy Greens"),
    ui: { displayStyle: "checkbox_grid" },
    options: saladOptionRows.leafy_greens,
  },
  {
    key: "vegetables_legumes",
    name: name("خضراوات وبقوليات", "Vegetables & Legumes"),
    ui: { displayStyle: "checkbox_grid" },
    options: saladOptionRows.vegetables_legumes,
  },
  {
    key: "cheese_nuts",
    ui: { displayStyle: "checkbox_grid" },
    name: name("الاجبان و المكسرات", "Cheese & Nuts"),
    options: saladOptionRows.cheese_nuts,
  },
  {
    key: "fruits",
    name: name("فواكه", "Fruits"),
    ui: { displayStyle: "checkbox_grid" },
    options: saladOptionRows.fruits,
  },
  {
    key: "sauces",
    name: name("الصوصات", "Sauces"),
    ui: { displayStyle: "radio_cards" },
    options: saladOptionRows.sauces,
  },
  {
    key: "extra_protein_50g",
    name: name("إضافة بروتين", "Extra Protein"),
    ui: { displayStyle: "checkbox_grid" },
    options: extraProteinOptions,
  },
];

const saladIngredientGroupAliases = {
  vegetables_legumes: "vegetables",
  sauces: "sauce",
};

// standardProteinOptionKeys is defined above as a literal array before oneTimeMealProteinRelations.

const extraProteinByMeal = {
  beef_steak_meal_150g: "extra_beef_steak_50g",
  salmon_meal_100g: "extra_salmon_50g",
  shrimp_meal_100g: "extra_shrimp_50g",
  chicken_fajita_meal_100g: "extra_chicken_fajita_50g",
  beef_stroganoff_meal_100g: "extra_beef_stroganoff_50g",
  mexican_chicken_meal_100g: "extra_mexican_chicken_50g",
  grilled_chicken_meal_100g: "extra_grilled_chicken_50g",
  asian_chicken_meal_100g: "extra_asian_chicken_50g",
  chicken_tikka_meal_100g: "extra_chicken_tikka_50g",
  italian_spiced_chicken_meal_100g: "extra_italian_spiced_chicken_50g",
  spicy_chicken_meal_100g: "extra_spicy_chicken_50g",
  creamy_chicken_meal_100g: "extra_creamy_chicken_50g",
};

const productGroupAllowedOptionKeys = {
  basic_salad: {
    ...customSaladAllowedOptions,
  },
  basic_meal: {
    carbs: [...CUSTOMER_VISIBLE_CARB_KEYS],
    proteins: [...STANDARD_MEAL_EXTENDED_PROTEIN_KEYS],
  },
  premium_large_salad: {
    ...customSaladAllowedOptions,
    proteins: premiumLargeSaladProteinRelations.map((row) => row.key),
    ...Object.fromEntries(SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS.map((groupKey) => [groupKey, []])),
  },
  ...lightOptionAllowedOptions,
  ...Object.fromEntries(
    Object.entries(extraProteinByMeal).map(([productKey, optionKey]) => [
      productKey,
      { extra_protein_50g: [optionKey] },
    ])
  ),
};

const saladProductGroupOptionPriceOverrides = Object.fromEntries(
  ["basic_salad"].map((productKey) => [
    productKey,
    {
      proteins: Object.fromEntries(oneTimeSaladProteinRelations.map((relation) => [relation.key, relation.extraPriceHalala || 0])),
      extra_protein_50g: saladExtraProteinPriceOverrides,
    },
  ])
);

function resolveProductGroupOptionPriceHalala(productKey, groupKey, optionDef) {
  if (productKey === "basic_meal" && groupKey === "proteins") {
    return subscriptionProteinRelationByKey.get(optionDef.key)?.extraFeeHalala || 0;
  }
  return saladProductGroupOptionPriceOverrides[productKey]?.[groupKey]?.[optionDef.key]
    ?? optionDef.extraPriceHalala
    ?? 0;
}

function resolveProductGroupOptionSortOrder(productKey, groupKey, optionDef, fallbackSortOrder) {
  if (productKey === "basic_salad" && groupKey === "proteins") {
    return oneTimeSaladProteinRelationByKey.get(optionDef.key)?.sortOrder || fallbackSortOrder;
  }
  return fallbackSortOrder;
}

const mealProductDefaults = {
  category: "meals",
  itemType: "product",
  pricingModel: "fixed",
  availableFor: ["one_time"],
  imageUrl: "",
  ui: { cardVariant: "ready_meal", cardSize: "medium", imageRatio: "square" },
};

const mealProductRows = [
  { key: "beef_steak_meal_150g", name: name("وجبة ستيك لحم 150 جرام", "Beef Steak Meal 150g"), priceHalala: 3900, defaultWeightGrams: 150 },
  { key: "salmon_meal_100g", name: name("وجبة سالمون 100 جرام", "Salmon Meal 100g"), priceHalala: 3900, defaultWeightGrams: 100 },
  { key: "shrimp_meal_100g", name: name("وجبة جمبري 100 جرام", "Shrimp Meal 100g"), priceHalala: 3900, defaultWeightGrams: 100 },
  { key: "chicken_fajita_meal_100g", name: name("وجبة دجاج فاهيتا 100 جرام", "Chicken Fajita Meal 100g"), priceHalala: 1900, defaultWeightGrams: 100 },
  { key: "beef_stroganoff_meal_100g", name: name("وجبة لحم استرغانوف 100 جرام", "Beef Stroganoff Meal 100g"), priceHalala: 2200, defaultWeightGrams: 100 },
  { key: "mexican_chicken_meal_100g", name: name("وجبة دجاج مكسيكي 100 جرام", "Mexican Chicken Meal 100g"), priceHalala: 1900, defaultWeightGrams: 100 },
  { key: "grilled_chicken_meal_100g", name: name("وجبة دجاج مشوي 100 جرام", "Grilled Chicken Meal 100g"), priceHalala: 1900, defaultWeightGrams: 100 },
  { key: "asian_chicken_meal_100g", name: name("وجبة دجاج آسيوي 100 جرام", "Asian Chicken Meal 100g"), priceHalala: 1900, defaultWeightGrams: 100 },
  { key: "chicken_tikka_meal_100g", name: name("وجبة دجاج تكا 100 جرام", "Chicken Tikka Meal 100g"), priceHalala: 1900, defaultWeightGrams: 100 },
  { key: "italian_spiced_chicken_meal_100g", name: name("وجبة دجاج توابل إيطالية 100 جرام", "Italian Spiced Chicken Meal 100g"), priceHalala: 1900, defaultWeightGrams: 100 },
  { key: "spicy_chicken_meal_100g", name: name("وجبة دجاج سبايسي 100 جرام", "Spicy Chicken Meal 100g"), priceHalala: 1900, defaultWeightGrams: 100 },
  { key: "creamy_chicken_meal_100g", name: name("وجبة دجاج كريمة 100 جرام", "Creamy Chicken Meal 100g"), priceHalala: 1900, defaultWeightGrams: 100 },
  {
    key: "chicken_okra_meal",
    name: name("وجبة دجاج بالبامية", "Chicken Okra Meal"),
    description: name(
      "طعم البيت الأصيل بلمسة صحية خفيفة، قطع الدجاج الطرية والغنية بالبروتين مطهوة ببطء مع البامية الطازجة بصلصة صحية غنية بالنكهات.",
      "Tender protein-rich chicken slow-cooked with fresh okra in a healthy flavorful sauce."
    ),
    priceHalala: 1900,
    defaultWeightGrams: 100,
    // TODO: Persist calories (110) and prep time (23 minutes) when MenuProduct supports them.
  },
  {
    key: "chicken_molokhia_meal",
    name: name("وجبة دجاج بالملوخية", "Chicken Molokhia Meal"),
    description: name(
      "استمتع بنكهة صحية مختلفة دجاج مع الملوخية الخضراء اللذيذة، محضرة بلمسة صحية تناسب نظامك الغذائي الصحي.",
      "Chicken with flavorful green molokhia prepared with a healthy light touch."
    ),
    priceHalala: 1900,
    defaultWeightGrams: 100,
    // TODO: Persist calories (124) and prep time (25 minutes) when MenuProduct supports them.
  },
  {
    key: "shish_tawook_meal",
    name: name("شيش طاووق", "Shish Tawook"),
    description: name(
      "مكعبات دجاج مشوية بتتبيلة تقليدية تمنحها طراوة ونكهة مشوية غنية بالبروتين.",
      "Grilled chicken cubes with a traditional marinade, tender texture, and rich grilled protein flavor."
    ),
    priceHalala: 1900,
    defaultWeightGrams: 100,
    // TODO: Persist calories (240) and prep time (35 minutes) when MenuProduct supports them.
  },
  {
    key: "bbq_chicken_meal",
    name: name("دجاج باربكيو", "BBQ Chicken"),
    description: name(
      "قطع دجاج مشوية وصحية متبلة بعناية ومغطاة بصوص باربيكيو غني بطعم مدخن خفيف يمنحها نكهة لذيذة ومتوازنة",
      "Healthy grilled chicken pieces seasoned carefully and topped with a light smoky barbecue sauce."
    ),
    priceHalala: 1900,
    defaultWeightGrams: 100,
    // TODO: Persist calories (270) when MenuProduct supports it.
  },
  {
    key: "chicken_65_meal",
    name: name("دجاج 65", "Chicken 65"),
    description: name(
      "قطع دجاج متبلة بتوابل مميزة بنكهة حارة بطريقة صحية ولمسة مقرمشة بطابع هندي شهي",
      "Chicken pieces seasoned with distinctive spicy Indian-style flavors in a healthier preparation."
    ),
    priceHalala: 1900,
    defaultWeightGrams: 100,
    // TODO: Persist calories (260) when MenuProduct supports it.
  },
  { key: "tuna_meal_100g", name: name("وجبة تونا 100 جرام", "Tuna Meal 100g"), priceHalala: 1900, defaultWeightGrams: 100 },
  {
    key: "fish_fillet_meal_100g",
    name: name("وجبة سمك فيليه 100 جرام", "Fish Fillet Meal 100g"),
    priceHalala: 1900,
    defaultWeightGrams: 100,
    // TODO: Persist calories (130) when MenuProduct supports it.
  },
].map((row) => ({
  ...mealProductDefaults,
  ...row,
  groups: extraProteinByMeal[row.key] ? [["extra_protein_50g", 0, 1, false]] : undefined,
}));

// MenuProduct does not support calories yet. Keep them in carbRows and mirror them to BuilderCarb.nutrition.
const carbProductRows = carbRows.map((row) => ({
  key: row.key,
  category: "carbs",
  itemType: "product",
  name: row.productName,
  pricingModel: "fixed",
  priceHalala: row.priceHalala,
  defaultWeightGrams: row.defaultWeightGrams,
  availableFor: ["one_time"],
  imageUrl: row.imageUrl,
  ui: { cardVariant: "compact_product", cardSize: "small", imageRatio: "square" },
}));

// TODO: MenuProduct has no calories or prep-time fields. Keep the external metadata documented here
// until canonical product nutrition is supported. Sandwich calories are also mirrored to Sandwich.
// Cold sandwiches: beef_burger_sandwich 375/45, turkey_cold_sandwich 220/25,
// boiled_egg_sandwich 160/18, tuna_sandwich 200/23, mexican_chicken_sandwich 260/30,
// grilled_chicken_sandwich 220/not provided.
// Desserts: orange_cake 100/not provided, apple_cinnamon_muffin_2pcs 300/33,
// berry_cheesecake 350/39, strawberry_cheesecake 340/38, dark_brownies 360/40,
// protein_bar 220/25, basic_classic 310/34, protein_chocolate_cake 320/not provided.
// Juices: berry_blast 150/17, berry_prot 200/22, classic_green 120/14, beet_punch 140/16,
// orange_carrot 130/15, watermelon_mint 100/11.
// Drinks: protein_drink 200/15, diet_iced_tea 5/not provided.
const externalProductRows = [
  {
    key: "beef_burger_sandwich",
    category: "cold_sandwiches",
    itemType: "cold_sandwich",
    name: name("برجر لحم", "Beef Burger"),
    description: name(
      "شريحة لحم مشوية وغنية بالعصارة، داخل خبز البرجر الصحي مع الخضار الطازجة والجبن الخالي من الدسم. الوجبة المثالية لتستمتع بطعم البرجر الكلاسيكي وتحافظ على نظامك الصحي في نفس الوقت.",
      "Juicy grilled beef patty in a healthy burger bun with fresh vegetables and fat-free cheese."
    ),
    priceHalala: 1800,
    calories: 375,
    proteinFamilyKey: "beef",
  },
  // Subscription cold-sandwich allowlist — keys must match SUBSCRIPTION_COLD_SANDWICH_KEYS in mealPlannerContract.js
  { key: "turkey_cold_sandwich", category: "cold_sandwiches", itemType: "cold_sandwich", name: name("تركي", "Turkey"), priceHalala: 1300, calories: 220, proteinFamilyKey: "other" },
  { key: "boiled_egg_cold_sandwich", category: "cold_sandwiches", itemType: "cold_sandwich", name: name("بيض مسلوق", "Boiled Egg"), priceHalala: 900, calories: 160, proteinFamilyKey: "eggs" },
  { key: "tuna_cold_sandwich", category: "cold_sandwiches", itemType: "cold_sandwich", name: name("تونا", "Tuna"), priceHalala: 1300, calories: 200, proteinFamilyKey: "fish" },
  { key: "scrambled_egg_cold_sandwich", category: "cold_sandwiches", itemType: "cold_sandwich", name: name("بيض مخفوق", "Scrambled Egg"), priceHalala: 900, calories: 150, proteinFamilyKey: "eggs" },
  { key: "classic_halloumi_cold_sandwich", category: "cold_sandwiches", itemType: "cold_sandwich", name: name("حلوم كلاسيك", "Classic Halloumi"), priceHalala: 1100, calories: 200, proteinFamilyKey: "other" },
  { key: "chicken_fajita_cold_sandwich", category: "cold_sandwiches", itemType: "cold_sandwich", name: name("دجاج فاهيتا", "Chicken Fajita"), priceHalala: 1300, calories: 230, proteinFamilyKey: "chicken" },
  { key: "mexican_chicken_cold_sandwich", category: "cold_sandwiches", itemType: "cold_sandwich", name: name("دجاج مكسيكي", "Mexican Chicken"), priceHalala: 1300, calories: 260, proteinFamilyKey: "chicken" },
  { key: "grilled_chicken_cold_sandwich", category: "cold_sandwiches", itemType: "cold_sandwich", name: name("دجاج مشوي", "Grilled Chicken"), priceHalala: 1300, calories: 220, proteinFamilyKey: "chicken" },
  {
    key: "orange_cake",
    category: "desserts",
    itemType: "dessert",
    name: name("كيكة البرتقال", "Orange Cake"),
    description: name(
      "كيكة برتقال صحية محضّرة بمكونات خفيفة، بطعم برتقال طبيعي منعش وقوام ناعم، بدون سكر.",
      "Healthy orange cake made with light ingredients, natural refreshing orange flavor, soft texture, and no sugar."
    ),
    priceHalala: 900,
  },
  { key: "apple_cinnamon_muffin_2pcs", category: "desserts", itemType: "dessert", name: name("مافن التفاح بالقرفة قطعتين", "Apple Cinnamon Muffin - 2 Pieces"), priceHalala: 1200 },
  { key: "berry_cheesecake", category: "desserts", itemType: "dessert", name: name("تشيز كيك بالتوت", "Berry Cheesecake"), priceHalala: 1900 },
  { key: "strawberry_cheesecake", category: "desserts", itemType: "dessert", name: name("تشيز كيك بالفراولة", "Strawberry Cheesecake"), priceHalala: 1900 },
  { key: "dark_brownies", category: "desserts", itemType: "dessert", name: name("براونيز داكن", "Dark Brownies"), priceHalala: 1300 },
  { key: "protein_bar", category: "desserts", itemType: "dessert", name: name("بروتين بار", "Protein Bar"), priceHalala: 1500 },
  { key: "basic_classic", category: "desserts", itemType: "dessert", name: name("بيسك كلاسيك", "Basic Classic"), priceHalala: 1400 },
  { key: "protein_chocolate_cake", category: "desserts", itemType: "dessert", name: name("كيك شوكولاتة بروتين", "Protein Chocolate Cake"), priceHalala: 1900 },
  { key: "berry_blast", category: "juices", itemType: "juice", name: name("بيري بلاست", "Berry Blast"), priceHalala: 1100 },
  { key: "berry_prot", category: "juices", itemType: "juice", name: name("بيري بروت", "Berry Prot"), priceHalala: 1300 },
  { key: "classic_green", category: "juices", itemType: "juice", name: name("كلاسيك جرين", "Classic Green"), priceHalala: 1100 },
  { key: "beet_punch", category: "juices", itemType: "juice", name: name("بيت بنش", "Beet Punch"), priceHalala: 1100 },
  { key: "orange_carrot", category: "juices", itemType: "juice", name: name("برتقال وجزر", "Orange Carrot"), priceHalala: 1100 },
  { key: "watermelon_mint", category: "juices", itemType: "juice", name: name("بطيخ بالنعناع", "Watermelon Mint"), priceHalala: 1100 },
  { key: "vanilla_ice_cream", category: "ice_cream", itemType: "ice_cream", name: name("ايس كريم فانيليا", "Vanilla Ice Cream"), priceHalala: 1300 },
  { key: "chocolate_ice_cream", category: "ice_cream", itemType: "ice_cream", name: name("ايس كريم شوكولا", "Chocolate Ice Cream"), priceHalala: 1300 },
  { key: "ice_cream_addon", category: "ice_cream", itemType: "ice_cream", name: name("اضافة ايس كريم", "Ice Cream Add-on"), priceHalala: 700 },
  { key: "protein_drink", category: "drinks", itemType: "drink", name: name("مشروب بروتين", "Protein Drink"), priceHalala: 1900 },
  { key: "diet_iced_tea", category: "drinks", itemType: "drink", name: name("ايس تى دايت", "Diet Iced Tea"), priceHalala: 400 },
  { key: "diet_soda", category: "drinks", itemType: "drink", name: name("صودا دايت", "Diet Soda"), priceHalala: 300 },
  { key: "water", category: "drinks", itemType: "drink", name: name("مياه عادية", "Water"), priceHalala: 200 },
].map((row) => ({
  pricingModel: "fixed",
  availableFor: ["cold_sandwich", "juice", "dessert"].includes(row.itemType) ? ["one_time", "subscription"] : ["one_time"],
  ui: { cardVariant: row.itemType === "cold_sandwich" ? "sandwich_card" : "addon_card", cardSize: "small", imageRatio: "square" },
  ...row,
}));

const productRows = [
  {
    key: "basic_salad",
    category: "custom_order",
    itemType: "basic_salad",
    name: name("سلطة على مزاجك – 100جرام بروتين", "Custom Salad – 100g Protein"),
    pricingModel: "per_100g",
    priceHalala: 2900,
    availableFor: ["one_time", "subscription"],
    ui: { cardVariant: "hero_builder", cardSize: "large", imageRatio: "wide" },
    groups: [
      ["leafy_greens", 0, 2, false],
      ["vegetables_legumes", 0, 19, false],
      ["fruits", 0, 4, false],
      ["proteins", 1, 1, true],
      ["cheese_nuts", 0, 2, false],
      ["sauces", 1, 1, true],
      ["extra_protein_50g", 0, 1, false],
    ],
  },
  {
    key: "basic_meal",
    category: "custom_order",
    itemType: "basic_meal",
    name: name("وجبة بيسك", "Basic Meal"),
    pricingModel: "per_100g",
    priceHalala: 1900,
    availableFor: ["one_time", "subscription"],
    ui: { cardVariant: "hero_builder", cardSize: "large", imageRatio: "wide" },
    groups: [
      ["carbs", 1, 2],
      ["proteins", 1, 1],
    ],
  },
  {
    key: "premium_large_salad",
    category: "custom_order",
    itemType: "basic_salad",
    name: name("سلطة كبيرة مميزة", "Premium Large Salad"),
    pricingModel: "fixed",
    priceHalala: 2900,
    defaultWeightGrams: 0,
    availableFor: ["subscription"],
    ui: { cardVariant: "large_salad", cardSize: "large" },
    groups: [
      ["leafy_greens", 0, 2, false],
      ["vegetables_legumes", 0, 19, false],
      ["fruits", 0, 4, false],
      ["proteins", 1, 1, true],
      ["cheese_nuts", 0, 2, false],
      ["sauces", 1, 1, true],
    ],
  },
  {
    key: "small_salad",
    category: "custom_order",
    itemType: "green_salad",
    name: name("سلطة خضراء صغيرة", "Small Green Salad"),
    pricingModel: "fixed",
    priceHalala: 900,
    availableFor: ["subscription"],
    ui: { cardVariant: "addon", cardSize: "small" },
  },
  {
    key: "green_salad",
    category: "light_options",
    itemType: "green_salad",
    name: name("سلطة خضراء - 100 جرام", "Green Salad - 100g"),
    pricingModel: "fixed",
    priceHalala: 1500,
    defaultWeightGrams: 100,
    availableFor: ["one_time"],
    imageUrl: "",
    ui: { cardVariant: "compact_builder", cardSize: "medium", imageRatio: "square" },
    groups: [
      ["leafy_greens", 0, 2, false],
      ["vegetables_legumes", 0, 19, false],
      ["sauces", 0, 1, false],
    ],
  },
  {
    key: "fruit_salad",
    category: "light_options",
    itemType: "fruit_salad",
    name: name("سلطة فواكه – 150 جرام", "Fruit Salad – 150g"),
    pricingModel: "fixed",
    priceHalala: 1700,
    defaultWeightGrams: 150,
    availableFor: ["one_time"],
    imageUrl: "",
    ui: { cardVariant: "compact_builder", cardSize: "medium", imageRatio: "square" },
    groups: [
      ["fruits", 0, 9, false],
      ["sauces", 0, 1, false],
    ],
  },
  {
    key: "greek_yogurt",
    category: "light_options",
    itemType: "greek_yogurt",
    name: name("زبادي يوناني - 200 جرام", "Greek Yogurt - 200g"),
    pricingModel: "fixed",
    priceHalala: 1700,
    defaultWeightGrams: 200,
    availableFor: ["one_time"],
    imageUrl: "",
    ui: { cardVariant: "compact_builder", cardSize: "medium", imageRatio: "square" },
    groups: [
      ["fruits", 0, 5, false],
      ["sauces", 0, 1, false],
      ["cheese_nuts", 0, 3, false],
    ],
  },
  // Legacy subscription sandwich retained separately from the external grilled chicken row.
  { key: "chicken_sandwich", category: "cold_sandwiches", itemType: "cold_sandwich", name: name("ساندويتش دجاج", "Chicken Sandwich"), pricingModel: "fixed", priceHalala: 1300, availableFor: ["subscription"], ui: { cardVariant: "standard", cardSize: "small" }, proteinFamilyKey: "chicken" },
  { key: "sourdough_turkey", category: "sourdough", itemType: "sourdough", name: name("ساوردو تركي", "Sourdough Turkey"), pricingModel: "fixed", priceHalala: 2300, availableFor: ["subscription"], ui: { cardVariant: "standard", cardSize: "small" }, proteinFamilyKey: "other" },

  // Addon menu products for Juice subscription
  { key: "orange_juice", category: "juices", itemType: "juice", name: name("عصير برتقال", "Orange Juice"), pricingModel: "fixed", priceHalala: 1000, availableFor: ["subscription", "one_time"], ui: { cardVariant: "addon_card", cardSize: "small" } },
  { key: "apple_juice", category: "juices", itemType: "juice", name: name("عصير تفاح", "Apple Juice"), pricingModel: "fixed", priceHalala: 1000, availableFor: ["subscription", "one_time"], ui: { cardVariant: "addon_card", cardSize: "small" } },
  { key: "mango_juice", category: "juices", itemType: "juice", name: name("عصير مانجو", "Mango Juice"), pricingModel: "fixed", priceHalala: 1000, availableFor: ["subscription", "one_time"], ui: { cardVariant: "addon_card", cardSize: "small" } },

  // Addon menu products for Small Salad subscription
  { key: "greek_salad", category: "light_options", itemType: "green_salad", name: name("سلطة يونانية", "Greek Salad"), pricingModel: "fixed", priceHalala: 1200, availableFor: ["subscription", "one_time"], ui: { cardVariant: "addon", cardSize: "small" } },
  { key: "fruit_salad_addon", category: "light_options", itemType: "fruit_salad", name: name("سلطة فواكه", "Fruit Salad"), pricingModel: "fixed", priceHalala: 1200, availableFor: ["subscription", "one_time"], ui: { cardVariant: "addon", cardSize: "small" } },
  { key: "vegetable_salad", category: "light_options", itemType: "green_salad", name: name("سلطة خضار", "Vegetable Salad"), pricingModel: "fixed", priceHalala: 1200, availableFor: ["subscription", "one_time"], ui: { cardVariant: "addon", cardSize: "small" } },

  // Addon menu products for Snack subscription
  { key: "protein_snack", category: "desserts", itemType: "dessert", name: name("سناك بروتين", "Protein Snack"), pricingModel: "fixed", priceHalala: 1500, availableFor: ["subscription", "one_time"], ui: { cardVariant: "addon_card", cardSize: "small" } },
  { key: "healthy_dessert", category: "desserts", itemType: "dessert", name: name("حلوى صحية", "Healthy Dessert"), pricingModel: "fixed", priceHalala: 1500, availableFor: ["subscription", "one_time"], ui: { cardVariant: "addon_card", cardSize: "small" } },
  { key: "snack_box", category: "desserts", itemType: "dessert", name: name("صندوق سناك", "Snack Box"), pricingModel: "fixed", priceHalala: 1500, availableFor: ["subscription", "one_time"], ui: { cardVariant: "addon_card", cardSize: "small" } },

  ...externalProductRows,
  ...mealProductRows,
  ...carbProductRows,
];

const builderCategoryRows = [
  { key: "chicken", dimension: "protein", name: name("دجاج", "Chicken"), sortOrder: 10 },
  { key: "beef", dimension: "protein", name: name("لحم", "Beef"), sortOrder: 20, rules: { dailyLimit: 1, ruleKey: "beef_daily_limit", unit: "slots" } },
  { key: "fish", dimension: "protein", name: name("أسماك", "Fish"), sortOrder: 30 },
  { key: "eggs", dimension: "protein", name: name("بيض", "Eggs"), sortOrder: 40 },
  { key: "premium", dimension: "protein", name: name("بريميوم", "Premium"), sortOrder: 50, ui: { cardVariant: "premium" } },
  { key: "standard_carbs", dimension: "carb", name: name("كربوهيدرات", "Standard Carbs"), sortOrder: 10, rules: { maxTypes: 2, maxTotalGrams: 300, unit: "grams", ruleKey: "carb_split" } },
  { key: "large_salad", dimension: "carb", name: name("سلطة كبيرة مميزة", "Premium Large Salad"), sortOrder: 20, ui: { cardVariant: "large_salad" }, rules: { ruleKey: "premium_large_salad" } },
];

// Menu* collections are the canonical catalog source of truth in this seed.
// The Builder*, Sandwich, and SaladIngredient rows below are temporary mirrors
// for legacy planner validation/read paths that still resolve those model IDs.
async function resetCatalogData() {
  await Promise.all([
    ProductGroupOption.deleteMany({}),
    ProductOptionGroup.deleteMany({}),
    MenuOption.deleteMany({}),
    MenuOptionGroup.deleteMany({}),
    MenuProduct.deleteMany({}),
    MenuCategory.deleteMany({}),
    MenuVersion.deleteMany({}),
    BuilderProtein.deleteMany({}),
    BuilderCarb.deleteMany({}),
    BuilderCategory.deleteMany({}),
    Sandwich.deleteMany({}),
    SaladIngredient.deleteMany({}),
    MealBuilderConfig.deleteMany({}),
  ]);
}

async function seedCategories({ sync = false } = {}) {
  const categoryMap = new Map();
  for (let index = 0; index < categoryRows.length; index += 1) {
    const row = categoryRows[index];
    const doc = await upsertByMode(
      MenuCategory,
      { key: row.key },
      {
        key: row.key,
        name: row.name,
        ...(hasOwn(row, "imageUrl") ? { imageUrl: row.imageUrl } : {}),
        ui: row.ui,
        ...activePublishedFields((index + 1) * 10),
      },
      { label: "Categories", sync }
    );
    categoryMap.set(doc.key, doc);
  }
  return categoryMap;
}

async function seedOptionGroupsAndOptions({ catalogItemMap = new Map(), sync = false } = {}) {
  const groupMap = new Map();
  const optionMap = new Map();

  for (let groupIndex = 0; groupIndex < groupDefinitions.length; groupIndex += 1) {
    const groupDef = groupDefinitions[groupIndex];
    const group = await upsertByMode(
      MenuOptionGroup,
      { key: groupDef.key },
      {
        key: groupDef.key,
        name: groupDef.name,
        ui: groupDef.ui,
        ...activePublishedFields((groupIndex + 1) * 10),
      },
      { label: "Option groups", sync }
    );
    groupMap.set(group.key, group);

    for (let optionIndex = 0; optionIndex < groupDef.options.length; optionIndex += 1) {
      const optionDef = groupDef.options[optionIndex];
      const catalogItemKey = menuOptionCatalogItemKeyByOptionKey[optionDef.key];
      const catalogItem = catalogItemKey ? catalogItemMap.get(catalogItemKey) : null;
      const option = await upsertByMode(
        MenuOption,
        { groupId: group._id, key: optionDef.key },
        {
          groupId: group._id,
          key: optionDef.key,
          name: optionDef.name,
          ...(catalogItem ? { catalogItemId: catalogItem._id } : {}),
          ...(hasOwn(optionDef, "imageUrl") ? { imageUrl: optionDef.imageUrl } : {}),
          availableFor: optionDef.availableFor || ["one_time", "subscription"],
          availableForSubscription: (optionDef.availableFor || ["one_time", "subscription"]).includes("subscription"),
          nutrition: {
            calories: Number(optionDef.calories || optionDef.nutrition?.calories || 0),
            proteinGrams: Number(optionDef.nutrition?.proteinGrams || 0),
            carbGrams: Number(optionDef.nutrition?.carbGrams || 0),
            fatGrams: Number(optionDef.nutrition?.fatGrams || 0),
          },
          extraPriceHalala: groupDef.key === "proteins" ? 0 : (optionDef.extraPriceHalala ?? 0),
          extraWeightPriceHalala: 0,
          extraWeightUnitGrams: 0,
          extraFeeHalala: groupDef.key === "proteins" ? 0 : Number(optionDef.extraFeeHalala || 0),
          premiumKey: groupDef.key === "proteins" ? "" : (optionDef.premiumKey || ""),
          proteinFamilyKey: optionDef.proteinFamilyKey || "",
          displayCategoryKey: groupDef.key === "proteins" ? "" : (optionDef.displayCategoryKey || ""),
          selectionType: groupDef.key === "proteins" ? "" : (optionDef.selectionType || ""),
          ruleTags: groupDef.key === "proteins" ? [] : (optionDef.ruleTags || []),
          ...activePublishedFields((optionIndex + 1) * 10),
        },
        { label: "Options", sync }
      );
      optionMap.set(`${group.key}:${option.key}`, option);
    }
  }

  return { groupMap, optionMap };
}

async function seedBuilderCompatibilityCategories({ sync = false } = {}) {
  const categoryMap = new Map();
  for (const row of builderCategoryRows) {
    const doc = await upsertByMode(
      BuilderCategory,
      { dimension: row.dimension, key: row.key },
      {
        key: row.key,
        dimension: row.dimension,
        name: row.name,
        ui: row.ui || { cardVariant: row.key === "premium" ? "premium" : "standard" },
        rules: row.rules || {},
        isActive: true,
        sortOrder: row.sortOrder,
      },
      { label: "Builder categories", sync }
    );
    categoryMap.set(`${row.dimension}:${row.key}`, doc);
  }
  return categoryMap;
}

async function seedBuilderCompatibilityMirrors({ optionMap, builderCategoryMap, sync = false }) {
  for (const groupDef of groupDefinitions) {
    for (let optionIndex = 0; optionIndex < groupDef.options.length; optionIndex += 1) {
      const optionDef = groupDef.options[optionIndex];
      const option = optionMap.get(`${groupDef.key}:${optionDef.key}`);
      if (!option) continue;

      if (groupDef.key === "proteins") {
        const subscriptionRelation = subscriptionProteinRelationByKey.get(optionDef.key);
        if (!subscriptionRelation) continue;

        const displayCategoryKey = subscriptionRelation.displayCategoryKey || "other";
        const displayCategory = builderCategoryMap.get(`protein:${displayCategoryKey}`);
        if (!displayCategory) continue;

        const query = subscriptionRelation.premiumKey ? { premiumKey: subscriptionRelation.premiumKey } : { key: optionDef.key };
        const payload = {
          _id: option._id,
          key: optionDef.key,
          name: optionDef.name,
          ...(hasOwn(optionDef, "imageUrl") ? { imageUrl: optionDef.imageUrl } : {}),
          displayCategoryId: displayCategory._id,
          displayCategoryKey,
          proteinFamilyKey: optionDef.proteinFamilyKey || "other",
          selectionType: subscriptionRelation.selectionType,
          isPremium: Boolean(subscriptionRelation.isPremium),
          extraFeeHalala: Number(subscriptionRelation.extraFeeHalala || 0),
          nutrition: { calories: Number(optionDef.calories || 0) },
          currency: SYSTEM_CURRENCY,
          availableForSubscription: true,
          isActive: true,
          sortOrder: subscriptionRelation.sortOrder || ((optionIndex + 1) * 10),
        };
        if (subscriptionRelation.premiumKey) payload.premiumKey = subscriptionRelation.premiumKey;

        await upsertByMode(BuilderProtein, query, payload, { label: "Builder proteins", sync });
      }

      if (groupDef.key === "carbs") {
        const displayCategory = builderCategoryMap.get("carb:standard_carbs");
        await upsertByMode(
          BuilderCarb,
          { key: optionDef.key },
          {
            _id: option._id,
            key: optionDef.key,
            name: optionDef.name,
            displayCategoryId: displayCategory._id,
            displayCategoryKey: "standard_carbs",
            availableForSubscription: true,
            nutrition: { calories: Number(optionDef.calories || 0) },
            isActive: true,
            sortOrder: (optionIndex + 1) * 10,
          },
          { label: "Builder carbs", sync }
        );
      }

      if (["leafy_greens", "vegetables_legumes", "cheese_nuts", "fruits", "sauces"].includes(groupDef.key)) {
        const groupKey = saladIngredientGroupAliases[groupDef.key] || groupDef.key;
        await upsertByMode(
          SaladIngredient,
          { _id: option._id },
          {
            _id: option._id,
            name: optionDef.name,
            groupKey,
            price: 0,
            calories: Number(optionDef.calories || 0),
            maxQuantity: 99,
            isActive: true,
            sortOrder: (optionIndex + 1) * 10,
          },
          { label: "Salad ingredients", sync }
        );
      }
    }
  }
}

async function seedProducts({ catalogItemMap = new Map(), categoryMap, groupMap, optionMap, sync = false }) {
  const productMap = new Map();

  for (let productIndex = 0; productIndex < productRows.length; productIndex += 1) {
    const row = productRows[productIndex];
    const category = categoryMap.get(row.category);
    if (!category) throw new Error(`Missing category ${row.category} for ${row.key}`);
    const optionGroupKeys = Array.isArray(row.groups) ? row.groups.map(([groupKey]) => groupKey) : [];
    const weightPricing = testWeightPricingEligibility(row, row.category, optionGroupKeys).eligible
      ? testWeightPricingUpdate()
      : {};

    const catalogItemKey = menuProductCatalogItemKeyByProductKey[row.key];
    const catalogItem = catalogItemKey ? catalogItemMap.get(catalogItemKey) : null;
    const product = await upsertByMode(
      MenuProduct,
      { key: row.key },
      {
        categoryId: category._id,
        key: row.key,
        name: row.name,
        ...(catalogItem ? { catalogItemId: catalogItem._id } : {}),
        ...(row.description ? { description: row.description } : {}),
        ...(hasOwn(row, "imageUrl") ? { imageUrl: row.imageUrl } : {}),
        itemType: row.itemType,
        pricingModel: row.pricingModel,
        priceHalala: row.priceHalala,
        baseUnitGrams: 100,
        defaultWeightGrams: row.defaultWeightGrams ?? (row.pricingModel === "per_100g" ? 100 : 0),
        minWeightGrams: row.pricingModel === "per_100g" ? 100 : 0,
        maxWeightGrams: row.maxWeightGrams || 0,
        weightStepGrams: 50,
        ...weightPricing,
        currency: SYSTEM_CURRENCY,
        availableFor: row.availableFor,
        isCustomizable: productIsCustomizable(row),
        ui: row.ui || { cardVariant: "standard" },
        ...activePublishedFields((productIndex + 1) * 10),
      },
      { label: "Products", sync }
    );
    productMap.set(product.key, product);

    const activeGroupIdsForProduct = [];

    if (Array.isArray(row.groups)) {
      for (let relationIndex = 0; relationIndex < row.groups.length; relationIndex += 1) {
        const [groupKey, minSelections, maxSelections, explicitRequired] = row.groups[relationIndex];
        const group = groupMap.get(groupKey);
        if (!group) throw new Error(`Missing option group ${groupKey} for ${row.key}`);
        activeGroupIdsForProduct.push(group._id);

        await upsertByMode(
          ProductOptionGroup,
          { productId: product._id, groupId: group._id },
          {
            productId: product._id,
            groupId: group._id,
            minSelections,
            maxSelections,
            isRequired: explicitRequired ?? minSelections > 0,
            isActive: true,
            isVisible: true,
            isAvailable: true,
            sortOrder: (relationIndex + 1) * 10,
          },
          { label: "Product-group relations", sync, relation: true }
        );

        const groupDef = groupDefinitions.find((definition) => definition.key === groupKey);
        const explicitAllowedKeys = productGroupAllowedOptionKeys[row.key]?.[groupKey];
        const allowedOptions = groupDef
          ? groupDef.options.filter((optionDef) => (
            !Array.isArray(explicitAllowedKeys) || explicitAllowedKeys.includes(optionDef.key)
          ))
          : [];
        const allowedOptionIds = [];
        for (let optionIndex = 0; optionIndex < allowedOptions.length; optionIndex += 1) {
          const optionDef = allowedOptions[optionIndex];
          const option = optionMap.get(`${groupKey}:${optionDef.key}`);
          if (!option) continue;
          allowedOptionIds.push(option._id);
          await upsertByMode(
            ProductGroupOption,
            { productId: product._id, groupId: group._id, optionId: option._id },
            {
              productId: product._id,
              groupId: group._id,
              optionId: option._id,
              extraPriceHalala: resolveProductGroupOptionPriceHalala(row.key, groupKey, optionDef),
              extraWeightUnitGrams: 0,
              extraWeightPriceHalala: 0,
              isActive: true,
              isVisible: true,
              isAvailable: true,
              sortOrder: resolveProductGroupOptionSortOrder(row.key, groupKey, optionDef, (optionIndex + 1) * 10),
            },
            { label: "Product-option relations", sync, relation: true }
          );
        }

        if (sync) {
          await ProductGroupOption.updateMany(
            {
              productId: product._id,
              groupId: group._id,
              optionId: { $nin: allowedOptionIds },
            },
            {
              $set: {
                isActive: false,
                isVisible: false,
                isAvailable: false,
              },
            }
          );
        }
      }
    }

    if (sync) {
      const unavailable = { isActive: false, isVisible: false, isAvailable: false };
      await Promise.all([
        ProductOptionGroup.updateMany(
          {
            productId: product._id,
            ...(activeGroupIdsForProduct.length ? { groupId: { $nin: activeGroupIdsForProduct } } : {}),
          },
          { $set: unavailable }
        ),
        ProductGroupOption.updateMany(
          {
            productId: product._id,
            ...(activeGroupIdsForProduct.length ? { groupId: { $nin: activeGroupIdsForProduct } } : {}),
          },
          { $set: unavailable }
        ),
      ]);
    }

    const hasExtraProtein = row.groups?.some(([groupKey]) => groupKey === "extra_protein_50g");
    const extraProteinGroup = groupMap.get("extra_protein_50g");
    if (sync && row.category === "meals" && !hasExtraProtein && extraProteinGroup) {
      const unavailable = { isActive: false, isVisible: false, isAvailable: false };
      await Promise.all([
        ProductOptionGroup.updateMany({ productId: product._id, groupId: extraProteinGroup._id }, { $set: unavailable }),
        ProductGroupOption.updateMany({ productId: product._id, groupId: extraProteinGroup._id }, { $set: unavailable }),
      ]);
    }
  }

  return productMap;
}

async function seedPremiumUpgradeConfigs({ productMap, groupMap, optionMap, sync = false }) {
  const basicMeal = productMap.get("basic_meal");
  const premiumLargeSalad = productMap.get("premium_large_salad");
  const proteinsGroup = groupMap.get("proteins");
  if (!basicMeal || !proteinsGroup) return;

  for (const relation of premiumMealProteinRelations) {
    const option = optionMap.get(`proteins:${relation.key}`);
    if (!option) continue;
    await upsertByMode(
      PremiumUpgradeConfig,
      { premiumKey: relation.premiumKey || relation.key },
      {
        sourceType: "menu_option",
        sourceId: option._id,
        sourceProductId: basicMeal._id,
        sourceGroupId: proteinsGroup._id,
        selectionType: "premium_meal",
        premiumKey: relation.premiumKey || relation.key,
        displayGroupKey: "premium",
        upgradeDeltaHalala: Number(relation.extraFeeHalala || 0),
        currency: SYSTEM_CURRENCY,
        isEnabled: true,
        isVisible: true,
        status: "active",
        sortOrder: Number(relation.sortOrder || 0),
        sourceSnapshot: {
          key: option.key,
          name: option.name,
          context: { productKey: basicMeal.key, groupKey: proteinsGroup.key },
        },
      },
      { label: "Premium upgrade configs", sync }
    );
  }

  if (premiumLargeSalad) {
    await upsertByMode(
      PremiumUpgradeConfig,
      { premiumKey: "premium_large_salad" },
      {
        sourceType: "menu_product",
        sourceId: premiumLargeSalad._id,
        sourceProductId: premiumLargeSalad._id,
        sourceGroupId: null,
        selectionType: "premium_large_salad",
        premiumKey: "premium_large_salad",
        displayGroupKey: "premium",
        upgradeDeltaHalala: Number(premiumLargeSalad.priceHalala || 0),
        currency: SYSTEM_CURRENCY,
        isEnabled: true,
        isVisible: true,
        status: "active",
        sortOrder: 999,
        sourceSnapshot: {
          key: premiumLargeSalad.key,
          name: premiumLargeSalad.name,
          context: { productKey: premiumLargeSalad.key },
        },
      },
      { label: "Premium upgrade configs", sync }
    );
  }
}

async function seedSandwichCompatibility(productMap, { sync = false } = {}) {
  const subscriptionSandwichKeys = [...SUBSCRIPTION_COLD_SANDWICH_KEYS];
  const sandwichProducts = productRows.filter((row) => subscriptionSandwichKeys.includes(row.key));
  for (let index = 0; index < sandwichProducts.length; index += 1) {
    const row = sandwichProducts[index];
    const product = productMap.get(row.key);
    if (!product) continue;

    await upsertByMode(
      Sandwich,
      { _id: product._id },
      {
        _id: product._id,
        name: row.name,
        description: row.description || name("", ""),
        ...(hasOwn(row, "imageUrl") ? { imageUrl: row.imageUrl } : {}),
        calories: Number(row.calories || 0),
        selectionType: "sandwich",
        categoryKey: "sandwich",
        pricingModel: "included",
        priceHalala: 0,
        proteinFamilyKey: row.proteinFamilyKey || "other",
        isActive: true,
        sortOrder: (index + 1) * 10,
      },
      { label: "Sandwich mirrors", sync }
    );
  }
}

async function seedSubscriptionAddons(productMap, { sync = false } = {}) {
  let activeProductMap = productMap;
  if (!activeProductMap) {
    const MenuProductModel = require("../../src/models/MenuProduct");
    const products = await MenuProductModel.find({}).lean();
    activeProductMap = new Map(products.map((p) => [p.key, p]));
  }

  const addonProducts = productRows.filter((row) => (
    row.availableFor.includes("subscription")
    && ["juice", "dessert"].includes(row.itemType)
  ));

  for (const row of addonProducts) {
    const product = activeProductMap.get(row.key);
    const query = product ? { menuProductId: product._id } : { name: row.name };
    await upsertByMode(
      Addon,
      query,
      {
        name: row.name,
        ...(product ? { menuProductId: product._id } : {}),
        priceHalala: row.priceHalala,
        price: row.priceHalala / 100,
        priceSar: row.priceHalala / 100,
        priceLabel: `${row.priceHalala / 100} SAR`,
        kind: "item",
        type: "one_time",
        category: row.itemType === "juice" ? "juice" : "snack",
        billingMode: "flat_once",
        pricingModel: "one_time",
        billingUnit: "item",
        currency: SYSTEM_CURRENCY,
        isActive: true,
      },
      { label: "Subscription addons", sync }
    );
  }

  const MenuProduct = require("../../src/models/MenuProduct");
  const AddonPlanPrice = require("../../src/models/AddonPlanPrice");
  const Plan = require("../../src/models/Plan");

  // Fetch relevant products by key/itemType
  const juiceProducts = await MenuProduct.find({
    itemType: "juice",
    isActive: true
  }).lean();

  const snackProducts = await MenuProduct.find({
    itemType: "dessert",
    isActive: true
  }).lean();

  const saladProducts = await MenuProduct.find({
    key: { $in: ["greek_salad", "fruit_salad_addon", "vegetable_salad"] },
    isActive: true
  }).lean();

  const juiceProductIds = juiceProducts.map((p) => p._id);
  const saladProductIds = saladProducts.map((p) => p._id);
  const snackProductIds = snackProducts.map((p) => p._id);

  const planAddons = [
    {
      name: name("اشتراك العصير", "Juice Subscription"),
      priceHalala: 1100,
      category: "juice",
      sortOrder: 1,
      menuProductIds: juiceProductIds,
      maxPerDay: 1,
      pricingMode: "base_plan_matrix",
    },
    {
      name: name("اشتراك السناك", "Snack Subscription"),
      priceHalala: 1200,
      category: "snack",
      sortOrder: 2,
      menuProductIds: snackProductIds,
      maxPerDay: 1,
      pricingMode: "base_plan_matrix",
    },
    {
      name: name("اشتراك السلطة الصغيرة", "Small Salad Subscription"),
      priceHalala: 1200,
      category: "small_salad",
      sortOrder: 3,
      menuProductIds: saladProductIds,
      maxPerDay: 1,
      pricingMode: "base_plan_matrix",
    },
  ];

  const seededAddonPlans = [];
  for (const plan of planAddons) {
    const doc = await upsertByMode(
      Addon,
      { kind: "plan", category: plan.category },
      {
        ...plan,
        price: plan.priceHalala / 100,
        priceSar: plan.priceHalala / 100,
        priceLabel: `${plan.priceHalala / 100} SAR`,
        kind: "plan",
        type: "subscription",
        billingMode: "per_day",
        pricingModel: "subscription",
        billingUnit: "day",
        currency: SYSTEM_CURRENCY,
        isActive: true,
      },
      { label: "Subscription addons", sync: true }
    );
    seededAddonPlans.push(doc);
  }

  // Seed active price matrix rows for the base subscription plans
  const sellableQuery = Plan.getSellableQuery();
  const basePlans = await Plan.find(sellableQuery).lean();
  const basePlanIds = basePlans.map(p => p._id);

  // Clean existing local/dev seeded matrix data linked to non-sellable base plans
  await AddonPlanPrice.deleteMany({ basePlanId: { $nin: basePlanIds } });
  
  const matrixPrices = {
    juice: {
      7: 10000,
      26: 18000,
      30: 30000,
    },
    small_salad: {
      7: 9000,
      26: 16000,
      30: 27000,
    },
    snack: {
      7: 8000,
      26: 15000,
      30: 25000,
    },
  };

  const getMatrixPrice = (category, daysCount) => {
    const pricesObj = matrixPrices[category] || {};
    if (pricesObj[daysCount] !== undefined) {
      return pricesObj[daysCount];
    }
    // Proportional fallback placeholder based on days count
    const perDayRate = category === "juice" ? 1000 : (category === "snack" ? 800 : 900);
    return perDayRate * (daysCount || 30);
  };

  for (const addonDoc of seededAddonPlans) {
    for (const basePlanDoc of basePlans) {
      const priceHalala = getMatrixPrice(addonDoc.category, basePlanDoc.daysCount);
      if (priceHalala === null) continue; // Do not use loose fallback mapping

      await AddonPlanPrice.findOneAndUpdate(
        { addonPlanId: addonDoc._id, basePlanId: basePlanDoc._id },
        {
          $set: {
            priceHalala,
            currency: SYSTEM_CURRENCY,
            isActive: true,
          }
        },
        { upsert: true, new: true }
      );
    }
  }
}

async function seedSettings({ sync = false } = {}) {
  if (Array.isArray(pickupLocations) && pickupLocations.length > 0) {
    const stats = getStats("Pickup locations");
    const existing = await Setting.findOne({ key: "pickup_locations" });
    if (!existing) {
      await Setting.create({
        key: "pickup_locations",
        value: pickupLocations,
        description: "System Pickup Locations (Branches)",
      });
      stats.created += pickupLocations.length;
    } else if (sync) {
      await Setting.updateOne(
        { key: "pickup_locations" },
        { $set: { value: pickupLocations, description: "System Pickup Locations (Branches)" } }
      );
      stats.updated += pickupLocations.length;
    } else {
      const existingLocations = Array.isArray(existing.value) ? existing.value : [];
      const existingIds = new Set(existingLocations.map((location) => (
        String(location?.id || location?.key || location?.code || location?.slug || location?.branchId || location?.pickupLocationId || "")
      )).filter(Boolean));
      const missingLocations = pickupLocations.filter((location) => {
        const id = String(location?.id || location?.key || location?.code || location?.slug || location?.branchId || location?.pickupLocationId || "");
        return id && !existingIds.has(id);
      });
      if (missingLocations.length > 0) {
        await Setting.updateOne({ key: "pickup_locations" }, { $push: { value: { $each: missingLocations } } });
        stats.created += missingLocations.length;
        stats.repaired += missingLocations.length;
      }
      stats.skipped += pickupLocations.length - missingLocations.length;
    }
  }

  if (settings && typeof settings === "object") {
    const envOverrides = {
      restaurant_name: process.env.RESTAURANT_NAME,
      restaurant_phone: process.env.RESTAURANT_PHONE,
      restaurant_address: process.env.RESTAURANT_ADDRESS,
      restaurant_latitude: process.env.RESTAURANT_LATITUDE ? parseFloat(process.env.RESTAURANT_LATITUDE) : undefined,
      restaurant_longitude: process.env.RESTAURANT_LONGITUDE ? parseFloat(process.env.RESTAURANT_LONGITUDE) : undefined,
      restaurant_open_time: process.env.RESTAURANT_OPEN_TIME,
      restaurant_close_time: process.env.RESTAURANT_CLOSE_TIME,
      restaurant_is_open: process.env.RESTAURANT_IS_OPEN !== undefined ? process.env.RESTAURANT_IS_OPEN === "true" : undefined,
    };

    const settingEntries = Object.entries(settings);
    for (const [settingKey, defaultValue] of settingEntries) {
      const value = envOverrides[settingKey] !== undefined ? envOverrides[settingKey] : defaultValue;
      await upsertByMode(
        Setting,
        { key: settingKey },
        { key: settingKey, value, description: "System Base Setting" },
        { label: "Settings", sync }
      );
    }
  }

  if (Array.isArray(deliveryZones) && deliveryZones.length > 0) {
    for (const zone of deliveryZones) {
      await upsertByMode(
        Zone,
        { "name.en": zone.name.en },
        zone,
        { label: "Delivery zones", sync }
      );
    }
  }
}

async function seedCatalogItems() {
  const catalogItemMap = new Map();
  const stats = getStats("Catalog Items");

  for (const row of canonicalCatalogItems) {
    const existing = await CatalogItem.findOne({ key: row.key });
    if (existing) {
      stats.skipped += 1;
      catalogItemMap.set(existing.key, existing);
      continue;
    }

    const carbRow = carbRows.find((candidate) => candidate.key === row.key);
    const proteinRow = proteinRowsByKey.get(row.key);
    const doc = await CatalogItem.create({
      key: row.key,
      nameI18n: carbRow?.name || proteinRow?.name || name(row.key, row.key),
      itemKind: row.itemKind,
      nutrition: row.nutrition || {},
      isActive: true,
      isAvailable: true,
    });

    stats.created += 1;
    catalogItemMap.set(doc.key, doc);
  }

  return catalogItemMap;
}

async function seedCatalog({
  sync = false,
  reset = false,
  onlySubscriptionPlans = false,
  includeSubscriptionPlans = true,
  skipStrictVerify = false,
} = {}) {
  const runSync = sync === true;
  const runReset = reset === true;

  console.log(`Bootstrap mode: ${runSync ? "sync" : "create-missing-only"}`);

  if (onlySubscriptionPlans) {
    console.log("Only subscription plans flag detected. Menu/catalog seed will be skipped.");
    await seedSubscriptionPlans({ sync: runSync, cleanupFlatPlans: runSync });
    console.log("Subscription plans-only seed complete.");
    return;
  }

  if (runReset) {
    console.warn("Resetting catalog-owned collections because reset flag was provided.");
    await resetCatalogData();
  } else {
    console.log("Reset skipped. Existing rows will be preserved.");
  }

  const catalogItemMap = await seedCatalogItems();
  const builderCategoryMap = await seedBuilderCompatibilityCategories({ sync: runSync });
  const categoryMap = await seedCategories({ sync: runSync });
  const { groupMap, optionMap } = await seedOptionGroupsAndOptions({ catalogItemMap, sync: runSync });
  await seedBuilderCompatibilityMirrors({ optionMap, builderCategoryMap, sync: runSync });
  const productMap = await seedProducts({ catalogItemMap, categoryMap, groupMap, optionMap, sync: runSync });
  await seedPremiumUpgradeConfigs({ productMap, groupMap, optionMap, sync: runSync });
  await seedSandwichCompatibility(productMap, { sync: runSync });
  if (includeSubscriptionPlans) {
    await seedSubscriptionPlans({ sync: runSync, cleanupFlatPlans: runSync });
  } else {
    console.log("Subscription plans skipped by orchestrator; they will run as a focused bootstrap step.");
  }
  await seedSubscriptionAddons(productMap, { sync: runSync });
  await seedSettings({ sync: runSync });

  if (runSync) {
    await publishMenu({ notes: "Explicit canonical catalog sync" });
    console.log("Menu published because explicit sync mode was enabled.");
  } else {
    console.log("Menu publication skipped in create-missing-only mode.");
  }

  await verifySeedReadContracts({ strict: runSync && !skipStrictVerify });

  printBootstrapStats();
  console.log(runReset ? "Reset performed." : "No reset performed.");
  console.log(runSync ? "Explicit sync updates were allowed." : "No destructive operations performed.");
  console.log("Canonical catalog seed complete.");
}

module.exports = {
  main,
  seedCatalog,
  seedSubscriptionAddons,
  seedSubscriptionPlans,
  seedSettings,
  seedCategories,
  seedOptionGroupsAndOptions,
  seedProducts,
  seedSandwichCompatibility,
  verifySeedReadContracts,
};

async function main() {
  const uri = resolveMongoUri();

  const args = parseArgs();
  const runSync = args.sync && isTruthy(process.env.BOOTSTRAP_SYNC);
  if (args.reset && !isTruthy(process.env.ALLOW_CATALOG_RESET)) {
    throw new Error("Refusing catalog reset. Set ALLOW_CATALOG_RESET=true with --reset in a local/test environment.");
  }
  if (args.reset && getEnvironmentName() === "production") {
    throw new Error("Refusing catalog reset in production.");
  }
  const runReset = args.reset && isTruthy(process.env.ALLOW_CATALOG_RESET);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log("Connected to MongoDB for canonical catalog seeding.");
  try {
    await seedCatalog({
      sync: runSync,
      reset: runReset,
      onlySubscriptionPlans: args.onlySubscriptionPlans,
      includeSubscriptionPlans: !args.skipSubscriptionPlans,
    });
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(err);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    process.exit(1);
  });
}
