"use strict";

// Keep the checkout integration suite deterministic regardless of the GitHub
// runner wall clock or the restaurant cutoff. Production code is untouched;
// this file is loaded only through NODE_OPTIONS in the checkout test script.
const dateUtils = require("../../src/utils/date");
const restaurantHoursService = require("../../src/services/restaurantHoursService");

const BUSINESS_DATE = "2026-07-20";
const BUSINESS_TOMORROW = "2026-07-21";

dateUtils.getTodayKSADate = () => BUSINESS_DATE;
dateUtils.getTomorrowKSADate = () => BUSINESS_TOMORROW;
dateUtils.getCurrentBusinessDate = () => BUSINESS_DATE;
dateUtils.isBeforeCutoff = () => true;

restaurantHoursService.getRestaurantBusinessDate = async () => BUSINESS_DATE;
restaurantHoursService.getRestaurantBusinessTomorrow = async () => BUSINESS_TOMORROW;
