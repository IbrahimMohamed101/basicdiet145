const assert = require("assert");

const {
  filterAddonChoicesPayload,
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
  assert.strictEqual(filtered.data.meal, undefined, "inactive dynamic meal plan category is removed");
  assert.strictEqual(filtered.data.dessert, undefined, "archived dynamic plan category is removed");
  assert.deepStrictEqual(
    filtered.data.hot_drinks.choices.map((choice) => choice.id),
    ["coffee"],
    "active dynamic categories remain while inactive plan rows are removed"
  );
  assert.strictEqual(filtered.data.hot_drinks.entitlements.length, 1);

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
