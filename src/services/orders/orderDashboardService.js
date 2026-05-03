const mongoose = require("mongoose");

const ActivityLog = require("../../models/ActivityLog");
const Order = require("../../models/Order");
const Payment = require("../../models/Payment");
const User = require("../../models/User");
const { FINAL_ORDER_STATUSES } = require("../../utils/orderState");
const { serializeOrderForDashboard } = require("./orderSerializationService");
const {
  executeOrderAction,
  getAllowedOrderActions,
} = require("./orderOpsTransitionService");

const MAX_LIMIT = 100;

function createServiceError(status, code, message, details) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  if (details !== undefined) err.details = details;
  return err;
}

function parsePositiveInt(value, fallback, max) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseStatusFilter(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((status) => FINAL_ORDER_STATUSES.includes(status));
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function roleVisibilityFilter(actor = {}) {
  const role = String(actor.role || "").toLowerCase();
  if (role === "kitchen") {
    return { statuses: ["confirmed", "in_preparation", "ready_for_pickup"] };
  }
  if (role === "courier") {
    return {
      fulfillmentMethod: "delivery",
      statuses: ["in_preparation", "out_for_delivery", "fulfilled", "cancelled"],
    };
  }
  return {};
}

async function buildSearchFilter(q) {
  const needle = String(q || "").trim();
  if (!needle) return null;

  const regex = new RegExp(escapeRegex(needle), "i");
  const or = [
    { orderNumber: regex },
    { "delivery.address.phone": regex },
    { "delivery.address.line1": regex },
    { "delivery.address.line2": regex },
    { "delivery.address.district": regex },
    { "delivery.address.city": regex },
  ];

  if (mongoose.Types.ObjectId.isValid(needle)) {
    or.push({ _id: new mongoose.Types.ObjectId(needle) });
  }

  const users = await User.find({
    $or: [{ name: regex }, { phone: regex }],
  }).select("_id").limit(100).lean();
  const userIds = users.map((user) => user._id);
  if (userIds.length) {
    or.push({ userId: { $in: userIds } });
  }

  return { $or: or };
}

async function buildOrderFilter(filters = {}, actor = {}) {
  const visibility = roleVisibilityFilter(actor);
  const query = {};
  if (visibility.fulfillmentMethod) query.fulfillmentMethod = visibility.fulfillmentMethod;
  const statuses = parseStatusFilter(filters.status);
  const visibleStatuses = Array.isArray(visibility.statuses) ? visibility.statuses : null;
  if (statuses.length && visibleStatuses) {
    query.status = { $in: statuses.filter((status) => visibleStatuses.includes(status)) };
  } else if (statuses.length) {
    query.status = { $in: statuses };
  } else if (visibleStatuses) {
    query.status = { $in: visibleStatuses };
  }
  if (filters.paymentStatus) query.paymentStatus = String(filters.paymentStatus).trim();
  if (filters.fulfillmentMethod && !visibility.fulfillmentMethod) query.fulfillmentMethod = String(filters.fulfillmentMethod).trim();
  if (filters.date) query.fulfillmentDate = String(filters.date).trim();
  if (filters.zoneId && mongoose.Types.ObjectId.isValid(filters.zoneId)) {
    query["delivery.zoneId"] = new mongoose.Types.ObjectId(filters.zoneId);
  }

  const from = parseDate(filters.from);
  const to = parseDate(filters.to);
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = from;
    if (to) query.createdAt.$lte = to;
  }

  const searchFilter = await buildSearchFilter(filters.q);
  if (searchFilter) {
    query.$and = query.$and || [];
    query.$and.push(searchFilter);
  }

  return query;
}

async function listDashboardOrders({ filters = {}, pagination = {}, actor = {} }) {
  const page = parsePositiveInt(pagination.page, 1, Number.MAX_SAFE_INTEGER);
  const limit = parsePositiveInt(pagination.limit, 25, MAX_LIMIT);
  const skip = (page - 1) * limit;
  const query = await buildOrderFilter(filters, actor);

  const [orders, total] = await Promise.all([
    Order.find(query)
      .populate("userId", "_id name phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Order.countDocuments(query),
  ]);

  return {
    items: orders.map((order) => serializeOrderForDashboard(order, {
      allowedActions: getAllowedOrderActions(order, actor),
    })),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

async function getDashboardOrder({ orderId, actor = {} }) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw createServiceError(400, "INVALID_ORDER_ID", "Invalid order id");
  }

  const order = await Order.findById(orderId)
    .populate("userId", "_id name phone")
    .lean();
  if (!order) {
    throw createServiceError(404, "ORDER_NOT_FOUND", "Order not found");
  }

  const [payment, activity] = await Promise.all([
    order.paymentId
      ? Payment.findById(order.paymentId).select("_id provider type status amount currency paidAt createdAt updatedAt").lean()
      : Payment.findOne({ orderId: order._id, type: "one_time_order" }).select("_id provider type status amount currency paidAt createdAt updatedAt").lean(),
    ActivityLog.find({ entityType: "order", entityId: order._id }).sort({ createdAt: -1 }).limit(50).lean(),
  ]);

  return serializeOrderForDashboard(order, {
    allowedActions: getAllowedOrderActions(order, actor),
    payment,
    activity,
    detail: true,
  });
}

async function executeDashboardOrderAction({ orderId, action, actor = {}, payload = {} }) {
  await executeOrderAction({ orderId, action, actor, payload });
  return getDashboardOrder({ orderId, actor });
}

module.exports = {
  listDashboardOrders,
  getDashboardOrder,
  executeDashboardOrderAction,
};
