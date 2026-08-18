"use strict";

// The final-candidate replica-set scenario now exercises the P4 public-runtime
// activation decision instead of calling the P2 pinned function directly. Keep
// this dedicated entry point so P4 CI cannot omit the complete activation ->
// selection -> Pickup -> fulfillment -> replay lifecycle.
require("./subscriptionStackingFinalIntegrationCandidate.integration.test");
