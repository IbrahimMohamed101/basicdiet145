"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalHash, normalizeSaleIntent, normalizeRefundIntent, validateIdempotencyKey } =
  require("../src/services/pos/financialIntent");
const { hasPosCapability, requireFinancialStagingWrites } =
  require("../src/services/pos/financialRuntime");

test("no financial writes without exact isolated Staging runtime or approved Production rs0", async () => {
  await assert.rejects(requireFinancialStagingWrites(), (e) =>
    e.status === 403 && ["POS_STAGING_ONLY", "POS_DISABLED"].includes(e.code));
});
test("D-090 pos.refund is a separately revocable capability", () => {
  for (const role of ["cashier", "restaurant", "admin", "superadmin"]) {
    assert.equal(hasPosCapability(role, "pos.refund", {}), true);
  }
  assert.equal(hasPosCapability("kitchen", "pos.refund", {}), false);
  assert.equal(hasPosCapability("cashier", "pos.refund", { POS_REFUND_ROLES: "admin" }), false);
  assert.equal(hasPosCapability("admin", "pos.refund", { POS_REFUND_ROLES: "admin" }), true);
  assert.equal(hasPosCapability("admin", "pos.refund", { POS_REFUND_ROLES: "" }), false);
  assert.equal(hasPosCapability("admin", "pos.sale", {}), false);
});
test("idempotency key is required and canonical stable hash ignores client totals", () => {
  assert.throws(() => validateIdempotencyKey(null), /Idempotency-Key/);
  assert.throws(() => validateIdempotencyKey("tiny"), /Idempotency-Key/);
  assert.doesNotThrow(() => validateIdempotencyKey("f99df576-3baa-48bc-a302-c40b398eea7c"));
  const sale = { revision: 1, channel: "restaurant", serviceMode: "takeaway",
    items: [{ productId: "water", variantId: "bottle", quantity: 1, addons: [] }],
    tender: { method: "cash", receivedHalalas: 500 } };
  const actual = normalizeSaleIntent(sale);
  assert.equal(canonicalHash(actual), canonicalHash(normalizeSaleIntent({
    ...sale, price: 2, vatHalalas: 1, finalPayableHalalas: -999,
  })));
  assert.notEqual(canonicalHash(actual), canonicalHash(normalizeSaleIntent({
    ...sale, tender: { method: "network" },
  })));
  assert.equal(canonicalHash({ a: 1, b: { x: 1, y: 2 } }),
    canonicalHash({ b: { y: 2, x: 1 }, a: 1 }));
});
test("app receivables carry external status, not restaurant tender", () => {
  const a = normalizeSaleIntent({ revision: 1, channel: "keeta", appPaymentStatus: "cash",
    externalOrderNumber: "T-123",
    tender: { method: "cash", receivedHalalas: 100000 },
    items: [{ productId: "water", variantId: "bottle", quantity: 1, addonIds: [] }] });
  assert.equal(a.tender, undefined);
  assert.equal(a.externalOrderNumber, "T-123");
  assert.equal(a.appPaymentStatus, "cash");
  assert.equal(a.items[0].addons.length, 0);
});
test("D-090 reason and refund quantity are mandatory", () => {
  const valid = { invoiceId: "abcdef0123456789abcdef01", reason: "إرجاع بناء على طلب العميل",
    method: "cash", lines: [{ lineId: "i0", quantity: 1 }] };
  assert.deepEqual(normalizeRefundIntent(valid), valid);
  assert.throws(() => normalizeRefundIntent({ ...valid, reason: "" }), /سبب المرتجع/);
  assert.throws(() => normalizeRefundIntent({ ...valid, lines: [
    { lineId: "i0", quantity: 1 }, { lineId: "i0", quantity: 1 },
  ] }), /مكررة/);
});
