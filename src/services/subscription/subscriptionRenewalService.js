const { createLocalizedError } = require("../../utils/errorLocalization");
const validateObjectId = require("../../utils/validateObjectId");
const Subscription = require("../../models/Subscription");
const dateUtils = require("../../utils/date");
const CheckoutDraft = require("../../models/CheckoutDraft");
const { RECONCILE_MODES, reconcileCheckoutDraft } = require("../../services/reconciliationService");
const {
  isPendingCheckoutReusable,
  buildCheckoutReusePayload,
  releaseCheckoutDraftIdempotencyKey,
  persistCheckoutInitializationFailure,
  isCheckoutDraftDuplicateKeyError,
} = require("./subscriptionCheckoutHelpers");
// Lazy require to break circular dependency with subscriptionController
function getSerializeSubscriptionForClient() {
  return require("../../controllers/subscriptionController").serializeSubscriptionForClient;
}
const { getInvoice } = require("../moyasarService");
const { logger } = require("../../utils/logger");
const { STALE_DRAFT_THRESHOLD_MS } = require("../../constants");
const { SYSTEM_CURRENCY, assertSystemCurrencyOrThrow } = require("../../utils/currency");
const { LEGACY_PREMIUM_WALLET_MODE } = require("../../constants");
const { buildRecurringAddonEntitlementsFromQuote } = require("../../services/recurringAddonService");
const { buildPaymentDescription } = require("../../utils/payment");
const { resolveProviderRedirectUrl } = require("../../utils/payment");
const { getInvoiceResponseId, getInvoiceResponseUrl } = require("../../utils/payment");
const { buildCheckoutRequestHash } = require("../../utils/checkout");
const { normalizeCheckoutDeliveryForPersistence } = require("../../utils/checkout");
const { isPhase1CanonicalCheckoutDraftWriteEnabled, isPhase2GenericPremiumWalletEnabled } = require("../../utils/featureFlags");
const { sliceBDefaultRuntime } = require("./runtime");
const { resolveSubscriptionCheckoutPaymentType } = require("../../utils/payment");
const { persistCheckoutDraftUpdate, ensureSubscriptionCheckoutPayment } = require("./subscriptionCheckoutHelpers");

function parseIdempotencyKey(rawValue) {
  if (rawValue === undefined || rawValue === null) return "";
  const value = String(rawValue).trim();
  if (!value) return "";
  if (value.length > 128) {
    const err = new Error("idempotencyKey must be at most 128 characters");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  return value;
}

function cloneValue(value) {
  if (!value || typeof value !== "object") return value || null;
  return JSON.parse(JSON.stringify(value));
}

function createRenewalError(key, code = "RENEWAL_UNAVAILABLE", fallbackMessage = key) {
  return createLocalizedError({
    code,
    key,
    fallbackMessage,
  });
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function extractSnapshotRenewalSeed(previousSubscription) {
  const snapshot = previousSubscription
    && previousSubscription.contractSnapshot
    && typeof previousSubscription.contractSnapshot === "object"
    ? previousSubscription.contractSnapshot
    : null;
  const plan = snapshot && snapshot.plan && typeof snapshot.plan === "object" ? snapshot.plan : null;
  const delivery = snapshot && snapshot.delivery && typeof snapshot.delivery === "object" ? snapshot.delivery : null;

  if (!plan) return null;

  const planId = plan.planId ? String(plan.planId) : "";
  const grams = Number(plan.selectedGrams || 0);
  const mealsPerDay = Number(plan.mealsPerDay || 0);
  const daysCount = Number(plan.daysCount || 0);

  if (!planId || !isPositiveInteger(grams) || !isPositiveInteger(mealsPerDay) || !isPositiveInteger(daysCount)) {
    return null;
  }

  return {
    seedSource: "snapshot",
    planId,
    grams,
    mealsPerDay,
    daysCount,
    deliveryPreference: {
      mode: delivery && delivery.mode ? String(delivery.mode) : null,
      address: cloneValue(delivery && delivery.address),
      slot: cloneValue(delivery && delivery.slot),
      pickupLocationId: delivery && delivery.pickupLocationId ? String(delivery.pickupLocationId) : null,
      zoneId: delivery && delivery.zoneId ? String(delivery.zoneId) : null,
      zoneName: delivery && delivery.zoneName ? String(delivery.zoneName) : "",
      seedOnly: true,
    },
  };
}

function extractLegacyRenewalSeed(previousSubscription) {
  if (!previousSubscription || typeof previousSubscription !== "object") {
    return null;
  }

  const planId = previousSubscription.planId ? String(previousSubscription.planId) : "";
  const grams = Number(previousSubscription.selectedGrams || 0);
  const mealsPerDay = Number(previousSubscription.selectedMealsPerDay || 0);
  const daysCount = Number(previousSubscription.totalMeals || 0) && mealsPerDay > 0
    ? Math.round(Number(previousSubscription.totalMeals || 0) / mealsPerDay)
    : 0;

  if (!planId || !isPositiveInteger(grams) || !isPositiveInteger(mealsPerDay) || !isPositiveInteger(daysCount)) {
    return null;
  }

  return {
    seedSource: "legacy",
    planId,
    grams,
    mealsPerDay,
    daysCount,
    deliveryPreference: {
      mode: previousSubscription.deliveryMode ? String(previousSubscription.deliveryMode) : null,
      address: cloneValue(previousSubscription.deliveryAddress),
      slot: cloneValue(previousSubscription.deliverySlot)
        || (previousSubscription.deliveryWindow
          ? {
            type: previousSubscription.deliveryMode || "delivery",
            window: String(previousSubscription.deliveryWindow || ""),
            slotId: "",
          }
          : null),
      pickupLocationId: previousSubscription.pickupLocationId ? String(previousSubscription.pickupLocationId) : null,
      zoneId: previousSubscription.deliveryZoneId ? String(previousSubscription.deliveryZoneId) : null,
      zoneName: previousSubscription.deliveryZoneName ? String(previousSubscription.deliveryZoneName) : "",
      seedOnly: true,
    },
  };
}

function resolveRenewalSeedSource(previousSubscription) {
  return extractSnapshotRenewalSeed(previousSubscription) || extractLegacyRenewalSeed(previousSubscription) || null;
}

function validateRenewablePlanOption({ plan, grams, mealsPerDay }) {
  if (!plan) {
    throw createRenewalError("errors.renewal.planUnavailable", "RENEWAL_UNAVAILABLE", "Plan is no longer available");
  }
  if (plan.isActive === false) {
    throw createRenewalError("errors.renewal.planUnavailable", "RENEWAL_UNAVAILABLE", "Plan is no longer available");
  }

  const gramsOptions = Array.isArray(plan.gramsOptions) ? plan.gramsOptions : [];
  const gramsOption = gramsOptions.find((item) => item && Number(item.grams) === Number(grams) && item.isActive !== false);
  if (!gramsOption) {
    throw createRenewalError(
      "errors.renewal.gramsOptionUnavailable",
      "RENEWAL_UNAVAILABLE",
      "Selected grams option is no longer available"
    );
  }

  const mealsOptions = Array.isArray(gramsOption.mealsOptions) ? gramsOption.mealsOptions : [];
  const mealsOption = mealsOptions.find(
    (item) => item && Number(item.mealsPerDay) === Number(mealsPerDay) && item.isActive !== false
  );
  if (!mealsOption) {
    throw createRenewalError(
      "errors.renewal.mealsOptionUnavailable",
      "RENEWAL_UNAVAILABLE",
      "Selected mealsPerDay option is no longer available"
    );
  }

  return {
    planId: String(plan._id),
    grams: Number(grams),
    mealsPerDay: Number(mealsPerDay),
    daysCount: Number(plan.daysCount || 0),
  };
}

function buildSubscriptionRenewalSeed({ previousSubscription, livePlan }) {
  const baseSeed = resolveRenewalSeedSource(previousSubscription);
  if (!baseSeed) {
    throw createRenewalError(
      "errors.renewal.baseConfigurationInsufficient",
      "RENEWAL_UNAVAILABLE",
      "Subscription does not have enough base configuration to renew"
    );
  }

  const validatedPlan = validateRenewablePlanOption({
    plan: livePlan,
    grams: baseSeed.grams,
    mealsPerDay: baseSeed.mealsPerDay,
  });

  return {
    subscriptionId: previousSubscription && previousSubscription._id ? String(previousSubscription._id) : null,
    seedSource: baseSeed.seedSource,
    renewable: true,
    seed: {
      planId: validatedPlan.planId,
      grams: validatedPlan.grams,
      mealsPerDay: validatedPlan.mealsPerDay,
      daysCount: validatedPlan.daysCount,
      deliveryPreference: baseSeed.deliveryPreference,
    },
  };
}

async function performSubscriptionRenewal(userId, subscriptionId, body, lang, runtimeOverrides = null) {
  const runtime = runtimeOverrides ? { ...sliceBDefaultRuntime(), ...runtimeOverrides } : sliceBDefaultRuntime();
  let draft;
  let requestHash = "";
  let renewalStage = "pre_draft";
  let providerInvoiceId = "";
  let paymentUrl = "";

  try {
    validateObjectId(subscriptionId, "subscriptionId");
  } catch (err) {
    throw { status: err.status, code: err.code, message: err.message };
  }

  const previousSubscription = await Subscription.findById(subscriptionId).lean();
  if (!previousSubscription) {
    throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
  }
  if (String(previousSubscription.userId) !== String(userId)) {
    throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };
  }

  // Verify subscription is eligible for renewal (either expired or in final stages)
  const today = dateUtils.getTodayKSADate();
  const endDate = previousSubscription.validityEndDate || previousSubscription.endDate;
  const endDateStr = endDate ? dateUtils.toKSADateString(endDate) : null;
  if (endDateStr && endDateStr > today) {
    throw { status: 422, code: "RENEWAL_PREMATURE", message: "Cannot renew an active subscription" };
  }

  // Extract renewal parameters from previous subscription or body
  const candidatePlanId = previousSubscription.contractSnapshot
    && previousSubscription.contractSnapshot.plan
    && previousSubscription.contractSnapshot.plan.planId
    ? previousSubscription.contractSnapshot.plan.planId
    : previousSubscription.planId;

  if (!candidatePlanId) {
    throw { status: 422, code: "RENEWAL_UNAVAILABLE", message: "Subscription does not have enough base configuration to renew" };
  }

  // Use previous parameters as defaults, allow overrides from body
  const renewalPayload = {
    planId: body.planId || candidatePlanId,
    grams: body.grams !== undefined ? body.grams : (previousSubscription.selectedGrams || 1000),
    mealsPerDay: body.mealsPerDay !== undefined ? body.mealsPerDay : (previousSubscription.selectedMealsPerDay || 1),
    premiumItems: body.premiumItems || [],
    addons: body.addons || [],
    delivery: {
      type: body.delivery && body.delivery.type ? body.delivery.type : (previousSubscription.deliveryMode || "delivery"),
      address: body.delivery && body.delivery.address ? body.delivery.address : (previousSubscription.deliveryAddress || null),
      slot: body.delivery && body.delivery.slot ? body.delivery.slot : (previousSubscription.deliverySlot || {}),
      zoneId: body.delivery && body.delivery.zoneId ? body.delivery.zoneId : (previousSubscription.deliveryZoneId || null),
      pickupLocationId: body.delivery && body.delivery.pickupLocationId ? body.delivery.pickupLocationId : null,
    },
    renewedFromSubscriptionId: subscriptionId,
    startDate: body.startDate || null,
    idempotencyKey: parseIdempotencyKey(
      body.idempotencyKey
    ),
  };

  if (!renewalPayload.idempotencyKey) {
    throw { status: 400, code: "VALIDATION_ERROR", message: "idempotencyKey is required (Idempotency-Key header, X-Idempotency-Key header, or body.idempotencyKey)" };
  }

  try {
    // Use same checkout quote resolver with renewal context
    const quote = await runtime.resolveCheckoutQuoteOrThrow(renewalPayload, {
      lang,
      useGenericPremiumWallet:
        isPhase2GenericPremiumWalletEnabled()
        && isPhase1CanonicalCheckoutDraftWriteEnabled(),
      enforceActivePlan: true,
    });
    const normalizedDelivery = normalizeCheckoutDeliveryForPersistence(quote.delivery);

    // Proceed with checkout (standard flow)
    if (isPhase1CanonicalCheckoutDraftWriteEnabled()) {
      const canonicalContract = runtime.buildPhase1SubscriptionContract({
        payload: renewalPayload,
        resolvedQuote: quote,
        actorContext: { actorRole: "client", actorUserId: userId },
        source: "renewal",
        now: new Date(),
      });
      renewalPayload.contractVersion = canonicalContract.contractVersion;
      renewalPayload.contractMode = canonicalContract.contractMode;
    }

    requestHash = buildCheckoutRequestHash({ userId, quote });
    const existingByKey = await CheckoutDraft.findOne({
      userId,
      idempotencyKey: renewalPayload.idempotencyKey,
    }).sort({ createdAt: -1 }).lean();

    if (existingByKey) {
      if (existingByKey.requestHash && existingByKey.requestHash !== requestHash) {
        throw {
          status: 409,
          code: "IDEMPOTENCY_CONFLICT",
          message: "idempotencyKey is already used with a different renewal payload"
        };
      }

      const { draft: reconciledDraft, payment: reconciledPayment } = await reconcileCheckoutDraft(existingByKey._id, {
        mode: RECONCILE_MODES.PERSIST,
      });
      const currentDraft = reconciledDraft || existingByKey;
      const currentPayment = reconciledPayment;

      if (isPendingCheckoutReusable(currentDraft, currentPayment)) {
        return { status: 200, data: buildCheckoutReusePayload(currentDraft, currentPayment) };
      }
      if (currentDraft.status === "completed" && currentDraft.subscriptionId) {
        const newSub = await Subscription.findById(currentDraft.subscriptionId).lean();
        return { status: 200, data: await getSerializeSubscriptionForClient()(newSub, lang) };
      }

      if (currentDraft.status === "pending_payment") {
        const isStale = (new Date() - new Date(currentDraft.createdAt)) > STALE_DRAFT_THRESHOLD_MS;
        if (isStale) {
          await CheckoutDraft.updateOne(
            { _id: currentDraft._id },
            { $set: { status: "failed", failureReason: "stale_abandoned", updatedAt: new Date() } }
          );
          currentDraft.status = "failed";
          currentDraft.failureReason = "stale_abandoned";
          await releaseCheckoutDraftIdempotencyKey(currentDraft, {
            stage: "renewal_existing_by_key_stale",
            failureReason: "stale_abandoned",
          });
        } else if (currentPayment && currentPayment.providerInvoiceId) {
          try {
            const invoice = await getInvoice(currentPayment.providerInvoiceId);
            const invoiceStatus = String(invoice && invoice.status || "").toLowerCase();

            if (invoiceStatus === "paid" || invoiceStatus === "captured") {
              return { status: 200, data: buildCheckoutReusePayload(currentDraft, currentPayment) };
            }

            if (["failed", "expired", "canceled"].includes(invoiceStatus)) {
              await CheckoutDraft.updateOne(
                { _id: currentDraft._id },
                { $set: { status: "failed", failureReason: `invoice_${invoiceStatus}`, updatedAt: new Date() } }
              );
              currentDraft.status = "failed";
              currentDraft.failureReason = `invoice_${invoiceStatus}`;
              await releaseCheckoutDraftIdempotencyKey(currentDraft, {
                stage: "renewal_existing_by_key_invoice_terminal",
                failureReason: `invoice_${invoiceStatus}`,
              });
            } else {
              throw {
                status: 409,
                code: "CHECKOUT_IN_PROGRESS",
                message: "Checkout initialization is still in progress. Retry with the same idempotency key.",
                data: { draftId: String(currentDraft._id) }
              };
            }
          } catch (err) {
            logger.warn("Failed to fetch renewal invoice status during checkout reconciliation", {
              draftId: String(currentDraft._id),
              error: err.message,
            });
            throw {
              status: 409,
              code: "CHECKOUT_IN_PROGRESS",
              message: "Checkout initialization is still in progress. Retry with the same idempotency key.",
              data: { draftId: String(currentDraft._id) }
            };
          }
        } else {
          throw {
            status: 409,
            code: "CHECKOUT_IN_PROGRESS",
            message: "Checkout initialization is still in progress. Retry with the same idempotency key.",
            data: { draftId: String(currentDraft._id) }
          };
        }
      } else if (["failed", "canceled", "expired"].includes(String(currentDraft.status || "").trim())) {
        await releaseCheckoutDraftIdempotencyKey(currentDraft, {
          stage: "renewal_existing_by_key_terminal_retry",
        });
      } else {
        throw {
          status: 409,
          code: "IDEMPOTENCY_CONFLICT",
          message: `idempotencyKey is already finalized with status ${currentDraft.status}`
        };
      }
    }

    // Create checkout draft - same as regular checkout
    const draftPayload = {
      userId,
      planId: quote.plan._id,
      idempotencyKey: renewalPayload.idempotencyKey,
      requestHash,
      daysCount: quote.plan.daysCount,
      grams: quote.grams,
      mealsPerDay: quote.mealsPerDay,
      startDate: quote.startDate || undefined,
      delivery: normalizedDelivery,
      premiumItems: quote.premiumItems.map((item) => ({
        premiumMealId: item.premiumMeal._id,
        qty: item.qty,
        unitExtraFeeHalala: item.unitExtraFeeHalala,
        currency: SYSTEM_CURRENCY,
      })),
      premiumWalletMode: quote.premiumWalletMode || LEGACY_PREMIUM_WALLET_MODE,
      premiumCount: Number(quote.premiumCount || 0),
      premiumUnitPriceHalala: Number(quote.premiumUnitPriceHalala || 0),
      addonItems: quote.addonItems.map((item) => ({
        addonId: item.addon._id,
        qty: item.qty,
        unitPriceHalala: item.unitPriceHalala,
        currency: SYSTEM_CURRENCY,
      })),
      addonSubscriptions: buildRecurringAddonEntitlementsFromQuote({ addonItems: quote.addonItems, lang }),
      breakdown: { ...quote.breakdown, currency: SYSTEM_CURRENCY },
      renewedFromSubscriptionId: subscriptionId,
    };

    if (isPhase1CanonicalCheckoutDraftWriteEnabled()) {
      const canonicalContract = runtime.buildPhase1SubscriptionContract({
        payload: renewalPayload,
        resolvedQuote: quote,
        actorContext: { actorRole: "client", actorUserId: userId },
        source: "renewal",
        now: new Date(),
      });
      Object.assign(draftPayload, runtime.buildCanonicalDraftPersistenceFields({ contract: canonicalContract }));
    }

    renewalStage = "draft_create";
    draft = await CheckoutDraft.create(draftPayload);

    const appUrl = process.env.APP_URL || "https://example.com";
    renewalStage = "invoice_create";
    logger.debug("[DEBUG-CHECKOUT] Calling renewal createInvoice", {
      draftId: String(draft._id),
      totalHalala: Number(quote && quote.breakdown && quote.breakdown.totalHalala || 0),
    });
    const invoice = await runtime.createInvoice({
      amount: quote.breakdown.totalHalala,
      description: buildPaymentDescription("subscriptionRenewal", lang, {
        daysCount: Number(quote.plan.daysCount || 0),
        previousSubscriptionId: subscriptionId,
      }),
      callbackUrl: `${appUrl}/api/webhooks/moyasar`,
      successUrl: resolveProviderRedirectUrl(body.successUrl, `${appUrl}/payments/success`),
      backUrl: resolveProviderRedirectUrl(body.backUrl, `${appUrl}/payments/cancel`),
      metadata: {
        type: "subscription_renewal",
        draftId: String(draft._id),
        userId: String(userId),
        renewedFromSubscriptionId: subscriptionId,
        grams: quote.grams,
        mealsPerDay: quote.mealsPerDay,
      },
    });

    providerInvoiceId = getInvoiceResponseId(invoice);
    paymentUrl = getInvoiceResponseUrl(invoice);
    logger.debug("[DEBUG-CHECKOUT] Renewal createInvoice returned", {
      draftId: String(draft._id),
      hasInvoiceId: Boolean(providerInvoiceId),
    });

    if (!providerInvoiceId || !paymentUrl) {
      const invalidInvoiceErr = new Error("Invoice response missing required payment fields");
      invalidInvoiceErr.code = "PAYMENT_PROVIDER_INVALID_RESPONSE";
      throw invalidInvoiceErr;
    }

    const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || SYSTEM_CURRENCY, "Invoice currency");
    const paymentPromise = ensureSubscriptionCheckoutPayment({
      draft,
      paymentType: resolveSubscriptionCheckoutPaymentType({ renewedFromSubscriptionId: subscriptionId }),
      totalHalala: quote.breakdown.totalHalala,
      invoiceCurrency,
      providerInvoiceId,
      paymentUrl,
    });

    renewalStage = "draft_invoice_persist";
    await persistCheckoutDraftUpdate(
      draft,
      {
        providerInvoiceId,
        paymentUrl,
        failureReason: "",
      },
      { stage: renewalStage }
    );

    renewalStage = "payment_create";
    logger.debug("[DEBUG-CHECKOUT] Creating renewal payment record", {
      draftId: String(draft._id),
    });
    const payment = await paymentPromise;

    renewalStage = "draft_payment_link_persist";
    await persistCheckoutDraftUpdate(
      draft,
      {
        paymentId: payment._id,
        providerInvoiceId,
        paymentUrl,
        failureReason: "",
      },
      { stage: renewalStage }
    );

    return {
      status: 201,
      data: {
        draftId: draft.id,
        paymentId: payment.id,
        payment_url: draft.paymentUrl,
        renewedFromSubscriptionId: subscriptionId,
        totals: quote.breakdown,
      },
    };
  } catch (err) {
    if (!draft && err.code === "VALIDATION_ERROR") {
      throw { status: 400, code: "VALIDATION_ERROR", message: err.message };
    }
    if (!draft && err.code === "NOT_FOUND") {
      throw { status: 404, code: "NOT_FOUND", message: err.message };
    }
    if (!draft && err.code === "INVALID_SELECTION") {
      throw { status: 400, code: "INVALID", message: err.message };
    }
    if (!draft && isCheckoutDraftDuplicateKeyError(err)) {
      let existingDraft = await CheckoutDraft.findOne({
        userId,
        idempotencyKey: renewalPayload.idempotencyKey,
      }).sort({ createdAt: -1 }).lean();

      if (!existingDraft && requestHash) {
        existingDraft = await CheckoutDraft.findOne({
          userId,
          requestHash,
          status: "pending_payment",
        }).sort({ createdAt: -1 }).lean();
      }

      if (existingDraft) {
        const { draft: reconciledDraft, payment: reconciledPayment } = await reconcileCheckoutDraft(existingDraft._id, {
          mode: RECONCILE_MODES.PERSIST,
        });
        const currentDraft = reconciledDraft || existingDraft;
        const currentPayment = reconciledPayment;

        if (isPendingCheckoutReusable(currentDraft, currentPayment)) {
          return { status: 200, data: buildCheckoutReusePayload(currentDraft, currentPayment) };
        }

        if (currentDraft.status === "completed" && currentDraft.subscriptionId) {
          const newSub = await Subscription.findById(currentDraft.subscriptionId).lean();
          return { status: 200, data: await getSerializeSubscriptionForClient()(newSub, lang) };
        }

        if (currentDraft.status === "pending_payment") {
          throw {
            status: 409,
            code: "CHECKOUT_IN_PROGRESS",
            message: "Checkout initialization is still in progress. Retry with the same idempotency key.",
            data: { draftId: String(currentDraft._id) }
          };
        }

        throw {
          status: 409,
          code: "IDEMPOTENCY_CONFLICT",
          message: `idempotencyKey is already finalized with status ${currentDraft.status}`
        };
      }
    }
    await persistCheckoutInitializationFailure(draft, err, {
      stage: renewalStage,
      providerInvoiceId,
      paymentUrl,
    });
    logger.error("Subscription renewal failed", { error: err.message, stack: err.stack });
    throw { status: 500, code: "INTERNAL", message: `Renewal failed: ${err.message} \n ${err.stack}` };
  }
}

module.exports = {
  buildSubscriptionRenewalSeed,
  resolveRenewalSeedSource,
  validateRenewablePlanOption,
  performSubscriptionRenewal,
};
