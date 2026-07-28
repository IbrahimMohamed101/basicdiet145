"use strict";

const subscriptionController = require("../controllers/subscriptionController");
const subscriptionQuoteService = require("./subscription/subscriptionQuoteService");

const STATE_KEY = Symbol.for(
  "basicdiet.subscriptionQuoteControllerComposition.state"
);
const WRAPPED_KEY = Symbol.for(
  "basicdiet.subscriptionQuoteControllerComposition.wrapped"
);

function currentQuoteResolver(...args) {
  return subscriptionQuoteService.resolveCheckoutQuoteOrThrow(...args);
}

function buildDynamicQuoteRuntime(runtimeOverrides = null) {
  const runtime =
    runtimeOverrides
    && typeof runtimeOverrides === "object"
    && !Array.isArray(runtimeOverrides)
      ? { ...runtimeOverrides }
      : {};

  if (typeof runtime.resolveCheckoutQuoteOrThrow !== "function") {
    runtime.resolveCheckoutQuoteOrThrow = currentQuoteResolver;
  }

  return runtime;
}

function wrapControllerHandler(methodName) {
  const original = subscriptionController[methodName];
  if (typeof original !== "function") {
    throw new Error(`subscriptionController.${methodName} is unavailable`);
  }
  if (original[WRAPPED_KEY]) return original;

  const wrapped = function subscriptionQuoteComposedControllerHandler(
    req,
    res,
    runtimeOverrides
  ) {
    return original.call(
      this,
      req,
      res,
      buildDynamicQuoteRuntime(runtimeOverrides)
    );
  };

  Object.defineProperty(wrapped, WRAPPED_KEY, {
    value: true,
    configurable: false,
  });
  Object.defineProperty(wrapped, "__subscriptionQuoteControllerComposition", {
    value: true,
    configurable: false,
  });
  Object.defineProperty(wrapped, "__original", {
    value: original,
    configurable: false,
  });

  subscriptionController[methodName] = wrapped;
  return wrapped;
}

function installSubscriptionQuoteControllerComposition() {
  const existing = globalThis[STATE_KEY];
  if (existing && existing.installed) return existing;

  // A controller may be loaded by a circular dependency before the quote
  // decorators finish. Keep its public resolver view bound to the final service
  // export instead of the function captured during module evaluation. The setter
  // keeps later, legitimate decorators (for example dashboard promo support)
  // compatible with the same live service boundary.
  Object.defineProperty(
    subscriptionController,
    "resolveCheckoutQuoteOrThrow",
    {
      configurable: true,
      enumerable: true,
      get() {
        return subscriptionQuoteService.resolveCheckoutQuoteOrThrow;
      },
      set(nextResolver) {
        if (typeof nextResolver !== "function") {
          throw new TypeError(
            "subscriptionController.resolveCheckoutQuoteOrThrow must be a function"
          );
        }
        subscriptionQuoteService.resolveCheckoutQuoteOrThrow = nextResolver;
      },
    }
  );

  const quoteSubscription = wrapControllerHandler("quoteSubscription");
  const checkoutSubscription = wrapControllerHandler("checkoutSubscription");

  const state = Object.freeze({
    installed: true,
    quoteSubscription,
    checkoutSubscription,
    dynamicResolver: true,
  });
  globalThis[STATE_KEY] = state;
  return state;
}

installSubscriptionQuoteControllerComposition();

module.exports = {
  STATE_KEY,
  WRAPPED_KEY,
  buildDynamicQuoteRuntime,
  currentQuoteResolver,
  installSubscriptionQuoteControllerComposition,
  wrapControllerHandler,
};
