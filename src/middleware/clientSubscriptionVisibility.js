"use strict";

function normalizeRequestPath(value) {
  const path = String(value || "").split("?", 1)[0];
  if (path.length > 1) return path.replace(/\/+$/, "");
  return path;
}

function hideCanceledSubscriptionsFromClientList(payload, {
  method = "",
  requestUrl = "",
} = {}) {
  if (String(method || "").trim().toUpperCase() !== "GET") return payload;
  if (normalizeRequestPath(requestUrl) !== "/api/subscriptions") return payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  if (!Array.isArray(payload.data)) return payload;

  return {
    ...payload,
    data: payload.data.filter((subscription) => (
      String(subscription && subscription.status || "").trim().toLowerCase() !== "canceled"
    )),
  };
}

module.exports = {
  hideCanceledSubscriptionsFromClientList,
  normalizeRequestPath,
};
