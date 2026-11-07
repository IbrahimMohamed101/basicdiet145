"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { pricePosInvoice, vatOnInclusiveGross } = require("../src/services/pos/invoiceMath");
const L = (amount, quantity = 1, discount) => ({ unitPriceHalalas: amount, quantity, discount });

test("D-088 vector 1: 10000 at 10% invoice discount", () => {
  const x = pricePosInvoice({ lines: [L(10000)], invoiceDiscount: { type: "percent", value: 10 } });
  assert.deepEqual([x.totals.grossHalalas, x.totals.vatHalalas, x.totals.netHalalas], [9000, 1174, 7826]);
});
test("D-088 vector 2: 400 at 10% invoice discount", () => {
  const x = pricePosInvoice({ lines: [L(400)], invoiceDiscount: { type: "percent", value: 10 } });
  assert.deepEqual([x.totals.grossHalalas, x.totals.vatHalalas, x.totals.netHalalas], [360, 47, 313]);
});
test("D-088 vector 3: meal + three independent 500 addon lines", () => {
  const x = pricePosInvoice({ lines: [L(3400), L(500), L(500), L(500)] });
  assert.deepEqual(x.lines.map(l => l.vatHalalas), [443, 65, 65, 65]);
  assert.equal(x.totals.grossHalalas, 4900);
  assert.equal(x.totals.vatHalalas, 638);
});
test("D-088 vector 4: 3400+500 fixed 100 largest remainder", () => {
  const x = pricePosInvoice({ lines: [L(3400), L(500)], invoiceDiscount: { type: "fixed", value: 100 } });
  assert.deepEqual(x.lines.map(l => l.invoiceDiscountPartHalalas), [87, 13]);
  assert.deepEqual(x.lines.map(l => l.grossHalalas), [3313, 487]);
  assert.deepEqual(x.lines.map(l => l.vatHalalas), [432, 64]);
  assert.deepEqual([x.totals.grossHalalas, x.totals.vatHalalas, x.totals.netHalalas], [3800, 496, 3304]);
});
test("D-088 vector 5: VAT on line total of three units", () => {
  const x = pricePosInvoice({ lines: [L(500, 3)] });
  assert.equal(x.lines[0].vatHalalas, 196);
  assert.equal(x.totals.grossHalalas, 1500);
});
test("D-088 vector 6: 3200+500+300 15% proportional invoice discount", () => {
  const x = pricePosInvoice({ lines: [L(3200), L(500), L(300)], invoiceDiscount: { type: "percent", value: 15 } });
  assert.deepEqual(x.lines.map(l => l.invoiceDiscountPartHalalas), [480, 75, 45]);
  assert.deepEqual(x.lines.map(l => l.vatHalalas), [355, 55, 33]);
  assert.deepEqual([x.totals.grossHalalas, x.totals.vatHalalas, x.totals.netHalalas], [3400, 443, 2957]);
});
test("D-088 vector 7: discounts cannot make any line or invoice negative", () => {
  assert.throws(() => pricePosInvoice({ lines: [L(500)], invoiceDiscount: { type: "fixed", value: 501 } }), /الخصم أكبر/);
  assert.throws(() => pricePosInvoice({ lines: [L(500, 1, { type: "fixed", value: 501 })] }), /الخصم أكبر/);
});
test("D-089: percentage/fixed line discounts precede invoice discount, configurable null cap", () => {
  const x = pricePosInvoice({ lines: [
    L(1000, 2, { type: "percent", value: 10 }),
    L(500, 1, { type: "fixed", value: 100 }),
  ], invoiceDiscount: { type: "percent", value: 5 } }, { cashierDiscountCapHalalas: null });
  assert.equal(x.totals.lineDiscountHalalas, 300);
  assert.equal(x.totals.invoiceDiscountHalalas, 110);
  assert.equal(x.totals.grossHalalas, 2090);
  assert.throws(() => pricePosInvoice({ lines: [L(1000)], invoiceDiscount:
    { type: "fixed", value: 200 } }, { cashierDiscountCapHalalas: 199 }), /سقف الكاشير/);
});
test("D-088 property checks over deterministic diverse invoices", () => {
  let seed = 90210;
  const random = n => { seed = (1664525 * seed + 1013904223) >>> 0; return seed % n; };
  for (let i = 0; i < 2500; i += 1) {
    const lines = Array.from({ length: 1 + random(12) }, () =>
      L(1 + random(30000), 1 + random(5), { type: "percent", value: random(30) }));
    const disc = { type: "percent", value: random(45) };
    const result = pricePosInvoice({ lines, invoiceDiscount: disc });
    assert.equal(result.lines.reduce((sum, line) => sum + line.invoiceDiscountPartHalalas, 0),
      result.totals.invoiceDiscountHalalas);
    for (const line of result.lines) {
      assert.equal(line.grossHalalas, line.vatHalalas + line.netHalalas);
      assert.ok(line.grossHalalas >= 0 && line.vatHalalas >= 0 && line.netHalalas >= 0);
      assert.equal(line.vatHalalas, vatOnInclusiveGross(line.grossHalalas));
    }
    assert.equal(result.totals.beforeDiscountHalalas,
      result.totals.grossHalalas + result.totals.totalDiscountHalalas);
    assert.equal(result.totals.grossHalalas, result.totals.netHalalas + result.totals.vatHalalas);
  }
});
test("D-088 stable tie-break: remainder, higher line value, earlier index", () => {
  const x = pricePosInvoice({ lines: [L(1), L(1), L(1)], invoiceDiscount: { type: "fixed", value: 1 } });
  assert.deepEqual(x.lines.map(l => l.invoiceDiscountPartHalalas), [1, 0, 0]);
});
