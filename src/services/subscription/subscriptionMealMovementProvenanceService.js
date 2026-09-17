"use strict";

const mongoose = require("mongoose");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const SubscriptionAuditLog = require("../../models/SubscriptionAuditLog");
const Delivery = require("../../models/Delivery");
const DashboardUser = require("../../models/DashboardUser");

const FULFILLED_STATUSES = new Set(["fulfilled", "delivered"]);
const CONSUMED_STATUSES = new Set([
  ...FULFILLED_STATUSES,
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

function integer(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function idOf(value) {
  if (!value) return null;
  const candidate = value && typeof value === "object" && value._id ? value._id : value;
  const text = String(candidate || "").trim();
  return text || null;
}

function roleOf(value) {
  const role = String(value || "").trim().toLowerCase();
  return role || null;
}

function parseEmbeddedActor(value) {
  const text = String(value || "").trim();
  if (!text) return { role: null, id: null };
  const separator = text.indexOf(":");
  if (separator < 0) {
    return DASHBOARD_ROLES.has(text)
      ? { role: text, id: null }
      : { role: null, id: text };
  }
  return {
    role: roleOf(text.slice(0, separator)),
    id: idOf(text.slice(separator + 1)),
  };
}

function actorView(actor = {}, actorMap = new Map()) {
  const id = idOf(actor.id || actor.actorId);
  const stored = id ? actorMap.get(id) : null;
  return {
    id,
    role: roleOf(actor.role || actor.actorType) || roleOf(stored && stored.role),
    email: stored && stored.email ? String(stored.email) : null,
  };
}

function resolvePlanningRole(day = {}) {
  const lockedPlanning = asObject(asObject(day.lockedSnapshot).planning);
  const lockedMeta = asObject(lockedPlanning.meta);
  const plannerMeta = asObject(day.plannerMeta);
  const planningMeta = asObject(day.planningMeta);
  const direct = roleOf(
    plannerMeta.confirmedByRole
      || planningMeta.confirmedByRole
      || lockedMeta.confirmedByRole
  );
  if (direct) return direct;

  const assignmentSources = asArray(day.baseMealSlots)
    .map((slot) => roleOf(slot && slot.assignmentSource))
    .filter(Boolean);
  if (assignmentSources.includes("client")) return "client";
  const dashboardRole = assignmentSources.find((role) => DASHBOARD_ROLES.has(role));
  if (dashboardRole) return dashboardRole;
  if (day.assignedByKitchen) return "kitchen";
  return null;
}

function selectionChannelFor({ day = null, pickupRequest = null } = {}) {
  const snapshot = asObject(pickupRequest && pickupRequest.snapshot);
  if (snapshot.createdFrom === "client_pickup_request") {
    return {
      code: "mobile_app",
      label: "تم الاختيار أو طلب الاستلام من تطبيق العميل",
      role: "client",
    };
  }

  const role = resolvePlanningRole(day || {});
  if (["client", "user", "app", "mobile"].includes(role)) {
    return { code: "mobile_app", label: "تم اختيار الوجبات من تطبيق العميل", role: "client" };
  }
  if (role && DASHBOARD_ROLES.has(role)) {
    return { code: "dashboard", label: "تم اختيار أو تعيين الوجبات من الداشبورد", role };
  }
  return { code: "unknown", label: "مصدر اختيار الوجبات غير مسجل", role: role || null };
}

function operationLabel(action) {
  const labels = {
    lock: "تأكيد وقفل اليوم",
    prepare: "بدء التحضير",
    ready_for_delivery: "جاهز للتوصيل",
    dispatch: "خرج للتوصيل",
    notify_arrival: "تنبيه العميل بالوصول",
    ready_for_pickup: "جاهز للاستلام",
    fulfill: "تم التسليم أو الاستلام",
    no_show: "لم يحضر العميل",
    cancel: "إلغاء العملية",
    reopen: "إعادة فتح اليوم",
  };
  return labels[action] || String(action || "إجراء");
}

function buildOperations({ day = null, pickupRequest = null, audits = [] } = {}, actorMap = new Map()) {
  const rows = [];
  const appendEmbedded = (row, evidence) => {
    const parsed = parseEmbeddedActor(row && row.by);
    rows.push({
      action: String(row && row.action || ""),
      label: operationLabel(row && row.action),
      actor: actorView(parsed, actorMap),
      at: row && row.at ? row.at : null,
      evidence,
    });
  };

  for (const row of asArray(day && day.operationAuditLog)) {
    appendEmbedded(row, "subscription_day.operationAuditLog");
  }
  for (const row of asArray(pickupRequest && pickupRequest.operationAuditLog)) {
    appendEmbedded(row, "subscription_pickup_request.operationAuditLog");
  }
  for (const audit of asArray(audits)) {
    const action = String(audit && audit.action || "").replace(/^dashboard_/, "");
    rows.push({
      action,
      label: operationLabel(action),
      actor: actorView({
        actorType: audit && audit.actorType,
        actorId: audit && audit.actorId,
      }, actorMap),
      at: audit && audit.createdAt ? audit.createdAt : null,
      fromStatus: audit && audit.fromStatus ? audit.fromStatus : null,
      toStatus: audit && audit.toStatus ? audit.toStatus : null,
      note: audit && audit.note ? audit.note : null,
      evidence: "subscription_audit_log",
    });
  }

  const seen = new Set();
  return rows
    .filter((row) => row.action)
    .sort((left, right) => new Date(left.at || 0).getTime() - new Date(right.at || 0).getTime())
    .filter((row) => {
      const key = [row.action, row.at ? new Date(row.at).toISOString() : "", row.actor.id || "", row.actor.role || ""].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function fulfillmentActor(context = {}, actorMap = new Map()) {
  if (context.pickupRequest && context.pickupRequest.fulfilledByDashboardUserId) {
    return actorView({ id: context.pickupRequest.fulfilledByDashboardUserId }, actorMap);
  }
  if (context.day && context.day.pickupVerifiedByDashboardUserId) {
    return actorView({ id: context.day.pickupVerifiedByDashboardUserId }, actorMap);
  }
  const fulfill = buildOperations(context, actorMap).filter((row) => row.action === "fulfill");
  return fulfill.length ? fulfill[fulfill.length - 1].actor : actorView({}, actorMap);
}

function fulfillmentMode(subscription = {}, day = null, pickupRequest = null) {
  if (pickupRequest) return "pickup";
  return String(
    day && day.fulfillmentModeOverride
      || subscription.deliveryMode
      || ""
  ).trim().toLowerCase() || null;
}

function consumptionSource({ status, mode, pickupRequest, manual = false, unknown = false }) {
  if (manual) {
    return { code: "dashboard_manual_deduction", label: "خصم يدوي من الداشبورد", channel: "dashboard", channelLabel: "الداشبورد" };
  }
  if (unknown) {
    return { code: "legacy_unattributed_consumption", label: "خصم تاريخي بلا مصدر موثق", channel: "unknown", channelLabel: "غير معروف" };
  }
  if (status === "consumed_without_preparation") {
    return { code: "consumed_without_preparation", label: "حسم تشغيلي بدون تحضير أو تسليم", channel: "system", channelLabel: "حسم تشغيلي" };
  }
  if (pickupRequest || mode === "pickup") {
    return { code: "branch_pickup_fulfillment", label: "استلام فعلي من الفرع", channel: "branch_pickup", channelLabel: "استلام من الفرع" };
  }
  if (mode === "delivery") {
    return { code: "delivery_fulfillment", label: "تسليم فعلي عن طريق التوصيل", channel: "delivery", channelLabel: "التوصيل" };
  }
  return { code: "subscription_fulfillment", label: "تنفيذ اشتراك", channel: "operations", channelLabel: "تشغيل الاشتراك" };
}

function itemsForAllocation(trackingDay, allocation, pickupRequest = null) {
  const items = asArray(trackingDay && trackingDay.mealItems);
  const slotKey = String(allocation && allocation.slotKey || "");
  const exact = items.find((item) => String(item && item.slotKey || "") === slotKey);
  if (exact) return [exact];

  const selectedKeys = new Set([
    ...asArray(pickupRequest && pickupRequest.selectedMealSlotIds),
    ...asArray(pickupRequest && pickupRequest.selectedPickupItemIds),
  ].map((value) => String(value || "")));
  const selected = items.filter((item) => selectedKeys.has(String(item && item.slotKey || "")));
  if (selected.length) return selected;
  return items.length === 1 ? items : [];
}

function manualEvents(manualDeductions = [], actorMap = new Map()) {
  return asArray(manualDeductions)
    .filter((row) => integer(row && row.deducted && row.deducted.totalMeals) > 0)
    .map((row) => {
      const source = consumptionSource({ manual: true });
      return {
        id: `manual:${row.id || row.createdAt || row.businessDate}`,
        type: "manual_deduction",
        balanceEffect: "consumed",
        quantity: integer(row.deducted.totalMeals),
        date: row.businessDate || null,
        occurredAt: row.createdAt || null,
        sourceCode: source.code,
        sourceLabel: source.label,
        selection: { code: "not_applicable", label: "لا يوجد اختيار يومي مرتبط بهذه الحركة", role: null },
        completion: { code: source.channel, label: source.channelLabel },
        fulfillmentMode: row.fulfillmentMethod || null,
        actor: actorView(row.actor || {}, actorMap),
        status: "consumed",
        reference: { type: "activity_log", id: row.id || null },
        mealItems: [],
        allocationKeys: [],
        operations: [],
        reason: row.reason || null,
        notes: row.notes || null,
        evidence: ["ActivityLog.action=manual_subscription_meal_deduction"],
        confidence: "exact",
      };
    });
}

function allocationEvents({ subscription, trackingDays, rawDays, pickupRequests, auditsByDay, deliveriesByDay, actorMap }) {
  const trackingByDate = new Map(asArray(trackingDays).map((day) => [String(day.date), day]));
  const rawDayById = new Map(asArray(rawDays).map((day) => [idOf(day._id), day]));
  const pickupById = new Map(asArray(pickupRequests).map((request) => [idOf(request._id), request]));
  const events = [];
  const consumedPerDay = new Map();

  for (const allocation of asArray(subscription.baseMealAllocations)) {
    const state = String(allocation && allocation.state || "");
    if (!["reserved", "consumed", "forfeited"].includes(state)) continue;

    const quantity = Math.max(1, integer(allocation && allocation.quantity));
    const dayId = idOf(allocation && allocation.dayId);
    const pickupId = idOf(allocation && allocation.pickupRequestId);
    const day = dayId ? rawDayById.get(dayId) || null : null;
    const pickupRequest = pickupId ? pickupById.get(pickupId) || null : null;
    const date = String(allocation && allocation.date || day && day.date || pickupRequest && pickupRequest.date || "") || null;
    const trackingDay = date ? trackingByDate.get(date) || null : null;
    const status = String(day && day.status || pickupRequest && pickupRequest.status || state);
    const mode = fulfillmentMode(subscription, day, pickupRequest);
    const selection = selectionChannelFor({ day, pickupRequest });
    const audits = dayId ? auditsByDay.get(dayId) || [] : [];
    const delivery = dayId ? deliveriesByDay.get(dayId) || null : null;
    const operations = buildOperations({ day, pickupRequest, audits }, actorMap);
    const actor = fulfillmentActor({ day, pickupRequest, audits }, actorMap);
    const source = consumptionSource({ status, mode, pickupRequest });

    if (state === "consumed" && dayId) {
      consumedPerDay.set(dayId, integer(consumedPerDay.get(dayId)) + quantity);
    }

    const occurredAt = state === "reserved"
      ? allocation.reservedAt || pickupRequest && pickupRequest.creditsReservedAt || day && day.updatedAt || null
      : state === "forfeited"
        ? allocation.forfeitedAt || day && day.settledAt || null
        : allocation.consumedAt
          || pickupRequest && pickupRequest.creditsConsumedAt
          || day && day.fulfilledAt
          || delivery && delivery.deliveredAt
          || null;

    events.push({
      id: `allocation:${allocation.allocationKey || events.length}`,
      type: state === "reserved" ? "reservation" : state === "forfeited" ? "forfeiture" : "consumption",
      balanceEffect: state,
      quantity,
      date,
      occurredAt,
      sourceCode: state === "reserved" ? `${selection.code}_reservation` : source.code,
      sourceLabel: state === "reserved" ? "حجز وجبة ولم يتم استهلاكها بعد" : source.label,
      selection,
      completion: state === "reserved"
        ? { code: "pending", label: "لم يتم التسليم بعد" }
        : { code: source.channel, label: source.channelLabel },
      fulfillmentMode: mode,
      actor: state === "reserved" ? actorView({ role: selection.role }, actorMap) : actor,
      status,
      reference: pickupRequest
        ? { type: "subscription_pickup_request", id: pickupId }
        : day
          ? { type: "subscription_day", id: dayId }
          : { type: "base_meal_allocation", id: null },
      mealItems: itemsForAllocation(trackingDay, allocation, pickupRequest),
      allocationKeys: allocation.allocationKey ? [String(allocation.allocationKey)] : [],
      operations,
      evidence: [
        `baseMealAllocation.state=${state}`,
        pickupId ? "baseMealAllocation.pickupRequestId" : null,
        dayId ? "baseMealAllocation.dayId" : null,
        delivery && delivery.status ? `Delivery.status=${delivery.status}` : null,
      ].filter(Boolean),
      confidence: dayId || pickupId ? "exact" : "derived",
    });
  }

  return { events, consumedPerDay };
}

function legacyDayEvents({ subscription, trackingDays, rawDays, auditsByDay, deliveriesByDay, actorMap, consumedPerDay, limit }) {
  let remaining = Math.max(0, integer(limit));
  if (!remaining) return [];

  const trackingByDate = new Map(asArray(trackingDays).map((day) => [String(day.date), day]));
  const events = [];
  const candidates = asArray(rawDays)
    .filter((day) => CONSUMED_STATUSES.has(String(day && day.status || "")) && day.creditsDeducted)
    .sort((left, right) => String(left.date).localeCompare(String(right.date)));

  for (const day of candidates) {
    if (!remaining) break;
    const dayId = idOf(day._id);
    const trackingDay = trackingByDate.get(String(day.date)) || null;
    const fulfilledSnapshot = asObject(day.fulfilledSnapshot);
    const expected = Math.max(
      integer(fulfilledSnapshot.deductedCredits),
      integer(trackingDay && trackingDay.consumedMeals),
      integer(trackingDay && trackingDay.receivedMeals)
    );
    const missing = Math.max(0, expected - integer(consumedPerDay.get(dayId)));
    if (!missing) continue;

    const quantity = Math.min(missing, remaining);
    remaining -= quantity;
    const audits = auditsByDay.get(dayId) || [];
    const delivery = deliveriesByDay.get(dayId) || null;
    const mode = fulfillmentMode(subscription, day, null);
    const source = consumptionSource({ status: String(day.status), mode, pickupRequest: null });

    events.push({
      id: `legacy-day:${dayId}`,
      type: "consumption",
      balanceEffect: "consumed",
      quantity,
      date: day.date || null,
      occurredAt: day.fulfilledAt || day.settledAt || delivery && delivery.deliveredAt || null,
      sourceCode: source.code,
      sourceLabel: source.label,
      selection: selectionChannelFor({ day }),
      completion: { code: source.channel, label: source.channelLabel },
      fulfillmentMode: mode,
      actor: fulfillmentActor({ day, audits }, actorMap),
      status: String(day.status),
      reference: { type: "subscription_day", id: dayId },
      mealItems: asArray(trackingDay && trackingDay.mealItems),
      allocationKeys: [],
      operations: buildOperations({ day, audits }, actorMap),
      evidence: [
        "SubscriptionDay.creditsDeducted=true",
        `SubscriptionDay.status=${day.status}`,
        "fulfilledSnapshot/timeline quantity",
      ],
      confidence: "derived",
    });
  }
  return events;
}

function unknownEvent(quantity) {
  const source = consumptionSource({ unknown: true });
  return {
    id: "legacy-unattributed",
    type: "consumption",
    balanceEffect: "consumed",
    quantity: integer(quantity),
    date: null,
    occurredAt: null,
    sourceCode: source.code,
    sourceLabel: source.label,
    selection: { code: "unknown", label: "مصدر الاختيار غير معروف", role: null },
    completion: { code: source.channel, label: source.channelLabel },
    fulfillmentMode: null,
    actor: { id: null, role: null, email: null },
    status: "unknown",
    reference: { type: "subscription_aggregate", id: null },
    mealItems: [],
    allocationKeys: [],
    operations: [],
    evidence: ["لا يوجد سجل يوم أو طلب استلام أو خصم يدوي يطابق عداد الاستهلاك"],
    confidence: "unknown",
  };
}

function mergeEvents(events) {
  const merged = new Map();
  for (const event of events) {
    const key = [
      event.type,
      event.sourceCode,
      event.date || "",
      event.reference && event.reference.type || "",
      event.reference && event.reference.id || "",
      event.actor && event.actor.id || "",
    ].join("|");
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...event, mealItems: [...asArray(event.mealItems)], allocationKeys: [...asArray(event.allocationKeys)] });
      continue;
    }
    existing.quantity += integer(event.quantity);
    existing.allocationKeys.push(...asArray(event.allocationKeys));
    const itemIds = new Set(existing.mealItems.map((item) => String(item && (item.id || item.slotKey) || "")));
    for (const item of asArray(event.mealItems)) {
      const itemId = String(item && (item.id || item.slotKey) || "");
      if (!itemId || itemIds.has(itemId)) continue;
      itemIds.add(itemId);
      existing.mealItems.push(item);
    }
  }
  return [...merged.values()];
}

function aggregateTotals(events, balanceConsumedMeals) {
  const consumed = events.filter((event) => event.balanceEffect === "consumed");
  const representedMeals = consumed.reduce((sum, event) => sum + integer(event.quantity), 0);
  const exactMeals = consumed.filter((event) => event.confidence === "exact").reduce((sum, event) => sum + integer(event.quantity), 0);
  const derivedMeals = consumed.filter((event) => event.confidence === "derived").reduce((sum, event) => sum + integer(event.quantity), 0);
  const unknownMeals = consumed.filter((event) => event.confidence === "unknown").reduce((sum, event) => sum + integer(event.quantity), 0);
  const reservationMeals = events.filter((event) => event.balanceEffect === "reserved").reduce((sum, event) => sum + integer(event.quantity), 0);

  const consumption = {
    delivery: 0,
    branchPickup: 0,
    dashboardManual: 0,
    consumedWithoutPreparation: 0,
    other: 0,
    unknown: 0,
  };
  const selection = { mobileApp: 0, dashboard: 0, unknown: 0, notApplicable: 0 };

  for (const event of consumed) {
    const quantity = integer(event.quantity);
    if (event.sourceCode === "delivery_fulfillment") consumption.delivery += quantity;
    else if (event.sourceCode === "branch_pickup_fulfillment") consumption.branchPickup += quantity;
    else if (event.sourceCode === "dashboard_manual_deduction") consumption.dashboardManual += quantity;
    else if (event.sourceCode === "consumed_without_preparation") consumption.consumedWithoutPreparation += quantity;
    else if (event.confidence === "unknown") consumption.unknown += quantity;
    else consumption.other += quantity;

    if (event.selection && event.selection.code === "mobile_app") selection.mobileApp += quantity;
    else if (event.selection && event.selection.code === "dashboard") selection.dashboard += quantity;
    else if (event.selection && event.selection.code === "not_applicable") selection.notApplicable += quantity;
    else selection.unknown += quantity;
  }

  const authoritative = integer(balanceConsumedMeals);
  const difference = authoritative - representedMeals;
  return {
    status: unknownMeals === 0 && difference === 0 ? "complete" : "partial",
    balanceConsumedMeals: authoritative,
    representedMeals,
    attributedMeals: exactMeals + derivedMeals,
    exactMeals,
    derivedMeals,
    unknownMeals,
    reservationMeals,
    difference,
    consumption,
    selection,
  };
}

function collectActorIds({ rawDays, pickupRequests, audits, manualDeductions }) {
  const ids = new Set();
  const add = (value) => {
    const id = idOf(value);
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

async function loadRecords(subscriptionId, manualDeductions = []) {
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

function buildProvenanceReport({ subscription, trackingDays, summary, manualDeductions, rawDays, pickupRequests, audits, deliveries, actors }) {
  const actorMap = new Map(asArray(actors).map((actor) => [idOf(actor._id), actor]));
  const auditsByDay = new Map();
  for (const audit of asArray(audits)) {
    const dayId = idOf(audit.entityId);
    if (!dayId) continue;
    const rows = auditsByDay.get(dayId) || [];
    rows.push(audit);
    auditsByDay.set(dayId, rows);
  }
  const deliveriesByDay = new Map(asArray(deliveries).map((delivery) => [idOf(delivery.dayId), delivery]));
  const manual = manualEvents(manualDeductions, actorMap);
  const allocations = allocationEvents({
    subscription,
    trackingDays,
    rawDays,
    pickupRequests,
    auditsByDay,
    deliveriesByDay,
    actorMap,
  });

  const summaryConsumed = summary
    ? (summary.balanceConsumedMeals ?? summary.consumedMeals)
    : undefined;
  const balanceConsumedMeals = integer(
    summaryConsumed
      ?? subscription.consumedMeals
      ?? Math.max(0, Number(subscription.totalMeals || 0) - Number(subscription.remainingMeals || 0))
  );
  const allocationConsumed = allocations.events
    .filter((event) => event.balanceEffect === "consumed")
    .reduce((sum, event) => sum + integer(event.quantity), 0);
  const manualConsumed = manual.reduce((sum, event) => sum + integer(event.quantity), 0);
  const legacyLimit = Math.max(0, balanceConsumedMeals - allocationConsumed - manualConsumed);
  const legacy = legacyDayEvents({
    subscription,
    trackingDays,
    rawDays,
    auditsByDay,
    deliveriesByDay,
    actorMap,
    consumedPerDay: allocations.consumedPerDay,
    limit: legacyLimit,
  });
  const known = allocationConsumed + manualConsumed + legacy.reduce((sum, event) => sum + integer(event.quantity), 0);
  const unknownQuantity = Math.max(0, balanceConsumedMeals - known);
  const unknown = unknownQuantity ? [unknownEvent(unknownQuantity)] : [];

  const movements = mergeEvents([
    ...allocations.events,
    ...legacy,
    ...manual,
    ...unknown,
  ]).sort((left, right) => {
    const leftTime = new Date(left.occurredAt || `${left.date || "1900-01-01"}T00:00:00Z`).getTime();
    const rightTime = new Date(right.occurredAt || `${right.date || "1900-01-01"}T00:00:00Z`).getTime();
    return rightTime - leftTime;
  });

  return {
    contractVersion: "subscription_meal_movement_provenance.v1",
    readOnly: true,
    coverage: aggregateTotals(movements, balanceConsumedMeals),
    movements,
  };
}

async function buildSubscriptionMealMovementProvenance({ subscription, tracking, manualDeductions = [] }) {
  const records = await loadRecords(subscription._id, manualDeductions);
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
