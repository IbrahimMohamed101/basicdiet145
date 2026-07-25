"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function run() {
  const capabilities = read("src/routes/dashboardRestaurantCapabilities.js");
  const installer = read("src/services/installDashboardSubscriptionPromoFlow.js");
  const paymentController = read(
    "src/controllers/dashboard/subscriptionPaymentRecordingController.js"
  );
  const subscriptionRoutes = read("src/routes/dashboardSubscriptions.js");

  assert(
    paymentController.indexOf('require("../../services/installDashboardSubscriptionPromoFlow")')
      < paymentController.indexOf('require("./subscriptionCreationController")'),
    "promo flow must be installed before the subscription controller captures service exports"
  );
  assert(
    installer.includes("options.userId || (payload && payload.userId)"),
    "dashboard create quote must use the customer userId for promo eligibility"
  );
  assert(
    installer.includes('contract.contractSource === "admin_create"'),
    "direct promo usage must be scoped to dashboard-created subscriptions"
  );
  assert(
    installer.includes('status: "consumed"'),
    "dashboard promo usage must be consumed in the activation transaction"
  );
  assert(
    installer.includes("currentUsageCount: 1"),
    "dashboard promo usage must increment the promo usage counter"
  );
  assert(
    paymentController.includes("decoratePromoQuotePayload"),
    "dashboard quote response must expose the applied promo block"
  );
  assert(
    paymentController.includes("linkPromoUsagePaymentBestEffort"),
    "dashboard payment should be linked to the consumed promo usage"
  );
  assert(
    subscriptionRoutes.includes("const subscriptionStaffAccess = dashboardRoleMiddleware([")
      && subscriptionRoutes.includes('"restaurant"')
      && subscriptionRoutes.includes('"kitchen"')
      && subscriptionRoutes.includes("subscriptionStaffAccess,"),
    "restaurant and legacy kitchen roles must retain quote/create access"
  );
  assert(
    !capabilities.includes('router.use("/promo-codes"'),
    "restaurant subscription promo use must not grant promo-code administration"
  );

  console.log("dashboard subscription promo flow policy checks passed");
}

run();
