"use strict";

const assert = require("assert");
const {
  buildLocalTaxQrPayload,
} = require("../src/controllers/dashboard/subscriptionInvoiceController");

function decodeTlvBase64(payloadBase64) {
  assert.match(payloadBase64, /^[A-Za-z0-9+/]+={0,2}$/);
  const buffer = Buffer.from(payloadBase64, "base64");
  const fields = [];
  let offset = 0;

  while (offset < buffer.length) {
    const tag = buffer[offset];
    const length = buffer[offset + 1];
    assert.notStrictEqual(tag, undefined, "TLV tag is missing");
    assert.notStrictEqual(length, undefined, "TLV length is missing");

    const valueStart = offset + 2;
    const valueEnd = valueStart + length;
    assert.ok(valueEnd <= buffer.length, `TLV tag ${tag} exceeds payload bounds`);

    fields.push({
      tag,
      length,
      value: buffer.subarray(valueStart, valueEnd).toString("utf8"),
    });
    offset = valueEnd;
  }

  assert.strictEqual(offset, buffer.length, "TLV payload must end on a field boundary");
  return fields;
}

const sample = {
  sellerName: "مؤسسة بيسيك دايت",
  vatNumber: "313015429700003",
  issuedAt: "2026-08-16T15:10:00.000Z",
  totalHalala: 11500,
  vatHalala: 1500,
};

const payloadBase64 = buildLocalTaxQrPayload(sample);
const fields = decodeTlvBase64(payloadBase64);

assert.deepStrictEqual(
  fields.map(({ tag, value }) => ({ tag, value })),
  [
    { tag: 1, value: sample.sellerName },
    { tag: 2, value: sample.vatNumber },
    { tag: 3, value: sample.issuedAt },
    { tag: 4, value: "115.00" },
    { tag: 5, value: "15.00" },
  ]
);

for (const field of fields) {
  assert.strictEqual(
    field.length,
    Buffer.byteLength(field.value, "utf8"),
    `TLV tag ${field.tag} must store UTF-8 byte length`
  );
}

assert.ok(!payloadBase64.startsWith("http://") && !payloadBase64.startsWith("https://"));

console.log("subscription tax QR TLV validation passed");
console.log(JSON.stringify({
  encoding: "TLV -> Base64 -> QR",
  tags: fields.map(({ tag, value }) => ({ tag, value })),
  payloadBase64,
}, null, 2));
