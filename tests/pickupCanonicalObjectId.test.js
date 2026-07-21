"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");

// Install the runtime/query guards before loading the canonical contract, as
// production does from app startup.
require("../src/services/installPickupCanonicalRuntimeGuard");
require("../src/services/installPickupCanonicalQueryGuard");

const {
  sourceSlotToKitchenSlot,
} = require("../src/services/installPickupCanonicalContract");

function run() {
  const productId = new mongoose.Types.ObjectId();
  const sandwichId = new mongoose.Types.ObjectId();
  const optionId = new mongoose.Types.ObjectId();

  const source = {
    slotIndex: 1,
    slotKey: "slot_1",
    selectionType: "full_meal_product",
    productId,
    sandwichId,
    productNameI18n: { ar: "حلوم كلاسيك", en: "Classic Halloumi" },
    selectedOptions: [{
      optionId,
      groupKey: "protein",
      canonicalGroupKey: "protein",
      nameI18n: { ar: "حلوم", en: "Halloumi" },
    }],
  };

  let kitchenSlot;
  assert.doesNotThrow(() => {
    kitchenSlot = sourceSlotToKitchenSlot(source, 0, {});
  });
  assert(kitchenSlot);
  assert.strictEqual(kitchenSlot.productId, productId.toHexString());
  assert.strictEqual(kitchenSlot.sandwichId, productId.toHexString());
  assert.strictEqual(kitchenSlot.selectedOptions[0].optionId, optionId.toHexString());
  assert.deepStrictEqual(kitchenSlot.productNameI18n, {
    ar: "حلوم",
    en: "Halloumi",
  });

  const cyclic = {};
  cyclic._id = cyclic;
  assert.doesNotThrow(() => sourceSlotToKitchenSlot({
    slotIndex: 2,
    slotKey: "slot_2",
    selectionType: "full_meal_product",
    productId: cyclic,
    productNameI18n: { ar: "منتج تجريبي", en: "Test Product" },
  }, 1, {}));

  console.log("pickup canonical ObjectId conversion checks passed");
}

run();
