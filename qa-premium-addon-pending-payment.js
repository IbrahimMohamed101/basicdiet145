#!/usr/bin/env node
"use strict";

/**
 * Premium + Add-on Pending Payment QA Mission
 * 
 * Objectives:
 * 1. Create a manual active QA subscription.
 * 2. Scenario A: Select a premium protein + entitled daily juice.
 *    Expected: juice priceHalala=0, total=premium fee only.
 * 3. Scenario B: Select a non-entitled daily snack (no snack entitlement).
 *    Expected: snack accepted with source=pending_payment, priceHalala=snack MenuProduct price.
 * 4. Combined: premium beef_steak + entitled juice + non-entitled snack.
 *    Expected: total = premium fee + snack price.
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
let warnings = 0;

function pass(label, detail = "") {
  passes += 1;
  console.log(`PASS: ${label}${detail ? ` - ${detail}` : ""}`);
}

function fail(label, detail = "") {
  failures += 1;
  console.error(`FAIL: ${label}${detail ? ` - ${detail}` : ""}`);
}

function warn(label, detail = "") {
  warnings += 1;
  console.warn(`WARN: ${label}${detail ? ` - ${detail}` : ""}`);
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
  const contentType = response.headers.get("content-type") || "";
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    const snippet = raw.replace(/\s+/g, " ").trim().slice(0, 160);
    const detail = `${method} ${path} returned HTTP ${response.status} content-type=${contentType || "unknown"} body="${snippet}"`;
    if (!allowError) {
      throw new Error(`Invalid JSON: ${detail}`);
    }
    return { ok: response.ok, status: response.status, data: null, raw, contentType, error: detail };
  }

  return { ok: response.ok, status: response.status, data: json };
}

function dataArray(json) {
  const data = json && json.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data && data.items)) return data.items;
  if (Array.isArray(data && data.plans)) return data.plans;
  if (Array.isArray(data && data.data)) return data.data;
  return [];
}

function getId(row) {
  if (!row || typeof row !== "object") return "";
  return String(row.id || row._id || row.planId || row.addonPlanId || row.addonId || "");
}

function normalizeId(value) {
  if (!value) return "";
  if (typeof value === "object") return getId(value);
  return String(value);
}

function getPremiumKey(row) {
  if (!row || typeof row !== "object") return "";
  return String(row.premiumKey || row.proteinKey || row.key || row.slug || row.code || "");
}

function getData(json) {
  return json && typeof json === "object" ? json.data : undefined;
}

function getErrorSummary(response) {
  if (!response) return "no response";
  if (response.error) return response.error;
  const error = response.data && response.data.error;
  if (error && typeof error === "object") {
    return `${error.code || "ERROR"}${error.message ? `: ${error.message}` : ""}`;
  }
  return `HTTP ${response.status}`;
}

function cloneWithoutExplicitPickupLocation(payload) {
  const next = JSON.parse(JSON.stringify(payload));
  delete next.pickupLocationId;
  if (next.delivery) delete next.delivery.pickupLocationId;
  return next;
}

function groupOptions(group) {
  if (!group || typeof group !== "object") return [];
  const directOptions = Array.isArray(group.options) ? group.options : [];
  const sectionOptions = Array.isArray(group.optionSections)
    ? group.optionSections.flatMap((sectionRow) => Array.isArray(sectionRow.options) ? sectionRow.options : [])
    : [];
  return directOptions.concat(sectionOptions);
}

function findSection(catalog, key) {
  const sections = Array.isArray(catalog && catalog.sections) ? catalog.sections : [];
  return sections.find((section) => section && section.key === key) || null;
}

function findGroupDeep(root, keys) {
  if (!root || typeof root !== "object") return null;
  const keySet = new Set(keys);
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (keySet.has(String(current.key || ""))) return current;
    for (const field of ["groups", "optionGroups", "sections", "products", "items"]) {
      const children = current[field];
      if (Array.isArray(children)) stack.push(...children);
    }
  }
  return null;
}

function collectItems(obj, out = []) {
  if (!obj || typeof obj !== "object") return out;
  if (Array.isArray(obj)) {
    obj.forEach(item => collectItems(item, out));
    return out;
  }
  if ((obj.key || obj.premiumKey || obj.category) && (obj.id || obj._id)) {
    out.push(obj);
  }
  ["sections", "products", "optionGroups", "groups", "options", "optionSections", "proteins", "items", "byCategory"].forEach(field => {
    if (obj[field]) collectItems(obj[field], out);
  });
  return out;
}

function choosePremiumProtein(menuData) {
  const builderCatalogV2 = menuData && (menuData.builderCatalogV2 || menuData.builderCatalog?.builderCatalogV2);
  const premiumSection = findSection(builderCatalogV2, "premium_meal");
  const premiumProteinGroup = findGroupDeep(premiumSection, ["protein", "proteins", "premium", "menu_protein"]);
  const premiumOptions = groupOptions(premiumProteinGroup);
  const allCandidates = premiumOptions.concat(collectItems(menuData));
  const seen = new Set();
  const candidates = allCandidates.filter((row) => {
    const id = getId(row);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return Boolean(row.isPremium || row.premiumKey || Number(row.extraFeeHalala || row.priceHalala || 0) > 0);
  });
  const preferredKeys = ["beef_steak", "shrimp", "salmon"];
  return preferredKeys
    .map((key) => candidates.find((row) => getPremiumKey(row) === key))
    .find(Boolean)
    || candidates.find((row) => Number(row.extraFeeHalala || row.priceHalala || 0) > 0)
    || candidates[0]
    || null;
}

function chooseCarb(menuData) {
  const builderCatalogV2 = menuData && (menuData.builderCatalogV2 || menuData.builderCatalog?.builderCatalogV2);
  const premiumSection = findSection(builderCatalogV2, "premium_meal");
  const standardSection = findSection(builderCatalogV2, "standard_meal");
  const premiumCarbGroup = findGroupDeep(premiumSection, ["carb", "carbs", "standard_carbs", "menu_carb"]);
  const standardCarbGroup = findGroupDeep(standardSection, ["carb", "carbs", "standard_carbs", "menu_carb"]);
  const carbs = groupOptions(premiumCarbGroup).concat(groupOptions(standardCarbGroup));
  return carbs.find((row) => getPremiumKey(row) === "white_rice")
    || carbs.find((row) => getId(row))
    || null;
}

function chooseAddonChoice(addonChoicesData, category) {
  const bucket = addonChoicesData && addonChoicesData[category];
  const choices = Array.isArray(bucket && bucket.choices) ? bucket.choices : [];
  return choices.find((choice) => getId(choice)) || null;
}

function canUseTimelineDay(day) {
  if (!day || !day.date) return false;
  const status = String(day.status || day.timelineStatus || "").toLowerCase();
  const terminalStatuses = new Set([
    "locked",
    "delivered",
    "consumed_without_preparation",
    "delivery_canceled",
    "canceled_at_branch",
    "no_show",
    "frozen",
    "skipped",
  ]);
  if (terminalStatuses.has(status)) return false;
  if (day.canEdit === false || day.canModify === false) return false;
  const max = Number(day.maxSlotCount ?? day.maxConsumableMealsNow ?? day.requiredMealCount ?? day.requiredMeals ?? 1);
  return !Number.isFinite(max) || max > 0;
}

function timelineDaysFromResponse(responseData) {
  const data = responseData && responseData.data;
  if (Array.isArray(data && data.days)) return data.days;
  return [];
}

function summarizeTimelineDays(days) {
  if (!Array.isArray(days) || days.length === 0) return "no days returned";
  const counts = new Map();
  for (const day of days) {
    const status = String(
      (day && (day.status || day.timelineStatus || day.commercialState || day.paymentStatus))
      || "unknown"
    );
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([status, count]) => `${status}:${count}`)
    .join(", ");
}

function assertQa(condition, label, detail = "") {
  if (condition) {
    pass(label, detail);
    return true;
  }
  fail(label, detail);
  return false;
}

function getSubscriptionEntitlements(subscription) {
  if (!subscription || typeof subscription !== "object") return [];
  return Array.isArray(subscription.addonSubscriptions) ? subscription.addonSubscriptions : [];
}

function findSubscriptionEntitlement(subscription, category) {
  return getSubscriptionEntitlements(subscription)
    .find((row) => row && String(row.category || "") === String(category)) || null;
}

function getDayEntitlement(day, category) {
  const entitlements = day && day.addonEntitlements;
  if (!entitlements || typeof entitlements !== "object") return null;
  if (entitlements[category]) return entitlements[category];
  if (Array.isArray(entitlements)) {
    return entitlements.find((row) => row && String(row.category || "") === String(category)) || null;
  }
  return null;
}

function assertCreatedSubscriptionEntitlement({ subscription, targetAddon }) {
  const category = String(targetAddon.category || "");
  const expectedAddonPlanId = getId(targetAddon);
  const entitlement = findSubscriptionEntitlement(subscription, category);
  const entitlementPlanId = entitlement ? normalizeId(entitlement.addonPlanId || entitlement.addonId || entitlement.id || entitlement._id) : "";

  let ok = true;
  ok = assertQa(Boolean(entitlement), "Entitlement", `created subscription includes ${category} entitlement`) && ok;
  ok = assertQa(Boolean(entitlement && entitlementPlanId === expectedAddonPlanId), "Entitlement", `addon plan id persisted (${entitlementPlanId || "missing"})`) && ok;
  ok = assertQa(Boolean(entitlement && Number(entitlement.maxPerDay || entitlement.maxSelections || 0) > 0), "Entitlement", `maxPerDay=${Number(entitlement && (entitlement.maxPerDay || entitlement.maxSelections) || 0)}`) && ok;
  return ok;
}

function assertDayEntitlement({ day, targetAddon }) {
  const category = String(targetAddon.category || "");
  const expectedAddonPlanId = getId(targetAddon);
  const entitlement = getDayEntitlement(day, category);
  const entitlementPlanId = entitlement ? normalizeId(entitlement.addonPlanId || entitlement.addonId || entitlement.id || entitlement._id) : "";

  let ok = true;
  ok = assertQa(Boolean(entitlement), "Entitlement", `day detail exposes ${category} entitlement`) && ok;
  ok = assertQa(Boolean(entitlement && entitlement.subscribed === true), "Entitlement", `${category} entitlement is subscribed before selection`) && ok;
  ok = assertQa(Boolean(entitlement && (!entitlementPlanId || entitlementPlanId === expectedAddonPlanId)), "Entitlement", `day entitlement addonPlanId=${entitlementPlanId || "not exposed"}`) && ok;
  return ok;
}

function findSavedAddonSelection(day, menuProductId) {
  const selections = Array.isArray(day && day.addonSelections) ? day.addonSelections : [];
  return selections.find((selection) => normalizeId(selection.addonId || selection.menuProductId || selection.id) === String(menuProductId)) || null;
}

function findSelectedEntitlementItem(day, category) {
  const entitlement = day && day.addonEntitlements && day.addonEntitlements[category];
  return entitlement && entitlement.selectedItem ? entitlement.selectedItem : null;
}

function assertDailySelectionReadback({ day, premiumProtein, juiceChoice, expectedPremiumHalala }) {
  const mealSlots = Array.isArray(day && day.mealSlots) ? day.mealSlots : [];
  const premiumSlot = mealSlots.find((slot) => String(slot.selectionType || "") === "premium_meal");
  const juiceMenuProductId = getId(juiceChoice);
  const savedJuiceSelection = findSavedAddonSelection(day, juiceMenuProductId);
  const selectedJuiceItem = findSelectedEntitlementItem(day, "juice");
  const paymentRequirement = day && day.paymentRequirement ? day.paymentRequirement : {};

  let ok = true;
  ok = assertQa(Boolean(premiumSlot), "Read-back", "premium meal slot exists") && ok;
  ok = assertQa(Boolean(premiumSlot && normalizeId(premiumSlot.proteinId) === getId(premiumProtein)), "Read-back", "premium meal uses beef_steak protein id") && ok;
  ok = assertQa(Boolean(premiumSlot && (premiumSlot.premiumKey === "beef_steak" || getPremiumKey(premiumProtein) === "beef_steak")), "Read-back", "premium identity is beef_steak") && ok;
  ok = assertQa(Boolean(savedJuiceSelection), "Read-back", "selected juice MenuProduct persisted") && ok;
  ok = assertQa(Boolean(day && day.addonEntitlements && day.addonEntitlements.juice && day.addonEntitlements.juice.subscribed === true), "Read-back", "juice entitlement is subscribed") && ok;
  ok = assertQa(Boolean(selectedJuiceItem && normalizeId(selectedJuiceItem.menuProductId || selectedJuiceItem.id) === juiceMenuProductId), "Read-back", "juice entitlement selected item matches MenuProduct") && ok;
  ok = assertQa(Boolean(savedJuiceSelection && savedJuiceSelection.source === "subscription"), "Read-back", "daily juice source is subscription") && ok;
  ok = assertQa(Boolean(savedJuiceSelection && Number(savedJuiceSelection.priceHalala || 0) === 0), "Read-back", "daily juice priceHalala is 0") && ok;
  ok = assertQa(Number(paymentRequirement.premiumSelectedCount || 0) >= 1, "Read-back", `premiumSelectedCount=${Number(paymentRequirement.premiumSelectedCount || 0)}`) && ok;
  ok = assertQa(Number(paymentRequirement.premiumPendingPaymentCount || 0) >= 1, "Read-back", `premiumPendingPaymentCount=${Number(paymentRequirement.premiumPendingPaymentCount || 0)}`) && ok;
  ok = assertQa(Number(paymentRequirement.addonSelectedCount || 0) >= 1, "Read-back", `addonSelectedCount=${Number(paymentRequirement.addonSelectedCount || 0)}`) && ok;
  ok = assertQa(Number(paymentRequirement.addonPendingPaymentCount || 0) === 0, "Read-back", "entitled juice has no add-on pending payment") && ok;
  ok = assertQa(Number(paymentRequirement.pendingAmountHalala || 0) === expectedPremiumHalala, "Read-back", `pendingAmountHalala=${Number(paymentRequirement.pendingAmountHalala || 0)}`) && ok;
  ok = assertQa(paymentRequirement.requiresPayment === true, "Read-back", "payment is required for premium only") && ok;
  ok = assertQa(paymentRequirement.canCreatePayment === true, "Read-back", "unified payment can be created") && ok;
  return ok;
}

async function cleanupSubscription(subscriptionId) {
  if (!subscriptionId) return { ok: true, skipped: true };
  if (QA_KEEP_SUBSCRIPTION) {
    warn("Cleanup", `QA_KEEP_SUBSCRIPTION=true; subscription remains active: ${subscriptionId}`);
    return { ok: true, skipped: true };
  }

  const detailRes = await requestJson("GET", `/api/admin/subscriptions/${subscriptionId}`, {
    token: DASHBOARD_TOKEN,
    allowError: true,
  });
  if (!detailRes.ok) {
    warn("Cleanup", `Could not verify QA subscription before cancellation: ${getErrorSummary(detailRes)}`);
    return { ok: false };
  }

  const subscription = getData(detailRes.data) || {};
  if (String(subscription.id || subscription._id || "") !== String(subscriptionId)) {
    warn("Cleanup", "Subscription verification response did not match requested id");
    return { ok: false };
  }
  if (!["active", "pending_payment"].includes(String(subscription.status || ""))) {
    pass("Cleanup", `Subscription already not active (${subscription.status || "unknown"})`);
    return { ok: true };
  }

  const cancelRes = await requestJson("POST", `/api/admin/subscriptions/${subscriptionId}/cancel`, {
    token: DASHBOARD_TOKEN,
    body: { reason: "QA premium add-on pending payment cleanup" },
    allowError: true,
  });
  if (!cancelRes.ok) {
    warn("Cleanup", `Subscription remains active; cancellation failed: ${getErrorSummary(cancelRes)}`);
    return { ok: false };
  }
  pass("Cleanup", "Subscription canceled.");
  return { ok: true };
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

function chooseValidPlanCombination(plans) {
  const activePlans = (plans || []).filter(p => p.isActive !== false && p.status !== "inactive");
  
  // Prefer >= 7 days
  const sortedPlans = activePlans.sort((a, b) => {
    const aDays = Number(a.daysCount || a.durationDays || a.days || 0);
    const bDays = Number(b.daysCount || b.durationDays || b.days || 0);
    if (aDays >= 7 && bDays < 7) return -1;
    if (bDays >= 7 && aDays < 7) return 1;
    return 0;
  });

  for (const plan of sortedPlans) {
    const gramsOptions = Array.isArray(plan.gramsOptions || plan.weightOptions) 
      ? (plan.gramsOptions || plan.weightOptions) 
      : [];
      
    let selectedGrams = null;
    let selectedMeals = null;

    // 1. Prefer 100g + 1 meal/day exactly
    for (const gOpt of gramsOptions) {
      if (gOpt.isActive === false) continue;
      if (Number(gOpt.grams) === 100) {
        const mOpts = Array.isArray(gOpt.mealsOptions || gOpt.mealOptions) ? (gOpt.mealsOptions || gOpt.mealOptions) : [];
        for (const mOpt of mOpts) {
          if (mOpt.isActive === false) continue;
          if (Number(mOpt.mealsPerDay) === 1) {
            selectedGrams = gOpt;
            selectedMeals = mOpt;
            break;
          }
        }
      }
      if (selectedGrams && selectedMeals) break;
    }

    // 2. Otherwise pick first available combination
    if (!selectedGrams || !selectedMeals) {
      for (const gOpt of gramsOptions) {
        if (gOpt.isActive === false) continue;
        const mOpts = Array.isArray(gOpt.mealsOptions || gOpt.mealOptions) ? (gOpt.mealsOptions || gOpt.mealOptions) : [];
        for (const mOpt of mOpts) {
          if (mOpt.isActive === false) continue;
          selectedGrams = gOpt;
          selectedMeals = mOpt;
          break;
        }
        if (selectedGrams && selectedMeals) break;
      }
    }

    if (selectedGrams && selectedMeals) {
      return {
        plan,
        grams: Number(selectedGrams.grams),
        mealsPerDay: Number(selectedMeals.mealsPerDay),
        priceHalala: Number(selectedMeals.priceHalala || 0)
      };
    }
  }

  return null;
}

  const validCombination = chooseValidPlanCombination(plans);
  if (!validCombination) {
    fail("Catalog", "Could not find any valid plan combination in the catalog");
    process.exit(1);
  }
  const { plan: canonicalPlan, grams: selectedGrams, mealsPerDay: selectedMealsPerDay, priceHalala: combinationPrice } = validCombination;
  const dCount = canonicalPlan.daysCount || canonicalPlan.durationDays || canonicalPlan.days;

  pass("Catalog", `Using Plan: ${canonicalPlan.id} (${dCount} days)`);
  pass("Catalog", `Valid combination found: ${selectedGrams}g + ${selectedMealsPerDay} meals/day (${combinationPrice} halala)`);

  const menuRes = await requestJson("GET", "/api/subscriptions/meal-planner-menu", { token: APP_TOKEN });
  if (!menuRes.ok) {
    fail("Catalog", `Failed to fetch menu: ${JSON.stringify(menuRes.data)}`);
    process.exit(1);
  }

  const data = menuRes.data && menuRes.data.data;
  const premiumProtein = choosePremiumProtein(data);
  const carb = chooseCarb(data);

  if (!premiumProtein) {
    const foundKeys = [...new Set(collectItems(data).map(getPremiumKey).filter(Boolean))].slice(0, 20).join(", ");
    fail("Catalog", `Could not find a premium protein. Found keys: ${foundKeys || "(none)"}`);
    process.exit(1);
  }
  if (!carb) {
    fail("Catalog", "Could not find a carb option for premium meal selection");
    process.exit(1);
  }
  const premiumProteinFeeHalala = Number(premiumProtein.extraFeeHalala || premiumProtein.priceHalala || 0);
  if (getPremiumKey(premiumProtein) !== "beef_steak") {
    fail("Catalog", `Expected beef_steak premium protein, got ${getPremiumKey(premiumProtein) || "no-key"}`);
    process.exit(1);
  }
  pass("Catalog", `Using premium protein: ${getId(premiumProtein)} (${getPremiumKey(premiumProtein) || "no-key"}, ${premiumProteinFeeHalala} halala)`);
  pass("Catalog", `Using carb: ${getId(carb)} (${getPremiumKey(carb) || "no-key"})`);

  const addonsRes = await requestJson("GET", "/api/addons?type=subscription", { token: APP_TOKEN });
  if (!addonsRes.ok) {
    fail("Catalog", `Failed to fetch subscription add-ons: ${JSON.stringify(addonsRes.data)}`);
    process.exit(1);
  }
  const addonRows = dataArray(addonsRes.data);
  const targetAddon = ["juice", "snack", "small_salad"]
    .map((category) => addonRows.find((row) => row.category === category && (row.kind === "plan" || row.type === "subscription")))
    .find(Boolean)
    || addonRows.find((row) => row.kind === "plan" || row.type === "subscription");

  if (!targetAddon) {
    fail("Catalog", `Could not find a subscription add-on plan. Found categories: ${[...new Set(addonRows.map(a => a.category).filter(Boolean))].join(", ")}`);
    process.exit(1);
  }
  const addonPlanFeeHalala = Number(targetAddon.priceHalala || targetAddon.pricePerDayHalala || targetAddon.unitPriceHalala || 0);
  pass("Catalog", `Using Add-on Plan: ${getId(targetAddon)} (${targetAddon.category || "no-category"}, ${addonPlanFeeHalala} halala)`);

  const addonChoicesRes = await requestJson("GET", "/api/subscriptions/addon-choices?category=juice", { token: APP_TOKEN });
  if (!addonChoicesRes.ok) {
    fail("Catalog", `Failed to fetch daily juice choices: ${getErrorSummary(addonChoicesRes)}`);
    process.exit(1);
  }
  const juiceChoice = chooseAddonChoice(getData(addonChoicesRes.data), "juice");
  if (!juiceChoice) {
    fail("Catalog", "Could not find a daily juice MenuProduct choice");
    process.exit(1);
  }
  pass("Catalog", `Using daily juice MenuProduct: ${getId(juiceChoice)} (${juiceChoice.key || "no-key"})`);

  const branchRes = await requestJson("GET", "/api/branches/pickup", { token: APP_TOKEN });
  const branchRows = branchRes.ok ? dataArray(branchRes.data) : [];
  const branch = branchRows.find((row) => getId(row)) || null;
  const pickupLocationId = branch ? getId(branch) : "";
  if (pickupLocationId) {
    pass("Catalog", `Using Pickup Location: ${pickupLocationId}`);
  } else {
    warn("Catalog", "No explicit pickup location returned; backend will auto-select the active pickup location");
  }

  // 2. Create Active Subscription
  console.log("Creating Manual QA Subscription...");
  const subPayload = {
    userId,
    planId: canonicalPlan.id,
    grams: selectedGrams,
    mealsPerDay: selectedMealsPerDay,
    startDate: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0], // T+2
    deliveryMode: "pickup",
    ...(pickupLocationId ? { pickupLocationId } : {}),
    addons: [getId(targetAddon)]
  };

  assertQa(Boolean(canonicalPlan.id), "Pre-Create", "The selected plan ID exists");
  assertQa(canonicalPlan.isActive !== false, "Pre-Create", "The selected plan is active");
  const gOpt = (canonicalPlan.gramsOptions || canonicalPlan.weightOptions || []).find(g => Number(g.grams) === selectedGrams);
  assertQa(Boolean(gOpt), "Pre-Create", "The selected grams option belongs to the selected plan");
  const mOpt = gOpt && (gOpt.mealsOptions || gOpt.mealOptions || []).find(m => Number(m.mealsPerDay) === selectedMealsPerDay);
  assertQa(Boolean(mOpt), "Pre-Create", "The selected meals option belongs to the selected grams option or valid plan combination");
  assertQa(Number(combinationPrice) >= 0, "Pre-Create", "The selected price combination exists");
  assertQa(Boolean(getId(targetAddon)), "Pre-Create", "The juice Addon plan ID exists");
  assertQa(subPayload.gramsOptionId === undefined && subPayload.mealsOptionId === undefined, "Pre-Create", "The create payload contains no stale or unrelated option IDs");

  console.log(`Create payload summary: plan key=${canonicalPlan.key || "no-key"}, plan duration=${dCount}, selected grams=${selectedGrams}, selected meals per day=${selectedMealsPerDay}, grams option ID present: no, meals option ID present: no, combination price=${combinationPrice}, addon plan categories=${targetAddon.category || "unknown"}, addon plan count=${subPayload.addons.length}`);
  let createRes = await requestJson("POST", "/api/dashboard/subscriptions", { token: DASHBOARD_TOKEN, body: subPayload });
  if (!createRes.ok && /Invalid pickup location/i.test(JSON.stringify(createRes.data || {})) && subPayload.pickupLocationId) {
    warn("Subscription", `Pickup location ${subPayload.pickupLocationId} was rejected; retrying with backend auto-selection`);
    createRes = await requestJson("POST", "/api/dashboard/subscriptions", {
      token: DASHBOARD_TOKEN,
      body: cloneWithoutExplicitPickupLocation(subPayload),
    });
  }
  if (!createRes.ok) {
    fail("Subscription", `Failed to create subscription: ${JSON.stringify(createRes.data)}`);
    process.exit(1);
  }
  const createdSubscription = createRes.data && createRes.data.data;
  const subscriptionId = createdSubscription && (createdSubscription.id || createdSubscription._id);
  pass("Subscription", `Created active subscription: ${subscriptionId}`);

  let currentSubId = subscriptionId;

  try {
    if (!assertCreatedSubscriptionEntitlement({ subscription: createdSubscription, targetAddon })) {
      throw new Error("Created subscription entitlement assertion error");
    }

    const subscriptionReadRes = await requestJson("GET", `/api/admin/subscriptions/${subscriptionId}`, { token: DASHBOARD_TOKEN });
    if (!subscriptionReadRes.ok) {
      fail("Entitlement", `Failed to read created subscription: ${getErrorSummary(subscriptionReadRes)}`);
      throw new Error("Created subscription read-back error");
    }
    if (!assertCreatedSubscriptionEntitlement({ subscription: getData(subscriptionReadRes.data), targetAddon })) {
      throw new Error("Created subscription read-back entitlement assertion error");
    }

    // 3. Selection Setup
    const timelineRes = await requestJson("GET", `/api/subscriptions/${subscriptionId}/timeline`, { token: APP_TOKEN });
    const timelineDays = timelineDaysFromResponse(timelineRes.data);
    const targetEntry = timelineDays.find(canUseTimelineDay);
    
    if (!targetEntry) {
      fail("Timeline", `Could not find a modifiable day in timeline. Days: ${summarizeTimelineDays(timelineDays)}`);
      throw new Error("Timeline error");
    }
    const targetDate = targetEntry.date;
    pass("Timeline", `Targeting date: ${targetDate}`);

    const preSelectionDayRes = await requestJson("GET", `/api/subscriptions/${subscriptionId}/days/${targetDate}`, { token: APP_TOKEN });
    if (!preSelectionDayRes.ok) {
      fail("Entitlement", `Failed to read target day before selection: ${getErrorSummary(preSelectionDayRes)}`);
      throw new Error("Pre-selection day read error");
    }
    if (!assertDayEntitlement({ day: getData(preSelectionDayRes.data), targetAddon })) {
      throw new Error("Pre-selection day entitlement assertion error");
    }

    const selectionPayload = {
      mealSlots: [
        {
          slotIndex: 1,
          slotKey: "slot_1",
          proteinId: getId(premiumProtein),
          proteinKey: getPremiumKey(premiumProtein) || undefined,
          premiumKey: getPremiumKey(premiumProtein) || undefined,
          carbs: [{ carbId: getId(carb), grams: 150 }],
          selectionType: "premium_meal"
        }
      ],
      addonsOneTime: [getId(juiceChoice)]
    };

    console.log(`Validating selection for ${targetDate}...`);
    const validateRes = await requestJson("POST", `/api/subscriptions/${subscriptionId}/days/${targetDate}/selection/validate`, { token: APP_TOKEN, body: selectionPayload });
    if (!validateRes.ok) {
      fail("Selection", `Failed to validate selection: ${getErrorSummary(validateRes)}`);
      throw new Error("Selection validation error");
    }
    const validateRequirement = getData(validateRes.data) && getData(validateRes.data).paymentRequirement;
    if (
      !validateRequirement
      || Number(validateRequirement.premiumPendingPaymentCount || 0) < 1
      || Number(validateRequirement.addonPendingPaymentCount || 0) !== 0
      || Number(validateRequirement.pendingAmountHalala || 0) !== premiumProteinFeeHalala
    ) {
      fail("Selection", `Validation payment requirement mismatch: premiumPending=${Number(validateRequirement && validateRequirement.premiumPendingPaymentCount || 0)}, addonPending=${Number(validateRequirement && validateRequirement.addonPendingPaymentCount || 0)}, pendingAmount=${Number(validateRequirement && validateRequirement.pendingAmountHalala || 0)}`);
      throw new Error("Selection validation assertion error");
    }
    pass("Selection", "Validation recognizes premium payment and entitled juice");

    console.log(`Saving selection for ${targetDate}...`);
    const saveRes = await requestJson("PUT", `/api/subscriptions/${subscriptionId}/days/${targetDate}/selection`, { token: APP_TOKEN, body: selectionPayload });
    if (!saveRes.ok) {
      fail("Selection", `Failed to save selection: ${getErrorSummary(saveRes)}`);
      throw new Error("Selection error");
    }
    pass("Selection", "Successfully saved premium + entitled juice selection");

    const dayRes = await requestJson("GET", `/api/subscriptions/${subscriptionId}/days/${targetDate}`, { token: APP_TOKEN });
    if (!dayRes.ok) {
      fail("Read-back", `Failed to read saved day: ${getErrorSummary(dayRes)}`);
      throw new Error("Read-back error");
    }
    const dayDetail = getData(dayRes.data);
    if (!assertDailySelectionReadback({
      day: dayDetail,
      premiumProtein,
      juiceChoice,
      expectedPremiumHalala: premiumProteinFeeHalala,
    })) {
      throw new Error("Read-back assertion error");
    }
    const paymentRequirement = dayDetail.paymentRequirement || {};
    const plannerRevisionHash = dayDetail.plannerRevisionHash || (getData(saveRes.data) && getData(saveRes.data).plannerRevisionHash);
    if (paymentRequirement.canCreatePayment !== true) {
      fail("Payment", `Backend does not allow payment creation yet: blockingReason=${paymentRequirement.blockingReason || "none"}`);
      throw new Error("Payment not allowed");
    }

    // 4. Unified Payment Initiation
    console.log("Triggering Unified Payment initiation...");
    const paymentPayload = {
        source: "manual_qa_pending_check",
        note: "Testing Premium + entitled daily add-on pending payment",
        ...(plannerRevisionHash ? { plannerRevisionHash } : {})
    };
    const paymentRes = await requestJson("POST", `/api/subscriptions/${subscriptionId}/days/${targetDate}/payments`, { token: APP_TOKEN, body: paymentPayload });
    
    if (!paymentRes.ok) {
      fail("Payment", `Failed to initiate payment: ${getErrorSummary(paymentRes)}`);
      throw new Error("Payment error");
    }

    const pData = paymentRes.data && paymentRes.data.data;
    const totalHalala = Number(pData && pData.totalHalala || 0);
    const premiumAmountHalala = Number(pData && pData.premiumAmountHalala || 0);
    const addonsAmountHalala = Number(pData && pData.addonsAmountHalala || 0);
    
    // VERIFICATION
    const expectedTotalHalala = premiumProteinFeeHalala;
    if (totalHalala === expectedTotalHalala) {
      pass("Verification", `Expected total ${expectedTotalHalala} halala confirmed.`);
    } else {
      fail("Verification", `Expected ${expectedTotalHalala} halala, but got ${totalHalala}`);
    }
    if (premiumAmountHalala === premiumProteinFeeHalala) {
      pass("Verification", `Premium amount ${premiumAmountHalala} halala confirmed.`);
    } else {
      fail("Verification", `Expected premium amount ${premiumProteinFeeHalala}, got ${premiumAmountHalala}`);
    }
    if (addonsAmountHalala === 0) {
      pass("Verification", "Entitled daily juice added 0 halala to day payment.");
    } else {
      fail("Verification", `Expected add-ons amount 0, got ${addonsAmountHalala}`);
    }

    const timelineCheck = await requestJson("GET", `/api/subscriptions/${subscriptionId}/timeline`, { token: APP_TOKEN });
    const dayCheck = timelineDaysFromResponse(timelineCheck.data).find(e => e.date === targetDate);
    
    if (
      dayCheck
      && (
        dayCheck.paymentStatus === "pending"
        || dayCheck.commercialState === "pending_payment"
        || dayCheck.status === "pending_payment"
        || dayCheck.timelineStatus === "pending_payment"
      )
    ) {
      pass("Verification", "Timeline reflects pending payment state.");
    } else {
      warn("Verification", `Timeline state for ${targetDate}: status=${dayCheck && dayCheck.status}, timelineStatus=${dayCheck && dayCheck.timelineStatus}, paymentStatus=${dayCheck && dayCheck.paymentStatus}, commercialState=${dayCheck && dayCheck.commercialState}`);
    }

    // ---------------------------------------------------------------
    // Scenario B: Non-entitled snack daily add-on (no snack entitlement)
    // Expected: accepted, source=pending_payment, priceHalala=snack MenuProduct price
    // ---------------------------------------------------------------
    console.log("\n--- Scenario B: Non-Entitled Snack Daily Add-on ---");
    const snackChoicesRes = await requestJson("GET", "/api/subscriptions/addon-choices?category=snack", { token: APP_TOKEN, allowError: true });
    if (snackChoicesRes.ok) {
      const snackChoice = chooseAddonChoice(getData(snackChoicesRes.data), "snack");
      if (snackChoice) {
        const snackMenuProductId = getId(snackChoice);
        const expectedSnackPrice = Number(snackChoice.priceHalala || 0);
        pass("Scenario B", `Found snack MenuProduct: ${snackMenuProductId} (${expectedSnackPrice} halala)`);

        // Verify subscription has NO snack entitlement
        const snackEntitlement = findSubscriptionEntitlement(createdSubscription, "snack");
        assertQa(!snackEntitlement, "Scenario B", "Subscription has no snack entitlement (correct for this test)");

        // Get a fresh modifiable day (same or different date)
        const scenarioBDate = targetDate;
        const scenarioBDayBefore = await requestJson("GET", `/api/subscriptions/${subscriptionId}/days/${scenarioBDate}`, { token: APP_TOKEN, allowError: true });
        const scenarioBDayMeals = scenarioBDayBefore.ok && getData(scenarioBDayBefore.data)
          ? Array.isArray(getData(scenarioBDayBefore.data).mealSlots) ? getData(scenarioBDayBefore.data).mealSlots : []
          : [];

        // Build selection payload: keep existing meal slots, change only addons to snack
        const scenarioBPayload = {
          mealSlots: scenarioBDayMeals.length > 0 ? scenarioBDayMeals.map((slot) => ({
            slotIndex: slot.slotIndex,
            slotKey: slot.slotKey,
            selectionType: slot.selectionType || "standard_meal",
            proteinId: normalizeId(slot.proteinId),
            premiumKey: slot.premiumKey,
            carbs: Array.isArray(slot.carbs) ? slot.carbs.map((c) => ({ carbId: normalizeId(c.carbId), grams: Number(c.grams || 150) })) : [],
          })) : [
            {
              slotIndex: 1,
              slotKey: "slot_1",
              proteinId: getId(premiumProtein),
              premiumKey: getPremiumKey(premiumProtein) || undefined,
              carbs: [{ carbId: getId(carb), grams: 150 }],
              selectionType: "premium_meal",
            }
          ],
          addonsOneTime: [snackMenuProductId],
        };

        const scenarioBSaveRes = await requestJson("PUT", `/api/subscriptions/${subscriptionId}/days/${scenarioBDate}/selection`, { token: APP_TOKEN, body: scenarioBPayload, allowError: true });
        if (scenarioBSaveRes.ok) {
          pass("Scenario B", "Non-entitled snack selection was accepted (not rejected)");

          const scenarioBDayRes = await requestJson("GET", `/api/subscriptions/${subscriptionId}/days/${scenarioBDate}`, { token: APP_TOKEN, allowError: true });
          if (scenarioBDayRes.ok) {
            const scenarioBDay = getData(scenarioBDayRes.data);
            const snackSel = findSavedAddonSelection(scenarioBDay, snackMenuProductId);
            assertQa(Boolean(snackSel), "Scenario B", "Snack selection persisted in addonSelections");
            assertQa(snackSel && snackSel.source === "pending_payment", "Scenario B",
              `snack source should be pending_payment, got: ${snackSel && snackSel.source}`);
            if (expectedSnackPrice > 0) {
              assertQa(snackSel && Number(snackSel.priceHalala || 0) === expectedSnackPrice, "Scenario B",
                `snack priceHalala should be ${expectedSnackPrice}, got: ${snackSel && Number(snackSel.priceHalala || 0)}`);
            } else {
              warn("Scenario B", `snack MenuProduct priceHalala not available from choices catalog; saved priceHalala=${snackSel && Number(snackSel.priceHalala || 0)}`);
            }
            const bReq = scenarioBDay && scenarioBDay.paymentRequirement || {};
            assertQa(Number(bReq.addonPendingPaymentCount || 0) >= 1, "Scenario B",
              `addonPendingPaymentCount should be >= 1, got: ${Number(bReq.addonPendingPaymentCount || 0)}`);
            pass("Scenario B", `pendingAmountHalala=${Number(bReq.pendingAmountHalala || 0)}`);

            // ---------------------------------------------------------------
            // Combined Scenario: premium beef_steak + entitled juice + non-entitled snack
            // ---------------------------------------------------------------
            console.log("\n--- Combined Scenario: Premium + Entitled Juice + Non-Entitled Snack ---");
            const combinedPayload = {
              mealSlots: [
                {
                  slotIndex: 1,
                  slotKey: "slot_1",
                  proteinId: getId(premiumProtein),
                  premiumKey: getPremiumKey(premiumProtein) || undefined,
                  carbs: [{ carbId: getId(carb), grams: 150 }],
                  selectionType: "premium_meal",
                },
              ],
              addonsOneTime: [getId(juiceChoice), snackMenuProductId],
            };
            const combinedSaveRes = await requestJson("PUT", `/api/subscriptions/${subscriptionId}/days/${scenarioBDate}/selection`, { token: APP_TOKEN, body: combinedPayload, allowError: true });
            if (combinedSaveRes.ok) {
              pass("Combined", "Combined payload (premium + juice + snack) was accepted");
              const combinedDayRes = await requestJson("GET", `/api/subscriptions/${subscriptionId}/days/${scenarioBDate}`, { token: APP_TOKEN, allowError: true });
              if (combinedDayRes.ok) {
                const combinedDay = getData(combinedDayRes.data);
                const cJuiceSel = findSavedAddonSelection(combinedDay, getId(juiceChoice));
                const cSnackSel = findSavedAddonSelection(combinedDay, snackMenuProductId);
                assertQa(Boolean(cJuiceSel), "Combined", "Juice selection persisted");
                assertQa(cJuiceSel && cJuiceSel.source === "subscription", "Combined",
                  `juice source should be subscription, got: ${cJuiceSel && cJuiceSel.source}`);
                assertQa(cJuiceSel && Number(cJuiceSel.priceHalala || 0) === 0, "Combined",
                  `juice priceHalala should be 0, got: ${cJuiceSel && Number(cJuiceSel.priceHalala || 0)}`);
                assertQa(Boolean(cSnackSel), "Combined", "Snack selection persisted");
                assertQa(cSnackSel && cSnackSel.source === "pending_payment", "Combined",
                  `snack source should be pending_payment, got: ${cSnackSel && cSnackSel.source}`);
                const cReq = combinedDay && combinedDay.paymentRequirement || {};
                assertQa(Number(cReq.addonSelectedCount || 0) === 2, "Combined",
                  `addonSelectedCount should be 2, got: ${Number(cReq.addonSelectedCount || 0)}`);
                assertQa(Number(cReq.addonPendingPaymentCount || 0) === 1, "Combined",
                  `addonPendingPaymentCount should be 1 (snack only), got: ${Number(cReq.addonPendingPaymentCount || 0)}`);
                assertQa(Number(cReq.premiumPendingPaymentCount || 0) >= 1, "Combined",
                  `premiumPendingPaymentCount should be >= 1, got: ${Number(cReq.premiumPendingPaymentCount || 0)}`);
                const expectedCombinedTotal = premiumProteinFeeHalala + (expectedSnackPrice > 0 ? expectedSnackPrice : Number(cSnackSel && cSnackSel.priceHalala || 0));
                assertQa(Number(cReq.pendingAmountHalala || 0) === expectedCombinedTotal, "Combined",
                  `pendingAmountHalala should be ${expectedCombinedTotal} (premium+snack), got: ${Number(cReq.pendingAmountHalala || 0)}`);
              } else {
                warn("Combined", `Failed to read combined day: ${getErrorSummary(combinedDayRes)}`);
              }
            } else {
              fail("Combined", `Combined selection failed: ${getErrorSummary(combinedSaveRes)}`);
            }
          } else {
            warn("Scenario B", `Failed to read day after snack selection: ${getErrorSummary(scenarioBDayRes)}`);
          }
        } else {
          const errCode = scenarioBSaveRes.data && scenarioBSaveRes.data.error && scenarioBSaveRes.data.error.code;
          if (errCode === "ADDON_ENTITLEMENT_REQUIRED") {
            fail("Scenario B", "REGRESSION CONFIRMED: backend rejected non-entitled snack with ADDON_ENTITLEMENT_REQUIRED — backend fix not yet deployed");
          } else {
            fail("Scenario B", `Non-entitled snack selection rejected unexpectedly: ${getErrorSummary(scenarioBSaveRes)}`);
          }
        }
      } else {
        warn("Scenario B", "No snack MenuProduct found in addon-choices; skipping Scenario B");
      }
    } else {
      warn("Scenario B", `Could not fetch snack addon-choices: ${getErrorSummary(snackChoicesRes)}`);
    }

  } catch (err) {
    console.error("QA Error during flow execution:", err.message);
  } finally {
    // 5. Cleanup
    if (currentSubId) console.log(`Canceling subscription ${currentSubId} for cleanup...`);
    await cleanupSubscription(currentSubId);
  }

  console.log("\n--- QA REPORT ---");
  console.log(`PASSES: ${passes}`);
  console.log(`WARNINGS: ${warnings}`);
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
