#!/usr/bin/env node
"use strict";

const assert = require("assert");

const BASE_URL = String(process.env.STAGING_BASE_URL || "").trim().replace(/\/+$/, "");
const CLIENT_TOKEN = String(process.env.STAGING_CLIENT_TOKEN || "").trim();
const LOGIN_PATH = String(process.env.STAGING_LOGIN_PATH || "/api/app/login").trim();
const LOGIN_PHONE = String(process.env.STAGING_CLIENT_PHONE || "").trim();
const LOGIN_PASSWORD = String(process.env.STAGING_CLIENT_PASSWORD || "").trim();
const PAYMENT_MODE = String(process.env.STAGING_PAYMENT_MODE || "").trim().toLowerCase();
const ALLOW_ORDER_CREATE = process.env.STAGING_ALLOW_ORDER_CREATE === "true";

const allowedPaymentModes = new Set(["test", "mock", "sandbox"]);

function header(title) {
  console.log("\n============================================================");
  console.log(title);
  console.log("============================================================");
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function assertHalala(value, label) {
  assert.strictEqual(typeof value, "number", `${label} must be number`);
  assert(Number.isInteger(value), `${label} must be integer`);
  assert(value >= 0, `${label} must be non-negative`);
}

function assertObject(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be object`);
}

function assertLocalized(value, label) {
  assert(
    (value && typeof value === "object")
    || (typeof value === "string" && value.trim()),
    `${label} must be localized object or non-empty string`
  );
}

async function requestJson(path, { method = "GET", token = "", body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_err) {
    throw new Error(`${method} ${path} returned non-JSON response with HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} failed with HTTP ${response.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function resolveClientToken() {
  if (CLIENT_TOKEN) return CLIENT_TOKEN;
  if (!LOGIN_PHONE || !LOGIN_PASSWORD) return "";

  header("Login Test Client");
  const json = await requestJson(LOGIN_PATH, {
    method: "POST",
    body: {
      phone: LOGIN_PHONE,
      password: LOGIN_PASSWORD,
    },
  });
  const token = json && json.data && (
    json.data.token
    || json.data.accessToken
    || json.data.access_token
    || json.data.authToken
  );
  if (!token) {
    throw new Error("Login response did not contain a recognized token field.");
  }
  pass("received staging client token from test login");
  return token;
}

function flattenProducts(menu) {
  return (menu.categories || []).flatMap((category) => (
    category.products || []
  ).map((product) => ({ ...product, categoryKey: category.key })));
}

function findProduct(menu, predicate) {
  return flattenProducts(menu).find(predicate);
}

function selectedRequiredOptions(product) {
  return (product.optionGroups || []).flatMap((group) => {
    const count = Number(group.minSelections || 0);
    if (count <= 0) return [];
    const options = Array.isArray(group.options) ? group.options : [];
    if (options.length < count) {
      throw new Error(`Product ${product.key || product.id} group ${group.key || group.id} lacks required options.`);
    }
    return options.slice(0, count).map((option) => ({
      groupId: group.id || group._id,
      optionId: option.id || option._id,
    }));
  });
}

function validateMenu(menu) {
  assert.strictEqual(menu.status, true, "menu.status must be true");
  assertObject(menu.data, "menu.data");
  assert.strictEqual(menu.data.fulfillmentMethod, "pickup");
  assert.strictEqual(menu.data.vatIncluded, true);
  assert(Array.isArray(menu.data.categories), "menu.data.categories must be array");
  assert.strictEqual(menu.data.delivery, undefined, "pickup menu must not expose delivery");
  assert(menu.data.categories.length > 0, "menu must include categories");
  const product = flattenProducts(menu.data)[0];
  assert(product, "menu must include products");
  assert(product.id || product._id, "product stable id is required");
  assertLocalized(product.nameI18n || product.name, "product name");
  assert.strictEqual(typeof product.pricingModel, "string", "product pricingModel must be string");
  assertHalala(product.priceHalala, "product.priceHalala");
}

function buildQuoteBody(menuData) {
  const fixed = findProduct(menuData, (product) => (
    product.pricingModel === "fixed"
    && product.canAddDirectly !== false
    && (!product.optionGroups || product.optionGroups.length === 0)
  ));
  const per100 = findProduct(menuData, (product) => product.pricingModel === "per_100g");
  if (!fixed) throw new Error("Could not find a direct fixed product for staging quote.");
  if (!per100) throw new Error("Could not find a per_100g product for staging quote.");

  return {
    fulfillmentMethod: "pickup",
    fulfillmentDate: process.env.STAGING_ORDER_DATE || "2026-05-10",
    pickup: {
      branchId: "main",
      pickupWindow: "18:00-20:00",
    },
    items: [
      {
        productId: fixed.id || fixed._id,
        qty: 1,
        selectedOptions: [],
      },
      {
        productId: per100.id || per100._id,
        qty: 1,
        weightGrams: Number(per100.defaultWeightGrams || per100.minWeightGrams || 100),
        selectedOptions: selectedRequiredOptions(per100),
      },
    ],
    successUrl: "basicdiet://orders/payment-success",
    backUrl: "basicdiet://orders/payment-cancel",
  };
}

function validateQuote(json) {
  assert.strictEqual(json.status, true, "quote.status must be true");
  assert.strictEqual(json.data.currency, "SAR");
  assert(Array.isArray(json.data.items), "quote.data.items must be array");
  assert(json.data.items.length > 0, "quote must include items");
  json.data.items.forEach((item, index) => {
    assert(item.productId || (item.productSnapshot && item.productSnapshot.id), `quote item ${index} productId required`);
    assertLocalized(item.name, `quote item ${index} name`);
    assert.strictEqual(typeof item.itemType, "string", `quote item ${index} itemType must be string`);
    assertHalala(item.unitPriceHalala, `quote item ${index}.unitPriceHalala`);
    assertHalala(item.lineTotalHalala, `quote item ${index}.lineTotalHalala`);
    assert(Array.isArray(item.selectedOptions), `quote item ${index}.selectedOptions must be array`);
    assertObject(item.productSnapshot, `quote item ${index}.productSnapshot`);
    assertObject(item.pricingSnapshot, `quote item ${index}.pricingSnapshot`);
  });
  assertHalala(json.data.pricing.subtotalHalala, "quote.pricing.subtotalHalala");
  assertHalala(json.data.pricing.totalHalala, "quote.pricing.totalHalala");
  assertHalala(json.data.pricing.vatHalala, "quote.pricing.vatHalala");
  assert.strictEqual(json.data.pricing.vatIncluded, true);
}

function validateCreate(json) {
  assert.strictEqual(json.status, true, "create.status must be true");
  assert(json.data.orderId, "create.data.orderId required");
  assert(json.data.paymentId, "create.data.paymentId required");
  assert(json.data.paymentUrl, "create.data.paymentUrl required");
  assert(json.data.invoiceId, "create.data.invoiceId required");
  assert.strictEqual(json.data.status, "pending_payment");
  assert.strictEqual(json.data.paymentStatus, "initiated");
  assertHalala(json.data.pricing.totalHalala, "create.pricing.totalHalala");
  assert(Array.isArray(json.data.items), "create.data.items must be array");
}

function validateOrderDetail(json) {
  assert.strictEqual(json.status, true, "detail.status must be true");
  assert(json.data.id || json.data.orderId, "detail order id required");
  assert.strictEqual(typeof json.data.status, "string", "detail status required");
  assert.strictEqual(typeof json.data.paymentStatus, "string", "detail paymentStatus required");
  assert.strictEqual(json.data.fulfillmentMethod, "pickup");
  assertObject(json.data.pickup, "detail.pickup");
  assert(Array.isArray(json.data.items), "detail.items must be array");
  assertObject(json.data.pricing, "detail.pricing");
  assertHalala(json.data.pricing.totalHalala, "detail.pricing.totalHalala");
}

async function main() {
  if (!BASE_URL) fail("STAGING_BASE_URL is required.");
  if (BASE_URL.includes("localhost") || BASE_URL.includes("127.0.0.1")) {
    console.warn("WARNING: STAGING_BASE_URL points to localhost. This is allowed, but it is not a remote staging check.");
  }

  header("GET /api/orders/menu");
  const menu = await requestJson("/api/orders/menu?lang=en");
  validateMenu(menu);
  pass("menu contract is valid");

  const token = await resolveClientToken();
  if (!token) {
    fail("STAGING_CLIENT_TOKEN or STAGING_CLIENT_PHONE/STAGING_CLIENT_PASSWORD is required for quote/order/detail checks.");
  }

  const orderBody = buildQuoteBody(menu.data);

  header("POST /api/orders/quote");
  const quote = await requestJson("/api/orders/quote", {
    method: "POST",
    token,
    body: orderBody,
  });
  validateQuote(quote);
  pass("quote contract is valid");

  if (!ALLOW_ORDER_CREATE || !allowedPaymentModes.has(PAYMENT_MODE)) {
    fail("Order creation blocked. Set STAGING_ALLOW_ORDER_CREATE=true and STAGING_PAYMENT_MODE=test|mock|sandbox only when staging payment is not live.");
  }

  header("POST /api/orders");
  const create = await requestJson("/api/orders", {
    method: "POST",
    token,
    body: {
      ...orderBody,
      idempotencyKey: `staging-validation-${Date.now()}`,
    },
  });
  validateCreate(create);
  pass("order creation contract is valid");

  header("GET /api/orders/:id");
  const detail = await requestJson(`/api/orders/${create.data.orderId}`, { token });
  validateOrderDetail(detail);
  pass("mobile order detail contract is valid");

  console.log("\nStaging validation passed.");
}

main().catch((err) => {
  console.error(`FAIL: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
