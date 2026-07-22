"use strict";

process.env.NODE_ENV = "test";

require("../src/services/installSubscriptionDailyAddonPolicy");
require("../src/services/installSubscriptionAddonReservationClosure");
require("../src/services/installSubscriptionAddonReservationReconciliation");
require("../src/services/installSubscriptionAddonOpsIdentityClosure");
require("./subscriptionDailyAddonPolicy.integration.test");
