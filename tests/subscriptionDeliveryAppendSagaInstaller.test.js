"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");

require("../src/services/installSubscriptionDayFullMealCompatibility");
require("../src/services/installSubscriptionDailyAddonPolicy");
require("../src/services/installSubscriptionAddonReservationClosure");
require("../src/services/installSubscriptionAddonReservationReconciliation");
require("../src/services/installSubscriptionAddonOpsIdentityClosure");
require("../src/services/installSubscriptionDeliveryAppendSaga");

const planningService = require("../src/services/subscription/subscriptionPlanningClientService");

assert.strictEqual(
  planningService.updateDaySelectionForClient.__dayMutationLockAware,
  true,
  "normal day edits must respect the append mutation lock"
);
assert.strictEqual(
  planningService.appendDayMealsForClient.__deliveryAppendSaga,
  true,
  "delivery append route must use the durable saga"
);

console.log("subscription delivery append saga installer checks passed");
