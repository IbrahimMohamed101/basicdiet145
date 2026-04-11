const CheckoutDraft = require("../../models/CheckoutDraft");
const { RECONCILE_MODES, reconcileCheckoutDraft } = require("../../services/reconciliationService");
const { isPendingCheckoutReusable, buildCheckoutReusePayload } = require("./subscriptionCheckoutHelpers");
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
const {
  persistCheckoutDraftUpdate,
  persistCheckoutInitializationFailure,
  ensureSubscriptionCheckoutPayment,
  releaseCheckoutDraftIdempotencyKey,
} = require("./subscriptionCheckoutHelpers");
const { resolveReadLabel } = require("../../utils/subscription/subscriptionReadLocalization");

async function performSubscriptionCheckout(userId, idempotencyKey, body, lang, runtimeOverrides = null) {
  const runtime = runtimeOverrides ? { ...sliceBDefaultRuntime(), ...runtimeOverrides } : sliceBDefaultRuntime();
  let draft;
  let requestHash = "";
  let canonicalContract = null;
  let checkoutStage = "pre_draft";
  let providerInvoiceId = "";
  let paymentUrl = "";

  try {
    const quote = await runtime.resolveCheckoutQuoteOrThrow(body, {
      lang,
      useGenericPremiumWallet:
        isPhase2GenericPremiumWalletEnabled()
        && isPhase1CanonicalCheckoutDraftWriteEnabled(),
    });
    const normalizedDelivery = normalizeCheckoutDeliveryForPersistence(quote.delivery);
    if (isPhase1CanonicalCheckoutDraftWriteEnabled()) {
      canonicalContract = runtime.buildPhase1SubscriptionContract({
        payload: body,
        resolvedQuote: quote,
        actorContext: { actorRole: "client", actorUserId: userId },
        source: "customer_checkout",
        now: new Date(),
      });
    }
    requestHash = buildCheckoutRequestHash({ userId, quote });

    const existingByKey = await CheckoutDraft.findOne({
      userId,
      idempotencyKey,
    }).sort({ createdAt: -1 }).lean();

    if (existingByKey) {
      let releasedFailedDraftForRetry = false;
      if (existingByKey.requestHash && existingByKey.requestHash !== requestHash) {
        throw { status: 409, code: "IDEMPOTENCY_CONFLICT", message: "idempotencyKey is already used with a different checkout payload" };
      }

      const { draft: reconciledDraft, payment: reconciledPayment } = await reconcileCheckoutDraft(existingByKey._id, { mode: RECONCILE_MODES.PERSIST });
      const currentDraft = reconciledDraft || existingByKey;
      const currentPayment = reconciledPayment;

      if (isPendingCheckoutReusable(currentDraft, currentPayment)) {
        return { ok: true, data: buildCheckoutReusePayload(currentDraft, currentPayment) };
      }

      if (currentDraft.status === "completed") {
        return {
          ok: true,
          data: {
            ...buildCheckoutReusePayload(currentDraft, currentPayment),
            checkoutStatusLabel: resolveReadLabel("checkoutStatuses", "completed", lang),
            paymentStatusLabel: resolveReadLabel("paymentStatuses", "paid", lang),
            checkedProvider: true,
          },
        };
      }

      if (currentDraft.status === "failed") {
        await releaseCheckoutDraftIdempotencyKey(currentDraft, {
          stage: "checkout_existing_by_key_failed_retry",
        });
        draft = null;
        releasedFailedDraftForRetry = true;
      }

      if (currentPayment && currentPayment.status === "paid") {
        checkoutStage = "post_payment";
        draft = currentDraft;
        providerInvoiceId = getInvoiceResponseId(currentPayment.invoiceResponse);
        paymentUrl = getInvoiceResponseUrl(currentPayment.invoiceResponse);
      } else if (!draft && !releasedFailedDraftForRetry) {
        checkoutStage = "draft_exists";
        draft = currentDraft;
      }
    }

    if (!draft) {
      const draftPayload = {
        userId,
        planId: quote.plan._id,
        idempotencyKey,
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
      };
      if (canonicalContract) {
        Object.assign(
          draftPayload,
          runtime.buildCanonicalDraftPersistenceFields({ contract: canonicalContract })
        );
      }
      checkoutStage = "draft_create";
      draft = await CheckoutDraft.create(draftPayload);
    }

    if (!providerInvoiceId) {
      const appUrl = process.env.APP_URL || "https://example.com";
      checkoutStage = "invoice_create";
      const invoice = await runtime.createInvoice({
        amount: quote.breakdown.totalHalala,
        description: buildPaymentDescription("subscriptionCheckout", lang, {
          daysCount: Number(quote.plan.daysCount || 0),
        }),
        callbackUrl: `${appUrl}/api/webhooks/moyasar`,
        successUrl: resolveProviderRedirectUrl(body.successUrl, `${appUrl}/payments/success`),
        backUrl: resolveProviderRedirectUrl(body.backUrl, `${appUrl}/payments/cancel`),
        metadata: {
          type: "subscription_activation",
          draftId: String(draft._id),
          userId: String(userId),
          grams: quote.grams,
          mealsPerDay: quote.mealsPerDay,
        },
      });
      providerInvoiceId = getInvoiceResponseId(invoice);
      paymentUrl = getInvoiceResponseUrl(invoice);

      if (!providerInvoiceId || !paymentUrl) {
        const invalidInvoiceErr = new Error("Invoice response missing required payment fields");
        invalidInvoiceErr.code = "PAYMENT_PROVIDER_INVALID_RESPONSE";
        throw invalidInvoiceErr;
      }

      const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || SYSTEM_CURRENCY, "Invoice currency");
      const paymentPromise = ensureSubscriptionCheckoutPayment({
        draft,
        paymentType: "subscription_activation",
        totalHalala: quote.breakdown.totalHalala,
        invoiceCurrency,
        providerInvoiceId,
        paymentUrl,
      });

      checkoutStage = "draft_invoice_persist";
      await persistCheckoutDraftUpdate(draft, {
        providerInvoiceId,
        paymentUrl,
        failureReason: "",
      }, { stage: checkoutStage });

      checkoutStage = "payment_create";
      const payment = await paymentPromise;

      checkoutStage = "draft_payment_link_persist";
      await persistCheckoutDraftUpdate(draft, {
        paymentId: payment._id,
        providerInvoiceId,
        paymentUrl,
        failureReason: "",
      }, { stage: checkoutStage });

      return {
        status: 201,
        ok: true,
        data: {
          draftId: draft.id || String(draft._id),
          paymentId: payment.id || String(payment._id),
          payment_url: draft.paymentUrl,
          subscriptionId: null,
          totals: quote.breakdown,
        },
      };
    }

    if (checkoutStage === "post_payment") {
      checkoutStage = "finalizing_payment";
      const finalizationResult = await runtime.finalizeSubscriptionDraftPaymentFlow({ draft, payment: null }, runtime);
      if (finalizationResult.subscription) {
        return {
          ok: true,
          data: {
            subscription: await getSerializeSubscriptionForClient()(finalizationResult.subscription, lang),
            checkoutStatusLabel: resolveReadLabel("checkoutStatuses", "completed", lang),
            paymentStatusLabel: resolveReadLabel("paymentStatuses", "paid", lang),
            checkedProvider: true,
          },
        };
      }
    }

    return {
      status: 200,
      ok: true,
      data: buildCheckoutReusePayload(draft, null),
    };
  } catch (err) {
    if (draft) {
      try {
        const failureStage = checkoutStage || "checkout_init";
        await persistCheckoutInitializationFailure(draft, err, {
          stage: failureStage,
          providerInvoiceId,
          paymentUrl,
        });
      } catch (updateErr) {
        logger.error("Failed to update draft status to failed", { draftId: draft._id, error: updateErr.message });
      }
    }
    throw err;
  }
}

module.exports = {
  performSubscriptionCheckout,
};
