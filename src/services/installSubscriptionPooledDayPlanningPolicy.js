"use strict";

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionPooledDayPlanningPolicy.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionPooledDayPlanningPolicy.wrapped");
const COUNT_LIMIT_CODES = new Set([
  "MEAL_SLOT_COUNT_EXCEEDED",
  "COMPLETE_SLOT_COUNT_EXCEEDED",
  "SLOT_COUNT_EXCEEDED",
]);
const COMMITTED_ALLOCATION_STATES = new Set(["reserved", "consumed", "forfeited"]);
const LEGACY_COMMITTED_DAY_STATUSES = new Set([
  "locked",
  "in_preparation",
  "ready_for_pickup",
  "ready_for_delivery",
  "out_for_delivery",
  "fulfilled",
  "consumed_without_preparation",
  "no_show",
]);

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function completeMealSlotCount(day) {
  return (Array.isArray(day && day.mealSlots) ? day.mealSlots : []).filter(
    (slot) => slot && String(slot.status || "complete") === "complete"
  ).length;
}

function committedDayMealCount(subscription, day) {
  if (!subscription || !day) return 0;
  const dayId = clean(day._id);
  const date = clean(day.date);
  const seen = new Set();

  for (const allocation of Array.isArray(subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : []) {
    if (!allocation || !COMMITTED_ALLOCATION_STATES.has(clean(allocation.state))) continue;
    const matchesDay = (dayId && clean(allocation.dayId) === dayId)
      || (!dayId && date && clean(allocation.date) === date);
    if (!matchesDay) continue;
    const identity = clean(allocation.allocationKey)
      || `${clean(allocation.date)}:${clean(allocation.slotKey)}`;
    if (identity) seen.add(identity);
  }

  if (seen.size > 0) return seen.size;

  const fulfilledCount = nonNegativeInteger(
    day.fulfilledSnapshot && day.fulfilledSnapshot.deductedCredits,
    0
  );
  if (fulfilledCount > 0) return fulfilledCount;
  if (day.creditsDeducted === true || LEGACY_COMMITTED_DAY_STATUSES.has(clean(day.status))) {
    return completeMealSlotCount(day);
  }
  return 0;
}

function buildDayPooledMealBalance({ subscription, day, businessDate = null, buildMealBalance }) {
  if (!subscription || typeof buildMealBalance !== "function") return undefined;
  const effectiveDate = clean(day && day.date) || clean(businessDate);
  const base = buildMealBalance(subscription, effectiveDate);
  if (!base || typeof base !== "object") return base;

  const committedMealsForDay = committedDayMealCount(subscription, day);
  const remainingMeals = nonNegativeInteger(base.remainingMeals, 0);
  const totalMeals = nonNegativeInteger(base.totalMeals, remainingMeals + committedMealsForDay);
  const maximumTotalMealsForDay = Math.min(
    totalMeals || remainingMeals + committedMealsForDay,
    remainingMeals + committedMealsForDay
  );

  return {
    ...base,
    maxConsumableMealsNow: Math.max(0, maximumTotalMealsForDay),
    dailyMealLimitEnforced: false,
    existingCommittedMealsForDay: committedMealsForDay,
    maximumAdditionalMealsNow: remainingMeals,
  };
}

function resolvePooledPlannerMax({ subscription, maxSlotCount = null } = {}) {
  const supplied = Number(maxSlotCount);
  const suppliedMax = Number.isFinite(supplied) ? Math.max(0, Math.floor(supplied)) : 0;
  const totalMeals = nonNegativeInteger(subscription && subscription.totalMeals, 0);
  const remainingMeals = nonNegativeInteger(subscription && subscription.remainingMeals, 0);
  return Math.max(suppliedMax, totalMeals || remainingMeals);
}

function normalizePlannerLimitResult(result) {
  if (!result || result.valid !== false) return result;
  const code = clean(result.errorCode).toUpperCase();
  const hasCountError = COUNT_LIMIT_CODES.has(code)
    || (Array.isArray(result.slotErrors) && result.slotErrors.some(
      (entry) => COUNT_LIMIT_CODES.has(clean(entry && entry.code).toUpperCase())
    ));
  if (!hasCountError) return result;

  return {
    ...result,
    errorCode: "MEAL_PLANNING_LIMIT_EXCEEDED",
    errorMessage: "Planned meals exceed the remaining subscription meal allowance",
    slotErrors: Array.isArray(result.slotErrors)
      ? result.slotErrors.map((entry) => COUNT_LIMIT_CODES.has(clean(entry && entry.code).toUpperCase())
        ? {
          ...entry,
          originalCode: entry.code,
          code: "MEAL_PLANNING_LIMIT_EXCEEDED",
          message: "Planned meals exceed the remaining subscription meal allowance",
        }
        : entry)
      : result.slotErrors,
  };
}

function wrapExport(target, name, factory) {
  const original = target && target[name];
  if (typeof original !== "function" || original[WRAPPED_KEY]) return original;
  const wrapped = factory(original);
  Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
  Object.defineProperty(wrapped, "__original", { value: original });
  target[name] = wrapped;
  return wrapped;
}

function patchClientDayBalance() {
  const support = require("./subscription/subscriptionClientSupportService");
  wrapExport(support, "shapeMealPlannerReadFields", (original) => function pooledDayRead(args = {}) {
    const shaped = original(args);
    if (!shaped || !args.subscription) return shaped;
    return {
      ...shaped,
      mealBalance: buildDayPooledMealBalance({
        subscription: args.subscription,
        day: args.day || shaped,
        businessDate: args.businessDate,
        buildMealBalance: support.buildMealBalance,
      }),
    };
  });
  support.shapeMealPlannerReadFields.__pooledDayBalance = true;
}

function patchPlannerValidators() {
  const legacyPlanner = require("./subscription/mealSlotPlannerService");

  wrapExport(legacyPlanner, "buildMealSlotDraft", (original) => async function pooledLegacyDraft(args = {}) {
    const result = await original({
      ...args,
      maxSlotCount: resolvePooledPlannerMax(args),
    });
    return normalizePlannerLimitResult(result);
  });
  legacyPlanner.buildMealSlotDraft.__pooledDayBalance = true;

  wrapExport(legacyPlanner, "recomputePlannerMetaFromSlots", (original) => function pooledRecompute(args = {}) {
    const mealSlots = Array.isArray(args.mealSlots) ? args.mealSlots : [];
    const supplied = Number(args.maxSlotCount);
    const maxSlotCount = Math.max(
      Number.isFinite(supplied) ? Math.max(0, Math.floor(supplied)) : 0,
      mealSlots.length
    );
    return original({ ...args, maxSlotCount });
  });
  legacyPlanner.recomputePlannerMetaFromSlots.__pooledDayBalance = true;

  const canonicalPlanner = require("./subscription/canonicalMealSlotPlannerService");
  wrapExport(canonicalPlanner, "validateCanonicalMealSlots", (original) => async function pooledCanonicalDraft(args = {}) {
    const result = await original({
      ...args,
      maxSlotCount: resolvePooledPlannerMax(args),
    });
    return normalizePlannerLimitResult(result);
  });
  canonicalPlanner.validateCanonicalMealSlots.__pooledDayBalance = true;
}

function installSubscriptionPooledDayPlanningPolicy() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];
  patchClientDayBalance();
  patchPlannerValidators();
  const state = Object.freeze({
    installed: true,
    installedAt: new Date(),
    flutterRepositoryChanged: false,
    policy: "TOTAL_BALANCE_WITHIN_VALIDITY",
  });
  globalThis[INSTALL_KEY] = state;
  return state;
}

installSubscriptionPooledDayPlanningPolicy();

module.exports = {
  COUNT_LIMIT_CODES,
  INSTALL_KEY,
  buildDayPooledMealBalance,
  committedDayMealCount,
  installSubscriptionPooledDayPlanningPolicy,
  normalizePlannerLimitResult,
  resolvePooledPlannerMax,
};
