"use strict";

// Read-only presentation of stacked packages in the daily-deduction picker.
// Only the pickup subset is sent to the existing pickup-only mutation.
// Non-pickup packages stay visible, with their original server-authoritative
// balance, so staff can continue using the standard manual deduction workflow.
function splitQuickDayOptions(options = {}, pickupOptions = []) {
  const all = Array.isArray(options.batches) ? options.batches : [];
  const allowedPickup = Array.isArray(pickupOptions) ? pickupOptions : [];
  const allowedIds = new Set(allowedPickup.map((row) => String(row.id)));
  return {
    ...options,
    batches: allowedPickup,
    manualOnlyBatches: all
      .filter((row) => !allowedIds.has(String(row.id)))
      .map((row) => ({ ...row, quickDeductionAllowed: false })),
  };
}

module.exports = { splitQuickDayOptions };
