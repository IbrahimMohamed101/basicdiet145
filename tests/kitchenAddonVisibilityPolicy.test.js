process.env.NODE_ENV = "test";
delete process.env.SUBSCRIPTION_DAILY_ADDON_AUTO_DEFAULTS_ENABLED;
require("../src/services/installExplicitSubscriptionAddonSelectionPolicy");

const assert = require("assert");
const {
  buildKitchenDetailsPayload,
} = require("../src/services/dashboard/opsPayloadService");

function addon(overrides = {}) {
  return {
    addonId: "66b000000000000000000001",
    productId: "66b000000000000000000001",
    menuProductId: "66b000000000000000000001",
    addonPlanId: "66b000000000000000000010",
    addonKey: "orange_juice",
    productKey: "orange_juice",
    name: "عصير برتقال",
    nameI18n: { ar: "عصير برتقال", en: "Orange Juice" },
    category: "juice",
    source: "subscription",
    qty: 1,
    quantity: 1,
    coveredQty: 1,
    paidQty: 0,
    selectionOrigin: "customer_selected",
    addonSettlementState: "consumed",
    ...overrides,
  };
}

function names(payload) {
  return payload.addons.map((item) => String(item.name || ""));
}

const explicitlySelected = addon();
const legacyAutomatic = addon({
  productId: "66b000000000000000000002",
  menuProductId: "66b000000000000000000002",
  name: "إضافة تلقائية قديمة",
  nameI18n: { ar: "إضافة تلقائية قديمة", en: "Legacy Automatic Add-on" },
  autoDailyAddon: true,
  selectionOrigin: "subscription_daily_default",
  dailyAllocationKey: "daily-addon:subscription:2026-08-01:juice:1",
  addonSettlementState: "reserved",
});
const legacyByAllocationKey = addon({
  productId: "66b000000000000000000003",
  menuProductId: "66b000000000000000000003",
  name: "حجز يومي قديم",
  nameI18n: { ar: "حجز يومي قديم", en: "Legacy Daily Reservation" },
  selectionOrigin: "",
  dailyAllocationKey: "daily-addon:subscription:2026-08-01:juice:2",
  addonSettlementState: "consumed",
});
const releasedExplicit = addon({
  productId: "66b000000000000000000004",
  menuProductId: "66b000000000000000000004",
  name: "إضافة ملغاة",
  nameI18n: { ar: "إضافة ملغاة", en: "Released Add-on" },
  addonSettlementState: "released",
});
const paidOneTime = addon({
  productId: "66b000000000000000000005",
  menuProductId: "66b000000000000000000005",
  name: "مياه مدفوعة",
  nameI18n: { ar: "مياه مدفوعة", en: "Paid Water" },
  source: "paid",
  selectionOrigin: "customer_selected",
  addonSettlementState: "consumed",
});

const day = {
  mealSlots: [],
  addonSelections: [explicitlySelected, legacyAutomatic, legacyByAllocationKey],
  oneTimeAddonSelections: [releasedExplicit, paidOneTime],
  recurringAddons: [],
};

const payload = buildKitchenDetailsPayload(day, {}, "ar", {});
const visibleNames = names(payload);

assert.strictEqual(payload.addons.length, 2, JSON.stringify(payload.addons));
assert(visibleNames.some((name) => name.includes("عصير برتقال")));
assert(visibleNames.some((name) => name.includes("مياه مدفوعة")));
assert(!visibleNames.some((name) => name.includes("تلقائية")));
assert(!visibleNames.some((name) => name.includes("حجز يومي")));
assert(!visibleNames.some((name) => name.includes("ملغاة")));

assert.strictEqual(day.addonSelections.length, 3, "policy must not mutate stored day selections");
assert.strictEqual(day.oneTimeAddonSelections.length, 2, "policy must not mutate one-time selections");

console.log("Kitchen add-on visibility policy test passed");
