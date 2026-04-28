const CheckoutDraft = require("../../models/CheckoutDraft");
const { RECONCILE_MODES, reconcileCheckoutDraft } = require("../../services/reconciliationService");
const { isPendingCheckoutReusable, buildCheckoutReusePayload } = require("./subscriptionCheckoutHelpers");
const { serializeSubscriptionForClient } = require("./subscriptionClientSerializationService");
const { getInvoice } = require("../moyasarService");
const { logger } = require("../../utils/logger");
const { STALE_DRAFT_THRESHOLD_MS } = require("../../constants");
const { SYSTEM_CURRENCY, assertSystemCurrencyOrThrow } = require("../../utils/currency");
const { buildPaymentDescription } = require("../../utils/payment");
const { resolveProviderRedirectUrl } = require("../../utils/payment");
const { buildPaymentRedirectContext } = require("../paymentFlowService");
const { getInvoiceResponseId, getInvoiceResponseUrl } = require("../../utils/payment");
const { buildCheckoutRequestHash } = require("../../utils/checkout");
const { normalizeCheckoutDeliveryForPersistence } = require("../../utils/checkout");
const { isPhase1CanonicalCheckoutDraftWriteEnabled } = require("../../utils/featureFlags");
const { buildMoneySummary, computeVatBreakdown, normalizeVatPercentage } = require("../../utils/pricing");
const { resolveQuoteSummary } = require("../../utils/subscription/subscriptionCatalog");
const {
  reservePromoCodeUsageForCheckout,
  releasePromoCodeUsageReservation,
  buildPromoResponseBlock,
} = require("../promoCodeService");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const { pickLang } = require("../../utils/i18n");

const { sliceBDefaultRuntime } = require("./runtime");
const {
  persistCheckoutDraftUpdate,
  persistCheckoutInitializationFailure,
  ensureSubscriptionCheckoutPayment,
  releaseCheckoutDraftIdempotencyKey,
} = require("./subscriptionCheckoutHelpers");
const { resolveReadLabel } = require("../../utils/subscription/subscriptionReadLocalization");

// ---------------------------------------------------------------------------
// Premium normalization helpers
// ---------------------------------------------------------------------------

function normalizeOptionalObjectId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s === "null" || s === "undefined") return null;
  return value;
}

/**
 * Normalise a single raw premiumItem into a canonical shape.
 * Uses canonicalProteinId from resolvedQuote if available, falls back to proteinId.
 * Preserves premiumKey from resolvedQuote, falls back to protein.premiumKey or item.premiumKey.
 */
function normalizePremiumItem(item) {
  const proteinId = item.protein && item.protein._id ? item.protein._id : item.proteinId;
  const qty = Number(item.qty || 0);

  let premiumKey = item.premiumKey || null;
  if (!premiumKey && item.protein && item.protein.premiumKey) {
    premiumKey = item.protein.premiumKey;
  }

  let canonicalProteinId = item.canonicalProteinId || null;
  if (!canonicalProteinId && premiumKey) {
    canonicalProteinId = proteinId;
  }

  let unitExtraFeeHalala = 0;
  if (typeof item.unitExtraFeeHalala === "number") {
    unitExtraFeeHalala = item.unitExtraFeeHalala;
  } else if (item.protein && typeof item.protein.extraFeeHalala === "number") {
    unitExtraFeeHalala = item.protein.extraFeeHalala;
  }

  const name = item.name || (item.protein && (item.protein.name?.en || item.protein.name?.ar)) || null;

  return {
    proteinId: normalizeOptionalObjectId(canonicalProteinId || proteinId),
    qty,
    unitExtraFeeHalala,
    currency: SYSTEM_CURRENCY,
    premiumKey,
    name,
    originalProteinId: normalizeOptionalObjectId(proteinId),
  };
}

/**
 * Build the full normalised premium rows array, filtering out invalid entries.
 */
function buildNormalizedPremiumRows(rawPremiumItems) {
  return (Array.isArray(rawPremiumItems) ? rawPremiumItems : [])
    .map(normalizePremiumItem)
    .filter(
      (row) =>
        (row.proteinId || row.premiumKey) &&
        Number.isInteger(row.qty) &&
        row.qty > 0
    );
}

/**
 * Sum the premium rows to produce the canonical premiumTotalHalala.
 */
function computePremiumTotalHalala(rows) {
  return rows.reduce(
    (sum, row) => sum + Number(row.qty) * Number(row.unitExtraFeeHalala),
    0
  );
}

/**
 * Recompute VAT from the canonical subtotal.
 *
 * WHY: quote.breakdown.vatHalala was calculated against the *raw* (un-normalised)
 * premiumTotalHalala.  Once we recompute premiumTotalHalala from normalizedPremiumItems
 * the subtotal changes, so VAT must follow — otherwise the three values
 *   contractSnapshot.pricing.totalHalala
 *   breakdown.totalHalala
 *   actual invoice amount
 * would all drift apart silently.
 *
 * The VAT rate comes from quote.breakdown.vatPercentage when available and
 * falls back to the derived rate for older quote shapes.
 */
function recomputeVatBreakdown(canonicalSubtotal, quoteBreakdown) {
  const explicitVatPercentage = normalizeVatPercentage(
    quoteBreakdown && quoteBreakdown.vatPercentage,
    NaN
  );
  const rawSubtotal =
    Number(quoteBreakdown.basePlanPriceHalala || 0) +
    Number(quoteBreakdown.premiumTotalHalala  || 0) +
    Number(quoteBreakdown.addonsTotalHalala   || 0) +
    Number(quoteBreakdown.deliveryFeeHalala   || 0);
  const derivedVatPercentage = rawSubtotal === 0
    ? 0
    : (Number(quoteBreakdown.vatHalala || 0) / rawSubtotal) * 100;
  const vatPercentage = Number.isFinite(explicitVatPercentage)
    ? explicitVatPercentage
    : derivedVatPercentage;
  return computeVatBreakdown({
    basePriceHalala: canonicalSubtotal,
    vatPercentage,
  });
}

// ---------------------------------------------------------------------------

async function performSubscriptionCheckout(userId, idempotencyKey, body, lang, runtimeOverrides = null) {
  const runtime = runtimeOverrides ? { ...sliceBDefaultRuntime(), ...runtimeOverrides } : sliceBDefaultRuntime();
  let draft;
  let requestHash = "";
  let canonicalContract = null;
  let checkoutStage = "pre_draft";
  let providerInvoiceId = "";
  let paymentUrl = "";
  let normalizedPremiumItems = [];
  let breakdown = null;
  let quote = null;

  try {
    quote = await runtime.resolveCheckoutQuoteOrThrow(body, {
      lang,
      userId,
    });
    const currentBusinessDate = await getRestaurantBusinessDate();

    const normalizedDelivery = normalizeCheckoutDeliveryForPersistence(quote.delivery);

    canonicalContract = runtime.buildPhase1SubscriptionContract({
      payload: body,
      resolvedQuote: quote,
      actorContext: { actorRole: "client", actorUserId: userId },
      source: "customer_checkout",
      now: new Date(),
      currentBusinessDate,
    });

    requestHash = buildCheckoutRequestHash({ userId, quote });

    // ------------------------------------------------------------------
    // Idempotency: check for an existing draft with this key
    // ------------------------------------------------------------------
    const existingByKey = await CheckoutDraft.findOne({ userId, idempotencyKey })
      .sort({ createdAt: -1 })
      .lean();

    if (existingByKey) {
      let releasedFailedDraftForRetry = false;

      if (existingByKey.requestHash && existingByKey.requestHash !== requestHash) {
        throw {
          status: 409,
          code: "IDEMPOTENCY_CONFLICT",
          message: "idempotencyKey is already used with a different checkout payload",
        };
      }

      const { draft: reconciledDraft, payment: reconciledPayment } = await reconcileCheckoutDraft(
        existingByKey._id,
        { mode: RECONCILE_MODES.PERSIST }
      );
      const currentDraft = reconciledDraft || existingByKey;
      const currentPayment = reconciledPayment;

      if (currentDraft && Array.isArray(currentDraft.premiumItems)) {
        normalizedPremiumItems = currentDraft.premiumItems;
      }
      if (currentDraft && currentDraft.breakdown) {
        breakdown = currentDraft.breakdown;
      }

      if (isPendingCheckoutReusable(currentDraft, currentPayment)) {
        return {
          ok: true,
          data: buildCheckoutReusePayload(currentDraft, currentPayment, { reused: true }),
        };
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

      if (["failed", "canceled", "expired"].includes(String(currentDraft.status || ""))) {
        await releasePromoCodeUsageReservation({
          checkoutDraftId: currentDraft._id,
          reason: `checkout_retry_${currentDraft.status}`,
        });
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

    // ------------------------------------------------------------------
    // No usable draft found — create a new one
    // ------------------------------------------------------------------
    if (!draft) {
      // ----------------------------------------------------------------
      // STEP 1: Build normalised premium rows — single source of truth.
      // ----------------------------------------------------------------
      normalizedPremiumItems = buildNormalizedPremiumRows(quote.premiumItems);
      const premiumTotalHalala = computePremiumTotalHalala(normalizedPremiumItems);

      // ----------------------------------------------------------------
      // STEP 2: Rebuild the full breakdown.
      //
      //   KEY FIX (VAT):
      //   vatHalala is NOT read from quote.breakdown.vatHalala because that
      //   value was computed against the *raw* (un-normalised) premiumTotal.
      //   Instead we back-derive the VAT rate from quote.breakdown and apply
      //   it to the *canonical* subtotal so that:
      //     invoice amount == breakdown.totalHalala
      //              == contractSnapshot.pricing.totalHalala
      //   at all times.
      // ----------------------------------------------------------------
      const basePlanPriceHalala = Number(quote.breakdown.basePlanPriceHalala || 0);
      const addonsTotalHalala   = Number(quote.breakdown.addonsTotalHalala   || 0);
      const deliveryFeeHalala   = Number(quote.breakdown.deliveryFeeHalala   || 0);

      // Canonical subtotal (pre-VAT).
      const canonicalSubtotal =
        basePlanPriceHalala +
        premiumTotalHalala +
        addonsTotalHalala +
        deliveryFeeHalala;

      // VAT recomputed from canonical subtotal using the rate from the quote.
      const vatBreakdown = recomputeVatBreakdown(canonicalSubtotal, quote.breakdown);
      const vatHalala = vatBreakdown.vatHalala;
      const totalHalala = vatBreakdown.totalHalala;

      breakdown = {
        basePlanPriceHalala,
        premiumTotalHalala,
        addonsTotalHalala,
        deliveryFeeHalala,
        discountHalala: Number(quote.breakdown.discountHalala || 0),
        subtotalHalala: vatBreakdown.subtotalHalala,
        vatPercentage: vatBreakdown.vatPercentage,
        vatHalala,
        totalHalala,
        currency: SYSTEM_CURRENCY,
      };

      // ----------------------------------------------------------------
      // STEP 3: Build canonical persistence fields.
      // ----------------------------------------------------------------
      let canonicalFields = {};
      if (canonicalContract && runtime.buildCanonicalDraftPersistenceFields) {
        canonicalFields = runtime.buildCanonicalDraftPersistenceFields({
          contract: {
            ...canonicalContract,
            premiumSelections: normalizedPremiumItems,
            entitlementContract: {
              ...((canonicalContract && canonicalContract.entitlementContract) || {}),
              premiumItems: normalizedPremiumItems.map((item) => ({
                proteinId: item.proteinId,
                premiumKey: item.premiumKey,
                qty: item.qty,
                unitExtraFeeHalala: item.unitExtraFeeHalala,
                currency: item.currency,
              })),
            },
            pricing: {
              ...((canonicalContract && canonicalContract.pricing) || {}),
              addonsTotalHalala,
              discountHalala: Number(quote.breakdown.discountHalala || 0),
              premiumTotalHalala,
              vatHalala,       // ← propagate recomputed VAT into the contract snapshot
              totalHalala,
            },
            promo: quote.promoCode || null,
          },
        });
      }

      // ----------------------------------------------------------------
      // STEP 4: Invariant checks — fail fast at checkout, not at activation.
      // ----------------------------------------------------------------

      // 4a. Required canonical fields must all be present.
      if (
        typeof canonicalFields.contractVersion      === "undefined" ||
        typeof canonicalFields.contractMode         === "undefined" ||
        typeof canonicalFields.contractCompleteness === "undefined" ||
        typeof canonicalFields.contractSource       === "undefined" ||
        typeof canonicalFields.contractHash         === "undefined" ||
        typeof canonicalFields.contractSnapshot     === "undefined"
      ) {
        logger.error("Invariant violation: canonicalFields missing required contract fields");
        throw new Error("Missing canonical contract fields in draftPayload");
      }

      // 4b. contractSnapshot.pricing.premiumTotalHalala must match computed value.
      if (canonicalFields.contractSnapshot?.pricing?.premiumTotalHalala !== premiumTotalHalala) {
        logger.error("Invariant violation: contractSnapshot.pricing.premiumTotalHalala mismatch", {
          expected: premiumTotalHalala,
          actual: canonicalFields.contractSnapshot.pricing.premiumTotalHalala,
        });
        throw new Error("premiumTotalHalala mismatch: contractSnapshot.pricing.premiumTotalHalala");
      }

      // 4c. breakdown.premiumTotalHalala sanity check.
      if (breakdown.premiumTotalHalala !== premiumTotalHalala) {
        logger.error("Invariant violation: breakdown.premiumTotalHalala mismatch", {
          expected: premiumTotalHalala,
          actual: breakdown.premiumTotalHalala,
        });
        throw new Error("premiumTotalHalala mismatch: breakdown.premiumTotalHalala");
      }

      // 4d. contractSnapshot.pricing.totalHalala must match breakdown.totalHalala.
      if (canonicalFields.contractSnapshot?.pricing?.totalHalala !== breakdown.totalHalala) {
        logger.error("Invariant violation: contractSnapshot.pricing.totalHalala mismatch", {
          expected: breakdown.totalHalala,
          actual: canonicalFields.contractSnapshot.pricing.totalHalala,
        });
        throw new Error("totalHalala mismatch: contractSnapshot.pricing.totalHalala");
      }

      // 4e. contractSnapshot.pricing.vatHalala must match recomputed vatHalala.
      //     Catches cases where buildCanonicalDraftPersistenceFields ignores
      //     the overridden pricing.vatHalala we pass in above.
      if (canonicalFields.contractSnapshot?.pricing?.vatHalala !== vatHalala) {
        logger.error("Invariant violation: contractSnapshot.pricing.vatHalala mismatch", {
          expected: vatHalala,
          actual: canonicalFields.contractSnapshot.pricing.vatHalala,
        });
        throw new Error("vatHalala mismatch: contractSnapshot.pricing.vatHalala");
      }

      // 4f. entitlementContract.premiumItems sum must equal premiumTotalHalala.
      //     Mirrors the exact assertion run by assertPremiumBalanceMatchesContractPricing
      //     at activation time.
      {
        const entitlementItems =
          canonicalFields.contractSnapshot?.entitlementContract?.premiumItems || [];
        const entitlementTotal = entitlementItems.reduce(
          (sum, row) => sum + Number(row.qty) * Number(row.unitExtraFeeHalala),
          0
        );
        if (entitlementTotal !== premiumTotalHalala) {
          logger.error(
            "Invariant violation: entitlementContract.premiumItems sum mismatch — " +
              "this would cause activation to fall back to legacy path",
            {
              expected: premiumTotalHalala,
              actual: entitlementTotal,
              entitlementItems,
            }
          );
          throw new Error(
            "premiumTotalHalala mismatch: entitlementContract.premiumItems sum"
          );
        }
      }

      // ----------------------------------------------------------------
      // STEP 5: Persist the new draft.
      // ----------------------------------------------------------------
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
        premiumItems: normalizedPremiumItems,
        premiumCount: Number(quote.premiumCount || 0),
        premiumUnitPriceHalala: Number(quote.premiumUnitPriceHalala || 0),
        addonSubscriptions: (quote.addonItems || []).map((item) => ({
          addonId: item.addon._id,
          name: pickLang(item.addon.name, lang),
          category: item.category || item.addon.category,
          maxPerDay: 1,
        })),
        promo: quote.promoCode
          ? {
            promoCodeId: quote.promoCode.promoCodeId || null,
            code: String(quote.promoCode.code || ""),
            title: String(quote.promoCode.title || ""),
            description: String(quote.promoCode.description || ""),
            discountType: String(quote.promoCode.discountType || ""),
            discountValue: Number(quote.promoCode.discountValue || 0),
            discountAmountHalala: Number(quote.promoCode.discountAmountHalala || 0),
            message: String(quote.promoCode.message || ""),
            isApplied: Boolean(quote.promoCode.isApplied),
          }
          : null,
        breakdown,
        ...canonicalFields,
      };

      try {
        draft = await CheckoutDraft.create(draftPayload);
      } catch (err) {
        if (err && err.code === 11000) {
          logger.warn(
            "Subscription checkout race condition: Duplicate draft creation attempt caught",
            { userId, idempotencyKey }
          );
          const recovered = await CheckoutDraft.findOne({ userId, idempotencyKey })
            .sort({ createdAt: -1 })
            .lean();
          if (recovered) {
            const { draft: reconciled, payment: reconciledPayment } = await reconcileCheckoutDraft(
              recovered._id,
              { mode: RECONCILE_MODES.PERSIST }
            );
            const currentDraft = reconciled || recovered;
            if (isPendingCheckoutReusable(currentDraft, reconciledPayment)) {
              return {
                ok: true,
                data: buildCheckoutReusePayload(currentDraft, reconciledPayment, { reused: true }),
              };
            }
            draft = currentDraft;
          }
        }
        if (!draft) throw err;
      }

      if (draft && quote.promoCode && quote.promoCode.promoCodeId) {
        await reservePromoCodeUsageForCheckout({
          promo: {
            _id: quote.promoCode.promoCodeId,
            code: quote.promoCode.code,
            title: quote.promoCode.title,
            description: quote.promoCode.description,
            discountType: quote.promoCode.discountType,
            discountValue: quote.promoCode.discountValue,
            usageLimitTotal: null,
            usageLimitPerUser: null,
          },
          appliedPromo: quote.promoCode,
          userId,
          checkoutDraftId: draft._id,
        });
      }
    }

    // ------------------------------------------------------------------
    // Create the provider invoice if we don't already have one
    // ------------------------------------------------------------------
    if (!providerInvoiceId) {
      const appUrl = process.env.APP_URL || "https://example.com";
      const redirectContext = buildPaymentRedirectContext({
        appUrl,
        paymentType: "subscription_activation",
        draftId: String(draft._id),
        successUrl: body.successUrl,
        backUrl: body.backUrl,
      });
      checkoutStage = "invoice_create";

      const invoice = await runtime.createInvoice({
        amount: breakdown.totalHalala,
        description: buildPaymentDescription("subscriptionCheckout", lang, {
          daysCount: Number(quote.plan.daysCount || 0),
        }),
        callbackUrl: `${appUrl}/api/webhooks/moyasar`,
        successUrl: resolveProviderRedirectUrl(redirectContext.providerSuccessUrl, `${appUrl}/payments/success`),
        backUrl: resolveProviderRedirectUrl(redirectContext.providerCancelUrl, `${appUrl}/payments/cancel`),
        metadata: {
          type: "subscription_activation",
          draftId: String(draft._id),
          userId: String(userId),
          grams: quote.grams,
          mealsPerDay: quote.mealsPerDay,
          redirectToken: redirectContext.token,
        },
      });

      providerInvoiceId = getInvoiceResponseId(invoice);
      paymentUrl = getInvoiceResponseUrl(invoice);

      if (!providerInvoiceId || !paymentUrl) {
        const invalidInvoiceErr = new Error("Invoice response missing required payment fields");
        invalidInvoiceErr.code = "PAYMENT_PROVIDER_INVALID_RESPONSE";
        throw invalidInvoiceErr;
      }

      const invoiceCurrency = assertSystemCurrencyOrThrow(
        invoice.currency || SYSTEM_CURRENCY,
        "Invoice currency"
      );

      const paymentPromise = ensureSubscriptionCheckoutPayment({
        draft,
        paymentType: "subscription_activation",
        totalHalala: breakdown.totalHalala,
        invoiceCurrency,
        providerInvoiceId,
        paymentUrl,
        redirectContext,
      });

      checkoutStage = "draft_invoice_persist";
      await persistCheckoutDraftUpdate(
        draft,
        { providerInvoiceId, paymentUrl, failureReason: "" },
        { stage: checkoutStage }
      );

      checkoutStage = "payment_create";
      const payment = await paymentPromise;

      checkoutStage = "draft_payment_link_persist";
      await persistCheckoutDraftUpdate(
        draft,
        { paymentId: payment._id, providerInvoiceId, paymentUrl, failureReason: "" },
        { stage: checkoutStage }
      );

      return {
        status: 201,
        ok: true,
        data: {
          ...buildCheckoutReusePayload(
            { ...draft.toObject(), breakdown, subscriptionId: null },
            payment,
            { reused: false }
          ),
          pricingSummary: buildMoneySummary({
            basePriceHalala: breakdown.subtotalHalala || 0,
            vatPercentage: breakdown.vatPercentage || 0,
            vatHalala: breakdown.vatHalala || 0,
            totalPriceHalala: breakdown.totalHalala || 0,
            currency: breakdown.currency || SYSTEM_CURRENCY,
          }),
          promoCode: buildPromoResponseBlock(quote && quote.promoCode ? quote.promoCode : null),
          summary: quote
            ? {
              lineItems: resolveQuoteSummary({
                ...quote,
                breakdown,
              }, lang).lineItems,
            }
            : null,
        },
      };
    }

    // ------------------------------------------------------------------
    // Payment already exists — finalise if needed
    // ------------------------------------------------------------------
    if (checkoutStage === "post_payment") {
      checkoutStage = "finalizing_payment";
      const finalizationResult = await runtime.finalizeSubscriptionDraftPaymentFlow(
        { draft, payment: null },
        runtime
      );
      if (finalizationResult.subscription) {
        return {
          ok: true,
          data: {
            subscription: await serializeSubscriptionForClient(finalizationResult.subscription, lang),
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
        logger.error("Failed to update draft status to failed", {
          draftId: draft._id,
          error: updateErr.message,
        });
      }
      try {
        await releasePromoCodeUsageReservation({
          checkoutDraftId: draft._id,
          reason: `checkout_failure:${String(err.code || err.message || "unknown")}`,
        });
      } catch (releaseErr) {
        logger.error("Failed to release promo usage reservation", {
          draftId: draft._id,
          error: releaseErr.message,
        });
      }
    }
    throw err;
  }
}

module.exports = {
  performSubscriptionCheckout,
};
