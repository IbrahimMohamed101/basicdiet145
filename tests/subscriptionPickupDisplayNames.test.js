process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  normalizeSubscriptionBilingualResponse,
} = require("../src/utils/subscriptionBilingualResponse");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalize(payload, lang = "ar") {
  return normalizeSubscriptionBilingualResponse(clone(payload), {
    originalUrl: `/api/subscriptions/507f1f77bcf86cd799439011/pickup-availability?lang=${lang}`,
    query: { lang },
    headers: {},
  });
}

function pickupItem({ itemId, itemType, selectionType, title, product, components = [] }) {
  return {
    itemId,
    itemType,
    selectionType,
    title,
    product,
    components,
    display: {
      titleAr: title.ar,
      titleEn: title.en,
      statusTextAr: "متاح للاستلام",
      statusTextEn: "Available for pickup",
    },
    availability: { available: true, canSelect: true, state: "available" },
    payment: { required: false },
  };
}

function testPickupNamesAreComposedFromCanonicalData() {
  const payload = {
    status: true,
    data: {
      pickupItems: [
        pickupItem({
          itemId: "slot_1",
          itemType: "sandwich",
          selectionType: "full_meal_product",
          title: { ar: "وجبة عادية", en: "Standard meal" },
          product: {
            key: "fajita_sandwich",
            name: { ar: "فاهيتا", en: "Fajita" },
          },
        }),
        pickupItem({
          itemId: "slot_2",
          itemType: "meal",
          selectionType: "standard_meal",
          title: { ar: "وجبة عادية", en: "Standard meal" },
          product: { name: { ar: "وجبة عادية", en: "Standard meal" } },
          components: [
            { type: "protein", groupKey: "protein", name: { ar: "بيض", en: "Eggs" } },
            { type: "carb", groupKey: "carbs", name: { ar: "أرز", en: "Rice" } },
          ],
        }),
        pickupItem({
          itemId: "slot_3",
          itemType: "large_salad",
          selectionType: "premium_large_salad",
          title: { ar: "بيض", en: "Eggs" },
          product: { name: { ar: "بيض", en: "Eggs" } },
          components: [
            { type: "protein", groupKey: "protein", name: { ar: "بيض", en: "Eggs" } },
          ],
        }),
        pickupItem({
          itemId: "addon_1",
          itemType: "addon",
          selectionType: "addon",
          title: { ar: "إضافة", en: "Add-on" },
          product: { name: { ar: "آيس كريم شوكولاتة", en: "Chocolate Ice Cream" } },
          components: [
            { type: "addon", groupKey: "addons", name: { ar: "آيس كريم شوكولاتة", en: "Chocolate Ice Cream" } },
          ],
        }),
      ],
    },
  };

  const result = normalize(payload);
  const [sandwich, meal, salad, addon] = result.data.pickupItems;

  assert.deepStrictEqual(sandwich.title, {
    ar: "ساندوتش فاهيتا",
    en: "Fajita Sandwich",
  });
  assert.strictEqual(sandwich.display.titleAr, "ساندوتش فاهيتا");
  assert.strictEqual(sandwich.display.titleEn, "Fajita Sandwich");

  assert.deepStrictEqual(meal.title, {
    ar: "بيض + أرز",
    en: "Eggs + Rice",
  });
  assert.strictEqual(meal.display.titleAr, "بيض + أرز");
  assert.strictEqual(meal.display.titleEn, "Eggs + Rice");

  assert.deepStrictEqual(salad.title, {
    ar: "سلطة كبيرة + بيض",
    en: "Large Salad + Eggs",
  });
  assert.strictEqual(salad.display.titleAr, "سلطة كبيرة + بيض");
  assert.strictEqual(salad.display.titleEn, "Large Salad + Eggs");

  assert.deepStrictEqual(addon.title, {
    ar: "آيس كريم شوكولاتة",
    en: "Chocolate Ice Cream",
  });
  assert.strictEqual(addon.display.titleAr, "آيس كريم شوكولاتة");
  assert.strictEqual(addon.display.titleEn, "Chocolate Ice Cream");
}

function testExistingExplicitSandwichPrefixIsNotDuplicated() {
  const payload = {
    data: {
      pickupItems: [
        pickupItem({
          itemId: "slot_1",
          itemType: "sandwich",
          selectionType: "full_meal_product",
          title: { ar: "ساندوتش بيض", en: "Egg Sandwich" },
          product: {
            key: "egg_sandwich",
            name: { ar: "ساندوتش بيض", en: "Egg Sandwich" },
          },
        }),
      ],
    },
  };

  const result = normalize(payload, "en");
  assert.deepStrictEqual(result.data.pickupItems[0].title, {
    ar: "ساندوتش بيض",
    en: "Egg Sandwich",
  });
  assert.strictEqual(result.data.pickupItems[0].titleText, "Egg Sandwich");
}

function run() {
  testPickupNamesAreComposedFromCanonicalData();
  testExistingExplicitSandwichPrefixIsNotDuplicated();
  console.log("subscription pickup display name checks passed");
}

run();
