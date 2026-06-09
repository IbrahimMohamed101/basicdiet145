#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BASE_URL = String(process.env.BASE_URL || "https://basicdiet145.onrender.com").replace(/\/+$/, "");
const CLIENT_TOKEN = String(process.env.QA_CLIENT_TOKEN || "").trim();
const DASHBOARD_TOKEN = String(process.env.QA_DASHBOARD_TOKEN || "").trim();
const ALLOW_WRITE = process.env.QA_ALLOW_WRITE === "true";
const ALLOW_ORDER_CREATE = ALLOW_WRITE && process.env.QA_ALLOW_ORDER_CREATE === "true";
const ALLOW_DASHBOARD_WRITE = ALLOW_WRITE && process.env.QA_ALLOW_DASHBOARD_WRITE === "true";
const SUBSCRIPTION_ID = String(process.env.QA_SUBSCRIPTION_ID || "").trim();
const SUBSCRIPTION_DATE = String(process.env.QA_SUBSCRIPTION_DATE || "").trim();
const TEST_PRODUCT_ID = String(process.env.QA_TEST_PRODUCT_ID || "").trim();
const TEST_SIMPLE_PRODUCT_ID = String(process.env.QA_TEST_SIMPLE_PRODUCT_ID || "").trim();
const TEST_CONFIGURABLE_PRODUCT_ID = String(process.env.QA_TEST_CONFIGURABLE_PRODUCT_ID || "").trim();
const ADDON_IDS = String(process.env.QA_ADDON_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
const RUN_ID = `QA_E2E_${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
const REPORT_PATH = path.resolve(__dirname, "../docs/release-backend-full-e2e-qa-report.md");
const RESULTS = [];
const FINDINGS = [];
const WRITES = {
  orders: [],
  categories: [],
  products: [],
  optionGroups: [],
  options: [],
  relations: [],
  settingsTouched: [],
};

const CATEGORY_VARIANTS = new Set(["meal_builder", "light_collection", "sandwich_collection", "addon_collection"]);
const PRODUCT_VARIANTS = new Set(["standard", "premium", "large_salad", "addon"]);
const DISPLAY_STYLES = new Set(["chips", "radio_cards", "checkbox_grid", "dropdown", "stepper"]);
const PREMIUM_KEYS = new Set(["beef_steak", "shrimp", "salmon"]);
const CANONICAL_PLAN_KEYS = new Set(["subscription_7_days", "subscription_26_days", "subscription_30_days"]);
const LEGACY_PLAN_KEYS = [
  "subscription_1_meal_7_days_100g",
  "subscription_2_meal_26_days_150g",
  "subscription_3_meal_30_days_200g",
];
const CANONICAL_PICKUP_ADDRESS_AR = "H4GX+JF7، السلامة، جدة 23436، المملكة العربية السعودية";

function compact(value, max = 180) {
  const text = String(value === undefined || value === null ? "" : value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function escapeCell(value) {
  return compact(value, 240).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function tokenHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function errorInfo(body) {
  const error = body && typeof body === "object" ? body.error : null;
  return {
    code: error && error.code ? String(error.code) : "",
    message: error && error.message ? String(error.message) : "",
    details: error && error.details !== undefined ? error.details : undefined,
    messageAr: error && error.messageAr ? error.messageAr : error && error.details && error.details.messageAr,
    messageEn: error && error.messageEn ? error.messageEn : error && error.details && error.details.messageEn,
  };
}

function addResult(area, endpoint, scenario, result, statusCode = "", errorCode = "", notes = "") {
  RESULTS.push({ area, endpoint, scenario, result, statusCode, errorCode, notes: compact(notes, 300) });
  console.log(`${result.padEnd(4)} ${area}: ${scenario}${statusCode !== "" ? ` [${statusCode}]` : ""}${errorCode ? ` ${errorCode}` : ""}`);
}

function addFinding(kind, severity, area, message) {
  FINDINGS.push({ kind, severity, area, message: compact(message, 500) });
}

function validateErrorUx(area, endpoint, response, { userFacing = true } = {}) {
  if (!response || response.ok) return;
  const info = errorInfo(response.body);
  if (!info.code || !info.message) {
    addFinding("UX/API Contract", "high", area, `${endpoint} returned an inconsistent error shape (missing error.code or error.message).`);
  }
  if (userFacing && !info.messageAr) {
    addFinding("UX/API Contract", "warning", area, `${endpoint} error ${info.code || "(no code)"} has no Arabic message field.`);
  }
  if (/stack|CastError|ValidationError|Mongo|mongoose/i.test(info.message)) {
    addFinding("UX/API Contract", "high", area, `${endpoint} exposes a technical error message: ${info.message}`);
  }
}

async function request(method, endpoint, { token = "", body, headers = {} } = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const init = {
    method,
    headers: {
      Accept: "application/json",
      ...tokenHeaders(token),
      ...headers,
    },
  };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { ok: response.ok, status: response.status, body: parsed };
  } catch (error) {
    return { ok: false, status: 0, body: { error: { code: "NETWORK_ERROR", message: error.message } } };
  }
}

function dataOf(response) {
  return response && response.body && response.body.data !== undefined ? response.body.data : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function idOf(value) {
  return String(value && (value.id || value._id) || "");
}

function keyOf(value) {
  return String(value && value.key || "");
}

function localizedAddressAr(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value !== "object" || Array.isArray(value)) return "";
  if (typeof value.ar === "string" && value.ar.trim()) return value.ar.trim();
  return localizedAddressAr(value.line1);
}

function isMainPickupLocation(value) {
  return ["id", "key", "code", "slug", "branchId", "pickupLocationId"]
    .some((field) => String(value && value[field] || "").trim() === "main");
}

function hasLocalizedName(value) {
  if (!value) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return Boolean(String(value.ar || "").trim() && String(value.en || "").trim());
}

function note500(area, endpoint, response) {
  if (response.status === 500) addFinding("Business Logic", "critical", area, `${endpoint} returned HTTP 500.`);
}

function recordResponse(area, endpoint, scenario, response, expected, notes = "") {
  const info = errorInfo(response.body);
  const accepted = expected(response);
  addResult(area, endpoint, scenario, accepted ? "PASS" : "FAIL", response.status, info.code, notes || info.message);
  if (!accepted) note500(area, endpoint, response);
  validateErrorUx(area, endpoint, response);
  return accepted;
}

async function publicAvailability() {
  const rootHealth = await request("GET", "/health");
  addResult("Public availability", "/health", "GET /health exists", rootHealth.status === 404 ? "WARN" : rootHealth.status >= 500 ? "FAIL" : "PASS", rootHealth.status, errorInfo(rootHealth.body).code, rootHealth.status === 404 ? "No root health endpoint; authenticated /api/health/* endpoints exist." : "");
  note500("Public availability", "/health", rootHealth);

  const menus = {};
  for (const lang of ["ar", "en"]) {
    const endpoint = `/api/orders/menu?lang=${lang}`;
    const response = await request("GET", endpoint);
    recordResponse("Public availability", endpoint, `One-time menu responds in ${lang}`, response, (res) => res.ok && dataOf(res) && typeof dataOf(res) === "object");
    menus[lang] = dataOf(response);
  }
  return menus;
}

function inspectOneTimeMenu(menu) {
  const endpoint = "/api/orders/menu?lang=ar";
  const categories = asArray(menu && menu.categories);
  if (!categories.length) {
    addResult("One-time menu contract", endpoint, "Published categories array exists", "FAIL", 200, "", "data.categories is missing or empty.");
    addFinding("UX/API Contract", "high", "One-time menu contract", "Published menu does not expose a non-empty data.categories array.");
    return { categories, products: [] };
  }
  addResult("One-time menu contract", endpoint, "Published categories array exists", "PASS", 200);

  const products = [];
  for (const category of categories) {
    const categoryKey = keyOf(category);
    if (!idOf(category) || !categoryKey || !hasLocalizedName(category.name) || !CATEGORY_VARIANTS.has(category.ui && category.ui.cardVariant)) {
      addFinding("UX/API Contract", "high", "One-time menu contract", `Category ${categoryKey || idOf(category) || "(unknown)"} is missing id/key/localized name or has invalid ui.cardVariant.`);
    }
    for (const product of asArray(category.products)) {
      products.push(product);
      const productKey = keyOf(product);
      if (!idOf(product) || !productKey || !hasLocalizedName(product.name) || !product.pricingModel || !PRODUCT_VARIANTS.has(product.ui && product.ui.cardVariant)) {
        addFinding("UX/API Contract", "high", "One-time menu contract", `Product ${productKey || idOf(product) || "(unknown)"} is missing contract metadata or has invalid ui.cardVariant.`);
      }
      if (product.pricingModel === "fixed" && !Number.isFinite(Number(product.priceHalala))) {
        addFinding("Business Logic", "high", "One-time menu contract", `Fixed-price product ${productKey} has no numeric priceHalala.`);
      }
      for (const group of asArray(product.optionGroups)) {
        if (!idOf(group) || !keyOf(group) || !DISPLAY_STYLES.has(group.ui && group.ui.displayStyle)) {
          addFinding("UX/API Contract", "high", "One-time menu contract", `Option group on ${productKey} is missing id/key or has invalid ui.displayStyle.`);
        }
        if (group.isRequired && (!Number.isFinite(Number(group.minSelections)) || Number(group.minSelections) < 1)) {
          addFinding("Business Logic", "high", "One-time menu contract", `Required group ${keyOf(group)} on ${productKey} has unclear minSelections.`);
        }
        if (Number(group.maxSelections) < Number(group.minSelections)) {
          addFinding("Business Logic", "high", "One-time menu contract", `Group ${keyOf(group)} on ${productKey} has maxSelections below minSelections.`);
        }
        for (const option of asArray(group.options)) {
          if (!keyOf(option)) addFinding("UX/API Contract", "high", "One-time menu contract", `Option in ${productKey}/${keyOf(group)} has an empty key.`);
        }
      }
    }
  }

  for (const key of ["basic_meal", "basic_salad"]) {
    const product = products.find((item) => keyOf(item) === key);
    if (!product) continue;
    const premium = asArray(product.optionGroups).flatMap((group) => asArray(group.options)).filter((option) => PREMIUM_KEYS.has(keyOf(option)));
    if (premium.length) addFinding("Business Logic", "high", "One-time menu contract", `${key} exposes premium protein options: ${premium.map(keyOf).join(", ")}.`);
  }
  addResult("One-time menu contract", endpoint, "Menu metadata and selection rules inspected", FINDINGS.some((finding) => finding.area === "One-time menu contract" && ["critical", "high"].includes(finding.severity)) ? "FAIL" : "PASS", 200, "", `${categories.length} categories, ${products.length} products.`);
  return { categories, products };
}

function selectedOptionsFor(product) {
  const selected = [];
  for (const group of asArray(product && product.optionGroups)) {
    const min = Math.max(Number(group.minSelections || 0), group.isRequired ? 1 : 0);
    for (const option of asArray(group.options).slice(0, min)) {
      selected.push({ groupId: idOf(group), optionId: idOf(option), qty: 1 });
    }
  }
  return selected;
}

function buildQuoteItem(product) {
  return {
    productId: idOf(product),
    qty: 1,
    ...(product.pricingModel === "per_100g" ? { weightGrams: 100 } : {}),
    selectedOptions: selectedOptionsFor(product),
  };
}

function chooseProducts(products) {
  const byId = (id) => products.find((item) => idOf(item) === id);
  const simple = byId(TEST_SIMPLE_PRODUCT_ID || TEST_PRODUCT_ID) || products.find((item) => item.pricingModel === "fixed" && asArray(item.optionGroups).length === 0);
  const configurable = byId(TEST_CONFIGURABLE_PRODUCT_ID) || products.find((item) => asArray(item.optionGroups).some((group) => group.isRequired || Number(group.minSelections) > 0));
  const weighted = products.find((item) => item.pricingModel === "per_100g");
  return { simple, configurable, weighted };
}

function quotePayload(product, pickup = { branchId: "main" }) {
  return { fulfillmentMethod: "pickup", pickup, items: product ? [buildQuoteItem(product)] : [] };
}

function checkQuotePricing(response, scenario) {
  if (!response.ok) return;
  const pricing = dataOf(response) && dataOf(response).pricing;
  if (!pricing || !Number.isFinite(Number(pricing.subtotalHalala)) || !Number.isFinite(Number(pricing.totalHalala)) || !Number.isFinite(Number(pricing.vatHalala)) || !pricing.currency) {
    addFinding("Business Logic", "high", "One-time quote cycle", `${scenario} returned an incomplete pricing shape.`);
    return;
  }
  const expected = Number(pricing.subtotalHalala) + Number(pricing.deliveryFeeHalala || 0) - Number(pricing.discountHalala || 0);
  if (expected !== Number(pricing.totalHalala)) addFinding("Business Logic", "critical", "One-time quote cycle", `${scenario} pricing total is inconsistent.`);
}

async function quoteCycle(products, menu) {
  const endpoint = "/api/orders/quote";
  if (!CLIENT_TOKEN) {
    addResult("One-time quote cycle", endpoint, "Authenticated quote matrix", "SKIP", "", "", "QA_CLIENT_TOKEN is missing.");
    return null;
  }
  const chosen = chooseProducts(products);
  if (!chosen.simple && !chosen.configurable && !chosen.weighted) {
    addResult("One-time quote cycle", endpoint, "Dynamic product selection", "FAIL", "", "", "No published products are usable.");
    return null;
  }
  const windows = asArray(menu && menu.restaurantHours && menu.restaurantHours.pickupWindows);
  const firstWindow = windows.length ? String(windows[0].value || windows[0].key || windows[0]) : "";
  const baselineProduct = chosen.simple || chosen.configurable || chosen.weighted;
  const positive = [
    ["branchId main", quotePayload(baselineProduct, { branchId: "main", ...(firstWindow ? { pickupWindow: firstWindow } : {}) })],
    ["missing branch defaults to main", quotePayload(baselineProduct, {})],
    ["missing pickupWindow uses ASAP", quotePayload(baselineProduct, { branchId: "main" })],
    ["simple fixed product", chosen.simple && quotePayload(chosen.simple)],
    ["configurable product", chosen.configurable && quotePayload(chosen.configurable)],
    ["per_100g product with weight", chosen.weighted && quotePayload(chosen.weighted)],
  ];
  let validPayload = null;
  for (const [scenario, payload] of positive) {
    if (!payload) {
      addResult("One-time quote cycle", endpoint, scenario, "SKIP", "", "", "Catalog has no matching product.");
      continue;
    }
    const response = await request("POST", endpoint, { token: CLIENT_TOKEN, body: payload });
    const accepted = recordResponse("One-time quote cycle", endpoint, scenario, response, (res) => res.ok || errorInfo(res.body).code === "RESTAURANT_CLOSED");
    checkQuotePricing(response, scenario);
    if (accepted && response.ok && !validPayload) validPayload = payload;
  }

  const invalidId = "000000000000000000000000";
  const negative = [
    ["invalid branchId", quotePayload(baselineProduct, { branchId: `${RUN_ID}_invalid` }), ["INVALID_BRANCH"]],
    ["invalid pickupWindow", quotePayload(baselineProduct, { branchId: "main", pickupWindow: "99:99-99:99" }), ["INVALID_DELIVERY_WINDOW"]],
    ["empty items", { fulfillmentMethod: "pickup", pickup: {}, items: [] }, ["EMPTY_ORDER"]],
    ["invalid productId", { fulfillmentMethod: "pickup", pickup: {}, items: [{ productId: invalidId, qty: 1, selectedOptions: [] }] }, ["ITEM_NOT_FOUND", "PRODUCT_NOT_AVAILABLE"]],
    ["qty zero", { ...quotePayload(baselineProduct), items: [{ ...buildQuoteItem(baselineProduct), qty: 0 }] }, ["INVALID_SELECTION", "VALIDATION_ERROR"]],
  ];
  if (chosen.configurable) {
    const required = asArray(chosen.configurable.optionGroups).find((group) => group.isRequired || Number(group.minSelections) > 0);
    if (required) {
      negative.push(["missing required option", { ...quotePayload(chosen.configurable), items: [{ ...buildQuoteItem(chosen.configurable), selectedOptions: selectedOptionsFor(chosen.configurable).filter((item) => item.groupId !== idOf(required)) }] }, ["MIN_SELECTIONS_NOT_MET", "VALIDATION_ERROR", "INVALID_SELECTION", "REQUIRED_OPTIONS_MISSING"]]);
      const options = asArray(required.options);
      if (options.length > Number(required.maxSelections || 0)) {
        negative.push(["too many options for maxSelections", { ...quotePayload(chosen.configurable), items: [{ ...buildQuoteItem(chosen.configurable), selectedOptions: options.slice(0, Number(required.maxSelections || 0) + 1).map((option) => ({ groupId: idOf(required), optionId: idOf(option), qty: 1 })) }] }, ["VALIDATION_ERROR", "INVALID_SELECTION", "MAX_SELECTIONS_EXCEEDED"]]);
      }
    }
  }
  if (chosen.weighted) {
    const weightedItem = buildQuoteItem(chosen.weighted);
    const weightCodes = ["INVALID_WEIGHT_GRAMS", "WEIGHT_REQUIRED", "INVALID_WEIGHT"];
    negative.push(["per_100g missing weightGrams", { ...quotePayload(chosen.weighted), items: [{ ...weightedItem, weightGrams: undefined }] }, weightCodes]);
    negative.push(["per_100g null weightGrams", { ...quotePayload(chosen.weighted), items: [{ ...weightedItem, weightGrams: null }] }, weightCodes]);
    negative.push(["per_100g empty weightGrams", { ...quotePayload(chosen.weighted), items: [{ ...weightedItem, weightGrams: "" }] }, weightCodes]);
    negative.push(["per_100g zero weightGrams", { ...quotePayload(chosen.weighted), items: [{ ...weightedItem, weightGrams: 0 }] }, weightCodes]);
    negative.push(["per_100g negative weightGrams", { ...quotePayload(chosen.weighted), items: [{ ...weightedItem, weightGrams: -100 }] }, weightCodes]);
    negative.push(["per_100g decimal weightGrams", { ...quotePayload(chosen.weighted), items: [{ ...weightedItem, weightGrams: 100.5 }] }, weightCodes]);
    negative.push(["per_100g invalid weightGrams", { ...quotePayload(chosen.weighted), items: [{ ...weightedItem, weightGrams: "invalid" }] }, weightCodes]);
  }
  for (const [scenario, payload, codes] of negative) {
    const response = await request("POST", endpoint, { token: CLIENT_TOKEN, body: payload });
    recordResponse("One-time quote cycle", endpoint, scenario, response, (res) => !res.ok && res.status < 500 && codes.includes(errorInfo(res.body).code), `Expected ${codes.join("/")}; ${errorInfo(response.body).message}`);
  }
  return validPayload;
}

async function createOrderCycle(validPayload) {
  const endpoint = "/api/orders";
  if (!ALLOW_ORDER_CREATE) {
    addResult("One-time order creation", endpoint, "Create order and initialize payment", "SKIP", "", "", "Requires QA_ALLOW_WRITE=true and QA_ALLOW_ORDER_CREATE=true.");
    return;
  }
  if (!CLIENT_TOKEN || !validPayload) {
    addResult("One-time order creation", endpoint, "Create order and initialize payment", "SKIP", "", "", "Client token or valid quote payload unavailable.");
    return;
  }
  const idempotencyKey = `${RUN_ID}_${crypto.randomBytes(4).toString("hex")}`;
  const response = await request("POST", endpoint, { token: CLIENT_TOKEN, body: validPayload, headers: { "Idempotency-Key": idempotencyKey } });
  const passed = recordResponse("One-time order creation", endpoint, "Create order and initialize payment", response, (res) => res.ok && dataOf(res) && (dataOf(res).orderId || dataOf(res).id));
  if (!passed) return;
  const order = dataOf(response);
  const orderId = String(order.orderId || order.id);
  WRITES.orders.push(orderId);
  addFinding("Payment", "manual", "One-time order creation", `QA order created: ${orderId}. Payment initialization was exercised; external Moyasar completion remains manual.`);
  const detail = await request("GET", `/api/orders/${orderId}`, { token: CLIENT_TOKEN });
  recordResponse("One-time order creation", `/api/orders/${orderId}`, "Read created order detail", detail, (res) => res.ok && dataOf(res));
}

async function plansContract() {
  const endpoint = "/api/plans?lang=en";
  if (!CLIENT_TOKEN) {
    addResult("Subscription plans contract", endpoint, "Public/client plan contract", "SKIP", "", "", "QA_CLIENT_TOKEN is missing.");
  } else {
    const response = await request("GET", endpoint, { token: CLIENT_TOKEN });
    const passed = recordResponse("Subscription plans contract", endpoint, "Client plan list responds", response, (res) => res.ok && Array.isArray(dataOf(res)));
    if (passed) inspectPlans(asArray(dataOf(response)), endpoint, "client");
  }
  const dashboardEndpoint = "/api/dashboard/plans";
  if (!DASHBOARD_TOKEN) {
    addResult("Subscription plans contract", dashboardEndpoint, "Dashboard plan list", "SKIP", "", "", "QA_DASHBOARD_TOKEN is missing.");
    return;
  }
  const dashboard = await request("GET", dashboardEndpoint, { token: DASHBOARD_TOKEN });
  const passed = recordResponse("Subscription plans contract", dashboardEndpoint, "Dashboard plan list responds", dashboard, (res) => res.ok && Array.isArray(dataOf(res)));
  if (passed) inspectPlans(asArray(dataOf(dashboard)), dashboardEndpoint, "dashboard");
}

function inspectPlans(plans, endpoint, source) {
  const active = plans.filter((plan) => plan.isActive !== false);
  const visibleKeys = active.map(keyOf).filter(Boolean);
  const canonical = active.filter((plan) => CANONICAL_PLAN_KEYS.has(keyOf(plan)));
  if (source === "client" && active.length === 45) addFinding("Business Logic", "critical", "Subscription plans contract", `${endpoint} exposes 45 active flat plans as top-level plans.`);
  const legacy = active.filter((plan) => LEGACY_PLAN_KEYS.includes(keyOf(plan)));
  if (legacy.length) addFinding("UX/API Contract", source === "client" ? "high" : "warning", "Subscription plans contract", `${endpoint} exposes legacy active plan keys: ${legacy.map(keyOf).join(", ")}.`);
  if (source === "client" && canonical.length !== 3) addFinding("Business Logic", "high", "Subscription plans contract", `${endpoint} exposes canonical keys [${visibleKeys.join(", ")}], expected exactly the 7/26/30 day canonical plans.`);
  for (const plan of canonical) {
    const grams = asArray(plan.gramsOptions);
    for (const requiredGrams of [100, 150, 200]) {
      const row = grams.find((item) => Number(item.grams) === requiredGrams);
      if (!row) addFinding("Business Logic", "high", "Subscription plans contract", `${keyOf(plan)} is missing ${requiredGrams}g pricing.`);
      for (const meals of [1, 2, 3, 4, 5]) {
        const option = row && asArray(row.mealsOptions).find((item) => Number(item.mealsPerDay || item.meals) === meals);
        if (!option || !Number.isFinite(Number(option.priceHalala))) addFinding("Business Logic", "high", "Subscription plans contract", `${keyOf(plan)} ${requiredGrams}g is missing ${meals}-meal priceHalala.`);
      }
    }
  }
  addResult("Subscription plans contract", endpoint, `${source} plans inspected`, FINDINGS.some((finding) => finding.area === "Subscription plans contract" && ["critical", "high"].includes(finding.severity)) ? "FAIL" : "PASS", 200, "", `${active.length} active plans.`);
}

async function mealPlannerContract() {
  const endpoint = "/api/subscriptions/meal-planner-menu?lang=ar";
  const response = await request("GET", endpoint);
  const passed = recordResponse("Meal planner catalog", endpoint, "Canonical planner menu responds", response, (res) => res.ok && dataOf(res));
  if (!passed) return null;
  const data = dataOf(response);
  const v1 = data.builderCatalog || {};
  const addon = data.addonCatalog || {};
  for (const field of ["proteins", "premiumProteins", "carbs", "sandwiches"]) {
    if (!Array.isArray(v1[field])) addFinding("UX/API Contract", "high", "Meal planner catalog", `builderCatalog.${field} is missing.`);
  }
  if (!v1.premiumLargeSalad) addFinding("UX/API Contract", "high", "Meal planner catalog", "builderCatalog.premiumLargeSalad is missing.");
  if (!addon || typeof addon !== "object") addFinding("UX/API Contract", "high", "Meal planner catalog", "addonCatalog is missing.");
  const v2 = data.builderCatalogV2 || {};
  const sections = asArray(v2.sections);
  if (v2.catalogVersion !== "meal_planner_menu.v2") addFinding("UX/API Contract", "high", "Meal planner catalog", "builderCatalogV2.catalogVersion is not meal_planner_menu.v2.");
  for (const key of ["standard_meal", "premium_meal", "sandwich", "premium_large_salad"]) {
    if (!sections.find((section) => section.key === key || section.selectionType === key)) addFinding("UX/API Contract", "high", "Meal planner catalog", `builderCatalogV2 section ${key} is missing.`);
  }
  const standardKeys = new Set(asArray(v1.proteins).map((item) => item.proteinFamilyKey || item.key));
  for (const premium of PREMIUM_KEYS) {
    if (standardKeys.has(premium)) addFinding("Business Logic", "high", "Meal planner catalog", `Standard protein list contains premium key ${premium}.`);
  }
  for (const option of asArray(v1.premiumProteins)) {
    if (!idOf(option) || !keyOf(option) || !option.premiumKey) addFinding("UX/API Contract", "high", "Meal planner catalog", "A premium protein has incomplete id/key/premiumKey identity.");
  }
  const saladGroups = asArray(v1.premiumLargeSalad && v1.premiumLargeSalad.groups);
  const saladSection = sections.find((section) => section.key === "premium_large_salad" || section.selectionType === "premium_large_salad");
  const saladProduct = catalogFirst(saladSection && saladSection.products);
  const v2SaladGroups = asArray(saladProduct && saladProduct.optionGroups);
  for (const key of ["leafy_greens", "vegetables", "protein", "cheese_nuts", "fruits", "sauce"]) {
    const group = saladGroups.find((item) => item.key === key);
    const v2Group = v2SaladGroups.find((item) => item.key === key);
    if (!group) {
      addFinding("Business Logic", "high", "Meal planner catalog", `Premium large salad V1 group ${key} is missing.`);
    }
    if (!v2Group || !asArray(v2Group.options).length) {
      addFinding("Business Logic", "high", "Meal planner catalog", `Premium large salad V2 group ${key} is missing or has no options.`);
    }
  }
  if (saladGroups.length && saladGroups.some((group) => !Array.isArray(group.options))) {
    addFinding("UX/API Contract", "warning", "Meal planner catalog", "Premium large salad V1 groups expose rules while selectable rows live in premiumLargeSalad.ingredients. V2 optionGroups are populated; legacy clients must use the documented split shape.");
  }
  if (!saladProduct || saladProduct.isVirtual !== false || !idOf(saladProduct)) {
    addFinding("Business Logic", "high", "Meal planner catalog", "Premium large salad V2 does not preserve a real MenuProduct id.");
  }
  addResult("Meal planner catalog", endpoint, "V1/V2 contract inspected", FINDINGS.some((finding) => finding.area === "Meal planner catalog" && ["critical", "high"].includes(finding.severity)) ? "FAIL" : "PASS", response.status);
  return data;
}

function catalogFirst(items, predicate = () => true) {
  return asArray(items).find(predicate);
}

function plannerPayloads(catalog) {
  const builder = catalog && catalog.builderCatalog || {};
  const standard = catalogFirst(builder.proteins, (item) => item.isPremium !== true);
  const premium = catalogFirst(builder.premiumProteins, (item) => item.premiumKey === "shrimp") || catalogFirst(builder.premiumProteins);
  const carb = catalogFirst(builder.carbs);
  const sandwich = catalogFirst(builder.sandwiches);
  const carbs = carb ? [{ carbId: idOf(carb), grams: 150 }] : [];
  const slot = (selectionType, extra) => ({ slotIndex: 1, slotKey: "slot_1", selectionType, ...extra });
  const payloads = {
    positive: [],
    negative: [],
  };
  if (standard && carb) payloads.positive.push(["standard_meal with valid protein and carb", { mealSlots: [slot("standard_meal", { proteinId: idOf(standard), carbs })] }]);
  if (premium && carb) {
    payloads.positive.push(["premium_meal using premiumKey/proteinKey", { mealSlots: [slot("premium_meal", { premiumKey: premium.premiumKey || keyOf(premium), proteinKey: keyOf(premium), carbs })] }]);
    if (idOf(premium)) payloads.positive.push(["premium_meal using proteinId", { mealSlots: [slot("premium_meal", { proteinId: idOf(premium), carbs })] }]);
  }
  if (sandwich) payloads.positive.push(["sandwich selection", { mealSlots: [slot("sandwich", { sandwichId: idOf(sandwich) })] }]);
  if (ADDON_IDS.length && payloads.positive[0]) payloads.positive.push(["addonsOneTime dry-run", { ...payloads.positive[0][1], addonsOneTime: ADDON_IDS }]);
  if (standard && carb) payloads.negative.push(["premium_meal with standard protein", { mealSlots: [slot("premium_meal", { proteinId: idOf(standard), carbs })] }, "INVALID_PROTEIN_TYPE"]);
  if (premium && carb) payloads.negative.push(["standard_meal with premium protein", { mealSlots: [slot("standard_meal", { proteinId: idOf(premium), carbs })] }, "INVALID_PROTEIN_TYPE"]);
  payloads.negative.push(["missing protein", { mealSlots: [slot("standard_meal", { carbs })] }, "PROTEIN_REQUIRED"]);
  if (standard) payloads.negative.push(["invalid carb", { mealSlots: [slot("standard_meal", { proteinId: idOf(standard), carbs: [{ carbId: "000000000000000000000000", grams: 150 }] })] }, "INVALID_CARB_ID"]);
  return payloads;
}

function dateOf(value) {
  return String(value && (value.date || value.businessDate) || "").slice(0, 10);
}

async function discoverSubscriptionValidationTarget() {
  const listEndpoint = "/api/subscriptions";
  const listed = await request("GET", listEndpoint, { token: CLIENT_TOKEN });
  if (!listed.ok || !Array.isArray(dataOf(listed))) {
    addResult("Subscription meal validation", listEndpoint, "Discover authenticated client subscriptions", "SKIP", listed.status, errorInfo(listed.body).code, "DATA_SETUP_REQUIRED: unable to list subscriptions owned by QA client.");
    return null;
  }

  const subscriptions = asArray(dataOf(listed));
  const configured = subscriptions.find((subscription) => idOf(subscription) === SUBSCRIPTION_ID);
  const candidates = [
    ...(configured ? [configured] : []),
    ...subscriptions.filter((subscription) => !configured || idOf(subscription) !== idOf(configured)),
  ];
  for (const subscription of candidates) {
    const subscriptionId = idOf(subscription);
    if (!subscriptionId) continue;
    const daysEndpoint = `/api/subscriptions/${subscriptionId}/days`;
    const daysResponse = await request("GET", daysEndpoint, { token: CLIENT_TOKEN });
    if (!daysResponse.ok || !Array.isArray(dataOf(daysResponse))) continue;
    const days = asArray(dataOf(daysResponse));
    const configuredDay = days.find((day) => dateOf(day) === SUBSCRIPTION_DATE);
    const openDay = days.find((day) => String(day.status || "").toLowerCase() === "open");
    const day = configuredDay || openDay || days[0];
    if (!day || !dateOf(day)) continue;
    const notes = configured && configuredDay
      ? "Using configured QA subscription and day."
      : `Auto-discovered owned subscription day${SUBSCRIPTION_ID || SUBSCRIPTION_DATE ? " after configured target was missing or invalid" : ""}.`;
    addResult("Subscription meal validation", daysEndpoint, "Discover authenticated client subscription day", "PASS", daysResponse.status, "", notes);
    return { subscriptionId, date: dateOf(day) };
  }

  addResult("Subscription meal validation", listEndpoint, "Discover authenticated client subscription day", "SKIP", listed.status, "", "DATA_SETUP_REQUIRED: QA client has no owned subscription with an existing day.");
  return null;
}

async function subscriptionSelection(catalog) {
  const placeholderEndpoint = "/api/subscriptions/:subscriptionId/days/:date/selection/validate";
  if (!CLIENT_TOKEN) {
    addResult("Subscription meal validation", placeholderEndpoint, "Canonical meal-slot validation matrix", "SKIP", "", "", "Requires QA_CLIENT_TOKEN.");
    return;
  }
  const target = await discoverSubscriptionValidationTarget();
  if (!target) return;
  const endpoint = `/api/subscriptions/${target.subscriptionId}/days/${target.date}/selection/validate`;
  const payloads = plannerPayloads(catalog);
  for (const [scenario, body] of payloads.positive) {
    const response = await request("POST", endpoint, { token: CLIENT_TOKEN, body });
    if (response.status === 404 && errorInfo(response.body).code === "NOT_FOUND") {
      addResult("Subscription meal validation", endpoint, scenario, "SKIP", response.status, "DATA_SETUP_REQUIRED", errorInfo(response.body).message);
      continue;
    }
    recordResponse("Subscription meal validation", endpoint, scenario, response, (res) => res.ok && dataOf(res) && dataOf(res).valid !== false);
  }
  for (const [scenario, body, expected] of payloads.negative) {
    const response = await request("POST", endpoint, { token: CLIENT_TOKEN, body });
    if (response.status === 404 && errorInfo(response.body).code === "NOT_FOUND") {
      addResult("Subscription meal validation", endpoint, scenario, "SKIP", response.status, "DATA_SETUP_REQUIRED", errorInfo(response.body).message);
      continue;
    }
    const data = dataOf(response) || response.body || {};
    const slotErrors = asArray(data.slotErrors || data.details && data.details.slotErrors);
    const code = data.errorCode || errorInfo(response.body).code || slotErrors[0] && slotErrors[0].code;
    addResult("Subscription meal validation", endpoint, scenario, code === expected ? "PASS" : "FAIL", response.status, code, `Expected ${expected}.`);
    if (slotErrors.length && slotErrors.some((item) => item.slotIndex === undefined)) addFinding("UX/API Contract", "warning", "Subscription meal validation", `${scenario} slotErrors omit slotIndex.`);
  }
}

async function settingsChecks() {
  const publicSettings = await request("GET", "/api/settings");
  const passed = recordResponse("Settings / pickup", "/api/settings", "Public settings respond", publicSettings, (res) => res.ok && dataOf(res));
  if (passed) {
    const settings = dataOf(publicSettings);
    const pickups = asArray(settings.pickup_locations);
    const main = pickups.find(isMainPickupLocation);
    if (!main) addFinding("UX/API Contract", "warning", "Settings / pickup", "pickup_locations does not expose a stable main branch; one-time pricing still documents a main fallback.");
    const address = main && localizedAddressAr(main.address || main.location);
    if (main && !address) addFinding("UX/API Contract", "warning", "Settings / pickup", "Main pickup branch address is not publicly exposed. Run npm run ensure:pickup-main against the target DB and verify the settings record.");
    if (main && address && address !== CANONICAL_PICKUP_ADDRESS_AR) addFinding("UX/API Contract", "warning", "Settings / pickup", "Main pickup branch address does not match the canonical H4GX+JF7 address. Run npm run ensure:pickup-main against the target DB.");
    if (main && [main.isActive, main.active, main.pickupEnabled, main.isPickupEnabled].some((value) => value === false)) addFinding("Business Logic", "high", "Settings / pickup", "Canonical main pickup branch is inactive or pickup-disabled.");
    if (!Array.isArray(settings.pickup_windows)) addFinding("UX/API Contract", "warning", "Settings / pickup", "Public settings omit pickup_windows.");
  }
  if (!DASHBOARD_TOKEN) {
    addResult("Settings / pickup", "/api/dashboard/settings", "Dashboard settings route", "SKIP", "", "", "No dedicated dashboard settings route was discovered; dashboard token is also missing.");
  } else {
    addResult("Settings / pickup", "/api/dashboard/settings", "Dashboard settings route", "WARN", "", "", "Static inspection found public /api/settings and /api/app/config, but no dedicated /api/dashboard/settings route.");
  }
}

async function authChecks() {
  const noToken = await request("POST", "/api/orders/quote", { body: { items: [] } });
  recordResponse("Auth / authorization", "/api/orders/quote", "Client endpoint without token", noToken, (res) => [401, 403].includes(res.status));
  const invalid = await request("POST", "/api/orders/quote", { token: "invalid.qa.token", body: { items: [] } });
  recordResponse("Auth / authorization", "/api/orders/quote", "Client endpoint with invalid token", invalid, (res) => [401, 403].includes(res.status));
  const dashboardNoToken = await request("GET", "/api/dashboard/plans");
  recordResponse("Auth / authorization", "/api/dashboard/plans", "Dashboard endpoint without token", dashboardNoToken, (res) => [401, 403].includes(res.status));
  if (CLIENT_TOKEN) {
    const clientOnDashboard = await request("GET", "/api/dashboard/plans", { token: CLIENT_TOKEN });
    recordResponse("Auth / authorization", "/api/dashboard/plans", "Client token rejected by dashboard route", clientOnDashboard, (res) => [401, 403].includes(res.status));
  }
}

async function dashboardWriteCycle() {
  const endpoint = "/api/dashboard/menu";
  if (!DASHBOARD_TOKEN || !ALLOW_DASHBOARD_WRITE) {
    addResult("Dashboard catalog writes", endpoint, "QA-tagged create/update/immutable-key cycle", "SKIP", "", "", "Requires QA_DASHBOARD_TOKEN, QA_ALLOW_WRITE=true, and QA_ALLOW_DASHBOARD_WRITE=true.");
    return;
  }
  const base = "/api/dashboard/menu";
  const inactive = { isActive: false, isVisible: false, isAvailable: false };
  const activeHidden = { isActive: true, isVisible: false, isAvailable: false };

  async function create(kind, route, body, bucket) {
    const response = await request("POST", `${base}${route}`, { token: DASHBOARD_TOKEN, body });
    const visibility = kind === "category" ? "active hidden" : "inactive";
    const passed = recordResponse("Dashboard catalog writes", `${base}${route}`, `Create ${visibility} QA ${kind} without key`, response, (res) => res.status === 201 && idOf(dataOf(res)) && keyOf(dataOf(res)), keyOf(dataOf(response)) ? `Generated key: ${keyOf(dataOf(response))}` : "");
    if (!passed) return null;
    const row = dataOf(response);
    WRITES[bucket].push(idOf(row));
    return row;
  }

  async function updateAndAssertImmutable(kind, route, row, updateBody) {
    if (!row) return;
    const updated = await request("PATCH", `${base}${route}/${idOf(row)}`, { token: DASHBOARD_TOKEN, body: updateBody });
    recordResponse("Dashboard catalog writes", `${base}${route}/${idOf(row)}`, `Update QA ${kind} name/UI without changing key`, updated, (res) => res.ok && keyOf(dataOf(res)) === keyOf(row));
    const immutable = await request("PATCH", `${base}${route}/${idOf(row)}`, { token: DASHBOARD_TOKEN, body: { key: `${keyOf(row)}_changed` } });
    recordResponse("Dashboard catalog writes", `${base}${route}/${idOf(row)}`, `Reject ${kind} key mutation`, immutable, (res) => res.status === 400 && errorInfo(res.body).code === "IMMUTABLE_KEY");
  }

  const category = await create("category", "/categories", {
    name: { ar: `${RUN_ID} تصنيف`, en: `${RUN_ID} category` },
    ui: { cardVariant: "addon_collection" },
    ...activeHidden,
  }, "categories");
  await updateAndAssertImmutable("category", "/categories", category, {
    name: { ar: `${RUN_ID} تصنيف محدث`, en: `${RUN_ID} category updated` },
    ui: { cardVariant: "light_collection" },
  });

  const product = category && await create("product", "/products", {
    categoryId: idOf(category),
    name: { ar: `${RUN_ID} منتج`, en: `${RUN_ID} product` },
    pricingModel: "fixed",
    priceHalala: 100,
    availableFor: ["one_time"],
    ui: { cardVariant: "standard", badge: RUN_ID, ctaLabel: RUN_ID, imageRatio: "square" },
    ...inactive,
  }, "products");
  await updateAndAssertImmutable("product", "/products", product, {
    name: { ar: `${RUN_ID} منتج محدث`, en: `${RUN_ID} product updated` },
    ui: { cardVariant: "addon", badge: RUN_ID, ctaLabel: RUN_ID, imageRatio: "square" },
  });

  const group = await create("option group", "/option-groups", {
    name: { ar: `${RUN_ID} مجموعة`, en: `${RUN_ID} group` },
    ui: { displayStyle: "chips" },
    ...inactive,
  }, "optionGroups");
  await updateAndAssertImmutable("option group", "/option-groups", group, {
    name: { ar: `${RUN_ID} مجموعة محدثة`, en: `${RUN_ID} group updated` },
    ui: { displayStyle: "radio_cards" },
  });

  const option = group && await create("option", "/options", {
    groupId: idOf(group),
    name: { ar: `${RUN_ID} خيار`, en: `${RUN_ID} option` },
    availableFor: ["one_time"],
    extraPriceHalala: 0,
    ...inactive,
  }, "options");
  await updateAndAssertImmutable("option", "/options", option, {
    name: { ar: `${RUN_ID} خيار محدث`, en: `${RUN_ID} option updated` },
  });

  if (product && group) {
    const relationPath = `${base}/products/${idOf(product)}/option-groups`;
    const relation = await request("POST", relationPath, {
      token: DASHBOARD_TOKEN,
      body: { groupId: idOf(group), minSelections: 1, maxSelections: 1, isRequired: true, sortOrder: 10, ...inactive },
    });
    const passed = recordResponse("Dashboard catalog writes", relationPath, "Link inactive QA option group to QA product", relation, (res) => res.status === 201 && dataOf(res));
    if (passed) WRITES.relations.push(idOf(dataOf(relation)) || `${idOf(product)}:${idOf(group)}`);
  }
  if (product && group && option) {
    const relationPath = `${base}/products/${idOf(product)}/option-groups/${idOf(group)}/options`;
    const relation = await request("POST", relationPath, {
      token: DASHBOARD_TOKEN,
      body: { optionId: idOf(option), sortOrder: 10, ...inactive },
    });
    const passed = recordResponse("Dashboard catalog writes", relationPath, "Link inactive QA option to QA product group", relation, (res) => res.status === 201 && dataOf(res));
    if (passed) WRITES.relations.push(idOf(dataOf(relation)) || `${idOf(product)}:${idOf(group)}:${idOf(option)}`);
  }
  addResult("Dashboard catalog writes", "/api/orders/menu", "Published menu visibility for QA records", "SKIP", "", "", "QA records intentionally remain inactive and unpublished; no publish operation is performed by unattended QA.");
  addFinding("Manual Verification", "manual", "Dashboard catalog writes", "Inactive QA-tagged catalog records remain for dashboard inspection. Publish/visibility verification requires an explicit operator decision.");
}

function summaryCounts() {
  return ["PASS", "FAIL", "WARN", "SKIP"].reduce((acc, key) => {
    acc[key] = RESULTS.filter((row) => row.result === key).length;
    return acc;
  }, {});
}

function handoffDecision() {
  const critical = FINDINGS.some((finding) => finding.severity === "critical");
  const failed = RESULTS.some((row) => row.result === "FAIL");
  const skipped = RESULTS.some((row) => row.result === "SKIP");
  if (critical) return "Not Ready";
  if (failed || skipped) return "Conditionally Ready";
  return "Ready";
}

function findingLines(kind) {
  const findings = FINDINGS.filter((finding) => finding.kind === kind);
  return findings.length ? findings.map((finding) => `- **${finding.severity.toUpperCase()}** ${finding.area}: ${finding.message}`).join("\n") : "- None recorded.";
}

function writtenLines() {
  return Object.entries(WRITES).map(([key, values]) => `- ${key}: ${values.length ? values.join(", ") : "none"}`).join("\n");
}

function writeReport() {
  const counts = summaryCounts();
  const decision = handoffDecision();
  const critical = FINDINGS.filter((finding) => finding.severity === "critical");
  const high = FINDINGS.filter((finding) => finding.severity === "high");
  const warnings = FINDINGS.filter((finding) => finding.severity === "warning");
  const matrix = RESULTS.map((row) => `| ${escapeCell(row.area)} | ${escapeCell(row.endpoint)} | ${escapeCell(row.scenario)} | ${row.result} | ${row.statusCode} | ${escapeCell(row.errorCode)} | ${escapeCell(row.notes)} |`).join("\n");
  const report = `# Backend Full E2E QA Report

## 1. Environment
- Base URL: ${BASE_URL}
- Date/time: ${new Date().toISOString()}
- Tokens provided: client=${CLIENT_TOKEN ? "yes" : "no"}, dashboard=${DASHBOARD_TOKEN ? "yes" : "no"}
- Write mode enabled: ${ALLOW_WRITE ? "yes" : "no"}
- Order create enabled: ${ALLOW_ORDER_CREATE ? "yes" : "no"}
- Dashboard write enabled: ${ALLOW_DASHBOARD_WRITE ? "yes" : "no"}

## 2. Executive Summary
- Decision: **${decision}**
- PASS / FAIL / WARN / SKIP: ${counts.PASS} / ${counts.FAIL} / ${counts.WARN} / ${counts.SKIP}
- Critical blockers: ${critical.length}
- High-risk issues: ${high.length}
- Non-blocking warnings: ${warnings.length}

## 3. PASS / FAIL / WARN / SKIP Matrix
| Area | Endpoint | Scenario | Result | Status Code | Error Code | Notes |
| --- | --- | --- | --- | --- | --- | --- |
${matrix}

## 4. Business Logic Findings
${findingLines("Business Logic")}

## 5. UX/API Contract Findings
${findingLines("UX/API Contract")}

## 6. Data Written During QA
${writtenLines()}

## 7. Payment Verification Status
- Quote behavior is tested when QA_CLIENT_TOKEN is available.
- Order initialization is tested only when QA_ALLOW_WRITE=true and QA_ALLOW_ORDER_CREATE=true.
- External Moyasar payment completion is not automated. It remains manual unless an already-documented test provider is configured.
${findingLines("Payment")}

## 8. Manual Verification Still Required
${findingLines("Manual Verification")}
- Complete one Moyasar test-mode payment externally and verify webhook-driven order state transition.
- Run dashboard QA-tagged catalog writes manually if production mutation is intentionally approved.

## 9. Final Handoff Decision
**${decision}**

Payment completion being manual does not block handoff by itself. Any HTTP 500 in a critical flow does block handoff.
`;
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, report);
  console.log(`\nReport written: ${REPORT_PATH}`);
  console.log(`Summary: PASS=${counts.PASS} FAIL=${counts.FAIL} WARN=${counts.WARN} SKIP=${counts.SKIP}`);
}

async function main() {
  console.log(`Backend release QA ${RUN_ID}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Tokens: client=${CLIENT_TOKEN ? "yes" : "no"}, dashboard=${DASHBOARD_TOKEN ? "yes" : "no"} (values are never logged)`);
  console.log(`Write gates: general=${ALLOW_WRITE}, order=${ALLOW_ORDER_CREATE}, dashboard=${ALLOW_DASHBOARD_WRITE}\n`);

  const menus = await publicAvailability();
  const { products } = inspectOneTimeMenu(menus.ar || menus.en || {});
  const validQuote = await quoteCycle(products, menus.ar || menus.en || {});
  await createOrderCycle(validQuote);
  await plansContract();
  const planner = await mealPlannerContract();
  await subscriptionSelection(planner);
  await settingsChecks();
  await authChecks();
  await dashboardWriteCycle();
  writeReport();
}

main().catch((error) => {
  addFinding("Business Logic", "critical", "Runner", `Unhandled runner failure: ${error.message}`);
  addResult("Runner", "local", "Unhandled runner failure", "FAIL", "", "RUNNER_ERROR", error.message);
  writeReport();
  process.exitCode = 1;
});
