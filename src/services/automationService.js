"use strict";

/**
 * Automation Service
 *
 * NOTE (2026-05-04): The daily cutoff job that previously auto-settled past
 * subscription days and auto-consumed pickup-mode days has been DISABLED as part
 * of the new meal balance policy.
 *
 * Old behavior (removed):
 *   1. settlePastSubscriptionDaysForRange() — marked past days as
 *      consumed_without_preparation and deducted remainingMeals.
 *   2. Pickup-day loop — deducted meals for today's pickup days that did not
 *      have pickupRequested=true when the window ended.
 *
 * New policy: meals are only deducted on actual operational fulfillment or an
 * explicit cashier/manual consumption action. Calendar-day passage never
 * consumes meals.
 */

const { logger } = require("../utils/logger");

let isCutoffJobRunning = false;

async function processDailyCutoff() {
  if (isCutoffJobRunning) {
    const err = new Error("Cutoff job is already running");
    err.code = "JOB_RUNNING";
    throw err;
  }
  isCutoffJobRunning = true;
  try {
    // DISABLED: Calendar-day auto-consumption is no longer performed.
    // Under the new meal balance policy, meals are only deducted on actual
    // operational fulfillment or an explicit cashier/manual consumption action.
    // This function is kept as a no-op to preserve the scheduler integration
    // without breaking the job invocation.
    logger.info("processDailyCutoff: auto-settlement and pickup auto-consumption are disabled (new meal balance policy)", {
      policyVersion: "TOTAL_BALANCE_WITHIN_VALIDITY",
    });
  } finally {
    isCutoffJobRunning = false;
  }
}

module.exports = { processDailyCutoff };
