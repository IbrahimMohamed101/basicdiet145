"use strict";

const assert = require("assert");

const { mapOrderToDTO } = require("../src/services/dashboard/dashboardDtoService");
const { buildOrderKitchenDetailsPayload } = require("../src/services/dashboard/opsPayloadService");
const { buildKitchenProjection } = require("../src/services/dashboard/kitchenProjectionService");

function selectedOption(groupId, groupAr, groupEn, optionId, optionKey, nameAr, nameEn, pricing = {}) {
  return {
    groupId,
    groupName: { ar: groupAr, en: groupEn },
    optionId,
    optionKey,
    name: { ar: nameAr, en: nameEn },
    qty: pricing.qty || 1,
    extraPriceHalala: pricing.extraPriceHalala || 0,
    totalHalala: pricing.totalHalala || 0,
  };
}

function run() {
  const ids = {
    product: "6a522ed1b3fb649917aee497",
    leafy: "6a522ed1b3fb649917aee501",
    vegetables: "6a522ed1b3fb649917aee502",
    fruits: "6a522ed1b3fb649917aee503",
    proteins: "6a522ed1b3fb649917aee504",
    cheeseNuts: "6a522ed1b3fb649917aee505",
    sauces: "6a522ed1b3fb649917aee506",
    extraProtein: "6a522ed1b3fb649917aee507",
  };
  const options = [
    selectedOption(ids.leafy, "ورقيات", "Leafy greens", "6a522ed1b3fb649917aee511", "arugula", "جرجير", "Arugula"),
    selectedOption(ids.leafy, "ورقيات", "Leafy greens", "6a522ed1b3fb649917aee512", "lettuce", "خس", "Lettuce"),
    selectedOption(ids.vegetables, "خضراوات وبقوليات", "Vegetables & legumes", "6a522ed1b3fb649917aee513", "carrot", "جزر", "Carrot"),
    selectedOption(ids.vegetables, "خضراوات وبقوليات", "Vegetables & legumes", "6a522ed1b3fb649917aee514", "tomato", "طماطم", "Tomato"),
    selectedOption(ids.fruits, "فواكه", "Fruits", "6a522ed1b3fb649917aee515", "mango", "مانجا", "Mango"),
    selectedOption(ids.proteins, "بروتينات", "Proteins", "6a522ed1b3fb649917aee516", "fajita", "فاهيتا", "Fajita"),
    selectedOption(ids.cheeseNuts, "الاجبان و المكسرات", "Cheese & nuts", "6a522ed1b3fb649917aee517", "cashew", "كاجو", "Cashew"),
    selectedOption(ids.sauces, "الصوصات", "Sauces", "6a522ed1b3fb649917aee518", "spicy_ranch", "سبايسي رانش", "Spicy Ranch"),
    selectedOption(
      ids.extraProtein,
      "إضافة بروتين",
      "Extra protein",
      "6a522ed1b3fb649917aee519",
      "extra_chicken_50g",
      "زيادة 50 جرام من الدجاج",
      "Extra 50g chicken",
      { extraPriceHalala: 500, totalHalala: 500 }
    ),
  ];
  const order = {
    _id: "6a522ed1b3fb649917aee599",
    status: "confirmed",
    paymentStatus: "paid",
    fulfillmentMethod: "pickup",
    fulfillmentDate: "2026-07-17",
    items: [{
      itemType: "basic_salad",
      productId: ids.product,
      name: {
        ar: "سلطة على مزاجك – 100جرام بروتين",
        en: "Build Your Salad – 100g Protein",
      },
      qty: 1,
      productSnapshot: {
        key: "basic_salad",
        name: {
          ar: "سلطة على مزاجك – 100جرام بروتين",
          en: "Build Your Salad – 100g Protein",
        },
      },
      // Pricing persists the same immutable option snapshot in both locations
      // for compatibility with old and new order readers.
      selectedOptions: options,
      selections: { selectedOptions: options.map((option) => ({ ...option })) },
    }],
  };
  const optionRows = options.map((option) => ({
    _id: option.optionId,
    key: option.optionKey,
    name: option.name,
  }));
  const catalogMaps = {
    optionById: new Map(optionRows.map((option) => [String(option._id), option])),
    optionByKey: new Map(optionRows.map((option) => [String(option.key), option])),
  };

  const kitchenDetails = buildOrderKitchenDetailsPayload(order, "ar", catalogMaps);
  const kitchenDetailsBeforeProjection = structuredClone(kitchenDetails);
  const projection = buildKitchenProjection(kitchenDetails);
  assert.deepStrictEqual(kitchenDetails, kitchenDetailsBeforeProjection, "projection must not mutate legacy kitchenDetails");
  assert.strictEqual(kitchenDetails.mealSlots[0].selectedOptions.length, options.length * 2, "legacy merged snapshot remains unchanged");

  const card = projection.kitchenCards[0];
  assert.strictEqual(card.type, "basic_salad");
  assert.strictEqual(card.title, "سلطة على مزاجك – 100جرام بروتين");
  assert.strictEqual(card.badge, "سلطة");
  assert(card.sections.length >= 7);
  assert(card.lines.length > 0);
  assert(card.lines.includes("ورقيات: جرجير، خس"));
  assert(card.lines.includes("خضراوات وبقوليات: جزر، طماطم"));
  assert(card.lines.includes("الصوصات: سبايسي رانش"));
  assert(card.lines.includes("إضافة بروتين: زيادة 50 جرام من الدجاج"));
  assert(card.components.salad, "basic salad must expose structured salad components");
  assert.deepStrictEqual(card.components.salad.sections, card.sections);

  const projectedItems = card.sections.flatMap((section) => section.items);
  assert.strictEqual(projectedItems.length, options.length, "duplicate snapshot sources must not repeat options in the card");
  const extraChicken = projectedItems.find((option) => option.key === "extra_chicken_50g");
  assert(extraChicken, "paid extra protein remains visible");
  assert.strictEqual(extraChicken.totalPriceHalala, 500);
  assert.strictEqual(card.rawSelection, kitchenDetails.mealSlots[0]);

  const dto = mapOrderToDTO(order, null, null, "kitchen", "ar", catalogMaps);
  assert(dto.kitchenDetails, "one-time order keeps legacy kitchenDetails");
  assert.strictEqual(dto.kitchenProjectionVersion, "v1");
  assert.strictEqual(dto.kitchenCards[0].title, order.items[0].name.ar);
  assert(dto.kitchenCards[0].components.salad);

  console.log("✅ one-time basic salad projects grouped, deduplicated kitchen sections");
}

try {
  run();
} catch (error) {
  console.error(`❌ kitchen basic salad projection failed: ${error.stack || error.message}`);
  process.exit(1);
}
