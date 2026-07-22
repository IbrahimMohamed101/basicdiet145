"use strict";

const displayService = require("./subscription/mealComponentDisplayService");

const INSTALL_KEY = Symbol.for("basicdiet.mealComponentGramsPresentation.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.mealComponentGramsPresentation.wrapped");

function copyFunctionProperties(source, target) {
  for (const key of Reflect.ownKeys(source)) {
    if (["name", "length", "prototype", "arguments", "caller"].includes(String(key))) continue;
    if (key === WRAPPED_KEY) continue;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (descriptor) Object.defineProperty(target, key, descriptor);
    } catch (_error) {
      // Function metadata is best-effort. Runtime behavior remains authoritative.
    }
  }
}

function wrapSync(moduleObject, methodName, decorate, marker, prepareArgs = null) {
  const original = moduleObject && moduleObject[methodName];
  if (typeof original !== "function") {
    const error = new Error(`Missing presentation function: ${methodName}`);
    error.code = "MEAL_COMPONENT_PRESENTATION_INSTALL_FAILED";
    throw error;
  }
  if (original[WRAPPED_KEY]) return original;

  const wrapped = function gramsAwarePresentation(...args) {
    const callArgs = typeof prepareArgs === "function" ? prepareArgs(args) : args;
    const result = original.apply(this, callArgs);
    return decorate(result, callArgs);
  };
  copyFunctionProperties(original, wrapped);
  Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
  Object.defineProperty(wrapped, marker, { value: true });
  Object.defineProperty(wrapped, "__mealComponentPresentationOriginal", { value: original });
  moduleObject[methodName] = wrapped;
  return wrapped;
}

function withCarbAliases(slot = {}) {
  if (!slot || typeof slot !== "object" || Array.isArray(slot)) return slot;
  const directCarbs = Array.isArray(slot.carbs) ? slot.carbs : [];
  const directSelections = Array.isArray(slot.carbSelections) ? slot.carbSelections : [];
  const effective = directCarbs.length > 0 ? directCarbs : directSelections;
  if (!effective.length) return slot;
  return {
    ...slot,
    carbs: directCarbs.length > 0 ? directCarbs : effective,
    carbSelections: directSelections.length > 0 ? directSelections : effective,
  };
}

function prepareDay(day = {}) {
  if (!day || typeof day !== "object" || Array.isArray(day)) return day;
  const prepared = {
    ...day,
    mealSlots: Array.isArray(day.mealSlots)
      ? day.mealSlots.map(withCarbAliases)
      : day.mealSlots,
  };
  for (const key of ["lockedSnapshot", "fulfilledSnapshot"]) {
    const snapshot = day[key];
    if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
      prepared[key] = {
        ...snapshot,
        mealSlots: Array.isArray(snapshot.mealSlots)
          ? snapshot.mealSlots.map(withCarbAliases)
          : snapshot.mealSlots,
      };
    }
  }
  return prepared;
}

function prepareTimeline(timeline = {}) {
  if (!timeline || typeof timeline !== "object" || Array.isArray(timeline)) return timeline;
  return {
    ...timeline,
    days: Array.isArray(timeline.days) ? timeline.days.map(prepareDay) : timeline.days,
  };
}

function prepareSerializeArgs(args) {
  return [args[0], prepareDay(args[1]), ...args.slice(2)];
}

function prepareShapeArgs(args) {
  const options = args[0] && typeof args[0] === "object" ? args[0] : {};
  return [{ ...options, day: prepareDay(options.day) }, ...args.slice(1)];
}

function prepareDayLocalizationArgs(args) {
  return [prepareDay(args[0]), ...args.slice(1)];
}

function prepareTimelineLocalizationArgs(args) {
  return [prepareTimeline(args[0]), ...args.slice(1)];
}

function decorateKitchenDetails(result) {
  if (!result || typeof result !== "object") return result;
  return {
    ...result,
    mealSlots: Array.isArray(result.mealSlots)
      ? result.mealSlots.map((slot) => displayService.decorateMealSlot(withCarbAliases(slot)))
      : result.mealSlots,
  };
}

function decorateKitchenCard(result, args) {
  if (!result || typeof result !== "object") return result;
  const slot = args && args[1] && typeof args[1] === "object" ? withCarbAliases(args[1]) : {};
  const decoratedSlot = displayService.decorateMealSlot(slot);
  const title = decoratedSlot.canonicalTitleI18n;
  if (!title || (!title.ar && !title.en)) return result;
  return {
    ...result,
    title: title.ar || title.en || result.title,
    titleI18n: title,
  };
}

function installPickupPresentation() {
  const presentation = require("./subscription/pickupCanonicalPresentationService");
  wrapSync(
    presentation,
    "normalizePickupItem",
    (result) => displayService.decoratePickupItem(result),
    "__gramsAwareMealPresentation"
  );
  wrapSync(
    presentation,
    "normalizeAvailability",
    (result) => displayService.decoratePickupAvailability(result),
    "__gramsAwareMealPresentation"
  );
  wrapSync(
    presentation,
    "pickupItemToKitchenSlot",
    (result) => displayService.decorateMealSlot(withCarbAliases(result)),
    "__gramsAwareMealPresentation"
  );
  wrapSync(
    presentation,
    "buildCanonicalKitchenDetails",
    (result) => decorateKitchenDetails(result),
    "__gramsAwareMealPresentation"
  );
  wrapSync(
    presentation,
    "normalizeKitchenCard",
    decorateKitchenCard,
    "__gramsAwareMealPresentation"
  );
  return presentation;
}

function installDayReadPresentation() {
  const support = require("./subscription/subscriptionClientSupportService");
  wrapSync(
    support,
    "serializeSubscriptionDayForClient",
    (result) => displayService.decorateDayMealDisplay(prepareDay(result)),
    "__gramsAwareMealPresentation",
    prepareSerializeArgs
  );
  wrapSync(
    support,
    "shapeMealPlannerReadFields",
    (result) => displayService.decorateDayMealDisplay(prepareDay(result)),
    "__gramsAwareMealPresentation",
    prepareShapeArgs
  );

  const writeLocalization = require("../utils/subscription/subscriptionWriteLocalization");
  wrapSync(
    writeLocalization,
    "localizeWriteDayPayload",
    (result) => displayService.decorateDayMealDisplay(prepareDay(result)),
    "__gramsAwareMealPresentation",
    prepareDayLocalizationArgs
  );

  const readLocalization = require("../utils/subscription/subscriptionReadLocalization");
  wrapSync(
    readLocalization,
    "localizeSubscriptionDayReadPayload",
    (result) => displayService.decorateDayMealDisplay(prepareDay(result)),
    "__gramsAwareMealPresentation",
    prepareDayLocalizationArgs
  );
  wrapSync(
    readLocalization,
    "localizeTimelineReadPayload",
    (result) => displayService.decorateTimelineMealDisplay(prepareTimeline(result)),
    "__gramsAwareMealPresentation",
    prepareTimelineLocalizationArgs
  );

  return { support, writeLocalization, readLocalization };
}

function installMealComponentGramsPresentation() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const pickupPresentation = installPickupPresentation();
  const dayPresentation = installDayReadPresentation();
  const state = {
    installed: true,
    pickupPresentation,
    dayPresentation,
  };
  globalThis[INSTALL_KEY] = state;
  return state;
}

installMealComponentGramsPresentation();

module.exports = {
  INSTALL_KEY,
  WRAPPED_KEY,
  installMealComponentGramsPresentation,
  prepareDay,
  prepareTimeline,
  withCarbAliases,
};
