"use strict";

const assert = require("assert");
const { buildKitchenCard } = require("../src/services/dashboard/kitchenProjectionService");

function saladItem(index, key, ar, en) {
  return {
    id: `6a522ed1b3fb649917ae${String(index).padStart(4, "0")}`,
    key,
    name: { ar, en },
  };
}

const completeSelections = {
  protein: [saladItem(1, "boiled_eggs", "بيض مسلوق", "Boiled Eggs")],
  leafy_greens: [
    saladItem(2, "cabbage", "ملفوف", "Cabbage"),
    saladItem(3, "arugula", "جرجير", "Arugula"),
  ],
  vegetables_legumes: [
    saladItem(4, "tomato", "طماطم", "Tomato"),
    saladItem(5, "carrot", "جزر", "Carrot"),
    saladItem(6, "cucumber", "خيار", "Cucumber"),
    saladItem(7, "corn", "ذرة", "Corn"),
    saladItem(8, "chickpeas", "حمص", "Chickpeas"),
    saladItem(9, "jalapeno", "هالبينو", "Jalapeno"),
    saladItem(10, "red_beans", "فاصوليا حمراء", "Red Beans"),
    saladItem(11, "beetroot", "شمندر", "Beetroot"),
    saladItem(12, "hot_pepper", "فلفل حار", "Hot Pepper"),
    saladItem(13, "coriander", "كزبرة", "Coriander"),
    saladItem(14, "mushroom", "فطر", "Mushroom"),
    saladItem(15, "broccoli", "بروكلي", "Broccoli"),
    saladItem(16, "salad_grilled_mixed_vegetables", "خضار مشكل مشوي", "Grilled Mixed Vegetables"),
    saladItem(17, "red_onion", "بصل أحمر", "Red Onion"),
    saladItem(18, "green_onion", "بصل أخضر", "Green Onion"),
    saladItem(19, "green_olives", "زيتون أخضر", "Green Olives"),
    saladItem(20, "black_olives", "زيتون أسود", "Black Olives"),
    saladItem(21, "mint", "نعناع", "Mint"),
    saladItem(22, "pickled_onion", "بصل مخلل", "Pickled Onion"),
  ],
  cheese_nuts: [
    saladItem(23, "cashew", "كاجو", "Cashew"),
    saladItem(24, "walnut", "عين الجمل", "Walnut"),
  ],
  fruits: [
    saladItem(25, "raspberry", "توت أحمر", "Raspberry"),
    saladItem(26, "watermelon", "بطيخ", "Watermelon"),
    saladItem(27, "cantaloupe", "شمام", "Cantaloupe"),
    saladItem(28, "dates", "تمر", "Dates"),
  ],
  sauce: [saladItem(29, "spicy_ranch", "سبايسي رانش", "Spicy Ranch")],
};

const selectedOptions = Object.entries(completeSelections).flatMap(([groupKey, items]) => (
  items.map((item) => ({
    groupKey,
    canonicalGroupKey: groupKey === "vegetables_legumes" ? "vegetables" : groupKey,
    optionId: item.id,
    optionKey: item.key,
    nameI18n: item.name,
    quantity: 1,
  }))
));

// Reproduce the production symptom: the legacy salad.groups snapshot contains
// only 10 items, while selectedOptions still contains the complete 29 choices.
const incompleteStoredGroups = {
  protein: completeSelections.protein,
  leafy_greens: completeSelections.leafy_greens,
  cheese_nuts: completeSelections.cheese_nuts,
  fruits: completeSelections.fruits,
  sauce: completeSelections.sauce,
};

const card = buildKitchenCard({
  slotIndex: 3,
  slotKey: "slot_3",
  selectionType: "premium_large_salad",
  productKey: "premium_large_salad",
  productNameI18n: { ar: "سلطة كبيرة مميزة", en: "Premium Large Salad" },
  salad: { groups: incompleteStoredGroups },
  selectedOptions,
});

assert.strictEqual(card.type, "premium_large_salad");
assert.deepStrictEqual(card.sections.map((section) => section.key), [
  "leafy_greens",
  "vegetables_legumes",
  "protein",
  "cheese_nuts",
  "fruits",
  "sauce",
]);

const vegetableSection = card.sections.find((section) => section.key === "vegetables_legumes");
assert(vegetableSection, "vegetables_legumes section must be recovered");
assert.strictEqual(vegetableSection.items.length, 19);
assert.deepStrictEqual(
  vegetableSection.items.map((item) => item.key),
  completeSelections.vegetables_legumes.map((item) => item.key)
);

const allItems = card.sections.flatMap((section) => section.items);
assert.strictEqual(allItems.length, 29);
assert.strictEqual(new Set(allItems.map((item) => item.id || item.key)).size, 29);
assert(card.lines.some((line) => line.startsWith("خضروات وبقوليات:")));

console.log("kitchenPremiumSaladProjectionFallback.test.js passed");
