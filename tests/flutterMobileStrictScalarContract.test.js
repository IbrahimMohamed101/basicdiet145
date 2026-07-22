"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  validateSubscriptionDay,
} = require("../src/contracts/flutterMobileResponseContract");

function payloadWithSlot(overrides = {}) {
  return {
    ok: true,
    status: 200,
    data: {
      date: "2026-07-22",
      status: "open",
      mealSlots: [{
        slotIndex: 1,
        slotKey: "slot_1",
        status: "complete",
        carbs: [],
        isPremium: false,
        premiumSource: "none",
        premiumExtraFeeHalala: 0,
        ...overrides,
      }],
      addonSelections: [],
      addonBalance: [],
      addonSubscriptionAllowances: [],
      paymentRequirement: {},
    },
  };
}

const valid = payloadWithSlot();
assert.strictEqual(validateSubscriptionDay(valid), valid);

const omittedDefaults = payloadWithSlot();
delete omittedDefaults.data.mealSlots[0].status;
delete omittedDefaults.data.mealSlots[0].carbs;
delete omittedDefaults.data.mealSlots[0].isPremium;
delete omittedDefaults.data.mealSlots[0].premiumSource;
delete omittedDefaults.data.mealSlots[0].premiumExtraFeeHalala;
assert.strictEqual(
  validateSubscriptionDay(omittedDefaults),
  omittedDefaults,
  "missing nullable/defaulted fields must remain compatible with Dart defaults"
);

for (const [field, value, expectedPath] of [
  ["isPremium", "false", "isPremium"],
  ["premiumExtraFeeHalala", "500", "premiumExtraFeeHalala"],
  ["carbs", false, "carbs"],
  ["status", false, "status"],
]) {
  assert.throws(
    () => validateSubscriptionDay(payloadWithSlot({ [field]: value })),
    (error) => error
      && error.code === "FLUTTER_RESPONSE_CONTRACT_MISMATCH"
      && error.path.includes(expectedPath),
    `${field} must reject a Flutter-incompatible value instead of coercing it`
  );
}

const wrongAddonSelections = payloadWithSlot();
wrongAddonSelections.data.addonSelections = false;
assert.throws(
  () => validateSubscriptionDay(wrongAddonSelections),
  (error) => error
    && error.code === "FLUTTER_RESPONSE_CONTRACT_MISMATCH"
    && error.path.includes("addonSelections")
);

console.log("Flutter strict scalar contract checks passed");
