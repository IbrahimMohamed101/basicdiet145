const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  buildRecurringAddonEntitlementsFromQuote,
  normalizeRecurringAddonEntitlements,
  buildProjectedDayEntry,
} = require("../src/services/recurringAddonService");

function objectId() {
  return new mongoose.Types.ObjectId();
}

test("buildRecurringAddonEntitlementsFromQuote normalizes recurring entitlements with one-per-category fields", () => {
  const addonId = objectId();
  const entitlements = buildRecurringAddonEntitlementsFromQuote({
    addonItems: [
      {
        addon: {
          _id: addonId,
          name: { ar: "شوربة", en: "Soup" },
          type: "subscription",
          category: "starter",
        },
        unitPriceHalala: 300,
      },
    ],
    lang: "en",
  });

  assert.deepEqual(entitlements, [
    {
      addonId,
      name: "Soup",
      price: 3,
      type: "subscription",
      category: "starter",
      entitlementMode: "daily_recurring",
      maxPerDay: 1,
    },
  ]);
});

test("buildRecurringAddonEntitlementsFromQuote keeps purchase-flow recurring add-ons at one per day", () => {
  const addonId = objectId();
  const entitlements = buildRecurringAddonEntitlementsFromQuote({
    addonItems: [
      {
        addon: {
          _id: addonId,
          name: { ar: "عصير", en: "Juice" },
          type: "subscription",
          category: "beverage",
        },
        qty: 2,
        unitPriceHalala: 1200,
      },
    ],
    lang: "en",
  });

  assert.deepEqual(entitlements, [
    {
      addonId,
      name: "Juice",
      price: 12,
      type: "subscription",
      category: "beverage",
      entitlementMode: "daily_recurring",
      maxPerDay: 1,
    },
  ]);
});

test("normalizeRecurringAddonEntitlements rejects duplicate categories", () => {
  assert.throws(
    () => normalizeRecurringAddonEntitlements([
      { addonId: objectId(), name: "Soup", type: "subscription", category: "starter" },
      { addonId: objectId(), name: "Salad", type: "subscription", category: "starter" },
    ]),
    (error) => error && error.code === "RECURRING_ADDON_CATEGORY_CONFLICT"
  );
});

test("buildProjectedDayEntry adds recurring add-ons only for canonical subscriptions", () => {
  const addonId = objectId();
  const canonicalSubscription = {
    _id: objectId(),
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
    addonSubscriptions: [
      {
        addonId,
        name: "Soup",
        type: "subscription",
        category: "starter",
        entitlementMode: "daily_recurring",
        maxPerDay: 1,
      },
    ],
  };
  const legacySubscription = {
    _id: objectId(),
    addonSubscriptions: canonicalSubscription.addonSubscriptions,
  };

  const canonicalEntry = buildProjectedDayEntry({
    subscription: canonicalSubscription,
    date: "2026-03-20",
  });
  const legacyEntry = buildProjectedDayEntry({
    subscription: legacySubscription,
    date: "2026-03-20",
  });

  assert.equal(canonicalEntry.recurringAddons.length, 1);
  assert.equal(canonicalEntry.recurringAddons[0].category, "starter");
  assert.equal(Object.prototype.hasOwnProperty.call(legacyEntry, "recurringAddons"), false);
});
