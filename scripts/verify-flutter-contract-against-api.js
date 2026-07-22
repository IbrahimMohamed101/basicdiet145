#!/usr/bin/env node
"use strict";

const {
  validateAddonChoices,
  validateFulfillmentStatus,
  validateMealPlannerMenu,
  validateOverview,
  validatePickupAvailability,
  validatePickupRequests,
  validatePickupStatus,
  validateSubscriptionDay,
} = require("../src/contracts/flutterMobileResponseContract");

const FLUTTER_BASELINE = "Basic-Diet/mobile_app@6e1be0b38272160bc377cedf391cf082d0f2abfa";

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function normalizeBaseUrl(value) {
  return String(value).trim().replace(/\/+$/, "");
}

function endpoint(path) {
  return path.startsWith("/") ? path : `/${path}`;
}

function summarizeError(error) {
  if (!error) return "Unknown error";
  const parts = [error.code, error.message].filter(Boolean);
  return parts.join(": ");
}

async function requestJson({ baseUrl, token, path }) {
  const url = `${baseUrl}${endpoint(path)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "X-Flutter-Contract-Baseline": FLUTTER_BASELINE,
    },
    signal: AbortSignal.timeout(Number(process.env.API_TIMEOUT_MS || 30000)),
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_error) {
    throw new Error(`${path}: expected JSON, received ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    const code = payload && (payload.code || payload.error && payload.error.code);
    const message = payload && (payload.message || payload.error && payload.error.message);
    throw new Error(`${path}: HTTP ${response.status}${code ? ` ${code}` : ""}${message ? ` — ${message}` : ""}`);
  }

  return payload;
}

async function runCheck(context, check) {
  const startedAt = Date.now();
  const payload = await requestJson({
    baseUrl: context.baseUrl,
    token: context.token,
    path: check.path,
  });
  check.validate(payload);
  const elapsedMs = Date.now() - startedAt;
  console.log(`PASS  ${check.name.padEnd(28)} ${String(elapsedMs).padStart(5)}ms  ${check.path}`);
  return payload;
}

async function main() {
  const baseUrl = normalizeBaseUrl(requiredEnv("API_BASE_URL"));
  const token = requiredEnv("CUSTOMER_TOKEN");
  const subscriptionId = requiredEnv("SUBSCRIPTION_ID");
  const businessDate = requiredEnv("BUSINESS_DATE");
  const includePickup = !boolEnv("SKIP_PICKUP_CONTRACTS", false);

  console.log(`Flutter baseline: ${FLUTTER_BASELINE}`);
  console.log(`API base URL:     ${baseUrl}`);
  console.log(`Subscription:     ${subscriptionId}`);
  console.log(`Business date:    ${businessDate}`);
  console.log("Mode:             read-only GET contract verification");
  console.log("");

  const checks = [
    {
      name: "Current overview",
      path: "/api/subscriptions/current/overview",
      validate: validateOverview,
    },
    {
      name: "Add-on choices",
      path: "/api/subscriptions/addon-choices",
      validate: validateAddonChoices,
    },
    {
      name: "Meal planner menu",
      path: "/api/subscriptions/meal-planner-menu",
      validate: validateMealPlannerMenu,
    },
    {
      name: "Subscription day",
      path: `/api/subscriptions/${encodeURIComponent(subscriptionId)}/days/${encodeURIComponent(businessDate)}`,
      validate: validateSubscriptionDay,
    },
    {
      name: "Fulfillment status",
      path: `/api/subscriptions/${encodeURIComponent(subscriptionId)}/days/${encodeURIComponent(businessDate)}/fulfillment/status`,
      validate: validateFulfillmentStatus,
    },
  ];

  if (includePickup) {
    checks.push(
      {
        name: "Pickup availability",
        path: `/api/subscriptions/${encodeURIComponent(subscriptionId)}/pickup-availability?date=${encodeURIComponent(businessDate)}&includeUnavailable=true&includeHistory=true`,
        validate: validatePickupAvailability,
      },
      {
        name: "Pickup request list",
        path: `/api/subscriptions/${encodeURIComponent(subscriptionId)}/pickup-requests?date=${encodeURIComponent(businessDate)}`,
        validate: validatePickupRequests,
      },
      {
        name: "Pickup status",
        path: `/api/subscriptions/${encodeURIComponent(subscriptionId)}/days/${encodeURIComponent(businessDate)}/pickup/status`,
        validate: validatePickupStatus,
      }
    );
  }

  const failures = [];
  for (const check of checks) {
    try {
      await runCheck({ baseUrl, token }, check);
    } catch (error) {
      failures.push({ check, error });
      console.error(`FAIL  ${check.name.padEnd(28)}       ${check.path}`);
      console.error(`      ${summarizeError(error)}`);
      if (boolEnv("FAIL_FAST", false)) break;
    }
  }

  console.log("");
  if (failures.length) {
    console.error(`${failures.length}/${checks.length} Flutter contract checks failed.`);
    console.error("No write endpoint was called. Fix the backend response or choose an existing BUSINESS_DATE, then rerun.");
    process.exitCode = 1;
    return;
  }

  console.log(`${checks.length}/${checks.length} Flutter contract checks passed.`);
  console.log("No write endpoint was called and CUSTOMER_TOKEN was not printed.");
}

main().catch((error) => {
  console.error(`Flutter contract verifier failed: ${summarizeError(error)}`);
  process.exitCode = 1;
});
