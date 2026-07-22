"use strict";

function addonBalanceLedgerFields() {
  return {
    reservationKeys: { type: [String], default: undefined },
    consumedAllocationKeys: { type: [String], default: undefined },
    releasedAllocationKeys: { type: [String], default: undefined },
  };
}

function addonSelectionLifecycleFields(mongoose) {
  if (!mongoose || !mongoose.Schema || !mongoose.Schema.Types) {
    throw new TypeError("mongoose is required to build add-on lifecycle schema fields");
  }
  return {
    autoDailyAddon: { type: Boolean, default: false },
    dailyEntitlement: { type: Boolean, default: false },
    selectionOrigin: { type: String, default: "", trim: true },
    dailyAllocationKey: { type: String, default: "", trim: true },
    addonSettlementState: {
      type: String,
      enum: ["", "reserved", "consumed", "released"],
      default: "",
    },
    reservedAt: { type: Date, default: null },
    settledAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
    settlementReason: { type: String, default: null, trim: true },
    subscriptionAddonLabelI18n: { type: mongoose.Schema.Types.Mixed, default: undefined },
    resolvedProductNameI18n: { type: mongoose.Schema.Types.Mixed, default: undefined },
    requiresKitchenChoice: { type: Boolean, default: false },
  };
}

module.exports = {
  addonBalanceLedgerFields,
  addonSelectionLifecycleFields,
};
