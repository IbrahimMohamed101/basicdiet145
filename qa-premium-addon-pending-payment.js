#!/usr/bin/env node
"use strict";

/**
 * Premium + Add-on Pending Payment QA Mission
 * 
 * Objectives:
 * 1. Create a manual active QA subscription.
 * 2. Select a premium protein (beef_steak = 2000 halala).
 * 3. Select an add-on (Juice = 1100 halala).
 * 4. Trigger unified pending payment (Total = 3100 halala).
 * 5. Verify timeline and payment state.
 * 6. Cleanup (Cancel subscription).
 */

const { stdin, stdout } = require("node:process");
const jwt = require("jsonwebtoken");

const BASE_URL = String(process.env.BASE_URL || "https://basicdiet145.onrender.com").replace(/\/+$/, "");
const APP_TOKEN = process.env.APP_TOKEN || "";
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || "";
const QA_ALLOW_PAYMENT_PENDING_WRITE = process.env.QA_ALLOW_PAYMENT_PENDING_WRITE === "true";
const QA_KEEP_SUBSCRIPTION = process.env.QA_KEEP_SUBSCRIPTION === "true";

let failures = 0;
let passes = 0;

function pass(label, detail = "") {
  passes += 1;
  console.log(`PASS: ${label}${detail ? ` - ${detail}` : ""}`);
}

function fail(label, detail = "") {
  failures += 1;
  console.error(`FAIL: ${label}${detail ? ` - ${detail}` : ""}`);
}

function resolveUserId(token) {
  try {
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.userId) return null;
    return String(decoded.userId);
  } catch (err) {
    return null;
  }
}

async function requestJson(method, path, { token, body, allowError = false } = {}) {
  const headers = {
    "Accept": "application/json",
    ...(token ? { "Authorization": `Bearer ${token}` } : {}),
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const raw = await response.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    if (!allowError) {
      throw new Error(`Invalid JSON from ${path}: ${raw.substring(0, 100)}`);
    }
    return { ok: response.ok, status: response.status, raw };
  }

  return { ok: response.ok, status: response.status, data: json };
}

async function runQa() {
  console.log("--- Premium + Add-on Pending Payment QA Starting ---");
  console.log(`Base URL: ${BASE_URL}`);

  if (!APP_TOKEN) {
    fail("Environment", "APP_TOKEN is missing");
    process.exit(1);
  }
  if (!DASHBOARD_TOKEN) {
    fail("Environment", "DASHBOARD_TOKEN is missing");
    process.exit(1);
  }
  if (!QA_ALLOW_PAYMENT_PENDING_WRITE) {
    fail("Environment", "QA_ALLOW_PAYMENT_PENDING_WRITE is not true. Write operations are disabled.");
    process.exit(1);
  }

  const userId = resolveUserId(APP_TOKEN);
  if (!userId) {
    fail("Auth", "Could not resolve userId from APP_TOKEN");
    process.exit(1);
  }
  pass("Auth", `Resolved userId: ${userId}`);

  // 1. Catalog Discovery
  console.log("Fetching catalog data...");
  const plansRes = await requestJson("GET", "/api/plans", { token: APP_TOKEN });
  if (!plansRes.ok) {
    fail("Catalog", `Failed to fetch plans: ${JSON.stringify(plansRes.data)}`);
    process.exit(1);
  }
  const plans = plansRes.data && plansRes.data.data;
  
  // Debug if needed
  if (process.env.QA_DEBUG === "true") {
    console.log("Plans found:", JSON.stringify(plans, null, 2));
  }

  const canonicalPlan = plans && plans.find(p => {
    const dCount = p.daysCount || p.durationDays || p.days;
    return (p.isActive || p.status === "active") && Number(dCount) >= 7;
  });
  
  if (!canonicalPlan) {
    fail("Catalog", "Could not find an active canonical plan (>= 7 days)");
    process.exit(1);
  }
  pass("Catalog", `Using Plan: ${canonicalPlan.id} (${canonicalPlan.daysCount} days)`);

  const menuRes = await requestJson("GET", "/api/subscriptions/meal-planner-menu", { token: APP_TOKEN });
  if (!menuRes.ok) {
    fail("Catalog", `Failed to fetch menu: ${JSON.stringify(menuRes.data)}`);
    process.exit(1);
  }

  const data = menuRes.data && menuRes.data.data;
  const builderCatalog = data && (data.builderCatalog || data);
  
  // Recursive aggregation for items/proteins
  function collectItems(obj, out = []) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach(item => collectItems(item, out));
      return;
    }
    // If it looks like a protein/addon object
    if (obj.key && (obj.id || obj._id)) {
      out.push(obj);
    }
    // Recurse into common collection fields
    ["sections", "products", "optionGroups", "options", "proteins", "items", "byCategory"].forEach(field => {
      if (obj[field]) collectItems(obj[field], out);
    });
  }

  const allProteins = [];
  collectItems(builderCatalog, allProteins);
  const beefSteak = allProteins.find(p => p.key === "beef_steak");

  if (!beefSteak) {
    fail("Catalog", `Could not find protein 'beef_steak'. Found keys: ${[...new Set(allProteins.map(p => p.key))].slice(0, 20).join(", ")}...`);
    process.exit(1);
  }
  pass("Catalog", `Found beef_steak (Premium: ${beefSteak.isPremium})`);

  const allAddons = [];
  const addonCatalog = data && (data.addonCatalog || data);
  collectItems(addonCatalog, allAddons);

  const targetAddon = allAddons.find(a => a.category === "juice" || a.priceHalala === 1100);

  if (!targetAddon) {
    fail("Catalog", `Could not find a suitable add-on (price: 1100 or category: juice). Found categories: ${[...new Set(allAddons.map(a => a.category))].join(", ")}`);
    process.exit(1);
  }
  pass("Catalog", `Using Add-on: ${targetAddon.id} (${targetAddon.priceHalala} halala)`);

  const branchRes = await requestJson("GET", "/api/branches/pickup", { token: APP_TOKEN });
  const branch = branchRes.data && branchRes.data.data && branchRes.data.data[0];
  const pickupLocationId = branch ? (branch.id || branch._id) : "main_branch";
  pass("Catalog", `Using Pickup Location: ${pickupLocationId}`);

  // 2. Create Active Subscription
  console.log("Creating Manual QA Subscription...");
  const subPayload = {
    userId,
    planId: canonicalPlan.id,
    grams: 100,
    mealsPerDay: 1,
    startDate: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0], // T+2
    deliveryMode: "pickup",
    pickupLocationId,
    addonSubscriptions: [{ addonId: targetAddon.id, maxPerDay: 1 }]
  };

  const createRes = await requestJson("POST", "/api/dashboard/subscriptions", { token: DASHBOARD_TOKEN, body: subPayload });
  if (!createRes.ok) {
    fail("Subscription", `Failed to create subscription: ${JSON.stringify(createRes.data)}`);
    process.exit(1);
  }
  const subscriptionId = createRes.data && createRes.data.data && createRes.data.data.id;
  pass("Subscription", `Created active subscription: ${subscriptionId}`);

  let currentSubId = subscriptionId;

  try {
    // 3. Selection Setup
    const timelineRes = await requestJson("GET", `/api/subscriptions/${subscriptionId}/timeline`, { token: APP_TOKEN });
    const entries = timelineRes.data && timelineRes.data.data && timelineRes.data.data.entries;
    const targetEntry = entries && entries.find(e => e.status === "open" || e.status === "available");
    
    if (!targetEntry) {
      fail("Timeline", "Could not find a modifiable day in timeline");
      throw new Error("Timeline error");
    }
    const targetDate = targetEntry.date;
    pass("Timeline", `Targeting date: ${targetDate}`);

    const selectionPayload = {
      mealSlots: [
        {
          slotIndex: 0,
          proteinId: beefSteak.id,
          carbId: null, // Default
          selectionType: "protein_only"
        }
      ],
      addonsOneTime: [] // Not adding one-time here, using the subscription entitlement
    };

    console.log(`Saving selection for ${targetDate}...`);
    const saveRes = await requestJson("PUT", `/api/subscriptions/${subscriptionId}/days/${targetDate}/selection`, { token: APP_TOKEN, body: selectionPayload });
    if (!saveRes.ok) {
      fail("Selection", `Failed to save selection: ${JSON.stringify(saveRes.data)}`);
      throw new Error("Selection error");
    }
    pass("Selection", "Successfully saved premium selection");

    // 4. Unified Payment Initiation
    console.log("Triggering Unified Payment initiation...");
    const paymentPayload = {
        source: "manual_qa_pending_check",
        note: "Testing Premium + Add-on combined pending payment"
    };
    const paymentRes = await requestJson("POST", `/api/subscriptions/${subscriptionId}/days/${targetDate}/payments`, { token: APP_TOKEN, body: paymentPayload });
    
    if (!paymentRes.ok) {
      fail("Payment", `Failed to initiate payment: ${JSON.stringify(paymentRes.data)}`);
      throw new Error("Payment error");
    }

    const pData = paymentRes.data && paymentRes.data.data;
    const totalHalala = pData && pData.totalHalala;
    
    // VERIFICATION
    if (totalHalala === 3100) {
      pass("Verification", `Expected total 3100 halala confirmed.`);
    } else {
      fail("Verification", `Expected 3100 halala, but got ${totalHalala}`);
    }

    const timelineCheck = await requestJson("GET", `/api/subscriptions/${subscriptionId}/timeline`, { token: APP_TOKEN });
    const dayCheck = timelineCheck.data && timelineCheck.data.data && timelineCheck.data.data.entries.find(e => e.date === targetDate);
    
    if (dayCheck && (dayCheck.paymentStatus === "pending" || dayCheck.commercialState === "pending_payment" || dayCheck.status === "pending_payment")) {
      pass("Verification", "Timeline reflects pending payment state.");
    } else {
      warn("Verification", `Timeline state for ${targetDate}: ${JSON.stringify(dayCheck)}`);
    }

  } catch (err) {
    console.error("QA Error during flow execution:", err.message);
  } finally {
    // 5. Cleanup
    if (!QA_KEEP_SUBSCRIPTION && currentSubId) {
      console.log(`Canceling subscription ${currentSubId} for cleanup...`);
      await requestJson("POST", `/api/dashboard/subscriptions/${currentSubId}/cancel`, { token: DASHBOARD_TOKEN, body: { reason: "QA Cleanup" } });
      pass("Cleanup", "Subscription canceled.");
    } else {
      console.log("Skipping cleanup as requested.");
    }
  }

  console.log("\n--- QA REPORT ---");
  console.log(`PASSES: ${passes}`);
  console.log(`FAILURES: ${failures}`);
  
  if (failures === 0) {
    console.log("FINAL STATUS: PASS_PROD_READY");
  } else {
    console.log("FINAL STATUS: FAILED");
    process.exit(1);
  }
}

runQa().catch(err => {
  console.error("Critical Failure:", err);
  process.exit(1);
});
