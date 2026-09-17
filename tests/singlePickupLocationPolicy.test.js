"use strict";

const assert = require("assert");
const {
  getPickupLocationId,
  resolveSinglePickupLocation,
  resolveSinglePickupLocations,
} = require("../src/utils/singlePickupLocation");

function run() {
  const fallback = resolveSinglePickupLocation([]);
  assert.strictEqual(getPickupLocationId(fallback), "main");
  assert.strictEqual(fallback.isActive, true);

  const preferred = resolveSinglePickupLocations([
    { id: "first", name: "First", isActive: true },
    { id: "default", name: "Default", isActive: true, isDefault: true },
  ]);
  assert.strictEqual(preferred.length, 1);
  assert.strictEqual(preferred[0].id, "default");

  const mainWinsWithoutDefault = resolveSinglePickupLocation([
    { id: "first", name: "First", isActive: true },
    { id: "main", name: "Main", isActive: true },
  ]);
  assert.strictEqual(mainWinsWithoutDefault.id, "main");

  const inactiveOnlyFallsBack = resolveSinglePickupLocation([
    { id: "closed", name: "Closed", isActive: false },
  ]);
  assert.strictEqual(getPickupLocationId(inactiveOnlyFallsBack), "main");

  console.log("singlePickupLocationPolicy.test.js passed");
}

run();
