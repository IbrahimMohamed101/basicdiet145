"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");

require("../src/services/installPickupCanonicalObjectIdCoreGuard");
require("../src/services/installMealComponentGramsPresentation");

const presentation = require("../src/services/subscription/pickupCanonicalPresentationService");
const clientSupport = require("../src/services/subscription/subscriptionClientSupportService");
const writeLocalization = require("../src/utils/subscription/subscriptionWriteLocalization");
const displayService = require("../src/services/subscription/mealComponentDisplayService");

const proteinId = "64e000000000000000000001";
const pastaId = "64e000000000000000000002";
const riceId = "64e000000000000000000003";

function pickupInput() {
  const item = {
    itemId: "slot_1",
    slotId: "slot_1",
    slotKey: "slot_1",
    itemType: "meal",
    selectionType: "standard_meal",
    availability: { state: "available", available: true, canSelect: true },
    components: [
      {
        id: proteinId,
        optionId: proteinId,
        type: "protein",
        groupKey: "protein",
        name: { ar: "فراخ", en: "Chicken" },
      },
      {
        id: pastaId,
        optionId: pastaId,
        type: "carb",
        groupKey: "carbs",
        name: { ar: "مكرونة", en: "Pasta" },
        grams: 150,
      },
      {
        id: riceId,
        optionId: riceId,
        type: "carb",
        groupKey: "carbs",
        name: { ar: "أرز", en: "Rice" },
        grams: 100,
      },
    ],
  };
  return {
    subscriptionId: "subscription_1",
    date: "2026-07-22",
    slots: [{
      slotId: "slot_1",
      slotKey: "slot_1",
      selectionType: "standard_meal",
      available: true,
      canSelect: true,
      options: item.components,
    }],
    pickupItems: [item],
    sections: [{ sectionKey: "meals", items: [item] }],
  };
}

function deliveryDayInput() {
  return {
    _id: "64e000000000000000000010",
    subscriptionId: "64e000000000000000000011",
    date: "2026-07-22",
    status: "open",
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      status: "complete",
      selectionType: "standard_meal",
      proteinId,
      carbSelections: [
        { carbId: pastaId, grams: 150 },
        { carbId: riceId, grams: 100 },
      ],
      confirmationSnapshot: {
        selectedOptions: [
          {
            optionId: proteinId,
            optionKey: "chicken",
            groupKey: "protein",
            optionName: { ar: "فراخ", en: "Chicken" },
          },
          {
            optionId: pastaId,
            optionKey: "pasta",
            groupKey: "carbs",
            optionName: { ar: "مكرونة", en: "Pasta" },
          },
          {
            optionId: riceId,
            optionKey: "rice",
            groupKey: "carbs",
            optionName: { ar: "أرز", en: "Rice" },
          },
        ],
      },
    }],
    addonSelections: [],
  };
}

function assertMealContract(slot) {
  assert.strictEqual(slot.slotKey, "slot_1");
  assert.deepStrictEqual(slot.canonicalTitleI18n, {
    ar: "فراخ + مكرونة 150 جم + أرز 100 جم",
    en: "Chicken + Pasta 150 g + Rice 100 g",
  });
  assert.strictEqual(slot.carbSelections.length, 2);
  assert.strictEqual(slot.carbSelections[0].grams, 150);
  assert.strictEqual(slot.carbSelections[0].displayNameI18n.ar, "مكرونة 150 جم");
  assert.strictEqual(slot.carbSelections[0].displayNameI18n.en, "Pasta 150 g");
  assert.strictEqual(slot.carbSelections[1].grams, 100);
  assert.strictEqual(slot.carbSelections[1].displayNameI18n.ar, "أرز 100 جم");
  assert.strictEqual(slot.carbSelections[1].displayNameI18n.en, "Rice 100 g");
}

function testPickupContract() {
  const normalized = presentation.normalizeAvailability(pickupInput(), {
    date: "2026-07-22",
    mealSlots: deliveryDayInput().mealSlots,
  });

  assert.strictEqual(normalized.date, "2026-07-22");
  assert.strictEqual(normalized.pickupItems.length, 1);
  assert.strictEqual(normalized.pickupItems[0].itemId, "slot_1");
  assert.deepStrictEqual(normalized.pickupItems[0].title, {
    ar: "فراخ + مكرونة 150 جم + أرز 100 جم",
    en: "Chicken + Pasta 150 g + Rice 100 g",
  });
  assert.strictEqual(normalized.pickupItems[0].components[1].grams, 150);
  assert.strictEqual(normalized.pickupItems[0].components[1].displayNameI18n.ar, "مكرونة 150 جم");
  assert.strictEqual(normalized.pickupItems[0].components[2].grams, 100);
  assert.strictEqual(normalized.pickupItems[0].components[2].displayNameI18n.ar, "أرز 100 جم");
  assert.strictEqual(normalized.sections[0].items[0].itemId, "slot_1");
  assert.deepStrictEqual(normalized.sections[0].items[0].title, normalized.pickupItems[0].title);
  assert.strictEqual(normalized.slots[0].display.titleAr, "فراخ + مكرونة 150 جم + أرز 100 جم");
}

function testDeliveryReadContract() {
  const sourceDay = deliveryDayInput();
  const sourceSnapshot = JSON.stringify(sourceDay);
  const serialized = clientSupport.serializeSubscriptionDayForClient(null, sourceDay);

  assert.strictEqual(serialized.date, "2026-07-22");
  assert.strictEqual(JSON.stringify(sourceDay), sourceSnapshot, "read decoration must not mutate stored day state");
  assertMealContract(serialized.mealSlots[0]);
  assert.deepStrictEqual(
    serialized.mealSlots[0].confirmationSnapshot.title,
    serialized.mealSlots[0].canonicalTitleI18n
  );

  const localizedWrite = writeLocalization.localizeWriteDayPayload(sourceDay, { lang: "ar" });
  assert.strictEqual(localizedWrite.date, "2026-07-22");
  assertMealContract(localizedWrite.mealSlots[0]);
}

function testIdempotentDecoration() {
  const once = displayService.decorateDayMealDisplay(deliveryDayInput());
  const twice = displayService.decorateDayMealDisplay(once);
  assert.deepStrictEqual(twice.mealSlots[0].canonicalTitleI18n, once.mealSlots[0].canonicalTitleI18n);
  assert.strictEqual(twice.mealSlots[0].canonicalTitleI18n.ar, "فراخ + مكرونة 150 جم + أرز 100 جم");
  assert.strictEqual(
    (twice.mealSlots[0].canonicalTitleI18n.ar.match(/150 جم/g) || []).length,
    1,
    "grams must not be appended twice on repeated serializers"
  );
}

function testInstallerMarkers() {
  assert.strictEqual(presentation.normalizePickupItem.__gramsAwareMealPresentation, true);
  assert.strictEqual(presentation.normalizeAvailability.__gramsAwareMealPresentation, true);
  assert.strictEqual(clientSupport.serializeSubscriptionDayForClient.__gramsAwareMealPresentation, true);
  assert.strictEqual(clientSupport.shapeMealPlannerReadFields.__gramsAwareMealPresentation, true);
}

function run() {
  testInstallerMarkers();
  testPickupContract();
  testDeliveryReadContract();
  testIdempotentDecoration();
  console.log("meal component grams presentation checks passed");
}

run();
