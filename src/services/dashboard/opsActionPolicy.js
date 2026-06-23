"use strict";

const {
  canTransitionStatus,
  normalizeOperationalStatus,
} = require("./opsTransitionPolicy");

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
  ready_for_delivery: {
    id: "ready_for_delivery",
    label: { ar: "جاهز للتوصيل", en: "Ready for Delivery" },
    color: "teal",
    icon: "package",
    endpoint: "/api/dashboard/ops/actions/ready_for_delivery",
    method: "POST",
    roles: ["superadmin", "admin", "kitchen"],
    modes: ["delivery"],
  },
  pickup: {
    id: "pickup",
    label: { ar: "استلام", en: "Pick Up" },
    color: "indigo",
    icon: "truck",
    endpoint: "/api/dashboard/ops/actions/pickup",
    method: "POST",
    roles: ["superadmin", "admin", "courier"],
    modes: ["delivery"],
  },
  collect: {
    id: "collect",
    label: { ar: "استلام", en: "Collect" },
    color: "indigo",
    icon: "truck",
    endpoint: "/api/dashboard/ops/actions/collect",
    method: "POST",
    roles: ["superadmin", "admin", "courier"],
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

const ACTION_DISPLAY_ORDER = Object.freeze([
  "prepare", "start_preparation", "lock", "ready_for_pickup", "ready_for_delivery",
  "pickup", "collect", "dispatch", "notify_arrival", "fulfill", "no_show", "reopen", "cancel",
]);

function actionTargetStatus(entityType, actionId, mode) {
  const action = normalizeActionId(actionId);
  if (action === "lock") return "locked";
  if (action === "prepare" || action === "start_preparation") return "in_preparation";
  if (action === "ready_for_delivery") return "ready_for_delivery";
  if (["dispatch", "pickup", "collect"].includes(action)) return "out_for_delivery";
  if (action === "ready_for_pickup") return "ready_for_pickup";
  if (action === "fulfill") return "fulfilled";
  if (action === "no_show") return "no_show";
  if (action === "reopen") return "open";
  if (action === "cancel") {
    if (entityType === "order") return "cancelled";
    if (entityType === "subscription_pickup_request") return "canceled";
    return mode === "pickup" ? "canceled_at_branch" : "delivery_canceled";
  }
  return null;
}

function stateAllowsAction({ entityType, status, actionId, mode }) {
  if (actionId === "start_preparation" && entityType !== "subscription_pickup_request") return false;
  if (actionId === "prepare" && entityType === "subscription_pickup_request") return false;
  if (actionId === "notify_arrival") {
    return normalizeOperationalStatus(entityType, status) === "out_for_delivery";
  }
  const target = actionTargetStatus(entityType, actionId, mode);
  return Boolean(target && canTransitionStatus(entityType, status, target));
}

function normalizeActionId(actionId) {
  if (actionId === "ready-for-pickup") return "ready_for_pickup";
  if (actionId === "ready-for-delivery") return "ready_for_delivery";
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
  const allowedIds = ACTION_DISPLAY_ORDER.filter((actionId) => stateAllowsAction({
    entityType: normalizedEntityType,
    status,
    actionId,
    mode,
  }));

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

  if (!stateAllowsAction({
    entityType: normalizedEntityType,
    status,
    actionId: normalizedActionId,
    mode,
  })) {
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
