"use strict";

const dateUtils = require("../../utils/date");
const { resolveMealsPerDay } = require("../../utils/subscription/subscriptionDaySelectionSync");

const TERMINAL_NO_SERVICE_STATUSES = new Set(["delivery_canceled", "canceled_at_branch"]);

function derivePickupPrepared(day = {}) {
  return Boolean(
    ["in_preparation", "ready_for_pickup", "fulfilled", "no_show"].includes(String(day?.status || ""))
      || day?.pickupPreparationStartedAt
      || day?.pickupPreparedAt
  );
}

function derivePickupPreparationFlowStatus(day = {}) {
  const status = String(day?.status || "open");

  if (status === "consumed_without_preparation") return "consumed_without_preparation";
  if (status === "no_show") return "no_show";
  if (status === "fulfilled") return "fulfilled";
  if (status === "ready_for_pickup") return "ready_for_pickup";
  if (status === "in_preparation") return "in_preparation";
  if (status === "locked" && day?.pickupRequested) return "locked";
  return "waiting_for_prepare";
}

function normalizeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function countSpecifiedMeals(day = {}) {
  const materializedCount = Array.isArray(day.materializedMeals) ? day.materializedMeals.filter(Boolean).length : 0;
  if (materializedCount > 0) return materializedCount;

  const completeSlotCount = Array.isArray(day.mealSlots)
    ? day.mealSlots.filter((slot) => slot && slot.status === "complete").length
    : 0;
  if (completeSlotCount > 0) return completeSlotCount;

  const planningCount = normalizeCount(day?.planningMeta?.selectedTotalMealCount);
  if (planningCount > 0) return planningCount;

  const baseCount = Array.isArray(day.selections) ? day.selections.filter(Boolean).length : 0;
  const premiumCount = Array.isArray(day.premiumSelections) ? day.premiumSelections.filter(Boolean).length : 0;
  return baseCount + premiumCount;
}

function resolveRequiredMealCount(subscription = null, day = {}) {
  if (subscription) {
    const resolved = normalizeCount(resolveMealsPerDay(subscription));
    if (resolved > 0) return resolved;
  }

  const plannerRequired = normalizeCount(day?.plannerMeta?.requiredSlotCount);
  if (plannerRequired > 0) return plannerRequired;

  return normalizeCount(day?.planningMeta?.requiredMealCount);
}

function buildBaseState({
  day = {},
  subscription = null,
  derivedState = null,
  today = dateUtils.getTodayKSADate(),
} = {}) {
  const date = String(day?.date || "");
  const requiredMealCount = resolveRequiredMealCount(subscription, day);
  const specifiedMealCount = Math.min(countSpecifiedMeals(day), requiredMealCount || countSpecifiedMeals(day));
  const unspecifiedMealCount = Math.max(requiredMealCount - specifiedMealCount, 0);
  const hasCustomerSelections = specifiedMealCount > 0;
  const status = String(day?.status || "open");
  const paymentRequirement = derivedState?.paymentRequirement
    || (day?.paymentRequirement && typeof day.paymentRequirement === "object" ? day.paymentRequirement : null);
  const commercialState = derivedState?.commercialState || day?.commercialState || null;
  const isFulfillable = derivedState?.isFulfillable === undefined
    ? Boolean(day?.isFulfillable)
    : Boolean(derivedState?.isFulfillable);

  const isSkipped = status === "skipped";
  const isFrozen = status === "frozen";
  const isPickupNoShow = status === "no_show" || Boolean(day?.pickupNoShowAt);
  const isConsumedWithoutPreparation = status === "consumed_without_preparation";
  const isConsumed = status === "fulfilled" || Boolean(day?.fulfilledAt);
  const isTerminalNoService = TERMINAL_NO_SERVICE_STATUSES.has(status);
  const isDueToday = Boolean(date) && date === today;
  const isFutureDay = Boolean(date) && date > today;
  const isOperationallyActive = !isSkipped && !isFrozen && !isTerminalNoService && requiredMealCount > 0;

  let fulfillmentMode = "no_service";
  if (isSkipped) {
    fulfillmentMode = "skipped";
  } else if (isFrozen) {
    fulfillmentMode = "frozen";
  } else if (isConsumedWithoutPreparation) {
    fulfillmentMode = "pickup_day_ended_unprepared";
  } else if (hasCustomerSelections) {
    fulfillmentMode = "customer_selected";
  } else if (isOperationallyActive && isDueToday) {
    fulfillmentMode = "quantity_only";
  }

  let consumptionState = "pending_day";
  if (isSkipped) {
    consumptionState = "skipped";
  } else if (isFrozen) {
    consumptionState = "frozen";
  } else if (isPickupNoShow) {
    consumptionState = "pickup_no_show_consumed";
  } else if (isConsumedWithoutPreparation) {
    consumptionState = "consumed_without_preparation";
  } else if (isConsumed) {
    consumptionState = "consumed";
  } else if (isDueToday && isOperationallyActive) {
    consumptionState = "consumable_today";
  } else if (!isFutureDay && Boolean(day?.creditsDeducted)) {
    consumptionState = "consumed";
  }

  const planningReady = ["ready_to_confirm", "confirmed"].includes(String(commercialState || ""))
    && (!paymentRequirement || paymentRequirement.requiresPayment === false);

  const fulfillmentReady = Boolean(
    consumptionState === "consumable_today"
      && isOperationallyActive
      && (
        fulfillmentMode === "quantity_only"
          || (fulfillmentMode === "customer_selected" && isFulfillable)
      )
  );

  return {
    pickupRequested: Boolean(day?.pickupRequested),
    pickupPrepared: derivePickupPrepared(day),
    pickupPreparationFlowStatus: derivePickupPreparationFlowStatus(day),
    dayEndConsumptionReason: day?.dayEndConsumptionReason || null,
    fulfillmentMode,
    consumptionState,
    requiredMealCount,
    specifiedMealCount,
    unspecifiedMealCount,
    hasCustomerSelections,
    requiresMealTypeKnowledge: hasCustomerSelections,
    mealTypesSpecified: hasCustomerSelections,
    planningReady,
    fulfillmentReady,
  };
}

function buildSubscriptionDayFulfillmentState(input = {}) {
  return buildBaseState(input);
}

function applySubscriptionDayFulfillmentState(input = {}) {
  const { day = {} } = input;
  return {
    ...day,
    ...buildBaseState(input),
  };
}

module.exports = {
  applySubscriptionDayFulfillmentState,
  buildSubscriptionDayFulfillmentState,
  countSpecifiedMeals,
  resolveRequiredMealCount,
};
