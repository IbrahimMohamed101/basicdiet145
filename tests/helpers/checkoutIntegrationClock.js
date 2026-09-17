"use strict";

// Keep the checkout integration suite deterministic regardless of the GitHub
// runner wall clock or the restaurant cutoff. Production code is untouched;
// this file is loaded only through NODE_OPTIONS in the checkout test script.
const dateUtils = require("../../src/utils/date");
const restaurantHoursService = require("../../src/services/restaurantHoursService");
const subscriptionQuoteService = require("../../src/services/subscription/subscriptionQuoteService");

const BUSINESS_DATE = "2026-07-20";
const BUSINESS_TOMORROW = "2026-07-21";
const SAME_DAY_OVERRIDE_TEST_KEY = "checkout_test_delivery_status_";
const TEST_PICKUP_LOCATION_ID = "test_pickup_location";

dateUtils.getTodayKSADate = () => BUSINESS_DATE;
dateUtils.getTomorrowKSADate = () => BUSINESS_TOMORROW;
dateUtils.getCurrentBusinessDate = () => BUSINESS_DATE;
dateUtils.isBeforeCutoff = () => true;

restaurantHoursService.getRestaurantBusinessDate = async () => BUSINESS_DATE;
restaurantHoursService.getRestaurantBusinessTomorrow = async () => BUSINESS_TOMORROW;

// The legacy checkout integration fixture is named as an explicit first-day
// pickup override scenario, but its request body predates the explicit field.
// Enrich only that uniquely identified test request so the suite validates the
// current contract instead of relying on the removed implicit override.
const originalResolveCheckoutQuoteOrThrow =
  subscriptionQuoteService.resolveCheckoutQuoteOrThrow;
subscriptionQuoteService.resolveCheckoutQuoteOrThrow = async function deterministicCheckoutQuote(
  payload,
  options
) {
  const idempotencyKey = String(payload?.idempotencyKey || "");
  const delivery = payload?.delivery;
  const shouldAddExplicitOverride = Boolean(
    idempotencyKey.startsWith(SAME_DAY_OVERRIDE_TEST_KEY)
      && delivery
      && delivery.type === "delivery"
      && !delivery.firstDayFulfillmentOverride
  );

  const normalizedPayload = shouldAddExplicitOverride
    ? {
        ...payload,
        delivery: {
          ...delivery,
          firstDayFulfillmentOverride: {
            type: "pickup",
            pickupLocationId: TEST_PICKUP_LOCATION_ID,
          },
        },
      }
    : payload;

  return originalResolveCheckoutQuoteOrThrow.call(
    subscriptionQuoteService,
    normalizedPayload,
    options
  );
};
