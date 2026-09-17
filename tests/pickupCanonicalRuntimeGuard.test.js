"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const {
  sanitizeCanonicalValue,
} = require("../src/services/installPickupCanonicalRuntimeGuard");
const canonical = require("../src/services/subscription/pickupCanonicalPresentationService");
const {
  normalizeSubscriptionBilingualResponse,
} = require("../src/utils/subscriptionBilingualResponse");

function run() {
  const productId = new mongoose.Types.ObjectId();
  const optionId = new mongoose.Types.ObjectId();

  assert.strictEqual(sanitizeCanonicalValue(productId), productId.toHexString());

  const cyclic = { name: "cycle" };
  cyclic.self = cyclic;
  const sanitizedCycle = sanitizeCanonicalValue(cyclic);
  assert.strictEqual(sanitizedCycle.name, "cycle");
  assert.strictEqual(sanitizedCycle.self, null);

  const availability = canonical.normalizeAvailability({
    slots: [{
      slotId: "slot_1",
      slotKey: "slot_1",
      selectionType: "full_meal_product",
      product: {
        id: productId,
        name: { ar: "حلوم كلاسيك", en: "Classic Halloumi" },
      },
      available: true,
    }],
    pickupItems: [{
      itemId: "slot_1",
      slotId: "slot_1",
      selectionType: "full_meal_product",
      productId,
      product: {
        id: productId,
        name: { ar: "حلوم كلاسيك", en: "Classic Halloumi" },
      },
      components: [{
        id: optionId,
        optionId,
        type: "protein",
        groupKey: "protein",
        name: { ar: "حلوم", en: "Halloumi" },
      }],
      availability: { available: true, canSelect: true, state: "available" },
    }],
    sections: [{
      sectionKey: "meals",
      items: [{ itemId: "slot_1", slotId: "slot_1" }],
    }],
  }, {
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      selectionType: "full_meal_product",
      productId,
      productNameI18n: { ar: "حلوم كلاسيك", en: "Classic Halloumi" },
      selectedOptions: [{
        optionId,
        groupKey: "protein",
        nameI18n: { ar: "حلوم", en: "Halloumi" },
      }],
    }],
  });

  assert.strictEqual(availability.pickupItems[0].product.id, productId.toHexString());
  assert.strictEqual(availability.pickupItems[0].components[0].id, optionId.toHexString());

  const payload = normalizeSubscriptionBilingualResponse({
    status: true,
    data: availability,
  }, {
    originalUrl: "/api/subscriptions/sub_1/pickup-availability?lang=ar",
    query: { lang: "ar" },
    headers: {},
  });

  assert.doesNotThrow(() => JSON.stringify(payload));
  assert.strictEqual(payload.data.pickupItems[0].display.titleAr, "حلوم");
  console.log("pickup canonical runtime guard checks passed");
}

run();
