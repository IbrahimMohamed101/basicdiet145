"use strict";

process.env.NODE_ENV = "test";

require("../src/services/installSubscriptionDailyAddonPolicy");
require("../src/services/installSubscriptionAddonReservationClosure");
require("../src/services/installSubscriptionAddonReservationReconciliation");

const dailyAddonService = require("../src/services/subscription/subscriptionDailyAddonService");
const composedEnsure = dailyAddonService.ensureDailyAddonDefaultsForDay;
dailyAddonService.ensureDailyAddonDefaultsForDay = async function diagnosticEnsure(args = {}) {
  const result = await composedEnsure(args);
  const firstSelection = result && result.day && Array.isArray(result.day.addonSelections)
    ? result.day.addonSelections[0]
    : null;
  console.log("[addons][reconciliation-diagnostic]", JSON.stringify({
    normalizationUpdatedCount: result && result.normalizationUpdatedCount,
    firstSelection: firstSelection && {
      name: firstSelection.name,
      nameI18n: firstSelection.nameI18n,
      autoDailyAddon: firstSelection.autoDailyAddon,
      dailyAllocationKey: firstSelection.dailyAllocationKey,
      subscriptionAddonLabelI18n: firstSelection.subscriptionAddonLabelI18n,
      resolvedProductNameI18n: firstSelection.resolvedProductNameI18n,
    },
  }));
  return result;
};

require("./subscriptionDailyAddonPolicy.integration.test");
