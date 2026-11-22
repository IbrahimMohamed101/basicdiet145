"use strict";

const MANUAL_DEDUCTION_ACTION = "manual_subscription_meal_deduction";
const MANUAL_DEDUCTION_REVERSAL_ACTION = "subscription_manual_deduction_reversal";
// Staff confirmation that a manual deduction on this business date is on purpose
// even though the customer also received that day's delivery (the customer took
// extra meals from the balance). It is evidence only: it never moves a balance.
const SAME_DAY_EXTRA_ACTION = "subscription_manual_deduction_same_day_extra";
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
  SAME_DAY_EXTRA_ACTION,
  MANUAL_BATCH_JOURNAL,
  DELIVERY_BATCH_JOURNAL,
  HISTORICAL_DELIVERY_BATCH_JOURNAL,
};
