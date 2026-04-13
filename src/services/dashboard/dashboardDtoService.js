const { pickLang } = require("../../utils/i18n");
const opsActionPolicy = require("./opsActionPolicy");

/**
 * Service to map internal models to the UnifiedOperationalDTO.
 * This ensures the frontend receives a sanitized, render-ready contract.
 */

const STATUS_METADATA = {
  // Common for SubscriptionDay and Order
  open: { badge: "info", icon: "clock" },
  frozen: { badge: "info", icon: "cloud-snow" },
  locked: { badge: "info", icon: "lock" },
  preparing: { badge: "warning", icon: "chef-hat" },
  ready_for_pickup: { badge: "success", icon: "shopping-bag" },
  fulfilled: { badge: "success", icon: "check-circle" },
  delivery_canceled: { badge: "danger", icon: "x-circle" },
  canceled_at_branch: { badge: "danger", icon: "x-circle" },
  no_show: { badge: "danger", icon: "user-x" },
  skipped: { badge: "secondary", icon: "skip-forward" },
  
  // Specific for Orders/Deliveries
  out_for_delivery: { badge: "info", icon: "truck" },
  on_the_way: { badge: "info", icon: "truck" }, // Alias for ui
  canceled: { badge: "danger", icon: "x-circle" },
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

function mapSubscriptionDayToDTO(day, delivery, subscription, user, role, lang) {
  const status = day.status;
  const mode = day.pickupRequested ? "pickup" : "delivery";
  const ui = resolveUiMetadata(status, lang);
  
  const allowedActions = opsActionPolicy.getAllowedActions({
    entityType: "subscription",
    status,
    mode,
    role,
    lang,
  });
  
  return {
    id: String(day._id),
    type: "subscription",
    mode,
    reference: `SUB-${String(day.subscriptionId).slice(-6).toUpperCase()}`,
    status,
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
      branch: day.pickupRequested ? "Main Branch" : null, // Placeholder
      pickupCode: day.pickupCode || null,
    },
    allowedActions,
    timestamps: {
      createdAt: day.createdAt,
      updatedAt: day.updatedAt,
    },
  };
}

function mapOrderToDTO(order, delivery, user, role, lang) {
  const status = order.status;
  const mode = order.deliveryMode;
  const ui = resolveUiMetadata(status, lang);

  const allowedActions = opsActionPolicy.getAllowedActions({
    entityType: "order",
    status,
    mode,
    role,
    lang,
  });

  return {
    id: String(order._id),
    type: "order",
    mode,
    reference: `ORD-${String(order._id).slice(-6).toUpperCase()}`,
    status,
    ui: {
      ...ui,
      label: order.status, // To be localized in opsReadService
    },
    customer: {
      id: String(user ? user._id : ""),
      name: user ? user.name : "Unknown",
      phone: user ? user.phone : "",
    },
    context: {
      date: order.deliveryDate,
      window: order.deliveryWindow || "",
      address: order.deliveryAddress || null,
      branch: mode === "pickup" ? "Main Branch" : null,
    },
    allowedActions,
    timestamps: {
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    },
  };
}

module.exports = {
  mapSubscriptionDayToDTO,
  mapOrderToDTO,
  resolveUiMetadata,
};
