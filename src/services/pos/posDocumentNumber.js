"use strict";
function formatPosDocumentNumber(kind, sequence, production) {
  if (!["sale", "refund"].includes(kind) ||
      !Number.isSafeInteger(sequence) || sequence < 1 || sequence > 999999999) {
    throw new Error("POS_INVALID_SEQUENCE");
  }
  const prefix = production ? (kind === "sale" ? "POS-" : "POS-R-")
    : (kind === "sale" ? "STG-" : "STG-R-");
  return prefix + String(sequence).padStart(6, "0");
}
module.exports = { formatPosDocumentNumber };
