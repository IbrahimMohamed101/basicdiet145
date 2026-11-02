"use strict";
process.env.NODE_ENV = "test";
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { models } = require("../src/modules/pos/models");
const { isEnabled, indexDefinitions, inspectIndexes, getPosReadiness } = require("../src/modules/pos/readiness");
const fakeDb = (hello, indices = () => []) => ({
  db: {
    admin: () => ({ command: async () => hello }),
    collection: name => ({ indexes: async () => indices(name) }),
  },
});
async function test() {
  assert.equal(isEnabled({}), false);
  assert.equal(isEnabled({ POS_ENABLED: "true" }), true);
  assert.equal(isEnabled({ POS_ENABLED: "false" }), false);
  assert.equal((await getPosReadiness({ env: {} })).code, "POS_DISABLED");
  assert.equal((await getPosReadiness({
    env: { POS_ENABLED: "true" }, connection: fakeDb({ isWritablePrimary: true }),
  })).code, "POS_TRANSACTIONS_REQUIRED");
  assert.deepEqual(models.map(m => m.collection.name).sort(), [
    "pos_audit_events", "pos_counters", "pos_orders", "pos_shifts", "pos_terminals",
  ]);
  assert(models.every(m => m.schema.options.autoIndex === false));
  const definitions = indexDefinitions();
  const openShift = definitions.find(x => x.name === "pos_one_open_shift_per_terminal");
  assert.equal(openShift.unique, true);
  assert.deepEqual(openShift.partialFilterExpression, { status: "open" });
  assert(definitions.some(x => x.name === "pos_order_idempotency_unique" && x.unique));
  const correct = name => definitions.filter(x => x.collection === name).map(x => ({
    name: x.name, key: x.key, unique: x.unique,
    ...(x.partialFilterExpression ? { partialFilterExpression: x.partialFilterExpression } : {}),
  }));
  assert.deepEqual(await inspectIndexes(fakeDb({ setName: "rs0" }, correct)), []);
  assert.equal((await getPosReadiness({
    env: { POS_ENABLED: "true" },
    connection: fakeDb({ setName: "rs0" }, correct),
  })).code, "POS_READY");
  assert.equal((await getPosReadiness({
    env: { POS_ENABLED: "true" },
    connection: fakeDb({ setName: "rs0" }, name =>
      correct(name).filter(x => x.name !== "pos_order_receipt_unique")),
  })).code, "POS_INDEXES_MISSING");
  const PosOrder = models.find(m => m.modelName === "PosOrder");
  const order = new PosOrder({
    receiptNumber: "TEST-RECEIPT-01",
    shiftId: new mongoose.Types.ObjectId(),
    branchId: "jed1", businessDate: "2026-11-02",
    cashierId: new mongoose.Types.ObjectId(), channel: "takeaway",
    pricing: { grossHalala: 400, totalHalala: 360, vatHalala: 47, netHalala: 313 },
    idempotencyKey: "test-001", requestHash: "hash-001",
  });
  assert.equal(order.validateSync(), undefined, "valid halala order should pass");
  order.pricing.totalHalala = 3.5;
  assert(order.validateSync(), "fractional halala must fail");
  console.log("POS foundation tests: schemas, transaction guard, indexes and integer money PASS");
}
test().catch(err => { console.error(err); process.exitCode = 1; });
