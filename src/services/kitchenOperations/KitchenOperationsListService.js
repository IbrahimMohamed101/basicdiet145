"use strict";

const { isValidKSADateString } = require("../../utils/date");
const {
  fetchSubscriptionDaysByDate,
  fetchOrdersByDate,
  fetchMealNameMap,
  fetchAddonNameMap,
  collectSubscriptionDayMealIds,
  collectOrderMealIds,
  collectSubscriptionDayAddonIds,
} = require("./KitchenOperationsDataService");
const {
  mapSubscriptionDayToRow,
  mapOrderToRow,
  sanitizeRow,
} = require("./KitchenOperationsMapper");
const { STATUS_SORT_ORDER } = require("./KitchenOperationsStatusResolver");

const VALID_TABS = new Set(["subscriptions", "orders", "branch_pickup"]);
const VALID_MODES = new Set(["all", "delivery", "pickup"]);
const VALID_SORT_BY = new Set(["status", "customerName", "reference", "timeWindow", "date", "createdAt"]);

function normalizeQuery(rawQuery = {}) {
  const page = Math.max(1, Number.parseInt(rawQuery.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(rawQuery.limit, 10) || 20));
  const tab = VALID_TABS.has(rawQuery.tab) ? rawQuery.tab : "subscriptions";
  const mode = VALID_MODES.has(rawQuery.mode) ? rawQuery.mode : "all";
  const sortBy = VALID_SORT_BY.has(rawQuery.sortBy) ? rawQuery.sortBy : "status";
  const sortOrder = String(rawQuery.sortOrder || "asc").toLowerCase() === "desc" ? "desc" : "asc";

  return {
    date: String(rawQuery.date || "").trim(),
    tab,
    status: rawQuery.status ? String(rawQuery.status).trim() : null,
    mode,
    search: rawQuery.search ? String(rawQuery.search).trim().toLowerCase() : "",
    page,
    limit,
    branchId: rawQuery.branchId ? String(rawQuery.branchId).trim() : null,
    kitchenId: rawQuery.kitchenId ? String(rawQuery.kitchenId).trim() : null,
    sortBy,
    sortOrder,
  };
}

function validateQuery(query) {
  if (!query.date || !isValidKSADateString(query.date)) {
    const err = new Error("Invalid date");
    err.status = 400;
    err.code = "INVALID_DATE";
    throw err;
  }
}

function matchesMode(row, mode) {
  if (mode === "all") return true;
  return row.mode === mode;
}

function matchesStatus(row, status) {
  if (!status) return true;
  return row.status === status;
}

function matchesBranch(row, branchId) {
  if (!branchId) return true;
  return row.branchId === branchId;
}

function matchesSearch(row, search) {
  if (!search) return true;
  const haystack = [
    row.reference,
    row.customer && row.customer.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(search);
}

function sortRows(rows, sortBy, sortOrder) {
  const multiplier = sortOrder === "desc" ? -1 : 1;
  const cloned = rows.slice();

  cloned.sort((left, right) => {
    let comparison = 0;

    switch (sortBy) {
      case "customerName":
        comparison = String(left.customer && left.customer.name || "").localeCompare(String(right.customer && right.customer.name || ""), "ar");
        break;
      case "reference":
        comparison = String(left.reference || "").localeCompare(String(right.reference || ""));
        break;
      case "timeWindow":
        comparison = String(left.timeWindow && left.timeWindow.label || "").localeCompare(String(right.timeWindow && right.timeWindow.label || ""));
        break;
      case "date":
        comparison = String(left.date || "").localeCompare(String(right.date || ""));
        break;
      case "createdAt":
        comparison = String(left.timing && left.timing.createdAt || "").localeCompare(String(right.timing && right.timing.createdAt || ""));
        break;
      case "status":
      default:
        comparison = (STATUS_SORT_ORDER[left.status] || 999) - (STATUS_SORT_ORDER[right.status] || 999);
        if (comparison === 0) {
          comparison = String(left.reference || "").localeCompare(String(right.reference || ""));
        }
        break;
    }

    return comparison * multiplier;
  });

  return cloned;
}

async function fetchListBaseDataset(query, runtime) {
  const [subscriptionDays, orders] = await Promise.all([
    query.tab === "orders" ? Promise.resolve([]) : runtime.fetchSubscriptionDaysByDate(query.date),
    query.tab === "subscriptions" || query.tab === "branch_pickup" ? Promise.resolve([]) : runtime.fetchOrdersByDate(query.date),
  ]);

  const mealIds = collectSubscriptionDayMealIds(subscriptionDays).concat(collectOrderMealIds(orders));
  const addonIds = collectSubscriptionDayAddonIds(subscriptionDays);

  const [mealNameById, addonNameById] = await Promise.all([
    runtime.fetchMealNameMap(mealIds),
    runtime.fetchAddonNameMap(addonIds),
  ]);

  return {
    subscriptionDays,
    orders,
    mealNameById,
    addonNameById,
  };
}

function buildRows(query, dataset) {
  const context = {
    mealNameById: dataset.mealNameById,
    addonNameById: dataset.addonNameById,
  };

  if (query.tab === "orders") {
    return dataset.orders.map((order) => mapOrderToRow(order, context));
  }

  const mappedDays = dataset.subscriptionDays.map((day) => mapSubscriptionDayToRow(
    day,
    context,
    { entityType: query.tab === "branch_pickup" ? "pickup_day" : "subscription_day" }
  ));

  return query.tab === "branch_pickup"
    ? mappedDays.filter((row) => row.mode === "pickup")
    : mappedDays;
}

async function listKitchenOperations(rawQuery = {}, options = {}) {
  const query = normalizeQuery(rawQuery);
  validateQuery(query);

  const runtime = {
    fetchSubscriptionDaysByDate,
    fetchOrdersByDate,
    fetchMealNameMap,
    fetchAddonNameMap,
    ...(options.runtime || {}),
  };

  const dataset = await fetchListBaseDataset(query, runtime);
  const rows = buildRows(query, dataset)
    .filter((row) => matchesMode(row, query.mode))
    .filter((row) => matchesStatus(row, query.status))
    .filter((row) => matchesBranch(row, query.branchId))
    .filter((row) => matchesSearch(row, query.search));

  const sortedRows = sortRows(rows, query.sortBy, query.sortOrder);
  const total = sortedRows.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / query.limit);
  const offset = (query.page - 1) * query.limit;
  const paginatedRows = sortedRows.slice(offset, offset + query.limit).map(sanitizeRow);

  return {
    date: query.date,
    tab: query.tab,
    rows: paginatedRows,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
    },
    appliedFilters: {
      status: query.status,
      mode: query.mode,
      search: query.search || null,
      branchId: query.branchId,
      kitchenId: query.kitchenId,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    },
  };
}

module.exports = {
  listKitchenOperations,
};
