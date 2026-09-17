#!/usr/bin/env node
"use strict";

require("dotenv").config();

const crypto = require("node:crypto");

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertLocalBaseUrl(value) {
  const url = new URL(value);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(url.hostname) && process.env.ALLOW_REMOTE_PICKUP_E2E !== "true") {
    throw new Error(
      "Refusing to create a pickup request against a non-local API. "
      + "Use a localhost URL or explicitly set ALLOW_REMOTE_PICKUP_E2E=true."
    );
  }
  return value.replace(/\/$/, "");
}

async function requestJson(url, { method = "GET", token, body = null } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      "Accept-Language": "ar",
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_err) {
    throw new Error(`${method} ${url} returned non-JSON (${response.status}): ${text.slice(0, 300)}`);
  }
  return { response, payload };
}

function assertNoHistoricalPickupFailures(payload, context) {
  const serialized = JSON.stringify(payload || {});
  for (const forbidden of [
    "Maximum call stack size exceeded",
    "Linked day entitlement is not available for this pickup request",
  ]) {
    if (serialized.includes(forbidden)) {
      throw new Error(`${context} leaked historical backend failure: ${forbidden}`);
    }
  }
}

function responseData(payload) {
  return payload && payload.data && typeof payload.data === "object"
    ? payload.data
    : payload;
}

function findSelectableItem(availability, requestedItemId = "") {
  const items = Array.isArray(availability.pickupItems) ? availability.pickupItems : [];
  if (requestedItemId) {
    const exact = items.find((item) => String(item.itemId) === requestedItemId);
    if (!exact) throw new Error(`PICKUP_ITEM_ID ${requestedItemId} was not returned by availability`);
    return exact;
  }
  return items.find((item) => item
    && item.availability
    && item.availability.available === true
    && item.availability.canSelect === true
    && item.selectionMode === "independent");
}

async function main() {
  const baseUrl = assertLocalBaseUrl(required("API_BASE_URL"));
  const userToken = required("USER_TOKEN");
  const subscriptionId = required("SUBSCRIPTION_ID");
  const date = required("PICKUP_DATE");
  const requestedItemId = String(process.env.PICKUP_ITEM_ID || "").trim();

  const availabilityUrl = `${baseUrl}/api/subscriptions/${subscriptionId}/pickup-availability?date=${encodeURIComponent(date)}&includeUnavailable=true&lang=ar`;
  console.log(`[pickup-api] GET ${availabilityUrl}`);
  const availabilityResult = await requestJson(availabilityUrl, { token: userToken });
  assertNoHistoricalPickupFailures(availabilityResult.payload, "pickup availability");
  if (!availabilityResult.response.ok) {
    throw new Error(`Availability failed (${availabilityResult.response.status}): ${JSON.stringify(availabilityResult.payload)}`);
  }

  const availability = responseData(availabilityResult.payload);
  const item = findSelectableItem(availability, requestedItemId);
  if (!item) {
    throw new Error(
      "No selectable pickup item was returned. Run the entitlement diagnostic for this subscription/date."
    );
  }

  const itemId = String(item.itemId);
  console.log(`[pickup-api] selected ${itemId}: ${item.display?.titleAr || item.title?.ar || item.label || "unnamed item"}`);

  const idempotencyKey = `local-pickup-${crypto.randomUUID()}`;
  const createUrl = `${baseUrl}/api/subscriptions/${subscriptionId}/pickup-requests`;
  const createResult = await requestJson(createUrl, {
    method: "POST",
    token: userToken,
    body: {
      date,
      selectedPickupItemIds: [itemId],
      idempotencyKey,
    },
  });
  assertNoHistoricalPickupFailures(createResult.payload, "pickup request creation");
  if (!createResult.response.ok) {
    throw new Error(`Create pickup request failed (${createResult.response.status}): ${JSON.stringify(createResult.payload)}`);
  }

  const created = responseData(createResult.payload);
  if (!created || !created.requestId) {
    throw new Error(`Create response is missing requestId: ${JSON.stringify(createResult.payload)}`);
  }
  console.log(`[pickup-api] created request ${created.requestId}, status=${created.status}`);

  const statusUrl = `${baseUrl}/api/subscriptions/${subscriptionId}/pickup-requests/${created.requestId}/status`;
  const statusResult = await requestJson(statusUrl, { token: userToken });
  assertNoHistoricalPickupFailures(statusResult.payload, "pickup request status");
  if (!statusResult.response.ok) {
    throw new Error(`Pickup status failed (${statusResult.response.status}): ${JSON.stringify(statusResult.payload)}`);
  }
  console.log(`[pickup-api] status endpoint passed`);

  const dashboardToken = String(process.env.DASHBOARD_TOKEN || "").trim();
  if (dashboardToken) {
    const opsUrl = `${baseUrl}/api/dashboard/ops/list?date=${encodeURIComponent(date)}`;
    const opsResult = await requestJson(opsUrl, { token: dashboardToken });
    assertNoHistoricalPickupFailures(opsResult.payload, "dashboard operations list");
    if (!opsResult.response.ok) {
      throw new Error(`Dashboard ops failed (${opsResult.response.status}): ${JSON.stringify(opsResult.payload)}`);
    }
    const rows = Array.isArray(opsResult.payload?.data) ? opsResult.payload.data : [];
    const row = rows.find((entry) => String(entry.id || entry.entityId || "") === String(created.requestId));
    if (!row) throw new Error("Created pickup request was not found in dashboard operations list");
    const cards = row.kitchen?.cards || row.kitchenCards || [];
    if (!cards.length) throw new Error("Dashboard operation has no kitchen cards");
    if (cards.some((card) => !String(card.title || "").trim() || String(card.title).trim() === "وجبة")) {
      throw new Error(`Dashboard returned a generic/empty kitchen card title: ${JSON.stringify(cards)}`);
    }
    console.log(`[pickup-api] dashboard operation and product-name contract passed`);
  }

  console.log("[pickup-api] local end-to-end pickup flow passed");
}

main().catch((err) => {
  console.error(`[pickup-api] ${err.message}`);
  process.exitCode = 1;
});
