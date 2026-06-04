#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const BASE_URL = String(process.env.BASE_URL || "https://basicdiet145.onrender.com").replace(/\/+$/, "");
const APP_TOKEN = process.env.APP_TOKEN || "";
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || "";
const QA_KEEP_SUBSCRIPTION = process.env.QA_KEEP_SUBSCRIPTION === "true";
const QA_DAYS_OFFSET = Number.isInteger(Number(process.env.QA_DAYS_OFFSET))
  ? Number(process.env.QA_DAYS_OFFSET)
  : 2;

const PLAN_KEY = "subscription_7_days";
const GRAMS = 100;
const MEALS_PER_DAY = 1;
const EXPECTED_BASE_PRICE_HALALA = 13800;

let failures = 0;
let warnings = 0;
let skips = 0;
let createdSubscriptionId = "";

function pass(label, detail = "") {
  console.log(`PASS ${label}${detail ? ` - ${detail}` : ""}`);
}

function fail(label, detail = "") {
  failures += 1;
  console.log(`FAIL ${label}${detail ? ` - ${detail}` : ""}`);
}

function warn(label, detail = "") {
  warnings += 1;
  console.log(`WARN ${label}${detail ? ` - ${detail}` : ""}`);
}

function skip(label, detail = "") {
  skips += 1;
  console.log(`SKIP ${label}${detail ? ` - ${detail}` : ""}`);
}

function requireEnv() {
  const missing = [];
  if (process.env.QA_ALLOW_SUBSCRIPTION_WRITE !== "true") missing.push("QA_ALLOW_SUBSCRIPTION_WRITE=true");
  if (!APP_TOKEN) missing.push("APP_TOKEN");
  if (!DASHBOARD_TOKEN) missing.push("DASHBOARD_TOKEN");
  if (missing.length) {
    console.error(`Refusing to run: missing ${missing.join(", ")}.`);
    process.exitCode = 2;
    return false;
  }
  return true;
}

function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch (_err) {
    return null;
  }
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function requestJson(method, apiPath, { token, body, allowError = false } = {}) {
  const headers = {
    Accept: "application/json",
    ...(token ? authHeader(token) : {}),
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${BASE_URL}${apiPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_err) {
    json = { rawText: text };
  }

  if (!allowError && !response.ok) {
    throw new Error(`${method} ${apiPath} failed with HTTP ${response.status}${formatError(json)}`);
  }

  return { status: response.status, ok: response.ok, json };
}

function formatError(json) {
  const code = String((json && (json.code || json.errorCode)) || (json && json.error && json.error.code) || "");
  const message = String((json && json.message) || (json && json.error && json.error.message) || "");
  return `${code ? ` ${code}` : ""}${message ? `: ${message}` : ""}`;
}

function getData(json) {
  return json && typeof json === "object" ? json.data : undefined;
}

function getId(row) {
  return String(row && (row.id || row._id || row.planId || row.subscriptionId) || "");
}

function dataArray(json) {
  const data = getData(json);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data && data.items)) return data.items;
  if (Array.isArray(data && data.plans)) return data.plans;
  return [];
}

function getPlanKey(plan) {
  return String(plan && (plan.key || plan.code || plan.slug || plan.planKey) || "");
}

function getGramsRows(plan) {
  return plan && (plan.gramsOptions || plan.weightOptions || []);
}

function getMealRows(gramsRow) {
  return gramsRow && (gramsRow.mealsOptions || gramsRow.mealOptions || gramsRow.options || []);
}

function getGrams(row) {
  return Number(row && (row.grams ?? row.weightGrams ?? row.value ?? row.gram));
}

function getMeals(row) {
  return Number(row && (row.mealsPerDay ?? row.meals ?? row.count ?? row.value));
}

function getPriceHalala(row) {
  if (!row) return NaN;
  if (row.priceHalala != null) return Number(row.priceHalala);
  if (row.price != null) return Number(row.price);
  if (row.priceSar != null) return Math.round(Number(row.priceSar) * 100);
  return NaN;
}

function ksaDateOffset(daysOffset) {
  const date = new Date(Date.now() + Number(daysOffset || 0) * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function buildSubscriptionPayload({ userId, planId, startDate, pickupLocationId = "main" }) {
  const tag = `QA_AUTO_DAY_VALIDATION_${Date.now()}`;
  return {
    userId,
    planId,
    grams: GRAMS,
    mealsPerDay: MEALS_PER_DAY,
    startDate,
    deliveryMethod: "pickup",
    deliveryMode: "pickup",
    pickupLocationId,
    delivery: {
      type: "pickup",
      pickupLocationId,
    },
    note: tag,
    notes: tag,
    source: "manual_qa",
    metadata: {
      qa: true,
      source: "manual_qa",
      tag,
    },
  };
}

function withoutExplicitPickupLocation(payload) {
  const next = JSON.parse(JSON.stringify(payload));
  delete next.pickupLocationId;
  if (next.delivery) delete next.delivery.pickupLocationId;
  return next;
}

function extractSubscriptionId(createData) {
  if (!createData || typeof createData !== "object") return "";
  return String(
    createData.id
      || createData._id
      || createData.subscriptionId
      || (createData.subscription && (createData.subscription.id || createData.subscription._id))
      || ""
  );
}

function canUseTimelineDay(day) {
  if (!day || !day.date) return false;
  const status = String(day.status || day.timelineStatus || "").toLowerCase();
  if (["locked", "delivered", "consumed_without_preparation", "delivery_canceled", "canceled_at_branch", "no_show", "frozen", "skipped"].includes(status)) return false;
  if (day.canEdit === false || day.canModify === false) return false;
  return true;
}

async function resolveAppUser() {
  const payload = decodeJwtPayload(APP_TOKEN);
  const userId = payload && payload.userId ? String(payload.userId) : "";
  if (!userId || payload.tokenType !== "app_access" || payload.role !== "client") {
    fail("resolved app user", "APP_TOKEN is not a client app_access token");
    return "";
  }
  pass("resolved app user", `userId=${userId}`);
  return userId;
}

async function resolveCanonicalPlan() {
  const res = await requestJson("GET", "/api/plans", { token: APP_TOKEN });
  const plans = dataArray(res.json);
  const plan = plans.find((item) => getPlanKey(item) === PLAN_KEY);
  if (!plan) {
    fail("resolved canonical plan", `${PLAN_KEY} not found in GET /api/plans`);
    return null;
  }

  const gramsRow = getGramsRows(plan).find((row) => getGrams(row) === GRAMS);
  const mealRow = getMealRows(gramsRow).find((row) => getMeals(row) === MEALS_PER_DAY);
  const price = getPriceHalala(mealRow);
  if (price !== EXPECTED_BASE_PRICE_HALALA) {
    fail("resolved canonical plan", `expected ${EXPECTED_BASE_PRICE_HALALA} halala, got ${Number.isFinite(price) ? price : "missing"}`);
    return null;
  }

  pass("resolved canonical plan", `planId=${getId(plan)} ${GRAMS}g/${MEALS_PER_DAY} meal=${EXPECTED_BASE_PRICE_HALALA} halala`);
  return { plan, planId: getId(plan) };
}

async function dashboardQuote(payload) {
  let res = await requestJson("POST", "/api/dashboard/subscriptions/quote", {
    token: DASHBOARD_TOKEN,
    body: payload,
    allowError: true,
  });
  if (res.ok) {
    pass("dashboard quote", "pickupLocationId=main accepted");
    return { quote: getData(res.json), payload };
  }

  const errorText = formatError(res.json);
  if (/Invalid pickup location/i.test(errorText)) {
    const fallbackPayload = withoutExplicitPickupLocation(payload);
    res = await requestJson("POST", "/api/dashboard/subscriptions/quote", {
      token: DASHBOARD_TOKEN,
      body: fallbackPayload,
      allowError: true,
    });
    if (res.ok) {
      pass("dashboard quote", "backend auto-selected active pickup location");
      return { quote: getData(res.json), payload: fallbackPayload };
    }
  }

  fail("dashboard quote", `HTTP ${res.status}${formatError(res.json)}`);
  return null;
}

async function createQaSubscription(payload) {
  const res = await requestJson("POST", "/api/dashboard/subscriptions", {
    token: DASHBOARD_TOKEN,
    body: payload,
    allowError: true,
  });
  if (!res.ok) {
    fail("created QA subscription", `HTTP ${res.status}${formatError(res.json)}`);
    return "";
  }

  const id = extractSubscriptionId(getData(res.json));
  if (!id) {
    fail("created QA subscription", "creation response did not include subscription id");
    return "";
  }
  createdSubscriptionId = id;
  pass("created QA subscription", `subscriptionId=${id}`);
  return id;
}

async function discoverEditableDay(subscriptionId, fallbackStartDate) {
  const res = await requestJson("GET", `/api/subscriptions/${subscriptionId}/timeline`, {
    token: APP_TOKEN,
    allowError: true,
  });
  if (res.ok) {
    const days = Array.isArray(getData(res.json) && getData(res.json).days) ? getData(res.json).days : [];
    const day = days.find(canUseTimelineDay);
    if (day && day.date) {
      pass("discovered editable day", `date=${day.date}`);
      return day.date;
    }
  }

  if (fallbackStartDate) {
    pass("discovered editable day", `using startDate=${fallbackStartDate}`);
    return fallbackStartDate;
  }

  fail("discovered editable day", `timeline HTTP ${res.status}${formatError(res.json)}`);
  return "";
}

function runValidation(subscriptionId, dayDate) {
  const scriptPath = path.join(__dirname, "qa-subscription-day-validation.js");
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: __dirname,
    env: {
      ...process.env,
      BASE_URL,
      APP_TOKEN,
      QA_ALLOW_VALIDATION_POST: "true",
      SUBSCRIPTION_ID: subscriptionId,
      DAY_DATE: dayDate,
    },
    encoding: "utf8",
  });

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const summary = stdout.match(/SUMMARY failures=(\d+) warnings=(\d+) skips=(\d+)/);
  const lines = stdout.split(/\r?\n/).filter((line) => line && !line.startsWith("SUMMARY "));
  if (lines.length) console.log(lines.join("\n"));
  if (stderr.trim()) console.error(stderr.trim());

  if (summary) {
    failures += Number(summary[1] || 0);
    warnings += Number(summary[2] || 0);
    skips += Number(summary[3] || 0);
  } else if (result.status !== 0) {
    fail("day validation runner", `exited with status ${result.status}`);
  }
}

async function cleanupSubscription(subscriptionId) {
  if (!subscriptionId) return;
  if (QA_KEEP_SUBSCRIPTION) {
    warn("cleanup canceled QA subscription", `QA_KEEP_SUBSCRIPTION=true; subscription remains active: ${subscriptionId}`);
    return;
  }

  const res = await requestJson("POST", `/api/dashboard/subscriptions/${subscriptionId}/cancel`, {
    token: DASHBOARD_TOKEN,
    body: {
      reason: "QA_AUTO_DAY_VALIDATION cleanup",
    },
    allowError: true,
  });

  if (res.ok) {
    pass("cleanup canceled QA subscription", `subscriptionId=${subscriptionId}`);
  } else {
    warn("cleanup canceled QA subscription", `QA subscription remains active and must be manually canceled: ${subscriptionId}`);
  }
}

async function main() {
  if (!requireEnv()) return;
  console.log(`Base URL: ${BASE_URL}`);

  const userId = await resolveAppUser();
  if (!userId) {
    console.log(`SUMMARY failures=${failures} warnings=${warnings} skips=${skips}`);
    process.exitCode = 1;
    return;
  }

  const planResult = await resolveCanonicalPlan();
  if (!planResult) {
    console.log(`SUMMARY failures=${failures} warnings=${warnings} skips=${skips}`);
    process.exitCode = 1;
    return;
  }

  const startDate = ksaDateOffset(QA_DAYS_OFFSET);
  const initialPayload = buildSubscriptionPayload({
    userId,
    planId: planResult.planId,
    startDate,
    pickupLocationId: "main",
  });

  const quoteResult = await dashboardQuote(initialPayload);
  if (!quoteResult) {
    console.log(`SUMMARY failures=${failures} warnings=${warnings} skips=${skips}`);
    process.exitCode = 1;
    return;
  }

  try {
    const subscriptionId = await createQaSubscription(quoteResult.payload);
    if (!subscriptionId) {
      console.log(`SUMMARY failures=${failures} warnings=${warnings} skips=${skips}`);
      process.exitCode = 1;
      return;
    }

    const dayDate = await discoverEditableDay(subscriptionId, startDate);
    if (dayDate) {
      runValidation(subscriptionId, dayDate);
    }
  } finally {
    await cleanupSubscription(createdSubscriptionId);
  }

  console.log(`SUMMARY failures=${failures} warnings=${warnings} skips=${skips}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  fail("script runtime", err.message);
  await cleanupSubscription(createdSubscriptionId);
  console.log(`SUMMARY failures=${failures} warnings=${warnings} skips=${skips}`);
  process.exitCode = 1;
});
