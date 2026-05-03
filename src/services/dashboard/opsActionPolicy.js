"use strict";

/**
 * Action Policy Engine for Dashboard Operations.
 * Responsibilities:
 * 1. Calculate allowed actions for a given entity, role, and mode.
 * 2. Validate if a requested action is permissible.
 * 3. Provide UI metadata (labels, colors, icons) for actions.
 */

const ACTION_REGISTRY = {
  lock: {
    label: { ar: "إغلاق لليوم", en: "Lock Day" },
    color: "blue",
    icon: "lock",
    roles: ["admin", "kitchen"],
  },
  prepare: {
    label: { ar: "بدء التحضير", en: "Start Preparation" },
    color: "orange",
    icon: "chef-hat",
    roles: ["admin", "kitchen"],
  },
  dispatch: {
    label: { ar: "خروج للتوصيل", en: "Dispatch" },
    color: "indigo",
    icon: "truck",
    roles: ["admin", "kitchen", "courier"],
    modes: ["delivery"],
  },
  ready_for_pickup: {
    label: { ar: "جاهز للاستلام", en: "Ready for Pickup" },
    color: "green",
    icon: "shopping-bag",
    roles: ["admin", "kitchen"],
    modes: ["pickup"],
  },
  notify_arrival: {
    label: { ar: "تنبيه بالوصول", en: "Notify Arrival" },
    color: "yellow",
    icon: "bell",
    roles: ["admin", "courier"],
    modes: ["delivery"],
  },
  fulfill: {
    label: { ar: "إتمام العملية", en: "Fulfill" },
    color: "green",
    icon: "check-circle",
    roles: ["admin", "courier", "kitchen"], // Courier for delivery, Kitchen for pickup
  },
  cancel: {
    label: { ar: "إلغاء", en: "Cancel" },
    color: "red",
    icon: "x-circle",
    roles: ["admin", "kitchen", "courier"],
    requiresReason: true,
  },
  reopen: {
    label: { ar: "إعادة فتح", en: "Reopen" },
    color: "gray",
    icon: "rotate-ccw",
    roles: ["admin"],
  },
};

const TRANSITION_RULES = {
  subscription: {
    open: ["prepare", "lock", "cancel"],
    locked: ["prepare", "reopen", "cancel"],
    in_preparation: ["dispatch", "ready_for_pickup", "cancel"],
    out_for_delivery: ["notify_arrival", "fulfill", "cancel"],
    ready_for_pickup: ["fulfill", "cancel"],
    fulfilled: [],
    delivery_canceled: ["reopen"],
    canceled_at_branch: ["reopen"],
    no_show: ["reopen"],
    skipped: ["cancel"],
    frozen: ["cancel"],
  },
  order: {
    created: ["lock", "cancel"],
    confirmed: ["prepare", "cancel"],
    preparing: ["dispatch", "ready_for_pickup", "cancel"],
    out_for_delivery: ["notify_arrival", "fulfill", "cancel"],
    ready_for_pickup: ["fulfill", "cancel"],
    fulfilled: [],
    canceled: [],
  },
};

/**
 * Get all allowed actions for an entity.
 */
function getAllowedActions({ entityType, status, mode, role, lang = "ar" }) {
  const normalizedEntityType = entityType === "subscription_day" || entityType === "pickup_day"
    ? "subscription"
    : entityType;
  const typeRules = TRANSITION_RULES[normalizedEntityType] || {};
  const allowedIds = typeRules[status] || [];

  return allowedIds
    .map((actionId) => {
      const config = ACTION_REGISTRY[actionId];
      if (!config) return null;

      // Role check
      if (config.roles && !config.roles.includes(role)) return null;

      // Mode check (delivery/pickup)
      if (config.modes && !config.modes.includes(mode)) return null;

      return {
        id: actionId,
        label: config.label[lang] || config.label["en"],
        color: config.color,
        icon: config.icon,
        requiresReason: !!config.requiresReason,
      };
    })
    .filter(Boolean);
}

/**
 * Validate if an action is allowed.
 */
function validateAction({ entityType, status, mode, role, actionId }) {
  const normalizedEntityType = entityType === "subscription_day" || entityType === "pickup_day"
    ? "subscription"
    : entityType;
  const config = ACTION_REGISTRY[actionId];
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
  if (actionId === "fulfill" && role === "kitchen" && mode !== "pickup") {
    return { allowed: false, reason: "INVALID_ROLE_FOR_MODE" };
  }
  if (actionId === "cancel" && role === "courier" && mode !== "delivery") {
    return { allowed: false, reason: "INVALID_ROLE_FOR_MODE" };
  }

  const typeRules = TRANSITION_RULES[normalizedEntityType] || {};
  const allowedIds = typeRules[status] || [];
  if (!allowedIds.includes(actionId)) {
    return { allowed: false, reason: "INVALID_STATE_TRANSITION" };
  }

  return { allowed: true };
}

module.exports = {
  getAllowedActions,
  validateAction,
  ACTION_REGISTRY,
};
