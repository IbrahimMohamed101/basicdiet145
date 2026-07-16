const assert = require("assert");

const {
  filterAddonChoicesPayload,
  mergeActivePlanCatalog,
} = require("../src/middleware/filterAddonChoicesAvailability");
const {
  filterGloballyAvailable,
  isCatalogItemUsable,
  isLinkedDocGloballyAvailable,
} = require("../src/services/catalog/catalogAvailabilityService");

function run() {
  const activePlanId = "507f191e810c19729de86100";
  const inactivePlanId = "507f191e810c19729de86101";
  const archivedPlanId = "507f191e810c19729de86102";

  const payload = {
    status: true,
    data: {
      juice: {
        category: "juice",
        choices: [
          { id: "generic-juice", name: "Generic Juice" },
          { id: "active-juice", addonPlanId: activePlanId },
          { id: "inactive-juice", addonPlanId: inactivePlanId },
        ],
        entitlements: [
          { addonPlanId: activePlanId },
          { addonPlanId: inactivePlanId },
        ],
      },
      meal: {
        category: "meal",
        choices: [
          { id: "inactive-meal", addonPlanId: inactivePlanId },
          { id: "generic-meal" },
          {
            id: "authoritative-paid-extra",
            addonId: "507f191e810c19729de86200",
            productId: "507f191e810c19729de86200",
            isEligibleForAllowance: false,
          },
        ],
        entitlements: [{ addonPlanId: inactivePlanId }],
      },
      dessert: {
        category: "dessert",
        choices: [{ id: "archived-dessert", addonPlanId: archivedPlanId }],
        entitlements: [{ addonPlanId: archivedPlanId }],
      },
      hot_drinks: {
        category: "hot_drinks",
        choices: [
          { id: "coffee", addonPlanId: activePlanId },
          { id: "old-tea", addonPlanId: inactivePlanId },
        ],
        entitlements: [
          { addonPlanId: activePlanId },
          { addonPlanId: inactivePlanId },
        ],
      },
    },
  };

  const filtered = filterAddonChoicesPayload(payload, new Set([activePlanId]));

  assert(filtered.data.juice, "legacy generic category remains available");
  assert.deepStrictEqual(
    filtered.data.juice.choices.map((choice) => choice.id),
    ["generic-juice", "active-juice"],
    "inactive plan choices are removed without removing generic legacy products"
  );
  assert(filtered.data.meal, "purchased dynamic entitlement group remains available");
  assert.deepStrictEqual(
    filtered.data.meal.choices.map((choice) => choice.id),
    ["generic-meal", "authoritative-paid-extra"],
    "paid MenuProduct rows remain visible and are not interpreted as inactive add-on plans"
  );
  assert(filtered.data.dessert, "archived live plan does not erase an immutable purchased entitlement");
  assert.deepStrictEqual(filtered.data.dessert.choices, []);
  assert.deepStrictEqual(
    filtered.data.hot_drinks.choices.map((choice) => choice.id),
    ["coffee"],
    "active dynamic categories remain while inactive plan rows are removed"
  );
  assert.strictEqual(filtered.data.hot_drinks.entitlements.length, 2, "purchased entitlement snapshots are retained");

  const activePlanCatalog = {
    meal: {
      category: "meal",
      activeAddonPlans: [{ addonPlanId: activePlanId, addonPlanName: "Meal Plan" }],
      choices: [{
        id: "dashboard-active-meal",
        addonPlanId: activePlanId,
        addonPlanName: "Meal Plan",
        category: "meal",
        isEligibleForAllowance: false,
      }],
    },
    hot_drinks: {
      category: "hot_drinks",
      activeAddonPlans: [{ addonPlanId: activePlanId, addonPlanName: "Hot Drinks" }],
      choices: [{
        id: "coffee",
        addonPlanId: activePlanId,
        addonPlanName: "Hot Drinks",
        category: "hot_drinks",
        isEligibleForAllowance: false,
      }],
    },
  };
  const merged = mergeActivePlanCatalog(filtered, activePlanCatalog);
  assert(merged.data.meal, "a newly activated dashboard plan creates its dynamic mobile category");
  assert.deepStrictEqual(
    merged.data.meal.choices.map((choice) => choice.id),
    ["generic-meal", "authoritative-paid-extra", "dashboard-active-meal"]
  );
  assert.strictEqual(
    merged.data.meal.choices.find((choice) => choice.id === "dashboard-active-meal").isEligibleForAllowance,
    false
  );
  assert.strictEqual(
    merged.data.hot_drinks.choices.filter((choice) => choice.id === "coffee").length,
    1,
    "active plan merge does not duplicate an existing product row"
  );

  const activeDoc = { isActive: true, isAvailable: true, isVisible: true };
  const inactiveDoc = { ...activeDoc, isActive: false };
  const archivedDoc = { ...activeDoc, isArchived: true };
  const archivedAtDoc = { ...activeDoc, archivedAt: new Date() };
  const deletedDoc = { ...activeDoc, isDeleted: true };
  const deletedAtDoc = { ...activeDoc, deletedAt: new Date() };

  assert.strictEqual(isLinkedDocGloballyAvailable(activeDoc), true);
  assert.strictEqual(isLinkedDocGloballyAvailable(inactiveDoc), false);
  assert.strictEqual(isLinkedDocGloballyAvailable(archivedDoc), false);
  assert.strictEqual(isLinkedDocGloballyAvailable(archivedAtDoc), false);
  assert.strictEqual(isLinkedDocGloballyAvailable(deletedDoc), false);
  assert.strictEqual(isLinkedDocGloballyAvailable(deletedAtDoc), false);
  assert.strictEqual(isCatalogItemUsable({ ...activeDoc, isArchived: true }), false);
  assert.deepStrictEqual(filterGloballyAvailable([activeDoc, archivedDoc, deletedDoc]), [activeDoc]);

  console.log("addonChoicesAvailabilityFilter.test.js: PASS");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exit(1);
}
