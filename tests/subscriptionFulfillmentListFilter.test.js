"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const {
  normalizeFulfillmentMethodOrThrow,
  resolvePaginationOrThrow,
} = require("../src/services/dashboard/subscriptionFulfillmentListService");

function run() {
  assert.equal(normalizeFulfillmentMethodOrThrow(undefined), null);
  assert.equal(normalizeFulfillmentMethodOrThrow(""), null);
  assert.equal(normalizeFulfillmentMethodOrThrow("all"), null);
  assert.equal(normalizeFulfillmentMethodOrThrow(" DELIVERY "), "delivery");
  assert.equal(normalizeFulfillmentMethodOrThrow("pickup"), "pickup");

  assert.throws(
    () => normalizeFulfillmentMethodOrThrow("branch"),
    (error) => error && error.status === 400 && error.code === "INVALID"
  );

  assert.deepEqual(resolvePaginationOrThrow({}), { page: 1, limit: 50 });
  assert.deepEqual(resolvePaginationOrThrow({ page: "3", limit: "10" }), {
    page: 3,
    limit: 10,
  });
  assert.throws(
    () => resolvePaginationOrThrow({ limit: 0 }),
    (error) => error && error.status === 400 && error.code === "INVALID"
  );
  assert.throws(
    () => resolvePaginationOrThrow({ limit: 201 }),
    (error) => error && error.status === 400 && error.code === "INVALID"
  );

  console.log("subscription fulfillment list filter tests passed");
}

run();
