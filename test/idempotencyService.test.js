const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_IDEMPOTENCY_KEY_LENGTH,
  parseOperationIdempotencyKey,
  normalizeOperationScope,
  buildOperationRequestHash,
  buildContractHash,
  compareIdempotentRequest,
} = require("../src/services/idempotencyService");

test("parseOperationIdempotencyKey reads headers first then body", () => {
  assert.equal(
    parseOperationIdempotencyKey({
      headers: { "idempotency-key": "  abc-123 " },
      body: { idempotencyKey: "body-value" },
    }),
    "abc-123"
  );

  assert.equal(
    parseOperationIdempotencyKey({
      headers: {},
      body: { idempotencyKey: "body-only" },
    }),
    "body-only"
  );

  assert.equal(parseOperationIdempotencyKey({ headers: {}, body: {} }), "");
});

test("parseOperationIdempotencyKey rejects keys longer than max", () => {
  assert.throws(
    () =>
      parseOperationIdempotencyKey({
        body: { idempotencyKey: "x".repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1) },
      }),
    (error) => error && error.code === "VALIDATION_ERROR"
  );
});

test("normalizeOperationScope preserves approved scopes and maps known legacy aliases", () => {
  assert.equal(normalizeOperationScope("subscription_checkout"), "subscription_checkout");
  assert.equal(normalizeOperationScope("subscription_activation"), "subscription_checkout");
  assert.equal(normalizeOperationScope("custom_salad_order"), "custom_salad_day");
  assert.equal(normalizeOperationScope("one_time_order"), "one_time_addon");
});

test("buildOperationRequestHash is scoped by user and operation", () => {
  const effectivePayload = { amount: 1000, items: [{ id: "1", qty: 1 }] };
  const base = buildOperationRequestHash({
    scope: "subscription_checkout",
    userId: "user-1",
    effectivePayload,
  });
  const same = buildOperationRequestHash({
    scope: "subscription_checkout",
    userId: "user-1",
    effectivePayload: { items: [{ qty: 1, id: "1" }], amount: 1000 },
  });
  const differentScope = buildOperationRequestHash({
    scope: "premium_topup",
    userId: "user-1",
    effectivePayload,
  });

  assert.equal(base, same);
  assert.notEqual(base, differentScope);
});

test("buildContractHash uses canonical business contract only", () => {
  const contractA = {
    meta: { version: "subscription_contract.v1", capturedAt: "2026-03-17T10:00:00.000Z" },
    origin: { actorRole: "client", actorUserId: "u1" },
    plan: { planId: "p1", daysCount: 10, selectedGrams: 150, mealsPerDay: 3, totalMeals: 30, currency: "SAR" },
    start: { requestedStartDate: null, resolvedStartDate: "2026-03-18T00:00:00.000Z", defaultedToTomorrow: true, timezone: "Asia/Riyadh" },
    pricing: { basePlanPriceHalala: 10000, deliveryFeeHalala: 0, vatPercentage: 15, vatHalala: 1500, totalHalala: 11500, currency: "SAR" },
    delivery: { mode: "delivery", pricingMode: "flat_legacy", seedOnlyFromPreviousPreference: false, slot: { type: "delivery", window: "", slotId: "" }, address: { city: "Riyadh" }, pickupLocationId: null },
    policySnapshot: { freezePolicy: { enabled: true, maxDays: 31, maxTimes: 1 }, skipPolicyMode: "legacy_current", fallbackMode: "legacy_current", premiumAutoConsume: false, oneTimeAddonRequiresPaymentBeforeConfirmation: false },
  };
  const contractB = {
    ...contractA,
    meta: { version: "subscription_contract.v1", capturedAt: "2026-04-01T10:00:00.000Z" },
    origin: { actorRole: "admin", actorUserId: "u2", adminOverrideMeta: { note: "manual" } },
  };

  assert.equal(buildContractHash({ contractSnapshot: contractA }), buildContractHash({ contractSnapshot: contractB }));
});

test("compareIdempotentRequest returns new, reuse, or conflict", () => {
  assert.equal(compareIdempotentRequest({ existingRequestHash: "", incomingRequestHash: "a" }), "new");
  assert.equal(compareIdempotentRequest({ existingRequestHash: "a", incomingRequestHash: "a" }), "reuse");
  assert.equal(compareIdempotentRequest({ existingRequestHash: "a", incomingRequestHash: "b" }), "conflict");
});
