const { pickLang } = require("../../utils/i18n");
const opsActionPolicy = require("./opsActionPolicy");
const { buildSubscriptionDayFulfillmentState } = require("../subscription/subscriptionDayFulfillmentStateService");
const { getAllowedOrderActions } = require("../orders/orderOpsTransitionService");
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
} = require("./opsPayloadService");

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

function mapSubscriptionDayToDTO(day, delivery, subscription, user, role, lang, catalogMaps = {}) {
  const status = day.status;
  const mode = subscription && subscription.deliveryMode === "pickup" ? "pickup" : "delivery";
  const ui = resolveUiMetadata(status, lang);
  const fulfillmentState = buildSubscriptionDayFulfillmentState({
    subscription,
    day,
    today: day.date,
  });
  
  const allowedActions = opsActionPolicy.getAllowedActions({
    entityType: "subscription",
    status,
    mode,
    role,
    lang,
  });
  
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
    type: "subscription",
    mode,
    reference: `SUB-${String(day.subscriptionId).slice(-6).toUpperCase()}`,
    status,
    statusLabel: day.status, // To be localized
    fulfillmentType: mode === "pickup" ? "branch_pickup" : "home_delivery",
    plan,
    kitchenDetails,
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
    pickup: mode === "pickup" ? buildPickupPayload({ subscription, day }) : null,
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

  const allowedActions = getAllowedOrderActions(order, { role })
    .map((actionId) => {
      const config = opsActionPolicy.ACTION_REGISTRY[actionId];
      if (!config) return null;
      return {
        id: config.id || actionId,
        label: config.label[lang] || config.label.en,
        color: config.color,
        icon: config.icon,
        endpoint: config.endpoint,
        method: config.method || "POST",
        requiresReason: !!config.requiresReason,
      };
    })
    .filter(Boolean);

  const deliveryPayload = buildDeliveryPayload(delivery, {
    date: order.fulfillmentDate || order.deliveryDate,
    status: null,
    address: order.deliveryAddress || (order.delivery && order.delivery.address ? order.delivery.address : null),
    window: order.deliveryWindow || (order.delivery && order.delivery.deliveryWindow ? order.delivery.deliveryWindow : ""),
    zoneId: order.delivery && order.delivery.zoneId ? order.delivery.zoneId : null,
  });

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
    kitchenDetails: buildOrderKitchenDetailsPayload(order, lang, catalogMaps),
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
  });

  return {
    source: "subscription_pickup_request",
    entityType: "subscription_pickup_request",
    entityId: String(pickupRequest._id),
    requestId: String(pickupRequest._id),
    id: String(pickupRequest._id),
    type: "subscription_pickup_request",
    mode: "pickup",
    reference: `PICK-${String(pickupRequest._id).slice(-6).toUpperCase()}`,
    subscriptionId: String(pickupRequest.subscriptionId || ""),
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
        mealSlots: Array.isArray(pickupRequest.snapshot.mealSlots)
          ? pickupRequest.snapshot.mealSlots.map((slot) => ({
            ...buildKitchenDetailsPayload({ mealSlots: [slot] }, subscription || {}, lang, catalogMaps).mealSlots[0],
          }))
          : [],
        addons: buildKitchenDetailsPayload({
          addonSelections: Array.isArray(pickupRequest.snapshot.addons) ? pickupRequest.snapshot.addons : [],
        }, subscription || {}, lang, catalogMaps).addons,
      }
      : buildKitchenDetailsPayload({}, subscription || {}, lang, catalogMaps),
    paymentValidity: {
      paymentRequired: false,
      paymentStatus: "reserved",
      paymentApplied: Boolean(pickupRequest.creditsReserved),
      pendingUnpaid: false,
      superseded: false,
      revisionMismatch: false,
      canPrepare: ["locked"].includes(status) && Boolean(pickupRequest.creditsReserved),
      canFulfill: ["ready_for_pickup"].includes(status) && Boolean(pickupRequest.creditsReserved) && !pickupRequest.creditsReleasedAt,
      reason: pickupRequest.creditsReleasedAt ? "CREDITS_RELEASED" : null,
    },
    currentStep: statusPayload.currentStep,
    isReady: statusPayload.isReady,
    isCompleted: statusPayload.isCompleted,
    pickupCode: statusPayload.pickupCode,
    pickupCodeIssuedAt: statusPayload.pickupCodeIssuedAt,
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
      pickupPreparedAt: pickupRequest.pickupPreparedAt || null,
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
    },
  };
}

module.exports = {
  mapSubscriptionDayToDTO,
  mapSubscriptionPickupRequestToDTO,
  mapOrderToDTO,
  resolveUiMetadata,
};
