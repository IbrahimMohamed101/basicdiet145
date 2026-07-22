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

function wrapSync(moduleObject, methodName, decorate, marker) {
  const original = moduleObject && moduleObject[methodName];
  if (typeof original !== "function") {
    const error = new Error(`Missing presentation function: ${methodName}`);
    error.code = "MEAL_COMPONENT_PRESENTATION_INSTALL_FAILED";
    throw error;
  }
  if (original[WRAPPED_KEY]) return original;

  const wrapped = function gramsAwarePresentation(...args) {
    const result = original.apply(this, args);
    return decorate(result, args);
  };
  copyFunctionProperties(original, wrapped);
  Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
  Object.defineProperty(wrapped, marker, { value: true });
  Object.defineProperty(wrapped, "__mealComponentPresentationOriginal", { value: original });
  moduleObject[methodName] = wrapped;
  return wrapped;
}

function decorateKitchenDetails(result) {
  if (!result || typeof result !== "object") return result;
  return {
    ...result,
    mealSlots: Array.isArray(result.mealSlots)
      ? result.mealSlots.map(displayService.decorateMealSlot)
      : result.mealSlots,
  };
}

function decorateKitchenCard(result, args) {
  if (!result || typeof result !== "object") return result;
  const slot = args && args[1] && typeof args[1] === "object" ? args[1] : {};
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
    (result) => displayService.decorateMealSlot(result),
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
    (result) => displayService.decorateDayMealDisplay(result),
    "__gramsAwareMealPresentation"
  );
  wrapSync(
    support,
    "shapeMealPlannerReadFields",
    (result) => displayService.decorateDayMealDisplay(result),
    "__gramsAwareMealPresentation"
  );

  const writeLocalization = require("../utils/subscription/subscriptionWriteLocalization");
  wrapSync(
    writeLocalization,
    "localizeWriteDayPayload",
    (result) => displayService.decorateDayMealDisplay(result),
    "__gramsAwareMealPresentation"
  );

  const readLocalization = require("../utils/subscription/subscriptionReadLocalization");
  wrapSync(
    readLocalization,
    "localizeSubscriptionDayReadPayload",
    (result) => displayService.decorateDayMealDisplay(result),
    "__gramsAwareMealPresentation"
  );
  wrapSync(
    readLocalization,
    "localizeTimelineReadPayload",
    (result) => displayService.decorateTimelineMealDisplay(result),
    "__gramsAwareMealPresentation"
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
};
