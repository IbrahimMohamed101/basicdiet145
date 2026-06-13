"use strict";

const { normalizeLegacyOrderStatus } = require("../../utils/orderState");

/**
 * Action Policy Engine for Dashboard Operations.
 * Responsibilities:
 * 1. Calculate allowed actions for a given entity, role, and mode.
 * 2. Validate if a requested action is permissible.
 * 3. Provide UI metadata (labels, colors, icons) for actions.
 */

const ACTION_REGISTRY = {
  start_preparation: {
    id: "start_preparation",
    label: { ar: "بدء التحضير", en: "Start Preparation" },
    color: "orange",
    icon: "chef-hat",
    endpoint: "/api/dashboard/ops/actions/start_preparation",
    method: "POST",
    roles: ["superadmin", "admin", "kitchen"],
  },
  lock: {
    id: "lock",
    label: { ar: "إغلاق لليوم", en: "Lock Day" },
    color: "blue",
    icon: "lock",
    endpoint: "/api/dashboard/ops/actions/lock",
    method: "POST",
    roles: ["superadmin", "admin", "kitchen"],
  },
  prepare: {
    id: "prepare",
    label: { ar: "بدء التحضير", en: "Start Preparation" },
    color: "orange",
    icon: "chef-hat",
    endpoint: "/api/dashboard/ops/actions/prepare",
    method: "POST",
    roles: ["superadmin", "admin", "kitchen"],
  },
  dispatch: {
    id: "dispatch",
    label: { ar: "خروج للتوصيل", en: "Dispatch" },
    color: "indigo",
    icon: "truck",
    endpoint: "/api/dashboard/ops/actions/dispatch",
    method: "POST",
    roles: ["superadmin", "admin", "kitchen", "courier"],
    modes: ["delivery"],
  },
  ready_for_pickup: {
    id: "ready_for_pickup",
    label: { ar: "جاهز للاستلام", en: "Ready for Pickup" },
    color: "green",
    icon: "shopping-bag",
    endpoint: "/api/dashboard/ops/actions/ready_for_pickup",
    method: "POST",
    roles: ["superadmin", "admin", "kitchen"],
    modes: ["pickup"],
  },
  notify_arrival: {
    id: "notify_arrival",
    label: { ar: "تنبيه بالوصول", en: "Notify Arrival" },
    color: "yellow",
    icon: "bell",
    endpoint: "/api/dashboard/ops/actions/notify_arrival",
    method: "POST",
    roles: ["superadmin", "admin", "courier"],
    modes: ["delivery"],
  },
  fulfill: {
    id: "fulfill",
    label: { ar: "إتمام العملية", en: "Fulfill" },
    color: "green",
    icon: "check-circle",
    endpoint: "/api/dashboard/ops/actions/fulfill",
    method: "POST",
    roles: ["superadmin", "admin", "courier", "kitchen"], // Courier for delivery, Kitchen for pickup
  },
  cancel: {
    id: "cancel",
    label: { ar: "إلغاء", en: "Cancel" },
    color: "red",
    icon: "x-circle",
    endpoint: "/api/dashboard/ops/actions/cancel",
    method: "POST",
    roles: ["superadmin", "admin", "kitchen", "courier"],
    requiresReason: true,
  },
  no_show: {
    id: "no_show",
    label: { ar: "لم يحضر", en: "No-show" },
    color: "red",
    icon: "user-x",
    endpoint: "/api/dashboard/ops/actions/no_show",
    method: "POST",
    roles: ["superadmin", "admin", "kitchen"],
    modes: ["pickup"],
    requiresReason: true,
  },
  reopen: {
    id: "reopen",
    label: { ar: "إعادة فتح", en: "Reopen" },
    color: "gray",
    icon: "rotate-ccw",
    endpoint: "/api/dashboard/ops/actions/reopen",
    method: "POST",
    roles: ["superadmin", "admin"],
  },
};

const TRANSITION_RULES = {
  subscription: {
    open: ["prepare", "lock", "cancel"],
    locked: ["prepare", "reopen", "cancel"],
    in_preparation: ["dispatch", "ready_for_pickup", "cancel"],
    out_for_delivery: ["notify_arrival", "fulfill", "cancel"],
    ready_for_pickup: ["fulfill", "cancel", "no_show"],
    fulfilled: [],
    delivery_canceled: ["reopen"],
    canceled_at_branch: ["reopen"],
    no_show: ["reopen"],
    skipped: [],
    frozen: [],
  },
  order: {
    created: ["lock", "cancel"],
    confirmed: ["prepare", "cancel"],
    in_preparation: ["dispatch", "ready_for_pickup", "cancel"],
    out_for_delivery: ["notify_arrival", "fulfill", "cancel"],
    ready_for_pickup: ["fulfill", "cancel"],
    fulfilled: [],
    cancelled: [],
    expired: [],
    pending_payment: [],
  },
  subscription_pickup_request: {
    locked: ["start_preparation", "cancel"],
    in_preparation: ["ready_for_pickup", "cancel"],
    ready_for_pickup: ["fulfill", "no_show"],
    fulfilled: [],
    no_show: [],
    canceled: [],
  },
};

function normalizeActionId(actionId) {
  if (actionId === "ready-for-pickup") return "ready_for_pickup";
  return actionId;
}

function roleAllowedForActionMode(actionId, role, mode) {
  if (actionId === "fulfill") {
    if (role === "kitchen" && mode !== "pickup") return false;
    if (role === "courier" && mode === "pickup") return false;
  }
  if (actionId === "cancel" && role === "courier" && mode !== "delivery") {
    return false;
  }
  return true;
}

/**
 * Get all allowed actions for an entity.
 */
function getAllowedActions({ entityType, status, mode, role, lang = "ar" }) {
  const normalizedEntityType = entityType === "subscription_day" || entityType === "pickup_day"
    ? "subscription"
    : entityType;
  const typeRules = TRANSITION_RULES[normalizedEntityType] || {};
  const normalizedStatus = normalizedEntityType === "order"
    ? normalizeLegacyOrderStatus(status)
    : status;
  const allowedIds = typeRules[normalizedStatus] || [];

  return allowedIds
    .map((actionId) => {
      const config = ACTION_REGISTRY[actionId];
      if (!config) return null;

      // Role check
      if (config.roles && !config.roles.includes(role)) return null;
      if (!roleAllowedForActionMode(actionId, role, mode)) return null;

      // Mode check (delivery/pickup)
      if (config.modes && !config.modes.includes(mode)) return null;

      return {
        id: config.id || actionId,
        label: config.label[lang] || config.label["en"],
        color: config.color,
        icon: config.icon,
        endpoint: config.endpoint,
        method: config.method || "POST",
        requiresReason: !!config.requiresReason,
      };
    })
    .filter(Boolean);
}

/**
 * Validate if an action is allowed.
 */
function validateAction({ entityType, status, mode, role, actionId }) {
  const normalizedActionId = normalizeActionId(actionId);
  const normalizedEntityType = entityType === "subscription_day" || entityType === "pickup_day"
    ? "subscription"
    : entityType;
  const normalizedStatus = normalizedEntityType === "order"
    ? normalizeLegacyOrderStatus(status)
    : status;
  const config = ACTION_REGISTRY[normalizedActionId];
  if (!config) {
    return { allowed: false, reason: "UNKNOWN_ACTION" };
  }

  // Role check
  if (config.roles && !config.roles.includes(role)) {
    return { allowed: false, reason: "INSUFFICIENT_PERMISSIONS" };
  }

  // Mode check
  if (config.modes && !config.modes.includes(mode)) {
    return { allowed: false, reason: "INVALID_MODE_FOR_ACTION" };
  }

  // State check
  if (!roleAllowedForActionMode(normalizedActionId, role, mode)) {
    return { allowed: false, reason: "INVALID_ROLE_FOR_MODE" };
  }

  const typeRules = TRANSITION_RULES[normalizedEntityType] || {};
  const allowedIds = typeRules[normalizedStatus] || [];
  const transitionActionId = normalizedEntityType === "subscription_pickup_request" && normalizedActionId === "prepare"
    ? "start_preparation"
    : normalizedActionId;
  if (!allowedIds.includes(transitionActionId)) {
    return { allowed: false, reason: "INVALID_STATE_TRANSITION" };
  }

  return { allowed: true };
}

module.exports = {
  getAllowedActions,
  validateAction,
  ACTION_REGISTRY,
  normalizeActionId,
};
