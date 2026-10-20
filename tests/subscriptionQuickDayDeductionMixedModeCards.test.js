"use strict";

const assert = require("node:assert/strict");
const { splitQuickDayOptions } = require("../src/services/dashboard/subscriptionQuickDayDeductionOptionPresentation");

const all = [
  { id: "original-pickup", fulfillmentMethod: "pickup", remainingMeals: 0 },
  { id: "renewal-delivery", fulfillmentMethod: "delivery", totalMeals: 52, remainingMeals: 46, consumedMeals: 6, reservedMeals: 0 },
  { id: "other-pickup", fulfillmentMethod: "pickup", remainingMeals: 20 },
];
const pickup = [all[0], all[2]];
const before = JSON.stringify(all);
const result = splitQuickDayOptions({ subscriptionId: "container", businessDate: "2026-10-21", batches: all }, pickup);
assert.deepEqual(result.batches.map((b) => b.id), ["original-pickup", "other-pickup"]);
assert.deepEqual(result.manualOnlyBatches.map((b) => b.id), ["renewal-delivery"]);
assert.equal(result.manualOnlyBatches[0].remainingMeals, 46);
assert.equal(result.manualOnlyBatches[0].consumedMeals, 6);
assert.equal(result.manualOnlyBatches[0].fulfillmentMethod, "delivery");
assert.equal(result.manualOnlyBatches[0].quickDeductionAllowed, false);
assert.equal(result.businessDate, "2026-10-21");
assert.equal(JSON.stringify(all), before, "GET option projection must not mutate source batches");
assert.deepEqual(splitQuickDayOptions({ batches: [all[1]] }, []).batches, []);
assert.deepEqual(splitQuickDayOptions({ batches: [all[1]] }, []).manualOnlyBatches.map(x => x.id), ["renewal-delivery"]);
assert.deepEqual(splitQuickDayOptions({}, []).manualOnlyBatches, []);
console.log("subscriptionQuickDayDeductionMixedModeCards.test.js: OK");
