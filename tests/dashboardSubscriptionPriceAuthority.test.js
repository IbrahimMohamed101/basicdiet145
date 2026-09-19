"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

(function run() {
  const quote = read("src/services/subscription/subscriptionQuoteService.js");
  const admin = read("src/controllers/adminController.js");
  const pricing = read("src/utils/pricing.js");

  assert.ok(
    quote.includes("useDashboardDisplayedPlanPrice = false"),
    "quote service exposes the dashboard price authority option"
  );

  assert.ok(
    quote.includes(
      "useDashboardDisplayedPlanPrice\n      ? mealOption.priceHalala\n      : resolvePlanBasePriceHalala(mealOption)"
    ),
    "dashboard checkout uses the displayed priceHalala instead of compareAtHalala"
  );

  assert.ok(
    pricing.includes(
      "return normalizeHalala(mealOption && mealOption.priceHalala);"
    ),
    "canonical plan pricing uses priceHalala as the sell price"
  );

  const occurrences = admin.split("useDashboardDisplayedPlanPrice: true").length - 1;
  assert.strictEqual(
    occurrences,
    2,
    "dashboard quote and dashboard create both opt into displayed plan pricing"
  );

  assert.ok(
    pricing.includes("compareAtHalala"),
    "comparison pricing remains a separate field"
  );

  console.log("dashboardSubscriptionPriceAuthority.test.js: all checks passed");
})();
