"use strict";

const assert = require("assert");
require("../src/services/installPickupAvailabilityResponseFinalRepair");
const {
  normalizePickupProductNamesResponse,
} = require("../src/utils/pickupProductNameResponse");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function testFlutterAvailabilityUsesRealProductName() {
  const payload = {
    status: true,
    data: {
      slots: [{
        slotId: "slot_1",
        title: { ar: "وجبة عادية", en: "Standard meal" },
        product: { name: { ar: "دجاج ترياكي", en: "Chicken Teriyaki" } },
        display: { titleAr: "وجبة عادية", titleEn: "Standard meal" },
      }],
      pickupItems: [{
        itemId: "slot_1",
        title: { ar: "وجبة عادية", en: "Standard meal" },
        product: { name: { ar: "دجاج ترياكي", en: "Chicken Teriyaki" } },
        display: { titleAr: "وجبة عادية", titleEn: "Standard meal" },
      }],
      sections: [{ items: [{ itemId: "slot_1" }] }],
    },
  };
  const result = normalizePickupProductNamesResponse(
    clone(payload),
    "/api/subscriptions/sub_1/pickup-availability?lang=ar"
  );
  const item = result.data.pickupItems[0];
  assert.deepStrictEqual(item.title, { ar: "دجاج ترياكي", en: "Chicken Teriyaki" });
  assert.strictEqual(item.display.titleAr, "دجاج ترياكي");
  assert.strictEqual(item.productName, "Chicken Teriyaki");
  assert.strictEqual(result.data.sections[0].items[0].title.ar, "دجاج ترياكي");
}

function testGenericProductFallsBackToComponents() {
  const payload = {
    data: {
      pickupItems: [{
        itemId: "slot_2",
        title: { ar: "وجبة عادية", en: "Standard meal" },
        product: { name: { ar: "وجبة عادية", en: "Standard meal" } },
        components: [
          { type: "protein", name: { ar: "دجاج", en: "Chicken" } },
          { type: "carb", name: { ar: "أرز", en: "Rice" } },
        ],
      }],
    },
  };
  const result = normalizePickupProductNamesResponse(
    clone(payload),
    "/api/subscriptions/sub_1/pickup-availability"
  );
  assert.deepStrictEqual(result.data.pickupItems[0].title, {
    ar: "دجاج + أرز",
    en: "Chicken + Rice",
  });
}

function testScreenshotMalformedBuilderNamesAreRebuiltForFlutter() {
  const proteins = [
    ["chicken", "white_rice", "دجاج + رز أبيض", "Chicken + White Rice"],
    ["beef", "yellow_rice", "لحم بقري + رز أصفر", "Beef + Yellow Rice"],
    ["fish", "white_rice", "سمك + رز أبيض", "Fish + White Rice"],
  ];
  const pickupItems = proteins.map(([proteinKey, carbKey], index) => ({
    itemId: `slot_${index + 1}`,
    itemType: "meal",
    selectionType: "standard_meal",
    title: { ar: `${proteinKey} + [object Object]`, en: `${proteinKey} + [object Object]` },
    product: {
      name: { ar: `${proteinKey} + [object Object]`, en: `${proteinKey} + [object Object]` },
    },
    meal: {
      title: { ar: `${proteinKey} + [object Object]`, en: `${proteinKey} + [object Object]` },
    },
    components: [
      {
        type: "protein",
        key: proteinKey,
        name: { value: { ar: proteinKey, en: proteinKey } },
      },
      {
        type: "carb",
        key: carbKey,
        name: { ar: { value: {} }, en: { value: {} } },
      },
    ],
    display: {
      titleAr: `${proteinKey} + [object Object]`,
      titleEn: `${proteinKey} + [object Object]`,
    },
  }));
  const payload = {
    status: true,
    data: {
      pickupItems,
      sections: [{
        key: "meals",
        items: pickupItems.map((item) => ({ itemId: item.itemId })),
      }],
    },
  };

  const result = normalizePickupProductNamesResponse(
    clone(payload),
    "/api/subscriptions/sub_1/pickup-availability?date=2026-07-25&includeUnavailable=true"
  );

  proteins.forEach(([, , expectedAr, expectedEn], index) => {
    const item = result.data.pickupItems[index];
    assert.deepStrictEqual(item.title, { ar: expectedAr, en: expectedEn });
    assert.strictEqual(item.display.titleAr, expectedAr);
    assert.strictEqual(item.display.titleEn, expectedEn);
    assert.strictEqual(item.meal.title.ar, expectedAr);
    assert.strictEqual(item.product.name.ar, expectedAr);
    assert.strictEqual(result.data.sections[0].items[index].display.titleAr, expectedAr);
  });
  assert(!JSON.stringify(result).includes("[object Object]"));
}

function testDashboardKitchenCardUsesSameProductName() {
  const payload = {
    status: true,
    data: [{
      kitchenDetails: {
        mealSlots: [{
          productNameI18n: { ar: "دجاج ترياكي", en: "Chicken Teriyaki" },
          canonicalTitleI18n: { ar: "وجبة", en: "Meal" },
        }],
      },
      kitchen: {
        version: "v2",
        cards: [{
          title: "وجبة",
          titleI18n: { ar: "وجبة", en: "Meal" },
          components: {
            product: { nameI18n: { ar: "دجاج ترياكي", en: "Chicken Teriyaki" } },
          },
        }],
      },
      kitchenCards: [{ title: "وجبة", titleI18n: { ar: "وجبة", en: "Meal" } }],
    }],
  };
  const result = normalizePickupProductNamesResponse(
    clone(payload),
    "/api/dashboard/ops/list?date=2026-07-21"
  );
  assert.strictEqual(result.data[0].kitchen.cards[0].title, "دجاج ترياكي");
  assert.deepStrictEqual(result.data[0].kitchen.cards[0].titleI18n, {
    ar: "دجاج ترياكي",
    en: "Chicken Teriyaki",
  });
  assert.strictEqual(result.data[0].kitchenCards[0].title, "دجاج ترياكي");
}

function testMalformedComponentsCannotBreakOpsList() {
  const payload = {
    status: true,
    data: [{
      kitchenDetails: {
        mealSlots: [{
          productNameI18n: { ar: "دجاج ترياكي", en: "Chicken Teriyaki" },
          selectedOptions: [null, "legacy-option"],
        }],
      },
      kitchen: {
        version: "v2",
        cards: [{
          title: "وجبة",
          components: { product: { nameI18n: { ar: "دجاج ترياكي", en: "Chicken Teriyaki" } } },
        }],
      },
    }],
  };

  assert.doesNotThrow(() => normalizePickupProductNamesResponse(
    payload,
    "/api/dashboard/ops/list?date=2026-07-21"
  ));
  assert.strictEqual(payload.data[0].kitchen.cards[0].title, "دجاج ترياكي");
}

function testFrozenLegacyCardFailsOpen() {
  const frozenCard = Object.freeze({ title: "وجبة" });
  const payload = {
    data: [{
      kitchenDetails: {
        mealSlots: [{ productNameI18n: { ar: "دجاج", en: "Chicken" } }],
      },
      kitchenCards: [frozenCard],
    }],
  };

  assert.doesNotThrow(() => normalizePickupProductNamesResponse(
    payload,
    "/api/dashboard/ops/list"
  ));
  assert.strictEqual(payload.data[0].kitchenCards[0].title, "وجبة");
}

function run() {
  testFlutterAvailabilityUsesRealProductName();
  testGenericProductFallsBackToComponents();
  testScreenshotMalformedBuilderNamesAreRebuiltForFlutter();
  testDashboardKitchenCardUsesSameProductName();
  testMalformedComponentsCannotBreakOpsList();
  testFrozenLegacyCardFailsOpen();
  console.log("pickup product name response checks passed");
}

run();
