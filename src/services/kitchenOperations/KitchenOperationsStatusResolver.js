"use strict";

const ORDER_STATUS_TO_UI_STATUS = {
  created: "received",
  confirmed: "open",
  preparing: "in_preparation",
  out_for_delivery: "out_for_delivery",
  ready_for_pickup: "ready_for_pickup",
  fulfilled: "fulfilled",
  canceled: "cancelled",
};

const SUBSCRIPTION_STATUS_TO_UI_STATUS = {
  open: "open",
  locked: "locked",
  in_preparation: "in_preparation",
  out_for_delivery: "out_for_delivery",
  ready_for_pickup: "ready_for_pickup",
  fulfilled: "fulfilled",
  canceled_at_branch: "cancelled",
  delivery_canceled: "cancelled",
  no_show: "no_show",
};

const STATUS_LABELS = {
  open: "مفتوح",
  locked: "مقفل",
  in_preparation: "قيد التحضير",
  ready_for_pickup: "جاهز للاستلام",
  out_for_delivery: "خرج للتوصيل",
  fulfilled: "مكتمل",
  received: "تم الاستلام",
  cancelled: "ملغي",
  not_prepared: "غير مجهز",
  no_show: "لم يحضر",
};

const STATUS_SORT_ORDER = {
  not_prepared: 0,
  received: 1,
  open: 2,
  locked: 3,
  in_preparation: 4,
  ready_for_pickup: 5,
  out_for_delivery: 6,
  fulfilled: 7,
  cancelled: 8,
  no_show: 9,
};

function hasPreparables(items) {
  return Array.isArray(items) && items.length > 0;
}

function resolveUiStatus({
  entityType,
  rawStatus,
  items = [],
} = {}) {
  const normalizedEntityType = entityType === "order" ? "order" : "subscription_day";
  const mappedStatus = normalizedEntityType === "order"
    ? (ORDER_STATUS_TO_UI_STATUS[rawStatus] || "open")
    : (SUBSCRIPTION_STATUS_TO_UI_STATUS[rawStatus] || "open");

  if (!hasPreparables(items) && ["open", "received"].includes(mappedStatus)) {
    return "not_prepared";
  }

  return mappedStatus;
}

function buildProgressSteps({ mode, entityType } = {}) {
  const normalizedMode = mode === "pickup" ? "pickup" : "delivery";
  const includeReceived = entityType === "order";
  const steps = [];

  if (includeReceived) {
    steps.push({ key: "received", done: false });
  }

  steps.push({ key: "locked", done: false });
  steps.push({ key: "in_preparation", done: false });
  steps.push({ key: normalizedMode === "pickup" ? "ready_for_pickup" : "out_for_delivery", done: false });
  steps.push({ key: "fulfilled", done: false });

  return steps;
}

function resolveCompletedStepKeys({ uiStatus, rawStatus, entityType, mode } = {}) {
  const normalizedMode = mode === "pickup" ? "pickup" : "delivery";
  const keys = [];

  if (entityType === "order" && rawStatus === "created") {
    keys.push("received");
    return keys;
  }

  if (entityType === "order") {
    keys.push("received");
  }

  if (["locked", "in_preparation", "ready_for_pickup", "out_for_delivery", "fulfilled", "cancelled", "no_show"].includes(uiStatus)) {
    keys.push("locked");
  }
  if (["in_preparation", "ready_for_pickup", "out_for_delivery", "fulfilled", "cancelled", "no_show"].includes(uiStatus)) {
    keys.push("in_preparation");
  }
  if (
    (normalizedMode === "pickup" && ["ready_for_pickup", "fulfilled", "cancelled", "no_show"].includes(uiStatus))
    || (normalizedMode === "delivery" && ["out_for_delivery", "fulfilled", "cancelled"].includes(uiStatus))
  ) {
    keys.push(normalizedMode === "pickup" ? "ready_for_pickup" : "out_for_delivery");
  }
  if (uiStatus === "fulfilled") {
    keys.push("fulfilled");
  }

  return keys;
}

function resolveProgress({
  entityType,
  rawStatus,
  uiStatus,
  mode,
} = {}) {
  const steps = buildProgressSteps({ mode, entityType });
  const completedKeys = new Set(resolveCompletedStepKeys({ uiStatus, rawStatus, entityType, mode }));

  const resolvedSteps = steps.map((step) => ({
    key: step.key,
    done: completedKeys.has(step.key),
  }));

  const step = resolvedSteps.reduce((count, current) => count + (current.done ? 1 : 0), 0);

  return {
    step,
    totalSteps: resolvedSteps.length,
    steps: resolvedSteps,
  };
}

function resolveStatusMeta(input = {}) {
  const status = resolveUiStatus(input);
  return {
    status,
    statusLabel: STATUS_LABELS[status] || status,
    progress: resolveProgress({
      entityType: input.entityType,
      rawStatus: input.rawStatus,
      uiStatus: status,
      mode: input.mode,
    }),
  };
}

module.exports = {
  STATUS_LABELS,
  STATUS_SORT_ORDER,
  resolveUiStatus,
  resolveProgress,
  resolveStatusMeta,
};
