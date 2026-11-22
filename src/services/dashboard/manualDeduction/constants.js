"use strict";

const MANUAL_DEDUCTION_ACTION = "manual_subscription_meal_deduction";
const MANUAL_DEDUCTION_REVERSAL_ACTION = "subscription_manual_deduction_reversal";
const DAILY_DEDUCTION_ACTION = "subscription_daily_meal_deduction";
const MANUAL_BATCH_JOURNAL = "manualDeductions";
const DELIVERY_BATCH_JOURNAL = "chefChoiceDeliveryDeductions";
const HISTORICAL_DELIVERY_BATCH_JOURNAL = "historicalParentDeliveryReconciliations";
const ACTIVE_STATUS = "active";

module.exports = {
  ACTIVE_STATUS,
  MANUAL_DEDUCTION_ACTION,
  MANUAL_DEDUCTION_REVERSAL_ACTION,
  DAILY_DEDUCTION_ACTION,
  MANUAL_BATCH_JOURNAL,
  DELIVERY_BATCH_JOURNAL,
  HISTORICAL_DELIVERY_BATCH_JOURNAL,
};
