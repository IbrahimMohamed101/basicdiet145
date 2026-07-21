"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { sourceSlotToKitchenSlot } = require("../src/services/installPickupCanonicalContract");

function run() {
  const productId = new mongoose.Types.ObjectId();
  const sandwichId = new mongoose.Types.ObjectId();

  assert.doesNotThrow(() => sourceSlotToKitchenSlot({
    slotIndex: 1,
    slotKey: "slot_1",
    selectionType: "full_meal_product",
    productId,
    sandwichId,
    productNameI18n: { ar: "ساندوتش دجاج", en: "Chicken Sandwich" },
  }, 0, {}));

  const kitchenSlot = sourceSlotToKitchenSlot({
    slotIndex: 1,
    slotKey: "slot_1",
    selectionType: "full_meal_product",
    productId,
    productNameI18n: { ar: "ساندوتش دجاج", en: "Chicken Sandwich" },
  }, 0, {});

  assert.strictEqual(kitchenSlot.productId, productId.toHexString());
  console.log("pickup canonical ObjectId conversion checks passed");
}

run();
