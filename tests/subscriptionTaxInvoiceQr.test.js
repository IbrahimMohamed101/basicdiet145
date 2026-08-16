"use strict";

const assert = require("assert");
const { buildLocalTaxQrPayload } = require("../src/controllers/dashboard/subscriptionInvoiceController");
const { calculateVatBreakdownFromInclusiveTotal } = require("../src/config/vat");

function decodeTlv(base64) {
  const buffer = Buffer.from(base64, "base64");
  const fields = [];
  let offset = 0;

  while (offset < buffer.length) {
    const tag = buffer[offset];
    const length = buffer[offset + 1];
    const start = offset + 2;
    const end = start + length;
    assert.ok(end <= buffer.length, `TLV tag ${tag} exceeds payload bounds`);
    fields.push({ tag, value: buffer.subarray(start, end).toString("utf8") });
    offset = end;
  }

  return fields;
}

const totalHalala = 11500;
const vat = calculateVatBreakdownFromInclusiveTotal(totalHalala);
assert.strictEqual(vat.vatHalala, 1500, "115 SAR inclusive should contain 15 SAR VAT at 15%");

const payload = buildLocalTaxQrPayload({
  sellerName: "مؤسسة بيسيك دايت",
  vatNumber: "313015429700003",
  issuedAt: "2026-08-16T12:30:45.000Z",
  totalHalala,
  vatHalala: vat.vatHalala,
});

const fields = decodeTlv(payload);
assert.deepStrictEqual(fields, [
  { tag: 1, value: "مؤسسة بيسيك دايت" },
  { tag: 2, value: "313015429700003" },
  { tag: 3, value: "2026-08-16T12:30:45.000Z" },
  { tag: 4, value: "115.00" },
  { tag: 5, value: "15.00" },
]);

console.log("subscription tax invoice TLV QR test: PASS");
