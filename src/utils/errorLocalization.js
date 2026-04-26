const { getRequestLang, t } = require("./i18n");

const ERROR_MESSAGE_KEY_BY_LITERAL = {
  "Unexpected error": "errors.common.unexpectedError",
  "Forbidden": "errors.common.forbidden",
  "Invalid state transition": "errors.common.invalidStateTransition",
  "Subscription not found": "errors.subscription.notFound",
  "Subscription not active": "errors.subscription.inactive",
  "Subscription expired": "errors.subscription.expired",
  "Subscription has no base end date": "errors.subscription.baseEndDateMissing",
  "Day not found": "errors.subscription.dayNotFound",
  "Day is locked": "errors.subscription.dayLocked",
  "Delivery mode is not pickup": "errors.subscription.pickupModeRequired",
  "Pickup can only be prepared for the current business day":
    "errors.subscription.pickupCurrentBusinessDayOnly",
  "Day already locked": "errors.subscription.pickupDayAlreadyLocked",
  "Pickup prepare failed": "errors.subscription.pickupPrepareFailed",
  "Failed to get pickup status": "errors.subscription.pickupStatusFailed",
  "Day is frozen": "errors.subscription.dayFrozen",
  "Day is not skipped": "errors.subscription.dayNotSkipped",
  "Skipped day has no deducted credits to restore": "errors.subscription.skippedDayNoDeductedCredits",
  "Cannot unskip a processed day": "errors.subscription.cannotUnskipProcessedDay",
  "Cannot restore credits for this skipped day": "errors.subscription.restoreCreditsImpossible",
  "You have reached your maximum allowed skip days": "errors.subscription.skipLimitReached",
  "Skip is disabled for this plan": "errors.subscription.skipDisabled",
  "daysToSkip must be an integer >= 0": "errors.subscription.invalidSkipDays",
  "Freeze is disabled for this plan": "errors.subscription.freezeDisabled",
  "Freeze failed": "errors.subscription.freezeFailed",
  "Freeze subscription failed": "errors.subscription.freezeFailed",
  "Unfreeze failed": "errors.subscription.unfreezeFailed",
  "Unfreeze subscription failed": "errors.subscription.unfreezeFailed",
  "Skip failed": "errors.subscription.skipFailed",
  "Skip range failed": "errors.subscription.skipRangeFailed",
  "Selection failed": "errors.subscription.selectionFailed",
  "Selections exceed meals per day": "errors.subscription.selectionsExceedMealsPerDay",
  "Selected grams option is not available": "errors.checkout.gramsOptionUnavailable",
  "Selected mealsPerDay option is not available": "errors.checkout.mealsOptionUnavailable",
  "Plan price is invalid": "errors.checkout.planPriceInvalid",
  "Canonical day planning is not enabled for this subscription": "errors.planning.disabled",
  "Day must contain exactly mealsPerDay total meal selections before confirmation": "errors.planning.incomplete",
  "Day planning must be confirmed before execution": "errors.planning.unconfirmed",
  "Premium payment is required before confirmation": "errors.planning.premiumPaymentRequired",
  "Premium overage payment is required before confirmation": "errors.planning.premiumOverageRequired",
  "One-time add-on payment is required before confirmation": "errors.planning.oneTimeAddonRequired",
  "One-time add-ons may include at most one item per category": "errors.addon.oneTimeCategoryConflict",
  "Recurring add-ons may include at most one item per category": "errors.addon.recurringCategoryConflict",
  "Checkout draft not found": "errors.checkout.draftNotFound",
  "Checkout failed": "errors.checkout.failed",
  "Subscription checkout failed": "errors.checkout.failed",
  "Checkout verification failed": "errors.checkout.verificationFailed",
  "Subscription checkout verification failed": "errors.checkout.verificationFailed",
  "Checkout initialization is still in progress. Retry with the same idempotency key.": "errors.checkout.initializationInProgress",
  "Checkout payment is not initialized yet": "errors.checkout.paymentNotInitialized",
  "Checkout invoice is not initialized yet": "errors.checkout.invoiceNotInitialized",
  "Payment does not belong to a subscription checkout": "errors.checkout.invalidPaymentType",
  "Payment not found": "errors.payment.notFound",
  "Top-up payment not found": "errors.payment.topUpNotFound",
  "Top-up invoice is not initialized yet": "errors.payment.topUpInvoiceNotInitialized",
  "Top-up verification failed": "errors.payment.topUpVerificationFailed",
  "Failed to fetch payment status from provider": "errors.payment.providerStatusFetchFailed",
  "Invoice not found at payment provider": "errors.payment.invoiceNotFoundAtProvider",
  "Unsupported provider payment status": "errors.payment.unsupportedProviderStatus",
  "Invoice ID mismatch": "errors.payment.invoiceIdMismatch",
  "Payment ID mismatch": "errors.payment.paymentIdMismatch",
  "Amount mismatch": "errors.payment.amountMismatch",
  "Currency mismatch": "errors.payment.currencyMismatch",
  "Premium overage payment is not enabled for this day": "errors.payment.premiumOverageNotSupported",
  "This day has no unpaid premium overage": "errors.payment.noPendingPremiumOverage",
  "This day premium overage is already paid": "errors.payment.premiumOverageAlreadyPaid",
  "Premium overage payment not found": "errors.payment.premiumOveragePaymentNotFound",
  "Payment day mismatch": "errors.payment.paymentDayMismatch",
  "Premium overage invoice is not initialized yet": "errors.payment.premiumOverageInvoiceNotInitialized",
  "Premium overage verification failed": "errors.payment.premiumOverageVerificationFailed",
  "One-time add-on payment is not enabled for this day": "errors.payment.oneTimeAddonNotSupported",
  "This day has no unpaid one-time add-ons": "errors.payment.noPendingOneTimeAddons",
  "This day one-time add-on selection is already paid": "errors.payment.oneTimeAddonAlreadyPaid",
  "One-time add-on payment not found": "errors.payment.oneTimeAddonPaymentNotFound",
  "One-time add-on invoice is not initialized yet": "errors.payment.oneTimeAddonInvoiceNotInitialized",
  "One-time add-on verification failed": "errors.payment.oneTimeAddonVerificationFailed",
  "Order not found": "errors.order.notFound",
  "Order is locked for edits": "errors.order.lockedForEdits",
  "Plan not found": "errors.plan.notFound",
  "Addon not found": "errors.addon.notFound",
  "Premium meal not found": "errors.premiumMeal.notFound",
  "Invalid date format": "errors.validation.invalidDateFormat",
  "Date cannot be in the past": "errors.validation.dateInPast",
  "Date must be from tomorrow onward": "errors.validation.dateFromTomorrowOnward",
  "Date outside subscription validity": "errors.validation.dateOutsideSubscriptionValidity",
  "Cutoff time passed for tomorrow": "errors.validation.cutoffPassedForTomorrow",
  "Invalid startDate": "errors.validation.invalidStartDate",
  "Invalid days count": "errors.validation.invalidDaysCount",
  "Invalid delivery window": "errors.validation.invalidDeliveryWindow",
  "Invalid pickup location": "errors.validation.invalidPickupLocation",
  "Missing delivery address": "errors.validation.missingDeliveryAddress",
  "Missing delivery update fields": "errors.validation.missingDeliveryUpdateFields",
  "delivery.type must be one of: delivery, pickup": "errors.validation.invalidDeliveryType",
  "Delivery zone is required for delivery subscriptions": "errors.validation.deliveryZoneRequired",
  "Delivery zone not found": "errors.validation.deliveryZoneNotFound",
  "Selected delivery zone is currently inactive for new subscriptions": "errors.validation.deliveryZoneInactive",
  "Invalid premium count": "errors.validation.invalidPremiumCount",
  "Missing addonId or date": "errors.validation.missingAddonIdOrDate",
  "premiumCount must match the total qty of premiumItems when both are provided": "errors.validation.premiumCountMismatch",
  "startDate must be from tomorrow onward": "errors.validation.startDateFromTomorrowOnward",
  "startDate must be today or a future date": "errors.validation.startDateFromTodayOnward",
  "Ingredients are required": "errors.ingredients.required",
  "Each ingredient must include ingredientId": "errors.ingredients.ingredientIdRequired",
  "One or more ingredients not found or inactive": "errors.ingredients.notFoundOrInactive",
  "oneTimeAddonSelections must be an array": "errors.validation.oneTimeAddonSelectionsArray",
  "idempotencyKey must be at most 128 characters": "errors.validation.idempotencyMaxLength",
  "idempotencyKey is required (Idempotency-Key header, X-Idempotency-Key header, or body.idempotencyKey)": "errors.validation.idempotencyRequired",
  "Missing token": "errors.auth.missingToken",
  "Invalid token": "errors.auth.invalidToken",
  "Invalid token type": "errors.auth.invalidTokenType",
  "Invalid token payload": "errors.auth.invalidTokenPayload",
  "User account is inactive": "errors.auth.inactiveUser",
  "Insufficient permissions": "errors.auth.insufficientPermissions",
  "Missing dashboard token": "errors.dashboardAuth.missingToken",
  "Missing dashboard role": "errors.dashboardAuth.missingRole",
  "Invalid dashboard token": "errors.dashboardAuth.invalidToken",
  "Invalid dashboard token type": "errors.dashboardAuth.invalidTokenType",
  "Invalid dashboard token payload": "errors.dashboardAuth.invalidTokenPayload",
  "Insufficient dashboard permissions": "errors.dashboardAuth.insufficientPermissions",
  "Too many requests": "errors.rateLimit.default",
  "Too many OTP requests": "errors.rateLimit.otp",
  "Too many OTP verification attempts": "errors.rateLimit.otpVerify",
  "Too many checkout attempts": "errors.rateLimit.checkout",
  "Too many dashboard login attempts": "errors.rateLimit.dashboardLogin",
  "Invalid webhook token": "errors.webhook.invalidToken",
  "Missing payment identifiers": "errors.webhook.missingPaymentIdentifiers",
  "Webhook processing failed": "errors.webhook.processingFailed",
  "Ignored non-paid status": "errors.webhook.ignoredNonPaidStatus",
  "Plan is no longer available": "errors.renewal.planUnavailable",
  "Selected grams option is no longer available": "errors.renewal.gramsOptionUnavailable",
  "Selected mealsPerDay option is no longer available": "errors.renewal.mealsOptionUnavailable",
  "Subscription does not have enough base configuration to renew": "errors.renewal.baseConfigurationInsufficient",
  "Renewal is not available for this subscription": "errors.renewal.unavailable",
  "Canonical contract is invalid for activation": "errors.activation.invalidContract",
  "Canonical contract payload is invalid for activation": "errors.activation.invalidContractPayload",
  "Draft does not contain an authoritative canonical contract": "errors.activation.draftMissingCanonicalContract",
  "Mock activation is disabled in production": "errors.activation.mockDisabled",
  "Failed to add custom meal": "errors.custom.customMealAddFailed",
  "Failed to add custom salad": "errors.custom.customSaladAddFailed",
  "Not enough credits": "errors.wallet.notEnoughCredits",
  "Not enough premium credits": "errors.wallet.notEnoughPremiumCredits",
  "Not enough addon credits": "errors.wallet.notEnoughAddonCredits",
};

const ERROR_MESSAGE_PATTERNS = [
  {
    regex: /^(?<fieldName>[A-Za-z0-9_]+) is not a valid id$/,
    key: "errors.validation.invalidObjectId",
  },
  {
    regex: /^(?<fieldName>[A-Za-z0-9_]+) must be a valid ObjectId$/,
    key: "errors.validation.invalidObjectId",
  },
  {
    regex: /^(?<fieldName>[A-Za-z0-9_]+) must be a positive integer$/,
    key: "errors.validation.positiveInteger",
  },
  {
    regex: /^(?<itemName>[A-Za-z0-9_]+) must be an array$/,
    key: "errors.validation.arrayRequired",
  },
  {
    regex: /^(?<itemName>[A-Za-z0-9_]+) must contain objects$/,
    key: "errors.validation.objectArrayRequired",
  },
  {
    regex: /^qty must be a positive integer for (?<itemName>.+)$/,
    key: "errors.validation.qtyPositiveIntegerForList",
  },
  {
    regex: /^Quantity exceeds max for ingredient (?<ingredientId>.+)$/,
    key: "errors.ingredients.maxExceeded",
  },
  {
    regex: /^One-time addon (?<addonId>.+) not found or inactive$/,
    key: "errors.addon.oneTimeNotFoundOrInactive",
  },
  {
    regex: /^Premium meal (?<itemId>.+) not found(?: or inactive)?$/,
    key: "errors.premiumMeal.notFoundById",
  },
  {
    regex: /^Premium meal (?<itemId>.+) has invalid price$/,
    key: "errors.premiumMeal.invalidPrice",
  },
  {
    regex: /^Addon (?<itemId>.+) not found(?: or inactive)?$/,
    key: "errors.addon.notFoundById",
  },
  {
    regex: /^Add-on (?<itemId>.+) pricing not found$/,
    key: "errors.addon.pricingNotFound",
  },
  {
    regex: /^Cannot shrink validity to (?<validityDate>\d{4}-\d{2}-\d{2}) because day (?<dayDate>\d{4}-\d{2}-\d{2}) has active data$/,
    key: "errors.subscription.validityShrinkConflict",
  },
];

function isTranslationKey(value) {
  return typeof value === "string" && value.startsWith("errors.");
}

function createLocalizedError({ code, key, params = {}, status, details, fallbackMessage }) {
  const error = new Error(fallbackMessage || key);
  error.code = code;
  if (status !== undefined) error.status = status;
  if (details !== undefined) error.details = details;
  error.messageKey = key;
  error.messageParams = params;
  error.fallbackMessage = fallbackMessage || "";
  return error;
}

function resolveErrorSource(input) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return {
      message: typeof input.message === "string" ? input.message : "",
      key: typeof input.messageKey === "string" ? input.messageKey : typeof input.key === "string" ? input.key : "",
      params:
        input.messageParams && typeof input.messageParams === "object"
          ? input.messageParams
          : input.params && typeof input.params === "object"
            ? input.params
            : {},
      fallbackMessage:
        typeof input.fallbackMessage === "string"
          ? input.fallbackMessage
          : typeof input.message === "string"
            ? input.message
            : "",
    };
  }

  return {
    message: typeof input === "string" ? input : "",
    key: isTranslationKey(input) ? input : "",
    params: {},
    fallbackMessage: typeof input === "string" ? input : "",
  };
}

function resolveMessageDescriptor(input) {
  const source = resolveErrorSource(input);

  if (source.key) {
    return {
      key: source.key,
      params: source.params,
      fallbackMessage: source.fallbackMessage || source.key,
    };
  }

  if (isTranslationKey(source.message)) {
    return {
      key: source.message,
      params: source.params,
      fallbackMessage: source.fallbackMessage || source.message,
    };
  }

  if (ERROR_MESSAGE_KEY_BY_LITERAL[source.message]) {
    return {
      key: ERROR_MESSAGE_KEY_BY_LITERAL[source.message],
      params: source.params,
      fallbackMessage: source.fallbackMessage || source.message,
    };
  }

  for (const matcher of ERROR_MESSAGE_PATTERNS) {
    const match = source.message.match(matcher.regex);
    if (!match) continue;
    return {
      key: matcher.key,
      params: { ...source.params, ...(match.groups || {}) },
      fallbackMessage: source.fallbackMessage || source.message,
    };
  }

  return {
    key: "",
    params: source.params,
    fallbackMessage: source.fallbackMessage || source.message,
  };
}

function localizeErrorMessage(input, reqOrLang) {
  const descriptor = resolveMessageDescriptor(input);
  if (!descriptor.key) return descriptor.fallbackMessage || "";

  const lang = typeof reqOrLang === "string" ? reqOrLang : getRequestLang(reqOrLang || {});
  return t(descriptor.key, lang, descriptor.params);
}

module.exports = {
  ERROR_MESSAGE_KEY_BY_LITERAL,
  createLocalizedError,
  localizeErrorMessage,
  resolveMessageDescriptor,
};
