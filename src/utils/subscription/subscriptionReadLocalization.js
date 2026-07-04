const {
  formatDaysLabel,
  formatGramsLabel,
  formatMealsLabel,
  formatWindowLabel,
} = require("./subscriptionCatalog");
const {
  resolvePremiumKeyFromName,
  getPremiumDisplayName,
} = require("./premiumIdentity");
const {
  localizeAddonRows,
  localizeCustomItemRows,
  resolveCatalogOrStoredName,
  resolveFirstLocalizedText,
  resolveLocalizedText,
  resolveReadLabel,
} = require("./subscriptionLocalizationCommon");
const {
  mapLegacySelectionType,
  NEW_TYPES,
} = require("./mealTypeMapper");

function resolveWindowLabel(windowValue, lang) {
  const raw = String(windowValue || "").trim();
  if (!raw) return "";
  if (!/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(raw)) {
    return "";
  }
  return formatWindowLabel(raw, lang);
}

function localizeCustomSalads(rows, lang) {
  return localizeCustomItemRows(rows, lang);
}

function localizeCustomMeals(rows, lang) {
  return localizeCustomItemRows(rows, lang);
}

function localizePlanningView(planning, lang) {
  if (!planning || typeof planning !== "object") return planning;

  return {
    ...planning,
    stateLabel: resolveReadLabel("planningStates", planning.state, lang),
    premiumOverageStatusLabel: resolveReadLabel("paymentStatuses", planning.premiumOverageStatus, lang),
  };
}

function normalizeCanonicalMealSlots(mealSlots) {
  if (!Array.isArray(mealSlots)) return [];

  return mealSlots.map((slot) => {
    const selectionType = slot && slot.selectionType
      ? mapLegacySelectionType(slot.selectionType, slot || {})
      : "empty";
    const shouldUseLegacyCarbId = selectionType === NEW_TYPES.STANDARD_MEAL || selectionType === NEW_TYPES.PREMIUM_MEAL;
    const carbs = Array.isArray(slot && slot.carbs) && slot.carbs.length > 0
      ? slot.carbs.map((carb) => ({
        carbId: carb && carb.carbId ? String(carb.carbId) : "",
        grams: Number(carb && carb.grams || 0),
      }))
      : (shouldUseLegacyCarbId && slot && slot.carbId ? [{ carbId: String(slot.carbId), grams: 300 }] : []);
    const salad = slot && slot.salad
      ? slot.salad
      : (slot && slot.customSalad && typeof slot.customSalad === "object" ? slot.customSalad : null);

    return {
      slotIndex: Number(slot && slot.slotIndex || 0),
      slotKey: slot && slot.slotKey ? String(slot.slotKey) : "",
      status: slot && slot.status ? String(slot.status) : "empty",
      selectionType,
      contractVersion: slot && slot.contractVersion ? String(slot.contractVersion) : undefined,
      productId: slot && slot.productId ? String(slot.productId) : undefined,
      productKey: slot && slot.productKey ? String(slot.productKey) : undefined,
      selectedOptions: Array.isArray(slot && slot.selectedOptions)
        ? slot.selectedOptions.map((selection) => ({
          groupId: selection && selection.groupId ? String(selection.groupId) : "",
          groupKey: selection && selection.groupKey ? String(selection.groupKey) : "",
          canonicalGroupKey: selection && selection.canonicalGroupKey ? String(selection.canonicalGroupKey) : null,
          optionId: selection && selection.optionId ? String(selection.optionId) : "",
          optionKey: selection && selection.optionKey ? String(selection.optionKey) : "",
          quantity: Number(selection && selection.quantity || 1),
          grams: selection && selection.grams !== undefined && selection.grams !== null ? Number(selection.grams || 0) : null,
          unitPriceHalala: Number(selection && selection.unitPriceHalala || 0),
          totalPriceHalala: Number(selection && selection.totalPriceHalala || 0),
          extraWeightUnitGrams: Number(selection && selection.extraWeightUnitGrams || 0),
          extraWeightPriceHalala: Number(selection && selection.extraWeightPriceHalala || 0),
        }))
        : undefined,
      pricingSnapshot: slot && slot.pricingSnapshot ? slot.pricingSnapshot : undefined,
      displaySnapshot: slot && slot.displaySnapshot ? slot.displaySnapshot : undefined,
      fulfillmentSnapshot: slot && slot.fulfillmentSnapshot ? slot.fulfillmentSnapshot : undefined,
      confirmationSnapshot: slot && slot.confirmationSnapshot ? slot.confirmationSnapshot : undefined,
      proteinId: (slot && slot.proteinId && String(slot.proteinId).trim()) ? String(slot.proteinId).trim() : null,
      carbs,
      sandwichId: slot && slot.sandwichId ? String(slot.sandwichId) : null,
      salad: (salad && typeof salad === "object") ? {
        presetKey: salad.presetKey || null,
        groups: {
          leafy_greens: Array.isArray(salad.groups && salad.groups.leafy_greens) ? salad.groups.leafy_greens : [],
          vegetables: Array.isArray(salad.groups && salad.groups.vegetables) ? salad.groups.vegetables : [],
          protein: Array.isArray(salad.groups && salad.groups.protein) ? salad.groups.protein : [],
          cheese_nuts: Array.isArray(salad.groups && salad.groups.cheese_nuts) ? salad.groups.cheese_nuts : [],
          fruits: Array.isArray(salad.groups && salad.groups.fruits) ? salad.groups.fruits : [],
          sauce: Array.isArray(salad.groups && salad.groups.sauce) ? salad.groups.sauce : [],
        }
      } : null,
      isPremium: Boolean(slot && slot.isPremium),
      premiumKey: slot && slot.premiumKey ? String(slot.premiumKey) : null,
      premiumSource: slot && slot.premiumSource ? String(slot.premiumSource) : "none",
      premiumExtraFeeHalala: Number(slot && slot.premiumExtraFeeHalala || 0),
    };
  });
}

function localizeDaySnapshot(snapshot, { lang, addonNames = new Map() } = {}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return snapshot;
  }

  const localized = { ...snapshot };

  if (Array.isArray(snapshot.recurringAddons)) {
    localized.recurringAddons = localizeAddonRows(snapshot.recurringAddons, {
      lang,
      addonNames,
      preferStoredName: true,
    });
  }

  if (Array.isArray(snapshot.oneTimeAddonSelections)) {
    localized.oneTimeAddonSelections = localizeAddonRows(snapshot.oneTimeAddonSelections, {
      lang,
      addonNames,
      preferStoredName: true,
    });
  }

  if (snapshot.planning && typeof snapshot.planning === "object") {
    localized.planning = localizePlanningView(snapshot.planning, lang);
  }

  if (Array.isArray(snapshot.customSalads)) {
    localized.customSalads = localizeCustomSalads(snapshot.customSalads, lang);
  }

  if (Array.isArray(snapshot.customMeals)) {
    localized.customMeals = localizeCustomMeals(snapshot.customMeals, lang);
  }

  if (snapshot.oneTimeAddonPaymentStatus) {
    localized.oneTimeAddonPaymentStatusLabel = resolveReadLabel(
      "paymentStatuses",
      snapshot.oneTimeAddonPaymentStatus,
      lang
    );
  }

  return localized;
}

function localizeSubscriptionDayReadPayload(day, { lang, addonNames = new Map() } = {}) {
  if (!day || typeof day !== "object") return day;

  const localized = {
    ...day,
    statusLabel: resolveReadLabel("dayStatuses", day.status, lang),
  };

  if (Array.isArray(day.recurringAddons)) {
    localized.recurringAddons = localizeAddonRows(day.recurringAddons, {
      lang,
      addonNames,
      preferStoredName: Boolean(day.fulfilledSnapshot || day.lockedSnapshot),
    });
  }

  if (Array.isArray(day.oneTimeAddonSelections)) {
    localized.oneTimeAddonSelections = localizeAddonRows(day.oneTimeAddonSelections, {
      lang,
      addonNames,
      preferStoredName: Boolean(day.fulfilledSnapshot || day.lockedSnapshot),
    });
  }

  if (day.planning && typeof day.planning === "object") {
    localized.planning = localizePlanningView(day.planning, lang);
  }

  if (Array.isArray(day.mealSlots)) {
    localized.mealSlots = normalizeCanonicalMealSlots(day.mealSlots);
  }

  if (day.oneTimeAddonPaymentStatus) {
    localized.oneTimeAddonPaymentStatusLabel = resolveReadLabel(
      "paymentStatuses",
      day.oneTimeAddonPaymentStatus,
      lang
    );
  }

  if (Array.isArray(day.customSalads)) {
    localized.customSalads = localizeCustomSalads(day.customSalads, lang);
  }

  if (Array.isArray(day.customMeals)) {
    localized.customMeals = localizeCustomMeals(day.customMeals, lang);
  }

  if (day.lockedSnapshot) {
    localized.lockedSnapshot = localizeDaySnapshot(day.lockedSnapshot, { lang, addonNames });
  }

  if (day.fulfilledSnapshot) {
    localized.fulfilledSnapshot = localizeDaySnapshot(day.fulfilledSnapshot, { lang, addonNames });
  }

  return localized;
}

function localizeTimelineReadPayload(timeline, lang) {
  if (!timeline || typeof timeline !== "object") return timeline;

  return {
    subscriptionId: timeline.subscriptionId,
    dailyMealsRequired: timeline.dailyMealsConfig?.required || 3,
    premiumMealsRemaining: timeline.premiumMealsRemaining || 0,
    premiumMealsSelected: Number(timeline.premiumMealsSelected || 0),
    premiumBalanceBreakdown: Array.isArray(timeline.premiumBalanceBreakdown) ? timeline.premiumBalanceBreakdown : [],
    days: Array.isArray(timeline.days)
      ? timeline.days.map((day) => {
        const weekdayShort = day.calendar?.weekday?.shortLabels?.[lang] || "";
        const monthShort = day.calendar?.month?.shortLabels?.[lang] || "";
        const statusLabel = resolveReadLabel("timelineStatuses", day.status, lang);
        
        return {
          date: day.date,
          day: weekdayShort,
          month: monthShort,
          dayNumber: day.calendar?.dayOfMonth || 0,
          deliveryMode: day.deliveryMode || null,
          effectiveFulfillmentMode: day.effectiveFulfillmentMode || null,
          fulfillmentModeOverride: day.fulfillmentModeOverride || null,
          pickupLocationIdOverride: day.pickupLocationIdOverride || null,
          firstDayFulfillmentOverride: Boolean(day.firstDayFulfillmentOverride),
          status: day.status,
          dayStatus: day.dayStatus || day.status || "open",
          statusLabel,
          isPast: Boolean(day.isPast),
          autoSettled: Boolean(day.autoSettled),
          settledAt: day.settledAt || null,
          settlementReason: day.settlementReason || null,
          consumedByPolicy: Boolean(day.consumedByPolicy),
          selectedMeals: day.meals?.selected || 0,
          requiredMeals: day.meals?.required || 0,
          hasSelection: Boolean(day.hasSelection),
          selectionStatus: day.selectionStatus || "empty",
          paymentStatus: day.paymentStatus || "not_required",
          orderStatus: day.orderStatus || "none",
          subscriptionStatus: day.subscriptionStatus || null,
          timelineStatus: day.timelineStatus || "empty",
          isPlanned: Boolean(day.isPlanned),
          canShowAsPlanned: Boolean(day.canShowAsPlanned),
          canEdit: Boolean(day.canEdit),
          paymentStateReason: day.paymentStateReason || null,
          commercialState: day.commercialState || "draft",
          commercialStateLabel: resolveReadLabel("commercialStates", day.commercialState, lang),
          isFulfillable: Boolean(day.isFulfillable),
          canBePrepared: Boolean(day.canBePrepared),
          paymentRequirement: day.paymentRequirement
            ? {
              ...day.paymentRequirement,
              pricingStatusLabel: resolveReadLabel("pricingStatuses", day.paymentRequirement.pricingStatus, lang),
              blockingReasonLabel: day.paymentRequirement.blockingReason
                ? resolveReadLabel("paymentBlockingReasons", day.paymentRequirement.blockingReason, lang)
                : null,
            }
            : null,
          fulfillmentMode: day.fulfillmentMode || "no_service",
          consumptionState: day.consumptionState || "pending_day",
          requiredMealCount: Number(day.requiredMealCount || 0),
          specifiedMealCount: Number(day.specifiedMealCount || 0),
          unspecifiedMealCount: Number(day.unspecifiedMealCount || 0),
          hasCustomerSelections: Boolean(day.hasCustomerSelections),
          requiresMealTypeKnowledge: Boolean(day.requiresMealTypeKnowledge),
          planningReady: Boolean(day.planningReady),
          fulfillmentReady: Boolean(day.fulfillmentReady),
          deliveryWindow: day.deliveryWindow || null,
          deliveryAddress: day.deliveryAddress || null,
          pickupLocation: day.pickupLocation || null,
          fulfillmentSummary: day.fulfillmentSummary || null,
          lockedReason: day.lockedReason || null,
          lockedMessage: day.lockedMessage || null,
          selectedMealIds: Array.isArray(day.selectedMealIds) ? day.selectedMealIds : [],
          mealSlots: normalizeCanonicalMealSlots(day.mealSlots),
        };
      })
      : [],
  };
}

function localizeCheckoutDraftStatusReadPayload(payload, { lang, draft = null } = {}) {
  if (!payload || typeof payload !== "object") return payload;

  const localized = {
    ...payload,
    checkoutStatusLabel: resolveReadLabel("checkoutStatuses", payload.checkoutStatus, lang),
    paymentStatusLabel: resolveReadLabel("paymentStatuses", payload.paymentStatus, lang),
  };

  const planName = resolveFirstLocalizedText([
    draft && draft.contractSnapshot && draft.contractSnapshot.plan ? draft.contractSnapshot.plan.planName : null,
  ], lang);
  if (planName) {
    localized.planName = planName;
  }

  const deliveryMode = draft && draft.delivery && draft.delivery.type ? draft.delivery.type : null;
  if (deliveryMode) {
    localized.deliveryModeLabel = resolveReadLabel("deliveryModes", deliveryMode, lang);
  }

  const deliverySlotLabel = resolveWindowLabel(
    draft && draft.delivery && draft.delivery.slot ? draft.delivery.slot.window : "",
    lang
  );
  if (deliverySlotLabel) {
    localized.deliverySlotLabel = deliverySlotLabel;
  }

  return localized;
}

function localizeSubscriptionReadPayload(subscription, { lang, addonNames = new Map(), premiumNames = new Map(), premiumKeys = new Map(), planName = "" } = {}) {
  if (!subscription || typeof subscription !== "object") return subscription;

  const statusLabelAr = resolveReadLabel("subscriptionStatuses", subscription.status, "ar");
  const statusLabelEn = resolveReadLabel("subscriptionStatuses", subscription.status, "en");
  const deliveryModeLabelAr = resolveReadLabel("deliveryModes", subscription.deliveryMode, "ar");
  const deliveryModeLabelEn = resolveReadLabel("deliveryModes", subscription.deliveryMode, "en");

  const localized = {
    ...subscription,
    statusLabel: resolveReadLabel("subscriptionStatuses", subscription.status, lang),
    statusLabelAr,
    statusLabelEn,
    deliveryModeLabel: resolveReadLabel("deliveryModes", subscription.deliveryMode, lang),
    deliveryModeLabelAr,
    deliveryModeLabelEn,
  };

  if (planName) {
    localized.planName = planName;
  }

  if (Array.isArray(subscription.addonSubscriptions)) {
    localized.addonSubscriptions = localizeAddonRows(subscription.addonSubscriptions, {
      lang,
      addonNames,
      preferStoredName: false,
    });
  }

  if (Array.isArray(subscription.premiumBalance)) {
    localized.premiumBalance = subscription.premiumBalance.map((item) => {
      const rawProteinId = item.proteinId ? String(item.proteinId).trim() : null;
      const proteinId = rawProteinId || null;
      let premiumKey = item.premiumKey;

      if (!premiumKey && proteinId) {
        premiumKey = premiumKeys.get(proteinId);
      }
      if (!premiumKey) {
        premiumKey = resolvePremiumKeyFromName(item.name || "");
      }

      // Final safety check: if still null, throw instead of silent fallback
      if (!premiumKey) {
        console.error(`[PREMIUM_BALANCE_CONSISTENCY] CRITICAL: Failed to resolve premiumKey for item:`, {
          proteinId,
          name: item.name
        });
        throw new Error("Invalid premiumBalance row: premiumKey is required");
      }

      return {
        ...item,
        proteinId,
        premiumKey,
        name: getPremiumDisplayName({
          premiumKey,
          name: resolveCatalogOrStoredName({ 
            id: proteinId,
            liveName: proteinId ? premiumNames.get(proteinId) || "" : "",
            storedName: item.name || "", 
            lang 
          }),
          lang 
        }),
      };
    });
  } else {
    localized.premiumBalance = [];
  }
  if (planName) {
    localized.planName = planName;
  }

  // Canonical aliases for frontend compatibility
  localized.premiumSummary = localized.premiumBalance || [];
  localized.addonBalances = Array.isArray(localized.addonBalance) ? localized.addonBalance.map(row => {
    const purchasedQty = Number(row.purchasedQty != null ? row.purchasedQty : row.qty || 0);
    const remainingQty = Number(row.remainingQty != null ? row.remainingQty : Math.max(0, purchasedQty - Number(row.consumedQty || 0)));
    return {
      addonPlanId: row.addonPlanId || row.addonId || null,
      addonId: row.addonId || row.addonPlanId || null,
      name: row.name || "",
      category: row.category || "",
      purchasedDailyQty: Number(row.purchasedDailyQty || 0),
      includedTotalQty: Number(row.includedTotalQty != null ? row.includedTotalQty : purchasedQty),
      purchasedQty,
      consumedQty: Number(row.consumedQty != null ? row.consumedQty : Math.max(0, purchasedQty - remainingQty)),
      reservedQty: Number(row.reservedQty || 0),
      remainingQty,
      currency: row.currency || "SAR",
    };
  }) : [];
  localized.addonsSummary = (localized.addonBalance || []).map(row => ({
    addonId: row.addonId,
    name: row.name,
    purchasedQtyTotal: row.purchasedQty != null ? row.purchasedQty : row.qty || 0,
    remainingQtyTotal: row.remainingQty != null ? row.remainingQty : (row.qty || 0) - (row.consumedQty || 0),
    consumedQtyTotal: row.consumedQty != null ? row.consumedQty : Math.max(0, Number(row.purchasedQty || row.qty || 0) - Number(row.remainingQty || 0))
  }));

  return localized;
}

function localizeRenewalSeedReadPayload(renewalSeed, { lang, livePlan = null, previousSubscription = null } = {}) {
  if (!renewalSeed || typeof renewalSeed !== "object") return renewalSeed;

  const livePlanName = resolveFirstLocalizedText([livePlan && livePlan.name ? livePlan.name : null], lang);
  const snapshotPlanName = resolveFirstLocalizedText([
    previousSubscription
      && previousSubscription.contractSnapshot
      && previousSubscription.contractSnapshot.plan
      ? previousSubscription.contractSnapshot.plan.planName
      : null,
  ], lang);
  const planName = livePlanName || snapshotPlanName;
  const deliveryPreference = renewalSeed.seed && renewalSeed.seed.deliveryPreference
    ? renewalSeed.seed.deliveryPreference
    : null;
  const slotLabel = resolveWindowLabel(
    deliveryPreference && deliveryPreference.slot ? deliveryPreference.slot.window : "",
    lang
  );

  return {
    ...renewalSeed,
    seedSourceLabel: resolveReadLabel("renewalSeedSources", renewalSeed.seedSource, lang),
    seed: renewalSeed.seed
      ? {
        ...renewalSeed.seed,
        planName,
        daysLabel: formatDaysLabel(renewalSeed.seed.daysCount, lang),
        gramsLabel: formatGramsLabel(renewalSeed.seed.grams, lang),
        mealsPerDayLabel: formatMealsLabel(renewalSeed.seed.mealsPerDay, lang, true),
        deliveryPreference: deliveryPreference
          ? {
            ...deliveryPreference,
            modeLabel: resolveReadLabel("deliveryModes", deliveryPreference.mode, lang),
            slot: deliveryPreference.slot
              ? {
                ...deliveryPreference.slot,
                ...(slotLabel ? { label: slotLabel } : {}),
              }
              : deliveryPreference.slot,
          }
          : deliveryPreference,
      }
      : renewalSeed.seed,
  };
}

module.exports = {
  localizeCheckoutDraftStatusReadPayload,

  localizeCustomMeals,
  localizeCustomSalads,
  localizeDaySnapshot,
  localizePlanningView,
  localizeSubscriptionDayReadPayload,
  localizeSubscriptionReadPayload,
  localizeTimelineReadPayload,
  localizeRenewalSeedReadPayload,
  resolveCatalogOrStoredName,
  resolveFirstLocalizedText,
  resolveLocalizedText,
  resolveReadLabel,
  resolveWindowLabel,
};
