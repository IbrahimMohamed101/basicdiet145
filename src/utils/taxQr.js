"use strict";
// Shared ZATCA phase-1 TLV encoder. Identical byte encoding to legacy subscription invoices.
function formatSarFromHalala(amountHalala) {
  const normalized = Number.isFinite(Number(amountHalala)) && Number(amountHalala) >= 0
    ? Math.round(Number(amountHalala)) : 0;
  return (normalized / 100).toFixed(2);
}
function encodeTlvField(tag, value) {
  const valueBuffer = Buffer.from(String(value), "utf8");
  if (valueBuffer.length > 255) {
    throw new Error(`QR TLV field ${tag} exceeds 255 bytes`);
  }
  return Buffer.concat([Buffer.from([tag, valueBuffer.length]), valueBuffer]);
}
function buildLocalTaxQrPayload({ sellerName, vatNumber, issuedAt, totalHalala, vatHalala }) {
  return Buffer.concat([
    encodeTlvField(1, sellerName),
    encodeTlvField(2, vatNumber),
    encodeTlvField(3, issuedAt),
    encodeTlvField(4, formatSarFromHalala(totalHalala)),
    encodeTlvField(5, formatSarFromHalala(vatHalala)),
  ]).toString("base64");
}
module.exports = { buildLocalTaxQrPayload, encodeTlvField, formatSarFromHalala };
