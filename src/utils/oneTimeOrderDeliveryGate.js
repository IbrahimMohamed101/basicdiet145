"use strict";

function isOneTimeOrderDeliveryEnabled() {
  return process.env.ONE_TIME_ORDER_DELIVERY_ENABLED === "true";
}

function getOrderFulfillmentMethod(order = {}) {
  return String(order.fulfillmentMethod || order.deliveryMode || "").trim();
}

function isOneTimeDeliveryOrder(order = {}) {
  return getOrderFulfillmentMethod(order) === "delivery";
}

function shouldBlockOneTimeOrderDelivery(order = {}) {
  return isOneTimeDeliveryOrder(order) && !isOneTimeOrderDeliveryEnabled();
}

function createOneTimeOrderDeliveryDisabledError() {
  const err = new Error("One-time order delivery is disabled");
  err.status = 409;
  err.code = "DELIVERY_NOT_SUPPORTED";
  return err;
}

module.exports = {
  isOneTimeOrderDeliveryEnabled,
  getOrderFulfillmentMethod,
  isOneTimeDeliveryOrder,
  shouldBlockOneTimeOrderDelivery,
  createOneTimeOrderDeliveryDisabledError,
};
