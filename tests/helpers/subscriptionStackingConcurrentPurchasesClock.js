"use strict";

// Keep the concurrent stacking fixture deterministic. The legacy parent in
// subscriptionStackingConcurrentPurchases.integration.test.js is valid through
// 2026-08-26, while the scenario itself is intentionally evaluated on
// 2026-08-06. The shared webhook/verify dispatcher resolves the restaurant
// business date from the wall clock, so without this preload the same fixture
// changes meaning after its fixed validity date passes.
const restaurantHoursService = require("../../src/services/restaurantHoursService");

const BUSINESS_DATE = "2026-08-06";

restaurantHoursService.getRestaurantBusinessDate = async () => BUSINESS_DATE;
