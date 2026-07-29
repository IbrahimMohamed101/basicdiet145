"use strict";

const dateUtils = require("../../src/utils/date");

function installFixedKsaClock(businessDate) {
  if (!dateUtils.isValidKSADateString(businessDate)) {
    throw new TypeError("businessDate must use YYYY-MM-DD KSA format");
  }

  const originalFunctions = {
    getCurrentBusinessDate: dateUtils.getCurrentBusinessDate,
    getTodayKSADate: dateUtils.getTodayKSADate,
    getTomorrowKSADate: dateUtils.getTomorrowKSADate,
  };
  const tomorrow = dateUtils.addDaysToKSADateString(businessDate, 1);

  dateUtils.getCurrentBusinessDate = () => businessDate;
  dateUtils.getTodayKSADate = () => businessDate;
  dateUtils.getTomorrowKSADate = () => tomorrow;

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    process.removeListener("exit", restore);
    Object.assign(dateUtils, originalFunctions);
  };
  process.once("exit", restore);
  return restore;
}

module.exports = {
  installFixedKsaClock,
};
