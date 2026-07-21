"use strict";

const assert = require("assert");
const {
  isInvalidDisplayText,
  localizedPair,
  normalizeLocalizedFields,
} = require("../src/utils/safeLocalizedText");
const {
  normalizeCatalogMaps,
} = require("../src/services/installPickupLocalizedCatalogGuard");

require("../src/services/installPickupCanonicalRuntimeGuard");
const canonical = require("../src/services/subscription/pickupCanonicalPresentationService");

(function testNestedLocalizedPair() {
  const pair = localizedPair({
    localized: {
      ar: { value: "حلوم كلاسيك" },
      en: { text: "Classic Halloumi" },
    },
  });
  assert.deepStrictEqual(pair, {
    ar: "حلوم كلاسيك",
    en: "Classic Halloumi",
  });
  assert.strictEqual(isInvalidDisplayText("[object Object]"), true);
})();

(function testLocalizedFieldNormalization() {
  const normalized = normalizeLocalizedFields({
    product: {
      name: {
        translation: {
          ar: { text: "دجاج مشوي" },
          en: { value: "Grilled Chicken" },
        },
      },
    },
  });
  assert.deepStrictEqual(normalized.product.name, {
    ar: "دجاج مشوي",
    en: "Grilled Chicken",
  });
})();

(function testCatalogGuard() {
  const row = {
    _id: "507f1f77bcf86cd799439011",
    key: "classic_halloumi",
    name: {
      payload: {
        ar: { value: "حلوم كلاسيك" },
        en: { value: "Classic Halloumi" },
      },
    },
  };
  const maps = {
    productById: new Map([[String(row._id), row]]),
    productByKey: new Map([[row.key, row]]),
  };
  normalizeCatalogMaps(maps);
  assert.deepStrictEqual(row.name, {
    ar: "حلوم كلاسيك",
    en: "Classic Halloumi",
  });
  assert.deepStrictEqual(row.nameI18n, row.name);
})();

(function testCanonicalPickupItemNeverSerializesObjectObject() {
  const item = canonical.normalizePickupItem({
    itemId: "slot_2",
    slotId: "slot_2",
    slotKey: "slot_2",
    selectionType: "standard_meal",
    itemType: "meal",
    product: {
      id: "507f1f77bcf86cd799439011",
      key: "classic_halloumi",
      name: {
        payload: {
          ar: { value: "حلوم كلاسيك" },
          en: { text: "Classic Halloumi" },
        },
      },
    },
    availability: {
      available: true,
      canSelect: true,
    },
  });

  assert.strictEqual(item.title.ar, "حلوم كلاسيك");
  assert.strictEqual(item.title.en, "Classic Halloumi");
  assert.strictEqual(item.display.titleAr, "حلوم كلاسيك");
  assert.strictEqual(item.display.titleEn, "Classic Halloumi");
  assert.strictEqual(item.label, "حلوم كلاسيك");
  assert.ok(!JSON.stringify(item).includes("[object Object]"));
})();

(function testInvalidLegacyStringIsRemoved() {
  const item = canonical.normalizePickupItem({
    itemId: "slot_3",
    selectionType: "standard_meal",
    itemType: "meal",
    product: {
      key: "grilled_chicken",
      name: "[object Object]",
      nameI18n: {
        ar: "دجاج مشوي",
        en: "Grilled Chicken",
      },
    },
  });
  assert.strictEqual(item.title.ar, "دجاج مشوي");
  assert.strictEqual(item.title.en, "Grilled Chicken");
  assert.ok(!JSON.stringify(item).includes("[object Object]"));
})();

console.log("pickup localized name guard checks passed");
