"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  dashboardMenuUiNullCompatibility,
  normalizeDashboardMenuUiNullBody,
} = require("../src/middleware/dashboardMenuUiNullCompatibility");

const original = {
  name: { ar: "وجبة", en: "Meal" },
  ui: null,
};
const normalized = normalizeDashboardMenuUiNullBody(original);
assert.deepStrictEqual(normalized, {
  name: { ar: "وجبة", en: "Meal" },
});
assert.notStrictEqual(normalized, original, "normalization must not mutate the caller's body");
assert.strictEqual(original.ui, null);

const invalidUi = {
  ui: { cardVariant: "unknown" },
};
assert.strictEqual(
  normalizeDashboardMenuUiNullBody(invalidUi),
  invalidUi,
  "non-null UI must reach the catalog validator unchanged"
);

const omitted = { name: { en: "Meal" } };
assert.strictEqual(normalizeDashboardMenuUiNullBody(omitted), omitted);
assert.strictEqual(normalizeDashboardMenuUiNullBody(null), null);
assert.deepStrictEqual(normalizeDashboardMenuUiNullBody([]), []);

let nextCalls = 0;
const patchRequest = {
  method: "PATCH",
  body: { name: { en: "Meal" }, ui: null },
};
dashboardMenuUiNullCompatibility(patchRequest, {}, () => {
  nextCalls += 1;
});
assert.deepStrictEqual(patchRequest.body, { name: { en: "Meal" } });
assert.strictEqual(nextCalls, 1);

const getRequest = {
  method: "GET",
  body: { ui: null },
};
dashboardMenuUiNullCompatibility(getRequest, {}, () => {
  nextCalls += 1;
});
assert.deepStrictEqual(getRequest.body, { ui: null }, "GET bodies must remain untouched");
assert.strictEqual(nextCalls, 2);

console.log("dashboard menu nullable UI compatibility checks passed");
