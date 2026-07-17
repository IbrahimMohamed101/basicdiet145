const { pickLang } = require("../../utils/i18n");
const opsActionPolicy = require("./opsActionPolicy");
const { buildSubscriptionDayFulfillmentState } = require("../subscription/subscriptionDayFulfillmentStateService");
const { normalizeLegacyOrderStatus } = require("../../utils/orderState");
const { getOrderFulfillmentMethod } = require("../../utils/oneTimeOrderDeliveryGate");
const { mapSubscriptionPickupRequestStatus } = require("../subscription/subscriptionPickupRequestClientService");
const {
  buildDeliveryPayload,
  buildKitchenDetailsPayload,
  buildOrderKitchenDetailsPayload,
  buildPaymentValidityPayload,
  buildPickupPayload,
  buildPlanPayload,
  stringifyId,
} = require("./opsPayloadService");
const { buildKitchenProjection } = require("./kitchenProjectionService");

/**
 * Service to map internal models to the UnifiedOperationalDTO.
 * This ensures the frontend receives a sanitized, render-ready contract.
 */

const STATUS_METADATA = {
  // Common for SubscriptionDay and Order
  open: { badge: "info", icon: "clock" },
  frozen: { badge: "info", icon: "cloud-snow" },
  locked: { badge: "info", icon: "lock" },
  in_preparation: { badge: "warning", icon: "chef-hat" },
  ready_for_pickup: { badge: "success", icon: "shopping-bag" },
  fulfilled: { badge: "success", icon: "check-circle" },
  consumed_without_preparation: { badge: "secondary", icon: "calendar-x" },
  delivery_canceled: { badge: "danger", icon: "x-circle" },
  canceled_at_branch: { badge: "danger", icon: "x-circle" },
  no_show: { badge: "danger", icon: "user-x" },
  canceled: { badge: "danger", icon: "x-circle" },
  skipped: { badge: "secondary", icon: "skip-forward" },

  // Specific for Orders/Deliveries
  out_for_delivery: { badge: "info", icon: "truck" },
  on_the_way: { badge: "info", icon: "truck" }, // Alias for ui
  cancelled: { badge: "danger", icon: "x-circle" },
  confirmed: { badge: "info", icon: "check" },
};

function resolveUiMetadata(status, lang) {
  const meta = STATUS_METADATA[status] || { badge: "secondary", icon: "help-circle" };
  const labelKey = `read.dayStatuses.${status === 'out_for_delivery' ? 'on_the_way' : status}`;

  // Note: We'll assume the caller passes a loaded i18n helper or we'll need to
  // use the locale files directly. For this implementation, we'll return the key
  // or a simple mapping if the full i18n is too heavy for the DTO.
  // Actually, let's just use the direct mapping for Phase 1.

  return {
    label: status, // Fallback, normally localized by service
    badge: meta.badge,
    icon: meta.icon,
  };
}

function mapSubscriptionDayToDTO(day, delivery, subscription, user, role, lang, catalogMaps = {}, pickupRequest = null) {
  const status = day.status;
  const baseMode = subscription && subscription.deliveryMode === "pickup" ? "pickup" : "delivery";
  const mode = day && day.fulfillmentModeOverride ? day.fulfillmentModeOverride : baseMode;
  const ui = resolveUiMetadata(status, lang);
  const fulfillmentState = buildSubscriptionDayFulfillmentState({
    subscription,
    day,
    today: day.date,
  });

  const pickupPayload = mode === "pickup" ? buildPickupPayload({ pickupRequest, subscription, day }) : null;

  let allowedActions = opsActionPolicy.getAllowedActions({
    entityType: "subscription",
    status,
    mode,
    role,
    lang,
  });

  if (mode === "pickup" && (!pickupPayload || !pickupPayload.pickupRequestId)) {
    allowedActions = allowedActions.filter(
      (action) => !["prepare", "ready_for_pickup", "fulfill"].includes(action.id)
    );
  }

  const plan = buildPlanPayload(subscription, lang);
  const kitchenDetails = buildKitchenDetailsPayload(day, subscription, lang, catalogMaps);
  const paymentValidity = buildPaymentValidityPayload(day);
  const deliveryPayload = buildDeliveryPayload(delivery, {
    date: day.date,
    status: null,
    address: day.deliveryAddressOverride || subscription.deliveryAddress || null,
    window: day.deliveryWindowOverride || subscription.deliveryWindow || "",
    zoneId: subscription.deliveryZoneId || null,
  });

  return {
    source: "subscription",
    entityType: "subscription_day",
    entityId: String(day._id),
    id: String(day._id),
    subscriptionId: stringifyId(day.subscriptionId),
    type: "subscription",
    mode,
    deliveryMode: baseMode,
    fulfillmentModeOverride: day.fulfillmentModeOverride || null,
    effectiveFulfillmentMode: mode,
    pickupLocationIdOverride: day.pickupLocationIdOverride || null,
    firstDayFulfillmentOverride: Boolean(day.fulfillmentModeOverride),
    reference: `SUB-${String(day.subscriptionId).slice(-6).toUpperCase()}`,
    status,
    statusLabel: day.status, // To be localized
    fulfillmentType: mode === "pickup" ? "branch_pickup" : "home_delivery",
    mealCount: Array.isArray(day.mealSlots) ? day.mealSlots.length : 0,
    plan,
    kitchenDetails,
    ...buildKitchenProjection(kitchenDetails),
    paymentValidity,
    ui: {
      ...ui,
      label: day.status, // To be localized in opsReadService
    },
    customer: {
      id: String(user ? user._id : ""),
      name: user ? user.name : "Unknown",
      phone: user ? user.phone : "",
    },
    context: {
      date: day.date,
      window: day.deliveryWindowOverride || subscription.deliveryWindow || "",
      address: day.deliveryAddressOverride || subscription.deliveryAddress || null,
      branch: mode === "pickup" ? "Main Branch" : null, // Placeholder
      pickupCode: day.pickupCode || null,
      requiredMealCount: fulfillmentState.requiredMealCount,
      specifiedMealCount: fulfillmentState.specifiedMealCount,
      unspecifiedMealCount: fulfillmentState.unspecifiedMealCount,
      fulfillmentMode: fulfillmentState.fulfillmentMode,
      consumptionState: fulfillmentState.consumptionState,
      pickupRequested: fulfillmentState.pickupRequested,
      pickupPrepared: fulfillmentState.pickupPrepared,
      pickupPreparationFlowStatus: fulfillmentState.pickupPreparationFlowStatus,
      dayEndConsumptionReason: fulfillmentState.dayEndConsumptionReason,
      mealTypesSpecified: fulfillmentState.mealTypesSpecified,
    },
    delivery: {
      ...deliveryPayload,
      method: mode,
    },
    pickup: pickupPayload,
    allowedActions,
    timestamps: {
      createdAt: day.createdAt,
      updatedAt: day.updatedAt,
    },
  };
}

function mapOrderToDTO(order, delivery, user, role, lang, catalogMaps = {}) {
  const status = normalizeLegacyOrderStatus(order.status, { paymentStatus: order.paymentStatus });
  const mode = getOrderFulfillmentMethod(order);
  const ui = resolveUiMetadata(status, lang);
  const pickupCode = order.pickupCode || (order.pickup && order.pickup.pickupCode) || null;

  const allowedActions = opsActionPolicy.getAllowedActions({
    entityType: "order",
    status,
    mode,
    role,
    lang,
  });

  const deliveryPayload = buildDeliveryPayload(delivery, {
    date: order.fulfillmentDate || order.deliveryDate,
    status: null,
    address: order.deliveryAddress || (order.delivery && order.delivery.address ? order.delivery.address : null),
    window: order.deliveryWindow || (order.delivery && order.delivery.deliveryWindow ? order.delivery.deliveryWindow : ""),
    zoneId: order.delivery && order.delivery.zoneId ? order.delivery.zoneId : null,
  });
  const kitchenDetails = buildOrderKitchenDetailsPayload(order, lang, catalogMaps);

  return {
    source: "one_time_order",
    entityType: "order",
    entityId: String(order._id),
    id: String(order._id),
    orderId: String(order._id),
    type: "order",
    mode,
    reference: `ORD-${String(order._id).slice(-6).toUpperCase()}`,
    orderNumber: order.orderNumber || "",
    status,
    statusLabel: status,
    paymentStatus: order.paymentStatus || "paid",
    fulfillmentMethod: mode,
    fulfillmentType: mode === "pickup" ? "branch_pickup" : "delivery",
    kitchenDetails,
    ...buildKitchenProjection(kitchenDetails),
    paymentValidity: {
      paymentRequired: true,
      paymentStatus: order.paymentStatus || "initiated",
      paymentApplied: String(order.paymentStatus || "") === "paid",
      pendingUnpaid: String(order.paymentStatus || "") !== "paid",
      superseded: false,
      revisionMismatch: false,
      canPrepare: String(order.paymentStatus || "") === "paid" && status === "confirmed",
      canFulfill: String(order.paymentStatus || "") === "paid" && ["out_for_delivery", "ready_for_pickup"].includes(status),
      reason: String(order.paymentStatus || "") === "paid" ? null : "ORDER_PAYMENT_REQUIRED",
    },
    ui: {
      ...ui,
      label: status, // To be localized in opsReadService
    },
    customer: {
      id: String(user ? user._id : ""),
      name: user ? user.name : "Unknown",
      phone: user ? user.phone : "",
    },
    items: order.items || [],
    mealCount: Array.isArray(order.items) ? order.items.reduce((sum, item) => sum + Number(item.quantity || 1), 0) : 0,
    pricing: order.pricing || {},
    delivery: mode === "delivery" ? { ...(order.delivery || {}), ...deliveryPayload } : {},
    pickup: mode === "pickup" ? {
      ...buildPickupPayload({ subscription: {}, day: order }),
      ...(order.pickup || {}),
      pickupCode,
      pickupCodeIssuedAt: order.pickupCodeIssuedAt || null,
      pickupVerifiedAt: order.pickupVerifiedAt || null,
    } : {},
    context: {
      date: order.fulfillmentDate || order.deliveryDate,
      window: order.deliveryWindow || (order.delivery && order.delivery.deliveryWindow ? order.delivery.deliveryWindow : ""),
      address: order.deliveryAddress || (order.delivery && order.delivery.address ? order.delivery.address : null),
      branch: mode === "pickup" ? "Main Branch" : null,
      pickupCode,
      pickupCodeIssuedAt: order.pickupCodeIssuedAt || null,
      pickupVerifiedAt: order.pickupVerifiedAt || null,
    },
    allowedActions,
    createdAt: order.createdAt || null,
    timestamps: {
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    },
  };
}

function mapSubscriptionPickupRequestToDTO(pickupRequest, subscription, user, role, lang, catalogMaps = {}) {
  const statusPayload = mapSubscriptionPickupRequestStatus(pickupRequest, { includeNextAction: false });
  const status = statusPayload.status;
  const ui = resolveUiMetadata(status, lang);
  const allowedActions = opsActionPolicy.getAllowedActions({
    entityType: "subscription_pickup_request",
    status,
    mode: "pickup",
    role,
    lang,
  }).map((action) => {
    if (!action || action.id !== "start_preparation") return action;
    return {
      ...action,
      id: "prepare",
      endpoint: "/api/dashboard/ops/actions/prepare",
    };
  });
  const preparedAt = pickupRequest.pickupPreparedAt || pickupRequest.preparationStartedAt || null;
  const snapshotDay = pickupRequest.snapshot
    ? {
      status: "open",
      plannerState: "confirmed",
      mealSlots: Array.isArray(pickupRequest.snapshot.mealSlots) ? pickupRequest.snapshot.mealSlots : [],
      addonSelections: Array.isArray(pickupRequest.snapshot.addons) ? pickupRequest.snapshot.addons : [],
      premiumExtraPayment: pickupRequest.snapshot.premiumExtraPayment || null,
      plannerMeta: {
        requiredSlotCount: Number(pickupRequest.mealCount || 0),
        completeSlotCount: Array.isArray(pickupRequest.snapshot.mealSlots) ? pickupRequest.snapshot.mealSlots.length : 0,
        partialSlotCount: 0,
        isDraftValid: true,
      },
    }
    : null;
  const snapshotPaymentValidity = snapshotDay ? buildPaymentValidityPayload(snapshotDay) : null;
  const creditsAvailableForOps = Boolean(pickupRequest.creditsReserved) && !pickupRequest.creditsReleasedAt;
  const paymentBlocksOps = Boolean(snapshotPaymentValidity && snapshotPaymentValidity.pendingUnpaid);

  const dto = {
    source: "subscription_pickup_request",
    entityType: "subscription_pickup_request",
    entityId: String(pickupRequest._id),
    requestId: String(pickupRequest._id),
    id: String(pickupRequest._id),
    type: "subscription_pickup_request",
    mode: "pickup",
    reference: `PICK-${String(pickupRequest._id).slice(-6).toUpperCase()}`,
    subscriptionId: stringifyId(pickupRequest.subscriptionId),
    subscriptionDayId: pickupRequest.subscriptionDayId ? String(pickupRequest.subscriptionDayId) : null,
    userId: String(pickupRequest.userId || ""),
    date: pickupRequest.date,
    mealCount: Number(pickupRequest.mealCount || 0),
    status,
    statusLabel: statusPayload.statusLabel,
    fulfillmentType: "pickup_request",
    plan: buildPlanPayload(subscription || {}, lang),
    kitchenDetails: pickupRequest.snapshot
      ? {
        mealSlots: (Array.isArray(pickupRequest.snapshot.mealSlots) && pickupRequest.snapshot.mealSlots.length > 0)
          ? pickupRequest.snapshot.mealSlots.map((slot) => ({
            ...buildKitchenDetailsPayload({ mealSlots: [slot] }, subscription || {}, lang, catalogMaps).mealSlots[0],
          }))
          : (Array.isArray(pickupRequest.selectedPickupItems) && pickupRequest.selectedPickupItems.length > 0
            ? pickupRequest.selectedPickupItems.map((item, index) => {
                const itemIdStr = item.itemId ? String(item.itemId) : null;
                const realId = (item.product && (item.product.id || item.product._id)) || item.addonId || item.sourceId;
                const realIdStr = realId ? String(realId) : null;
                const isSandwich = item.itemType === "sandwich";
                const catalogDoc = isSandwich
                  ? (catalogMaps.sandwichById && (catalogMaps.sandwichById.get(itemIdStr) || catalogMaps.sandwichById.get(realIdStr)))
                  : (catalogMaps.productById && (catalogMaps.productById.get(itemIdStr) || catalogMaps.productById.get(realIdStr)));

                let defaultNameEn = item.display && item.display.titleEn ? item.display.titleEn : "Unknown";
                let defaultNameAr = item.display && item.display.titleAr ? item.display.titleAr : "غير معروف";

                let resolvedNameEn = defaultNameEn;
                let resolvedNameAr = defaultNameAr;

                if (catalogDoc && catalogDoc.name) {
                   if (typeof catalogDoc.name === 'object') {
                       resolvedNameEn = catalogDoc.name.en || catalogDoc.name.ar || defaultNameEn;
                       resolvedNameAr = catalogDoc.name.ar || catalogDoc.name.en || defaultNameAr;
                   } else {
                       resolvedNameEn = catalogDoc.name;
                       resolvedNameAr = catalogDoc.name;
                   }
                }

                const selectedOptions = (Array.isArray(item.components) ? item.components : []).map(comp => {
                    const compIdStr = comp.id ? String(comp.id) : null;
                    const optionDoc = catalogMaps.optionById && catalogMaps.optionById.get(compIdStr);
                    return {
                        optionId: compIdStr,
                        optionKey: comp.key || (optionDoc ? optionDoc.key : null),
                        nameI18n: {
                            ar: (optionDoc && optionDoc.name && optionDoc.name.ar) ? optionDoc.name.ar : (comp.name && comp.name.ar ? comp.name.ar : null),
                            en: (optionDoc && optionDoc.name && optionDoc.name.en) ? optionDoc.name.en : (comp.name && comp.name.en ? comp.name.en : null),
                        },
                        groupNameI18n: {
                            ar: comp.groupName && comp.groupName.ar ? comp.groupName.ar : null,
                            en: comp.groupName && comp.groupName.en ? comp.groupName.en : null,
                        },
                        quantity: comp.quantity || 1
                    };
                });

                return {
                  slotIndex: index + 1,
                  slotKey: `pickup_item_${index + 1}`,
                  selectionType: item.itemType || "standard_meal",
                  productId: itemIdStr,
                  productKey: catalogDoc ? catalogDoc.key : null,
                  productName: resolvedNameEn,
                  productNameI18n: { ar: resolvedNameAr, en: resolvedNameEn },
                  sandwichId: isSandwich ? itemIdStr : null,
                  sandwichKey: isSandwich && catalogDoc ? catalogDoc.key : null,
                  sandwichName: isSandwich ? resolvedNameEn : "",
                  sandwichNameI18n: isSandwich ? { ar: resolvedNameAr, en: resolvedNameEn } : undefined,
                  proteinId: null,
                  proteinKey: null,
                  proteinName: "",
                  proteinNameI18n: { ar: "", en: "" },
                  proteinGrams: null,
                  proteinFamilyKey: null,
                  carbSelections: [],
                  salad: null,
                  sauce: [],
                  selectedOptions,
                  sides: [],
                  isPremium: item.itemType === "premium_meal",
                  premiumKey: null,
                  premiumSource: "none",
                  quantity: item.quantity || 1,
                  notes: null,
                };
              })
            : Array.from({ length: Number(pickupRequest.mealCount || 0) }).map((_, index) => ({
                slotIndex: index + 1,
                slotKey: `chef_choice_${index + 1}`,
                selectionType: "chef_choice",
                productId: null,
                productKey: "chef_choice",
                productName: "Chef Choice",
                productNameI18n: { ar: "اختيار الشيف", en: "Chef Choice" },
                proteinId: null,
                proteinKey: null,
                proteinName: "",
                proteinNameI18n: { ar: "", en: "" },
                proteinGrams: null,
                proteinFamilyKey: null,
                carbSelections: [],
                salad: null,
                sauce: [],
                selectedOptions: [],
                sides: [],
                sandwichId: null,
                isPremium: false,
                premiumKey: null,
                premiumSource: "none",
                quantity: 1,
                notes: null,
              }))),
        addons: buildKitchenDetailsPayload({
          addonSelections: Array.isArray(pickupRequest.snapshot.addons) ? pickupRequest.snapshot.addons : [],
        }, subscription || {}, lang, catalogMaps).addons,
      }
      : buildKitchenDetailsPayload({}, subscription || {}, lang, catalogMaps),
    paymentValidity: {
      paymentRequired: Boolean(snapshotPaymentValidity && snapshotPaymentValidity.paymentRequired),
      paymentStatus: paymentBlocksOps
        ? snapshotPaymentValidity.paymentStatus
        : "reserved",
      paymentApplied: Boolean(creditsAvailableForOps && !paymentBlocksOps),
      pendingUnpaid: paymentBlocksOps,
      superseded: Boolean(snapshotPaymentValidity && snapshotPaymentValidity.superseded),
      revisionMismatch: Boolean(snapshotPaymentValidity && snapshotPaymentValidity.revisionMismatch),
      canPrepare: ["locked"].includes(status) && creditsAvailableForOps && !paymentBlocksOps,
      canFulfill: ["ready_for_pickup"].includes(status) && creditsAvailableForOps && !paymentBlocksOps,
      reason: pickupRequest.creditsReleasedAt
        ? "CREDITS_RELEASED"
        : (paymentBlocksOps ? snapshotPaymentValidity.reason || "PAYMENT_REQUIRED" : null),
    },
    currentStep: statusPayload.currentStep,
    isReady: statusPayload.isReady,
    isCompleted: statusPayload.isCompleted,
    pickupCode: statusPayload.pickupCode,
    pickupCodeIssuedAt: statusPayload.pickupCodeIssuedAt,
    preparedAt,
    pickupPreparedAt: preparedAt,
    fulfilledAt: statusPayload.fulfilledAt,
    ui: {
      ...ui,
      label: status,
    },
    customer: {
      id: String(user ? user._id : pickupRequest.userId || ""),
      name: user ? user.name : "Unknown",
      phone: user ? user.phone : "",
    },
    pickup: {
      pickupLocationId: subscription && subscription.pickupLocationId ? String(subscription.pickupLocationId) : null,
      pickupCode: statusPayload.pickupCode,
      pickupCodeIssuedAt: statusPayload.pickupCodeIssuedAt,
      pickupPreparedAt: preparedAt,
      pickupNoShowAt: pickupRequest.pickupNoShowAt || null,
      ...buildPickupPayload({ pickupRequest, subscription: subscription || {} }),
    },
    context: {
      date: pickupRequest.date,
      branch: "Main Branch",
      pickupCode: statusPayload.pickupCode,
      mealCount: Number(pickupRequest.mealCount || 0),
      snapshot: pickupRequest.snapshot || null,
      creditsReserved: Boolean(pickupRequest.creditsReserved),
      creditsConsumedAt: pickupRequest.creditsConsumedAt || null,
      creditsReleasedAt: pickupRequest.creditsReleasedAt || null,
    },
    snapshot: pickupRequest.snapshot || null,
    allowedActions,
    createdAt: pickupRequest.createdAt || null,
    timestamps: {
      createdAt: pickupRequest.createdAt,
      updatedAt: pickupRequest.updatedAt,
      preparedAt,
    },
  };
  return { ...dto, ...buildKitchenProjection(dto.kitchenDetails) };
}

module.exports = {
  mapSubscriptionDayToDTO,
  mapSubscriptionPickupRequestToDTO,
  mapOrderToDTO,
  resolveUiMetadata,
};
