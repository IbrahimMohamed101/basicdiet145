"use strict";

const mongoose = require("mongoose");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const SubscriptionAuditLog = require("../../models/SubscriptionAuditLog");
const Delivery = require("../../models/Delivery");
const DashboardUser = require("../../models/DashboardUser");

const CONSUMED_DAY_STATUSES = new Set([
  "fulfilled",
  "delivered",
  "consumed_without_preparation",
]);

const DASHBOARD_ROLES = new Set([
  "admin",
  "superadmin",
  "cashier",
  "restaurant",
  "kitchen",
  "courier",
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.floor(number));
}

function idString(value) {
  if (!value) return null;
  const candidate = value && typeof value === "object" && value._id ? value._id : value;
  const result = String(candidate || "").trim();
  return result || null;
}

function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return role || null;
}

function parseEmbeddedActor(value) {
  const text = String(value || "").trim();
  if (!text) return { role: null, id: null };
  const separator = text.indexOf(":");
  if (separator === -1) {
    return DASHBOARD_ROLES.has(text)
      ? { role: text, id: null }
      : { role: null, id: text };
  }
  return {
    role: normalizeRole(text.slice(0, separator)),
    id: idString(text.slice(separator + 1)),
  };
}

function actorView({ role = null, id = null } = {}, actorMap = new Map()) {
  const actorId = idString(id);
  const stored = actorId ? actorMap.get(actorId) : null;
  return {
    id: actorId,
    role: normalizeRole(role) || normalizeRole(stored && stored.role),
    email: stored && stored.email ? String(stored.email) : null,
  };
}

function resolvePlanningRole(day = {}) {
  const lockedPlanning = asObject(asObject(day.lockedSnapshot).planning);
  const lockedMeta = asObject(lockedPlanning.meta);
  const plannerMeta = asObject(day.plannerMeta);
  const planningMeta = asObject(day.planningMeta);
  const direct = normalizeRole(
    plannerMeta.confirmedByRole
      || planningMeta.confirmedByRole
      || lockedMeta.confirmedByRole
  );
  if (direct) return direct;

  const assignmentSources = asArray(day.baseMealSlots)
    .map((slot) => normalizeRole(slot && slot.assignmentSource))
    .filter(Boolean);
  if (assignmentSources.includes("client")) return "client";
  const dashboardSource = assignmentSources.find((source) => DASHBOARD_ROLES.has(source));
  if (dashboardSource) return dashboardSource;
  if (day.assignedByKitchen) return "kitchen";
  return null;
}

function selectionChannelFor({ day = null, pickupRequest = null } = {}) {
  const snapshot = asObject(pickupRequest && pickupRequest.snapshot);
  if (snapshot.createdFrom === "client_pickup_request") {
    return { code: "mobile_app", label: "اختيار أو طلب من تطبيق العميل", role: "client" };
  }

  const role = resolvePlanningRole(day || {});
  if (role === "client" || role === "user" || role === "app") {
    return { code: "mobile_app", label: "اختيار من تطبيق العميل", role: "client" };
  }
  if (role && DASHBOARD_ROLES.has(role)) {
    return { code: "dashboard", label: "اختيار أو تعيين من الداشبورد", role };
  }
  return { code: "unknown", label: "مصدر الاختيار غير مسجل", role: role || null };
}

function operationLabel(action) {
  const labels = {
    created: "إنشاء الطلب",
    lock: "تأكيد وقفل اليوم",
    prepare: "بدء التحضير",
    ready_for_delivery: "جاهز للتوصيل",
    dispatch: "خرج للتوصيل",
    notify_arrival: "تنبيه بالوصول",
    ready_for_pickup: "جاهز للاستلام",
    fulfill: "تم التسليم أو الاستلام",
    no_show: "لم يحضر العميل",
    cancel: "إلغاء",
    reopen: "إعادة فتح",
  };
  return labels[action] || String(action || "إجراء");
}

function buildOperationRows({ day = null, pickupRequest = null, audits = [] } = {}, actorMap = new Map()) {
  const rows = [];
  for (const row of asArray(day && day.operationAuditLog)) {
    const parsed = parseEmbeddedActor(row && row.by);
    rows.push({
      action: String(row && row.action || ""),
      label: operationLabel(row && row.action),
      actor: actorView(parsed, actorMap),
      at: row && row.at ? row.at : null,
      evidence: "embedded_operation_audit",
    });
  }
  for (const row of asArray(pickupRequest && pickupRequest.operationAuditLog)) {
    const parsed = parseEmbeddedActor(row && row.by);
    rows.push({
      action: String(row && row.action || ""),
      label: operationLabel(row && row.action),
      actor: actorView(parsed, actorMap),
      at: row && row.at ? row.at : null,
      evidence: "pickup_operation_audit",
    });
  }
  for (const audit of asArray(audits)) {
    const action = String(audit && audit.action || "").replace(/^dashboard_/, "");
    rows.push({
      action,
      label: operationLabel(action),
      actor: actorView({ role: audit && audit.actorType, id: audit && audit.actorId }, actorMap),
      at: audit && audit.createdAt ? audit.createdAt : null,
      fromStatus: audit && audit.fromStatus ? audit.fromStatus : null,
      toStatus: audit && audit.toStatus ? audit.toStatus : null,
      note: audit && audit.note ? audit.note : null,
      evidence: "subscription_audit_log",
    });
  }
  return rows
    .filter((row) => row.action)
    .sort((left, right) => new Date(left.at || 0).getTime() - new Date(right.at || 0).getTime());
}

function lastFulfillmentActor({ day = null, pickupRequest = null, audits = [] } = {}, actorMap = new Map()) {
  if (pickupRequest && pickupRequest.fulfilledByDashboardUserId) {
    const actorId = idString(pickupRequest.fulfilledByDashboardUserId);
    return actorView({ id: actorId }, actorMap);
  }
  if (day && day.pickupVerifiedByDashboardUserId) {
    const actorId = idString(day.pickupVerifiedByDashboardUserId);
    return actorView({ id: actorId }, actorMap);
  }
  const operations = buildOperationRows({ day, pickupRequest, audits }, actorMap)
    .filter((row) => row.action === "fulfill");
  return operations.length ? operations[operations.length - 1].actor : actorView({}, actorMap);
}

function resolveFulfillmentMode(subscription = {}, day = null, pickupRequest = null) {
  if (pickupRequest) return "pickup";
  return String(
    day && day.fulfillmentModeOverride
      || subscription.deliveryMode
      || ""
  ).trim().toLowerCase() || null;
}

function sourceDefinition({ status, fulfillmentMode, pickupRequest, manual = false, unknown = false }) {
  if (manual) {
    return {
      code: "dashboard_manual_deduction",
      label: "خصم يدوي من الداشبورد",
      completionChannel: "dashboard",
      completionLabel: "الداشبورد",
    };
  }
  if (unknown) {
    return {
      code: "legacy_unattributed_consumption",
      label: "خصم تاريخي بلا مصدر كافٍ",
      completionChannel: "unknown",
      completionLabel: "غير معروف",
    };
  }
  if (status === "consumed_without_preparation") {
    return {
      code: "consumed_without_preparation",
      label: "حسم تشغيلي بدون تحضير أو تسليم",
      completionChannel: "system",
      completionLabel: "حسم تشغيلي",
    };
  }
  if (pickupRequest || fulfillmentMode === "pickup") {
    return {
      code: "branch_pickup_fulfillment",
      label: "استلام فعلي من الفرع",
      completionChannel: "branch_pickup",
      completionLabel: "استلام من الفرع",
    };
  }
  if (fulfillmentMode === "delivery") {
    return {
      code: "delivery_fulfillment",
      label: "تسليم فعلي عن طريق التوصيل",
      completionChannel: "delivery",
      completionLabel: "التوصيل",
    };
  }
  return {
    code: "subscription_fulfillment",
    label: "تنفيذ اشتراك",
    completionChannel: "dashboard",
    completionLabel: "تشغيل الاشتراك",
  };
}

function mealItemsForAllocation(trackingDay, allocation, pickupRequest = null) {
  const slotKey = String(allocation && allocation.slotKey || "");
  const dayItems = asArray(trackingDay && trackingDay.mealItems);
  const exact = dayItems.find((item) => String(item && item.slotKey || "") === slotKey);
  if (exact) return [exact];

  const selectedKeys = new Set([
    ...asArray(pickupRequest && pickupRequest.selectedMealSlotIds),
    ...asArray(pickupRequest && pickupRequest.selectedPickupItemIds),
  ].map((value) => String(value || "")));
  if (selectedKeys.size) {
    const selected = dayItems.filter((item) => selectedKeys.has(String(item && item.slotKey || "")));
    if (selected.length) return selected;
  }
  return dayItems.length === 1 ? dayItems : [];
}

function eventKey(event) {
  return [
    event.type,
    event.sourceCode,
    event.date || "",
    event.reference && event.reference.type || "",
    event.reference && event.reference.id || "",
    event.actor && event.actor.id || "",
  ].join("|");
}

function mergeEvents(events) {
  const grouped = new Map();
  for (const event of events) {
    const key = eventKey(event);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...event,
        mealItems: [...asArray(event.mealItems)],
        allocationKeys: [...asArray(event.allocationKeys)],
      });
      continue;
    }
    existing.quantity += nonNegativeInteger(event.quantity);
    const itemKeys = new Set(existing.mealItems.map((item) => String(item && (item.id || item.slotKey) || "")));
    for (const item of asArray(event.mealItems)) {
      const itemKey = String(item && (item.id || item.slotKey) || "");
      if (!itemKey || itemKeys.has(itemKey)) continue;
      itemKeys.add(itemKey);
      existing.mealItems.push(item);
    }
    existing.allocationKeys.push(...asArray(event.allocationKeys));
  }
  return [...grouped.values()];
}

function buildManualEvents(manualDeductions = [], actorMap = new Map()) {
  return asArray(manualDeductions)
    .filter((row) => nonNegativeInteger(row && row.deducted && row.deducted.totalMeals) > 0)
    .map((row) => {
      const source = sourceDefinition({ manual: true });
      return {
        id: `manual:${row.id || row.createdAt || row.businessDate}`,
        type: "manual_deduction",
        balanceEffect: "consumed",
        quantity: nonNegativeInteger(row.deducted.totalMeals),
        date: row.businessDate || null,
        occurredAt: row.createdAt || null,
        sourceCode: source.code,
        sourceLabel: source.label,
        selection: { code: "not_applicable", label: "لا يوجد اختيار يومي", role: null },
        completion: { code: source.completionChannel, label: source.completionLabel },
        fulfillmentMode: row.fulfillmentMethod || null,
        actor: actorView(row.actor || {}, actorMap),
        status: "consumed",
        reference: { type: "activity_log", id: row.id || null },
        mealItems: [],
        allocationKeys: [],
        operations: [],
        reason: row.reason || null,
        notes: row.notes || null,
        evidence: ["manual_subscription_meal_deduction activity log"],
        confidence: "exact",
      };
    });
}

function buildAllocationEvents({
  subscription,
  trackingDays,
  rawDays,
  pickupRequests,
  auditsByDay,
  deliveriesByDay,
  actorMap,
}) {
  const trackingByDate = new Map(asArray(trackingDays).map((day) => [String(day.date), day]));
  const rawDayById = new Map(asArray(rawDays).map((day) => [idString(day._id), day]));
  const pickupById = new Map(asArray(pickupRequests).map((row) => [idString(row._id), row]));
  const events = [];
  const consumedByDay = new Map();

  for (const allocation of asArray(subscription.baseMealAllocations)) {
    const state = String(allocation && allocation.state || "");
    if (!["reserved", "consumed", "forfeited"].includes(state)) continue;
    const quantity = Math.max(1, nonNegativeInteger(allocation && allocation.quantity));
    const dayId = idString(allocation && allocation.dayId);
    const pickupRequestId = idString(allocation && allocation.pickupRequestId);
    const rawDay = dayId ? rawDayById.get(dayId) || null : null;
    const pickupRequest = pickupRequestId ? pickupById.get(pickupRequestId) || null : null;
    const date = String(allocation && allocation.date || rawDay && rawDay.date || pickupRequest && pickupRequest.date || "") || null;
    const trackingDay = date ? trackingByDate.get(date) || null : null;
    const status = String(rawDay && rawDay.status || pickupRequest && pickupRequest.status || state);
    const fulfillmentMode = resolveFulfillmentMode(subscription, rawDay, pickupRequest);
    const selection = selectionChannelFor({ day: rawDay, pickupRequest });
    const audits = dayId ? auditsByDay.get(dayId) || [] : [];
    const source = sourceDefinition({ status, fulfillmentMode, pickupRequest });
    const actor = lastFulfillmentActor({ day: rawDay, pickupRequest, audits }, actorMap);
    const delivery = dayId ? deliveriesByDay.get(dayId) || null : null;
    const type = state === "reserved" ? "reservation" : state === "forfeited" ? "forfeiture" : "consumption";
    const occurredAt = state === "reserved"
      ? allocation.reservedAt || pickupRequest && pickupRequest.creditsReservedAt || rawDay && rawDay.updatedAt || null
      : state === "forfeited"
        ? allocation.forfeitedAt || rawDay && rawDay.settledAt || null
        : allocation.consumedAt
          || pickupRequest && pickupRequest.creditsConsumedAt
          || rawDay && rawDay.fulfilledAt
          || delivery && delivery.deliveredAt
          || null;

    if (state === "consumed" && dayId) {
      consumedByDay.set(dayId, nonNegativeInteger(consumedByDay.get(dayId)) + quantity);
    }

    events.push({
      id: `allocation:${allocation.allocationKey || events.length}`,
      type,
      balanceEffect: state,
      quantity,
      date,
      occurredAt,
      sourceCode: state === "reserved" ? `${selection.code}_reservation` : source.code,
      sourceLabel: state === "reserved" ? selection.label : source.label,
      selection,
      completion: state === "reserved"
        ? { code: "pending", label: "لم يتم التسليم بعد" }
        : { code: source.completionChannel, label: source.completionLabel },
      fulfillmentMode,
      actor: state === "reserved" ? actorView({ role: selection.role }, actorMap) : actor,
      status,
      reference: pickupRequest
        ? { type: "subscription_pickup_request", id: pickupRequestId }
        : rawDay
          ? { type: "subscription_day", id: dayId }
          : { type: "base_meal_allocation", id: null },
      mealItems: mealItemsForAllocation(trackingDay, allocation, pickupRequest),
      allocationKeys: allocation.allocationKey ? [String(allocation.allocationKey)] : [],
      operations: buildOperationRows({ day: rawDay, pickupRequest, audits }, actorMap),
      evidence: [
        `baseMealAllocation state=${state}`,
        pickupRequestId ? "allocation.pickupRequestId" : null,
        dayId ? "allocation.dayId" : null,
        delivery && delivery.status ? `delivery.status=${delivery.status}` : null,
      ].filter(Boolean),
      confidence: dayId || pickupRequestId ? "exact" : "derived",
    });
  }

  return { events, consumedByDay };
}

function buildLegacyDayEvents({
  subscription,
  trackingDays,
  rawDays,
  auditsByDay,
  deliveriesByDay,
  actorMap,
  consumedByDay,
  maxQuantity,
}) {
  let remaining = Math.max(0, nonNegativeInteger(maxQuantity));
  if (!remaining) return [];
  const trackingByDate = new Map(asArray(trackingDays).map((day) => [String(day.date), day]));
  const candidates = [];

  for (const day of asArray(rawDays)) {
    const status = String(day && day.status || "");
    if (!CONSUMED_DAY_STATUSES.has(status) || !day.creditsDeducted) continue;
    const dayId = idString(day._id);
    const alreadyAllocated = nonNegativeInteger(consumedByDay.get(dayId));
    const trackingDay = trackingByDate.get(String(day.date)) || null;
    const snapshot = asObject(day.fulfilledSnapshot);
    const expected = Math.max(
      nonNegativeInteger(snapshot.deductedCredits),
      nonNegativeInteger(trackingDay && trackingDay.consumedMeals),
      nonNegativeInteger(trackingDay && trackingDay.receivedMeals)
    );
    const missing = Math.max(0, expected - alreadyAllocated);
    if (!missing) continue;
    candidates.push({ day, dayId, trackingDay, status, missing });
  }

  candidates.sort((left, right) => String(left.day.date).localeCompare(String(right.day.date)));
  const events = [];
  for (const candidate of candidates) {
    if (!remaining) break;
    const quantity = Math.min(candidate.missing, remaining);
    remaining -= quantity;
    const audits = auditsByDay.get(candidate.dayId) || [];
    const fulfillmentMode = resolveFulfillmentMode(subscription, candidate.day, null);
    const source = sourceDefinition({ status: candidate.status, fulfillmentMode, pickupRequest: null });
    const actor = lastFulfillmentActor({ day: candidate.day, audits }, actorMap);
    const delivery = deliveriesByDay.get(candidate.dayId) || null;
    events.push({
      id: `legacy-day:${candidate.dayId}`,
      type: "consumption",
      balanceEffect: "consumed",
      quantity,
      date: candidate.day.date || null,
      occurredAt: candidate.day.fulfilledAt || candidate.day.settledAt || delivery && delivery.deliveredAt || null,
      sourceCode: source.code,
      sourceLabel: source.label,
      selection: selectionChannelFor({ day: candidate.day }),
      completion: { code: source.completionChannel, label: source.completionLabel },
      fulfillmentMode,
      actor,
      status: candidate.status,
      reference: { type: "subscription_day", id: candidate.dayId },
      mealItems: asArray(candidate.trackingDay && candidate.trackingDay.mealItems),
      allocationKeys: [],
      operations: buildOperationRows({ day: candidate.day, audits }, actorMap),
      evidence: [
        "SubscriptionDay.creditsDeducted=true",
        `SubscriptionDay.status=${candidate.status}`,
        "fulfilledSnapshot/timeline deducted quantity",
      ],
      confidence: "derived",
    });
  }
  return events;
}

function buildUnknownEvent(quantity) {
  const source = sourceDefinition({ unknown: true });
  return {
    id: "legacy-unattributed",
    type: "consumption",
    balanceEffect: "consumed",
    quantity: nonNegativeInteger(quantity),
    date: null,
    occurredAt: null,
    sourceCode: source.code,
    sourceLabel: source.label,
    selection: { code: "unknown", label: "غير معروف", role: null },
    completion: { code: source.completionChannel, label: source.completionLabel },
    fulfillmentMode: null,
    actor: { id: null, role: null, email: null },
    status: "unknown",
    reference: { type: "subscription_aggregate", id: null },
    mealItems: [],
    allocationKeys: [],
    operations: [],
    evidence: ["subscription.consumedMeals has no matching day, pickup request, or manual-deduction log"],
    confidence: "unknown",
  };
}

function aggregateTotals(events, balanceConsumedMeals) {
  const consumedEvents = events.filter((event) => event.balanceEffect === "consumed");
  const reservations = events.filter((event) => event.balanceEffect === "reserved")
    .reduce((sum, event) => sum + nonNegativeInteger(event.quantity), 0);
  const attributed = consumedEvents
    .filter((event) => event.confidence !== "unknown")
    .reduce((sum, event) => sum + nonNegativeInteger(event.quantity), 0);
  const unknown = consumedEvents
    .filter((event) => event.confidence === "unknown")
    .reduce((sum, event) => sum + nonNegativeInteger(event.quantity), 0);
  const exact = consumedEvents
    .filter((event) => event.confidence === "exact")
    .reduce((sum, event) => sum + nonNegativeInteger(event.quantity), 0);
  const derived = consumedEvents
    .filter((event) => event.confidence === "derived")
    .reduce((sum, event) => sum + nonNegativeInteger(event.quantity), 0);

  const consumption = {
    delivery: 0,
    branchPickup: 0,
    dashboardManual: 0,
    consumedWithoutPreparation: 0,
    other: 0,
    unknown: 0,
  };
  const selection = { mobileApp: 0, dashboard: 0, unknown: 0 };

  for (const event of consumedEvents) {
    const quantity = nonNegativeInteger(event.quantity);
    if (event.sourceCode === "delivery_fulfillment") consumption.delivery += quantity;
    else if (event.sourceCode === "branch_pickup_fulfillment") consumption.branchPickup += quantity;
    else if (event.sourceCode === "dashboard_manual_deduction") consumption.dashboardManual += quantity;
    else if (event.sourceCode === "consumed_without_preparation") consumption.consumedWithoutPreparation += quantity;
    else if (event.confidence === "unknown") consumption.unknown += quantity;
    else consumption.other += quantity;

    if (event.selection && event.selection.code === "mobile_app") selection.mobileApp += quantity;
    else if (event.selection && event.selection.code === "dashboard") selection.dashboard += quantity;
    else selection.unknown += quantity;
  }

  const represented = consumedEvents.reduce((sum, event) => sum + nonNegativeInteger(event.quantity), 0);
  return {
    status: unknown === 0 && represented === nonNegativeInteger(balanceConsumedMeals) ? "complete" : "partial",
    balanceConsumedMeals: nonNegativeInteger(balanceConsumedMeals),
    representedMeals: represented,
    attributedMeals: attributed,
    exactMeals: exact,
    derivedMeals: derived,
    unknownMeals: unknown,
    reservationMeals: reservations,
    difference: nonNegativeInteger(balanceConsumedMeals) - represented,
    consumption,
    selection,
  };
}

function collectActorIds({ rawDays, pickupRequests, audits, manualDeductions }) {
  const ids = new Set();
  const add = (value) => {
    const id = idString(value);
    if (id && mongoose.isValidObjectId(id)) ids.add(id);
  };
  for (const day of asArray(rawDays)) {
    add(day.pickupVerifiedByDashboardUserId);
    for (const row of asArray(day.operationAuditLog)) add(parseEmbeddedActor(row && row.by).id);
  }
  for (const request of asArray(pickupRequests)) {
    add(request.fulfilledByDashboardUserId);
    for (const row of asArray(request.operationAuditLog)) add(parseEmbeddedActor(row && row.by).id);
  }
  for (const audit of asArray(audits)) add(audit.actorId);
  for (const row of asArray(manualDeductions)) add(row && row.actor && row.actor.id);
  return [...ids];
}

async function loadProvenanceRecords(subscriptionId, manualDeductions = []) {
  const rawDays = await SubscriptionDay.find({ subscriptionId })
    .select([
      "_id", "date", "status", "plannerState", "planningState", "plannerMeta", "planningMeta",
      "baseMealSlots", "lockedSnapshot", "assignedByKitchen", "fulfillmentModeOverride",
      "operationAuditLog", "creditsDeducted", "fulfilledAt", "fulfilledSnapshot", "autoSettled",
      "settledAt", "settlementReason", "settledBy", "dayEndConsumptionReason", "pickupVerifiedAt",
      "pickupVerifiedByDashboardUserId", "baseAllocationKeys", "createdAt", "updatedAt",
    ].join(" "))
    .sort({ date: 1 })
    .lean();
  const dayIds = rawDays.map((day) => day._id);

  const [pickupRequests, audits, deliveries] = await Promise.all([
    SubscriptionPickupRequest.find({ subscriptionId })
      .select([
        "_id", "subscriptionDayId", "date", "mealCount", "selectedMealSlotIds", "selectedPickupItemIds",
        "selectedPickupItems", "selectionMode", "status", "fulfilledAt", "fulfilledByDashboardUserId",
        "creditsReservedAt", "creditsConsumedAt", "creditsReleasedAt", "baseAllocationKeys", "snapshot",
        "operationAuditLog", "settlementReason", "settledBy", "createdAt", "updatedAt",
      ].join(" "))
      .sort({ createdAt: 1 })
      .lean(),
    dayIds.length
      ? SubscriptionAuditLog.find({ entityType: "subscription_day", entityId: { $in: dayIds } })
        .select("entityId action fromStatus toStatus actorType actorId note meta createdAt")
        .sort({ createdAt: 1 })
        .lean()
      : [],
    dayIds.length
      ? Delivery.find({ subscriptionId, dayId: { $in: dayIds } })
        .select("_id dayId date status deliveredAt etaAt createdAt updatedAt")
        .lean()
      : [],
  ]);

  const actorIds = collectActorIds({ rawDays, pickupRequests, audits, manualDeductions });
  const actors = actorIds.length
    ? await DashboardUser.find({ _id: { $in: actorIds } }).select("_id email role").lean()
    : [];

  return { rawDays, pickupRequests, audits, deliveries, actors };
}

function buildProvenanceReport({
  subscription,
  trackingDays,
  summary,
  manualDeductions,
  rawDays,
  pickupRequests,
  audits,
  deliveries,
  actors,
}) {
  const actorMap = new Map(asArray(actors).map((actor) => [idString(actor._id), actor]));
  const auditsByDay = new Map();
  for (const audit of asArray(audits)) {
    const key = idString(audit.entityId);
    if (!key) continue;
    const rows = auditsByDay.get(key) || [];
    rows.push(audit);
    auditsByDay.set(key, rows);
  }
  const deliveriesByDay = new Map(asArray(deliveries).map((delivery) => [idString(delivery.dayId), delivery]));
  const manualEvents = buildManualEvents(manualDeductions, actorMap);
  const allocationResult = buildAllocationEvents({
    subscription,
    trackingDays,
    rawDays,
    pickupRequests,
    auditsByDay,
    deliveriesByDay,
    actorMap,
  });

  const balanceConsumedMeals = nonNegativeInteger(
    summary && (summary.balanceConsumedMeals ?? summary.consumedMeals)
      ?? subscription.consumedMeals
      ?? Math.max(0, Number(subscription.totalMeals || 0) - Number(subscription.remainingMeals || 0))
  );
  const allocationConsumed = allocationResult.events
    .filter((event) => event.balanceEffect === "consumed")
    .reduce((sum, event) => sum + nonNegativeInteger(event.quantity), 0);
  const manualConsumed = manualEvents.reduce((sum, event) => sum + nonNegativeInteger(event.quantity), 0);
  const legacyCapacity = Math.max(0, balanceConsumedMeals - allocationConsumed - manualConsumed);
  const legacyEvents = buildLegacyDayEvents({
    subscription,
    trackingDays,
    rawDays,
    auditsByDay,
    deliveriesByDay,
    actorMap,
    consumedByDay: allocationResult.consumedByDay,
    maxQuantity: legacyCapacity,
  });
  const knownConsumed = allocationConsumed + manualConsumed
    + legacyEvents.reduce((sum, event) => sum + nonNegativeInteger(event.quantity), 0);
  const unknownQuantity = Math.max(0, balanceConsumedMeals - knownConsumed);
  const unknownEvents = unknownQuantity > 0 ? [buildUnknownEvent(unknownQuantity)] : [];

  const events = mergeEvents([
    ...allocationResult.events,
    ...legacyEvents,
    ...manualEvents,
    ...unknownEvents,
  ]).sort((left, right) => {
    const leftTime = new Date(left.occurredAt || `${left.date || "1900-01-01"}T00:00:00Z`).getTime();
    const rightTime = new Date(right.occurredAt || `${right.date || "1900-01-01"}T00:00:00Z`).getTime();
    return rightTime - leftTime;
  });

  return {
    contractVersion: "subscription_meal_movement_provenance.v1",
    readOnly: true,
    coverage: aggregateTotals(events, balanceConsumedMeals),
    movements: events,
  };
}

async function buildSubscriptionMealMovementProvenance({
  subscription,
  tracking,
  manualDeductions = [],
}) {
  const records = await loadProvenanceRecords(subscription._id, manualDeductions);
  return buildProvenanceReport({
    subscription,
    trackingDays: tracking && tracking.days,
    summary: tracking && tracking.summary,
    manualDeductions,
    ...records,
  });
}

module.exports = {
  aggregateTotals,
  buildProvenanceReport,
  buildSubscriptionMealMovementProvenance,
  parseEmbeddedActor,
  resolvePlanningRole,
  selectionChannelFor,
};
