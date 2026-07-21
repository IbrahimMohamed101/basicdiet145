"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  normalizePickupErrorResponse,
} = require("../src/utils/pickupErrorResponseLocalization");

function request(lang) {
  return {
    language: lang,
    query: {},
    headers: {},
  };
}

function run() {
  const source = {
    ok: false,
    error: {
      code: "MEAL_SLOT_UNAVAILABLE",
      message: "Linked day entitlement is not available for this pickup request",
    },
  };

  const ar = normalizePickupErrorResponse(
    source,
    request("ar"),
    "/api/subscriptions/sub_1/pickup-requests"
  );
  assert.strictEqual(ar.error.message.includes("تعذر حجز الوجبة"), true);
  assert.strictEqual(ar.error.details.messageEn.includes("selected meal"), true);

  const en = normalizePickupErrorResponse(
    source,
    request("en"),
    "/api/subscriptions/sub_1/pickup-requests"
  );
  assert.strictEqual(en.error.message.includes("selected meal"), true);

  const untouched = normalizePickupErrorResponse(
    source,
    request("ar"),
    "/api/dashboard/ops/list"
  );
  assert.strictEqual(untouched, source);

  console.log("pickup error response localization checks passed");
}

run();
