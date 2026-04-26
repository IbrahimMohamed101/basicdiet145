"use strict";

const Setting = require("../../models/Setting");
const dateUtils = require("../../utils/date");
const { getRestaurantBusinessTomorrow } = require("../restaurantHoursService");

const CUTOFF_ERROR_CODE = "CUTOFF_PASSED_FOR_TOMORROW";
const CUTOFF_ERROR_MESSAGE = "Cutoff time passed for tomorrow";

const CUTOFF_ACTIONS = Object.freeze({
  MEAL_PLANNER_SELECTION_VALIDATE: "meal_planner_selection_validate",
  MEAL_PLANNER_SELECTION_SAVE: "meal_planner_selection_save",
  MEAL_PLANNER_CONFIRM: "meal_planner_confirm",
  MEAL_PLANNER_PREMIUM_EXTRA_PAYMENT: "meal_planner_premium_extra_payment",
  MEAL_PLANNER_PREMIUM_OVERAGE_PAYMENT: "meal_planner_premium_overage_payment",
  DELIVERY_DETAILS_FOR_DATE_CHANGE: "delivery_details_for_date_change",
  DELIVERY_DEFAULTS_CHANGE: "delivery_defaults_change",
  SKIP_DAY_CHANGE: "skip_day_change",
  UNSKIP_DAY_CHANGE: "unskip_day_change",
  SKIP_RANGE_CHANGE: "skip_range_change",
  FREEZE_RANGE_CHANGE: "freeze_range_change",
  FREEZE_PREVIEW: "freeze_preview",
  ONE_TIME_ADDON_LOGISTICS_CHANGE: "one_time_addon_logistics_change",
  CUSTOM_MEAL_LOGISTICS_CHANGE: "custom_meal_logistics_change",
  CUSTOM_SALAD_LOGISTICS_CHANGE: "custom_salad_logistics_change",
  ORDER_DELIVERY_DATE_CHANGE: "order_delivery_date_change",
});

const ACTION_POLICY = Object.freeze({
  [CUTOFF_ACTIONS.MEAL_PLANNER_SELECTION_VALIDATE]: {
    category: "planning",
    lockTomorrowAfterCutoff: false,
  },
  [CUTOFF_ACTIONS.MEAL_PLANNER_SELECTION_SAVE]: {
    category: "planning",
    lockTomorrowAfterCutoff: false,
  },
  [CUTOFF_ACTIONS.MEAL_PLANNER_CONFIRM]: {
    category: "planning",
    lockTomorrowAfterCutoff: false,
  },
  [CUTOFF_ACTIONS.MEAL_PLANNER_PREMIUM_EXTRA_PAYMENT]: {
    category: "planning",
    lockTomorrowAfterCutoff: false,
  },
  [CUTOFF_ACTIONS.MEAL_PLANNER_PREMIUM_OVERAGE_PAYMENT]: {
    category: "planning",
    lockTomorrowAfterCutoff: false,
  },
  [CUTOFF_ACTIONS.DELIVERY_DETAILS_FOR_DATE_CHANGE]: {
    category: "delivery_schedule_change",
    lockTomorrowAfterCutoff: true,
  },
  [CUTOFF_ACTIONS.DELIVERY_DEFAULTS_CHANGE]: {
    category: "delivery_schedule_change",
    lockTomorrowAfterCutoff: true,
  },
  [CUTOFF_ACTIONS.SKIP_DAY_CHANGE]: {
    category: "skip_freeze_change",
    lockTomorrowAfterCutoff: true,
  },
  [CUTOFF_ACTIONS.UNSKIP_DAY_CHANGE]: {
    category: "skip_freeze_change",
    lockTomorrowAfterCutoff: true,
  },
  [CUTOFF_ACTIONS.SKIP_RANGE_CHANGE]: {
    category: "skip_freeze_change",
    lockTomorrowAfterCutoff: true,
  },
  [CUTOFF_ACTIONS.FREEZE_RANGE_CHANGE]: {
    category: "skip_freeze_change",
    lockTomorrowAfterCutoff: true,
  },
  [CUTOFF_ACTIONS.FREEZE_PREVIEW]: {
    category: "skip_freeze_change",
    lockTomorrowAfterCutoff: true,
  },
  [CUTOFF_ACTIONS.ONE_TIME_ADDON_LOGISTICS_CHANGE]: {
    category: "addon_logistics_change",
    lockTomorrowAfterCutoff: true,
  },
  [CUTOFF_ACTIONS.CUSTOM_MEAL_LOGISTICS_CHANGE]: {
    category: "addon_logistics_change",
    lockTomorrowAfterCutoff: true,
  },
  [CUTOFF_ACTIONS.CUSTOM_SALAD_LOGISTICS_CHANGE]: {
    category: "addon_logistics_change",
    lockTomorrowAfterCutoff: true,
  },
  [CUTOFF_ACTIONS.ORDER_DELIVERY_DATE_CHANGE]: {
    category: "order_delivery_date_change",
    lockTomorrowAfterCutoff: true,
  },
});

async function getCutoffTimeValue(fallback = "00:00") {
  const setting = await Setting.findOne({ key: "cutoff_time" }).lean();
  return setting && setting.value ? String(setting.value) : fallback;
}

function resolveTomorrowCutoffPolicy(action) {
  const policy = ACTION_POLICY[action];
  if (!policy) {
    const err = new Error(`Unsupported cutoff action: ${action}`);
    err.code = "INTERNAL";
    throw err;
  }
  return policy;
}

function buildTomorrowCutoffError({ action, policy, date }) {
  const err = new Error(CUTOFF_ERROR_MESSAGE);
  err.code = CUTOFF_ERROR_CODE;
  err.status = 400;
  err.details = {
    action,
    category: policy.category,
    date: String(date || ""),
  };
  return err;
}

function normalizeTargetDates({ date, dates }) {
  if (Array.isArray(dates)) {
    return dates.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim());
  }
  return typeof date === "string" && date.trim() ? [date.trim()] : [];
}

async function evaluateTomorrowCutoffImpact({
  action,
  date,
  dates,
  getCutoffTime = getCutoffTimeValue,
  getTomorrowKSADate = getRestaurantBusinessTomorrow,
  isBeforeCutoff = dateUtils.isBeforeCutoff,
} = {}) {
  const policy = resolveTomorrowCutoffPolicy(action);
  const targetDates = normalizeTargetDates({ date, dates });
  const tomorrow = await getTomorrowKSADate();
  const affectsTomorrow = targetDates.includes(tomorrow);

  if (!affectsTomorrow || !policy.lockTomorrowAfterCutoff) {
    return {
      action,
      category: policy.category,
      affectsTomorrow,
      cutoffPassed: false,
      allowed: true,
      tomorrow,
    };
  }

  const cutoffTime = await getCutoffTime();
  const cutoffPassed = !isBeforeCutoff(cutoffTime);

  return {
    action,
    category: policy.category,
    affectsTomorrow,
    cutoffPassed,
    allowed: !cutoffPassed,
    tomorrow,
    cutoffTime,
  };
}

async function assertTomorrowCutoffAllowed(options = {}) {
  const evaluation = await evaluateTomorrowCutoffImpact(options);
  if (!evaluation.allowed) {
    throw buildTomorrowCutoffError({
      action: options.action,
      policy: resolveTomorrowCutoffPolicy(options.action),
      date: evaluation.tomorrow,
    });
  }
  return evaluation;
}

module.exports = {
  CUTOFF_ACTIONS,
  CUTOFF_ERROR_CODE,
  CUTOFF_ERROR_MESSAGE,
  assertTomorrowCutoffAllowed,
  buildTomorrowCutoffError,
  evaluateTomorrowCutoffImpact,
  getCutoffTimeValue,
  resolveTomorrowCutoffPolicy,
};
