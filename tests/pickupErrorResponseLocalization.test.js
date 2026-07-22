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

  const forbidden = normalizePickupErrorResponse(
    {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "Forbidden",
      },
    },
    request("en"),
    "/api/subscriptions/sub_1/pickup-availability?date=2026-07-22"
  );
  assert.strictEqual(forbidden.error.message.includes("not linked to the current account"), true);
  assert.strictEqual(forbidden.error.message.includes("internal error"), false);
  assert.strictEqual(forbidden.error.details.messageAr.includes("غير مرتبط بالحساب الحالي"), true);

  const explicitOwnershipMessage = normalizePickupErrorResponse(
    {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "Forbidden",
        details: {
          messageAr: "رسالة ملكية مخصصة",
          messageEn: "Custom ownership message",
        },
      },
    },
    request("en"),
    "/api/subscriptions/sub_1/pickup-requests"
  );
  assert.strictEqual(explicitOwnershipMessage.error.message, "Custom ownership message");
  assert.strictEqual(explicitOwnershipMessage.error.details.messageAr, "رسالة ملكية مخصصة");

  const untouched = normalizePickupErrorResponse(
    source,
    request("ar"),
    "/api/dashboard/ops/list"
  );
  assert.strictEqual(untouched, source);

  console.log("pickup error response localization checks passed");
}

run();
