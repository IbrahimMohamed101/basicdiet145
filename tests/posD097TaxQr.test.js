"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { buildLocalTaxQrPayload } = require("../src/utils/taxQr");
const { buildLocalTaxQrPayload: subscriptionPublicExport } =
  require("../src/controllers/dashboard/subscriptionInvoiceController");
const { pricePosInvoice } = require("../src/services/pos/invoiceMath");
const { proportionalRefund } = require("../src/services/pos/financialLedgerService");
const { formatPosDocumentNumber } = require("../src/services/pos/posDocumentNumber");

// Frozen pre-refactor implementation from subscriptionInvoiceController.js;
// byte-for-byte identity is a prerequisite, not merely semantic TLV equivalence.
function legacyLocalTaxQrPayload({ sellerName, vatNumber, issuedAt, totalHalala, vatHalala }) {
  function toNonNegativeInteger(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
  }
  function formatSarFromHalala(amountHalala) {
    const normalized = toNonNegativeInteger(amountHalala) || 0;
    return (normalized / 100).toFixed(2);
  }
  function encodeTlvField(tag, value) {
    const valueBuffer = Buffer.from(String(value), "utf8");
    if (valueBuffer.length > 255) {
      throw new Error(`QR TLV field ${tag} exceeds 255 bytes`);
    }
    return Buffer.concat([Buffer.from([tag, valueBuffer.length]), valueBuffer]);
  }
  return Buffer.concat([
    encodeTlvField(1, sellerName),
    encodeTlvField(2, vatNumber),
    encodeTlvField(3, issuedAt),
    encodeTlvField(4, formatSarFromHalala(totalHalala)),
    encodeTlvField(5, formatSarFromHalala(vatHalala)),
  ]).toString("base64");
}
function decodeTlv(base64) {
  const decoded = Buffer.from(base64, "base64");
  const fields = [];
  let i = 0;
  while (i < decoded.length) {
    const tag = decoded[i++], size = decoded[i++];
    assert.ok(size >= 0 && i + size <= decoded.length);
    fields.push({ tag, text: decoded.subarray(i, i + size).toString("utf8") });
    i += size;
  }
  return fields;
}
const date = "2026-11-08T15:00:00.000Z", seller = "مؤسسة بيسيك دايت";
const vatNumber = "313015429700003";

test("subscription QR remains byte-for-byte identical including UTF-8 Arabic and fractional rounding", () => {
  for (const pair of [[10000, 1304], [1, 0], [11501, 1500], [0, 0], [4348, 567]]) {
    const params = { sellerName: seller, vatNumber, issuedAt: date,
      totalHalala: pair[0], vatHalala: pair[1] };
    assert.equal(buildLocalTaxQrPayload(params), legacyLocalTaxQrPayload(params));
    assert.equal(subscriptionPublicExport(params), legacyLocalTaxQrPayload(params));
  }
});

test("D-088 sale with an addon and a discount embeds exact server gross+VAT in POS TLV", () => {
  const quote = pricePosInvoice({
    lines: [{ id: "meal", name: "وجبة", quantity: 2, unitPriceHalalas: 5000 },
      { id: "addon", name: "إضافة", parentLineId: "meal", quantity: 1, unitPriceHalalas: 1500 }],
    invoiceDiscount: { type: "fixed", value: 1500 },
  });
  assert.equal(quote.totals.beforeDiscountHalalas, 11500);
  assert.equal(quote.totals.totalDiscountHalalas, 1500);
  assert.equal(quote.totals.grossHalalas, 10000);
  assert.equal(quote.totals.vatHalalas, 1304);
  assert.equal(quote.totals.netHalalas, 8696);
  assert.equal(quote.lines[1].parentLineId, "meal");
  const payload = buildLocalTaxQrPayload({
    sellerName: seller, vatNumber, issuedAt: date,
    totalHalala: quote.totals.grossHalalas, vatHalala: quote.totals.vatHalalas,
  });
  assert.deepEqual(decodeTlv(payload), [
    { tag: 1, text: seller }, { tag: 2, text: vatNumber },
    { tag: 3, text: date }, { tag: 4, text: "100.00" },
    { tag: 5, text: "13.04" },
  ]);
});

test("partial credit note uses ORIGINAL line prorated gross and VAT in exact TLV", () => {
  const original = { quantity: 2, grossHalalas: 8696, vatHalalas: 1134 };
  const balance = { refundedQuantity: 0, refundedGrossHalalas: 0, refundedVatHalalas: 0 };
  const refunded = proportionalRefund(original, balance, 1);
  assert.deepEqual(refunded, { grossHalalas: 4348, vatHalalas: 567, netHalalas: 3781 });
  const qr = buildLocalTaxQrPayload({ sellerName: seller, vatNumber, issuedAt: date,
    totalHalala: refunded.grossHalalas, vatHalala: refunded.vatHalalas });
  assert.deepEqual(decodeTlv(qr).slice(3), [
    { tag: 4, text: "43.48" }, { tag: 5, text: "5.67" },
  ]);
});

test("document numbering separates Production and Staging, sale and credit note", () => {
  assert.equal(formatPosDocumentNumber("sale", 1, true), "POS-000001");
  assert.equal(formatPosDocumentNumber("refund", 1, true), "POS-R-000001");
  assert.equal(formatPosDocumentNumber("sale", 1, false), "STG-000001");
  assert.equal(formatPosDocumentNumber("refund", 1, false), "STG-R-000001");
  assert.equal(formatPosDocumentNumber("sale", 2, true), "POS-000002");
  assert.throws(() => formatPosDocumentNumber("sale", 0, true), /POS_INVALID_SEQUENCE/);
});
