"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  safeObjectIdString,
  sanitizeObjectIdCycles,
} = require("../src/utils/safeObjectIdValue");

require("../src/services/installPickupCanonicalObjectIdCoreGuard");
const presentation = require("../src/services/subscription/pickupCanonicalPresentationService");

const hex = "64e000000000000000000001";
assert.strictEqual(safeObjectIdString({ toHexString: () => hex }), hex);

const self = {};
self._id = self;
assert.strictEqual(safeObjectIdString(self), null, "self-referential _id must terminate without recursion");

const left = {};
const right = {};
left._id = right;
right._id = left;
assert.strictEqual(safeObjectIdString(left), null, "mutual _id cycles must terminate without recursion");

const sanitized = sanitizeObjectIdCycles({
  id: { toHexString: () => hex },
  self,
  nested: { left },
});
assert.strictEqual(sanitized.id, hex);
assert.strictEqual(sanitized.self._id, null);
assert.strictEqual(sanitized.nested.left._id, null);

assert.strictEqual(presentation.normalizePickupItem.__cycleSafeObjectIds, true);
assert.strictEqual(presentation.normalizeAvailability.__cycleSafeObjectIds, true);

const normalized = presentation.normalizePickupItem({
  itemType: "meal",
  selectionType: "standard_meal",
  slotId: "slot_1",
  product: {
    id: self,
    name: { ar: "دجاج وأرز", en: "Chicken and Rice" },
  },
  components: [{
    _id: left,
    type: "protein",
    nameI18n: { ar: "دجاج", en: "Chicken" },
  }],
});

assert.strictEqual(normalized.product.id, null);
assert.strictEqual(normalized.title.ar, "دجاج");
assert.strictEqual(normalized.title.en, "Chicken");
assert.strictEqual(normalized.display.titleAr, "دجاج");
assert.strictEqual(normalized.display.titleEn, "Chicken");

const availability = presentation.normalizeAvailability({
  slots: [{
    slotId: "slot_1",
    productId: self,
    product: { id: self, name: { ar: "دجاج", en: "Chicken" } },
  }],
  pickupItems: [{
    itemId: "slot_1",
    productId: left,
    title: { ar: "دجاج", en: "Chicken" },
  }],
}, {
  mealSlots: [{ slotIndex: 1, slotKey: "slot_1", productId: right }],
});

assert.strictEqual(Array.isArray(availability.slots), true);
assert.strictEqual(availability.slots[0].product.id, null);
assert.strictEqual(Array.isArray(availability.pickupItems), true);

console.log("pickup canonical ObjectId core guard checks passed");
