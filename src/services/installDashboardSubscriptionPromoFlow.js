"use strict";

const PromoCode = require("../models/PromoCode");
const PromoUsage = require("../models/PromoUsage");
const subscriptionQuoteService = require("./subscription/subscriptionQuoteService");
const subscriptionActivationService = require("./subscription/subscriptionActivationService");
const subscriptionController = require("../controllers/subscriptionController");
const {
  createPromoError,
  validatePromoEligibilityOrThrow,
} = require("./promoCodeService");

const INSTALL_FLAG = Symbol.for("basicdiet.dashboardSubscriptionPromoFlow.installed");

function inheritFunctionCompositionMarkers(original, wrapped) {
  for (const propertyName of Object.getOwnPropertyNames(original || {})) {
    if (!propertyName.startsWith("__")) continue;
    if (Object.prototype.hasOwnProperty.call(wrapped, propertyName)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(original, propertyName);
    if (descriptor) Object.defineProperty(wrapped, propertyName, descriptor);
  }
  return wrapped;
}

function withSession(query, session) {
  return session ? query.session(session) : query;
}

function isDashboardDirectContract(contract) {
  const snapshot = contract && contract.contractSnapshot;
  return Boolean(
    contract
      && (
        contract.contractSource === "admin_create"
        || (snapshot && snapshot.meta && snapshot.meta.source === "admin_create")
      )
  );
}

function buildEligibilityQuote(contract) {
  const snapshot = contract && contract.contractSnapshot && typeof contract.contractSnapshot === "object"
    ? contract.contractSnapshot
    : {};
  const plan = snapshot.plan && typeof snapshot.plan === "object" ? snapshot.plan : {};
  const derived = contract && contract.derivedFields && typeof contract.derivedFields === "object"
    ? contract.derivedFields
    : {};
  const resolvedQuote = contract && contract.resolvedQuote && typeof contract.resolvedQuote === "object"
    ? contract.resolvedQuote
    : {};
  const resolvedPlan = resolvedQuote.plan && typeof resolvedQuote.plan === "object"
    ? resolvedQuote.plan
    : {};
  const pricing = snapshot.pricing && typeof snapshot.pricing === "object" ? snapshot.pricing : {};

  const daysCount = Number(
    plan.daysCount
      || derived.daysCount
      || resolvedPlan.daysCount
      || 0
  );
  const mealsPerDay = Number(
    plan.mealsPerDay
      || plan.selectedMealsPerDay
      || derived.mealsPerDay
      || resolvedQuote.mealsPerDay
      || 0
  );

  return {
    plan: {
      _id: plan.planId || resolvedPlan._id || null,
      daysCount,
    },
    mealsPerDay,
    breakdown: {
      basePlanPriceHalala: Number(pricing.basePlanPriceHalala || 0),
      premiumTotalHalala: Number(pricing.premiumTotalHalala || 0),
      addonsTotalHalala: Number(pricing.addonsTotalHalala || 0),
      deliveryFeeHalala: Number(pricing.deliveryFeeHalala || 0),
    },
  };
}

function isKsa96Promo(promo) {
  return Boolean(promo && String(promo.code || "").trim().toUpperCase() === "KSA96");
}

function assertDashboardKsa96Eligibility(contract) {
  const quote = buildEligibilityQuote(contract);
  const daysCount = Number(quote.plan.daysCount || 0);
  const mealsPerDay = Number(quote.mealsPerDay || 0);

  if (![26, 30].includes(daysCount) || ![1, 2, 3, 4, 5].includes(mealsPerDay)) {
    const err = createPromoError("PROMO_NOT_ELIGIBLE");
    err.details = {
      promoCode: "KSA96",
      daysCount,
      mealsPerDay,
    };
    throw err;
  }

  return quote;
}

async function loadAndValidatePromo({ contract, userId, session }) {
  const snapshot = contract && contract.contractSnapshot && typeof contract.contractSnapshot === "object"
    ? contract.contractSnapshot
    : {};
  const appliedPromo = snapshot.promo && typeof snapshot.promo === "object" ? snapshot.promo : null;
  if (!appliedPromo || !appliedPromo.promoCodeId) {
    return null;
  }

  const promo = await withSession(PromoCode.findById(appliedPromo.promoCodeId), session);
  if (!promo) {
    throw createPromoError("PROMO_NOT_FOUND");
  }

  if (isKsa96Promo(promo)) {
    // The dashboard create endpoint has already recomputed the final quote
    // immediately before building the contract. For KSA96, reuse the exact
    // contract dimensions instead of running a second generic eligibility
    // projection that can lose mealsPerDay during stacking composition.
    assertDashboardKsa96Eligibility(contract);
  } else {
    await validatePromoEligibilityOrThrow({
      promo,
      userId,
      quote: buildEligibilityQuote(contract),
      session,
    });
  }

  return { promo, appliedPromo };
}

async function claimPromoUsage({ promo, appliedPromo, userId, subscription, session }) {
  const existing = await withSession(
    PromoUsage.findOne({
      promoCodeId: promo._id,
      subscriptionId: subscription._id,
      status: { $in: ["reserved", "consumed"] },
    }),
    session
  );
  if (existing) {
    return existing;
  }

  const claimFilter = { _id: promo._id };
  if (promo.usageLimitTotal !== null && promo.usageLimitTotal !== undefined) {
    claimFilter.$expr = {
      $lt: [
        { $ifNull: ["$currentUsageCount", 0] },
        Number(promo.usageLimitTotal),
      ],
    };
  }

  const claimedPromo = await PromoCode.findOneAndUpdate(
    claimFilter,
    { $inc: { currentUsageCount: 1 } },
    { new: true, ...(session ? { session } : {}) }
  );
  if (!claimedPromo) {
    throw createPromoError("PROMO_USAGE_LIMIT_REACHED");
  }

  const created = await PromoUsage.create(
    [{
      promoCodeId: promo._id,
      userId,
      subscriptionId: subscription._id,
      paymentId: null,
      code: promo.code,
      discountAmountHalala: Number(appliedPromo.discountAmountHalala || 0),
      status: "consumed",
      consumedAt: new Date(),
      orderType: "subscription_checkout",
      metadata: {
        appliesTo: "subscription",
        source: "dashboard_direct_subscription",
      },
    }],
    session ? { session } : undefined
  );

  return created[0];
}

function install() {
  if (globalThis[INSTALL_FLAG]) return;
  globalThis[INSTALL_FLAG] = true;

  const originalResolveQuote = subscriptionQuoteService.resolveCheckoutQuoteOrThrow;
  const resolveDashboardPromoQuote = function resolveDashboardPromoQuote(
    payload,
    options = {}
  ) {
    const resolvedUserId = options.userId || (payload && payload.userId) || null;
    return originalResolveQuote(payload, {
      ...options,
      userId: resolvedUserId,
    });
  };
  inheritFunctionCompositionMarkers(originalResolveQuote, resolveDashboardPromoQuote);
  subscriptionQuoteService.resolveCheckoutQuoteOrThrow = resolveDashboardPromoQuote;
  // The public subscription controller is loaded before dashboard routes. Replace
  // its already-captured export so adminController receives the promo-aware quote.
  subscriptionController.resolveCheckoutQuoteOrThrow = resolveDashboardPromoQuote;

  const originalActivate = subscriptionActivationService.activateSubscriptionFromCanonicalContract;
  subscriptionActivationService.activateSubscriptionFromCanonicalContract = async function activateWithDashboardPromo(
    args
  ) {
    const input = args && typeof args === "object" ? args : {};
    const shouldConsumePromo = isDashboardDirectContract(input.contract);
    const validated = shouldConsumePromo
      ? await loadAndValidatePromo({
        contract: input.contract,
        userId: input.userId,
        session: input.session,
      })
      : null;

    const subscription = await originalActivate(args);
    if (!validated) {
      return subscription;
    }

    const usage = await claimPromoUsage({
      promo: validated.promo,
      appliedPromo: validated.appliedPromo,
      userId: input.userId,
      subscription,
      session: input.session,
    });

    if (usage && subscription.appliedPromo) {
      subscription.appliedPromo.usageId = usage._id;
      await subscription.save(input.session ? { session: input.session } : undefined);
    }

    return subscription;
  };
}

install();

module.exports = {
  buildEligibilityQuote,
  claimPromoUsage,
  inheritFunctionCompositionMarkers,
  install,
  isDashboardDirectContract,
  loadAndValidatePromo,
};
