#!/usr/bin/env node
"use strict";

const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { execFileSync } = require("node:child_process");

const BASE_URL = String(process.env.BASE_URL || "https://basicdiet145.onrender.com").replace(/\/+$/, "");
const ALLOWED_SALAD_PROTEIN_KEYS = [
  "boiled_eggs",
  "tuna",
  "chicken_fajita",
  "spicy_chicken",
  "italian_spiced_chicken",
  "chicken_tikka",
  "asian_chicken",
  "chicken_strips",
  "grilled_chicken",
  "mexican_chicken",
  "fish_fillet",
];
const SANDWICH_KEYS = [
  "beef_burger_sandwich",
  "turkey_cold_sandwich",
  "boiled_egg_sandwich",
  "tuna_sandwich",
  "mexican_chicken_sandwich",
  "grilled_chicken_sandwich",
];
const LEGACY_CARB_KEYS = ["brown_rice", "potato", "pasta"];
const LEGACY_SANDWICH_KEYS = ["chicken_sandwich", "sourdough_turkey"];
const FORBIDDEN_SALAD_PREMIUM_PROTEIN_KEYS = ["beef_steak", "shrimp", "salmon", "meatballs", "beef_stroganoff"];
const QA_DEBUG_CATALOG = process.env.QA_DEBUG_CATALOG === "true";
const ID_FIELDS = ["id", "_id", "optionId", "productId", "proteinId", "carbId", "sandwichId", "mealId", "groupId"];
const KEY_FIELDS = ["key", "proteinKey", "carbKey", "sandwichKey", "premiumKey", "productKey", "slug", "code"];

let failures = 0;
let warnings = 0;
let skips = 0;
let appToken = process.env.APP_TOKEN || "";

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

async function promptSecret(name) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    stdout.write(`Enter ${name}. It will not be printed:\n`);
    try {
      execFileSync("stty", ["-echo"], { stdio: ["inherit", "ignore", "ignore"] });
    } catch (_err) {
      warn("secret prompt echo", `Could not disable echo; set ${name} in env to avoid prompting`);
    }
    const value = await rl.question("");
    stdout.write("\n");
    return value.trim();
  } finally {
    try {
      execFileSync("stty", ["echo"], { stdio: ["inherit", "ignore", "ignore"] });
    } catch (_err) {
      // Best effort only.
    }
    rl.close();
  }
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function requestJson(method, path, { token, body, allowError = false } = {}) {
  const headers = {
    Accept: "application/json",
    ...(token ? authHeader(token) : {}),
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${BASE_URL}${path}`, {
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
    const code = getErrorCode(json);
    const message = getErrorMessage(json);
    throw new Error(`${method} ${path} failed with HTTP ${response.status}${code ? ` ${code}` : ""}${message ? `: ${message}` : ""}`);
  }

  return { status: response.status, ok: response.ok, json };
}

function getData(json) {
  return json && typeof json === "object" ? json.data : undefined;
}

function getId(row) {
  if (!row || typeof row !== "object") return "";
  for (const field of ID_FIELDS) {
    if (isObjectId(row[field])) return String(row[field]);
  }
  for (const field of ID_FIELDS) {
    if (row[field]) return String(row[field]);
  }
  return "";
}

function getKey(row) {
  if (!row || typeof row !== "object") return "";
  for (const field of KEY_FIELDS) {
    if (row[field]) return String(row[field]);
  }
  return "";
}

function isObjectId(value) {
  return /^[0-9a-fA-F]{24}$/.test(String(value || ""));
}

function walk(value, visitor, path = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visitor, path.concat(index)));
    return;
  }
  if (value && typeof value === "object") {
    visitor(value, path);
    for (const [key, child] of Object.entries(value)) {
      walk(child, visitor, path.concat(key));
    }
  }
}

function allObjects(value) {
  const rows = [];
  walk(value, (row) => rows.push(row));
  return rows;
}

function pathToString(path) {
  return path.map((part) => String(part)).join(".");
}

function allObjectsWithPath(value) {
  const rows = [];
  walk(value, (row, path) => rows.push({ row, path }));
  return rows;
}

function section(catalogV2, key) {
  const sections = catalogV2 && catalogV2.sections;
  if (!Array.isArray(sections)) return null;
  return sections.find((item) => item && (item.key === key || item.sectionKey === key)) || null;
}

function isOptionLike(row) {
  if (!row || typeof row !== "object") return false;
  if (!isObjectId(getId(row))) return false;
  if (Array.isArray(row.options) || Array.isArray(row.optionGroups) || Array.isArray(row.products)) return false;
  return KEY_FIELDS.some((field) => row[field] !== undefined) || ID_FIELDS.some((field) => row[field] !== undefined);
}

function findOptionByKeys(scope, keys, { requireObjectId = true } = {}) {
  const keySet = new Set(keys);
  for (const row of allObjects(scope || [])) {
    const id = getId(row);
    const key = getKey(row);
    if (keySet.has(key) && (!requireObjectId || isObjectId(id)) && (isOptionLike(row) || !requireObjectId)) return row;
  }
  return null;
}

function findAnyOption(scope, { rejectKeys = [] } = {}) {
  const rejected = new Set(rejectKeys);
  for (const row of allObjects(scope || [])) {
    const id = getId(row);
    const key = getKey(row);
    if (isOptionLike(row) && isObjectId(id) && !rejected.has(key)) return row;
  }
  return null;
}

function findGroup(groups, key) {
  return (groups || []).find((group) => group && (group.key === key || group.groupKey === key || group.sourceKey === key)) || null;
}

function findGroupDeep(scope, keys) {
  const keySet = new Set(keys);
  for (const row of allObjects(scope || [])) {
    const key = String(row.key || row.groupKey || row.sourceKey || "").trim();
    if (!keySet.has(key)) continue;
    if (Array.isArray(row.options) || Array.isArray(row.optionSections)) return row;
  }
  return null;
}

function groupOptions(group) {
  if (!group || typeof group !== "object") return [];
  const directOptions = Array.isArray(group.options) ? group.options : [];
  const sectionOptions = Array.isArray(group.optionSections)
    ? group.optionSections.flatMap((sectionRow) => Array.isArray(sectionRow.options) ? sectionRow.options : [])
    : [];
  return directOptions.concat(sectionOptions);
}

function findByKey(value, keys) {
  const keySet = new Set(keys);
  for (const row of allObjects(value)) {
    if (keySet.has(getKey(row))) return row;
  }
  return null;
}

function extractCatalog(menuData) {
  const builderCatalogV2 = menuData && (menuData.builderCatalogV2 || menuData.builderCatalog?.builderCatalogV2);
  const standardSection = section(builderCatalogV2, "standard_meal");
  const premiumSection = section(builderCatalogV2, "premium_meal");
  const sandwichSection = section(builderCatalogV2, "sandwich");
  const saladSection = section(builderCatalogV2, "premium_large_salad");
  const saladProduct = Array.isArray(saladSection && saladSection.products) ? saladSection.products[0] : null;
  const standardProteinGroup = findGroupDeep(standardSection, ["protein", "proteins", "standard_proteins", "menu_protein"]);
  const standardCarbGroup = findGroupDeep(standardSection, ["carb", "carbs", "standard_carbs", "menu_carb"]);
  const premiumProteinGroup = findGroupDeep(premiumSection, ["protein", "proteins", "premium", "menu_protein"]);
  const premiumCarbGroup = findGroupDeep(premiumSection, ["carb", "carbs", "standard_carbs", "menu_carb"]);
  const saladProteinGroup = findGroupDeep(saladProduct || saladSection, ["protein", "proteins", "menu_protein"]);
  const saladSauceGroup = findGroupDeep(saladProduct || saladSection, ["sauce", "sauces"]);
  const saladExtraProteinGroup = findGroupDeep(saladProduct || saladSection, ["extra_protein_50g"]);
  return {
    builderCatalogV2,
    standardSection,
    premiumSection,
    sandwichSection,
    saladSection,
    standardProteinGroup,
    standardCarbGroup,
    premiumProteinGroup,
    premiumCarbGroup,
    saladProduct,
    saladProteinGroup,
    saladSauceGroup,
    saladExtraProteinGroup,
  };
}

function describeFound(row) {
  if (!row) return "missing";
  const key = getKey(row) || "(no key)";
  const id = getId(row);
  return `${key} id=${isObjectId(id) ? id : "(no ObjectId)"}`;
}

function findPathForObject(root, target) {
  if (!target) return "";
  for (const { row, path } of allObjectsWithPath(root)) {
    if (row === target) return pathToString(path);
  }
  return "";
}

function debugCatalogExtraction(menuData, catalog, extracted) {
  if (!QA_DEBUG_CATALOG) return;
  const sections = Array.isArray(catalog.builderCatalogV2 && catalog.builderCatalogV2.sections)
    ? catalog.builderCatalogV2.sections.map((item) => item && item.key).filter(Boolean)
    : [];
  console.log("DEBUG catalog section keys:", sections.join(", ") || "(none)");
  console.log("DEBUG standard_meal protein group:", catalog.standardProteinGroup ? `${catalog.standardProteinGroup.key || ""} options=${groupOptions(catalog.standardProteinGroup).length}` : "missing");
  console.log("DEBUG standard_meal carb group:", catalog.standardCarbGroup ? `${catalog.standardCarbGroup.key || ""} options=${groupOptions(catalog.standardCarbGroup).length}` : "missing");
  console.log("DEBUG premium_meal protein group:", catalog.premiumProteinGroup ? `${catalog.premiumProteinGroup.key || ""} options=${groupOptions(catalog.premiumProteinGroup).length}` : "missing");
  console.log("DEBUG sandwich products:", Array.isArray(catalog.sandwichSection && catalog.sandwichSection.products) ? catalog.sandwichSection.products.length : 0);
  console.log("DEBUG premium_large_salad protein group:", catalog.saladProteinGroup ? `${catalog.saladProteinGroup.key || ""} options=${groupOptions(catalog.saladProteinGroup).length}` : "missing");
  console.log("DEBUG premium_large_salad sauce group:", catalog.saladSauceGroup ? `${catalog.saladSauceGroup.key || ""} options=${groupOptions(catalog.saladSauceGroup).length}` : "missing");
  for (const [label, row] of Object.entries(extracted)) {
    console.log(`DEBUG extracted ${label}: ${describeFound(row)}${row ? ` path=${findPathForObject(menuData, row)}` : ""}`);
  }
}

function buildStandardSlot({ slotIndex = 1, protein, carb }) {
  return {
    slotIndex,
    slotKey: `slot_${slotIndex}`,
    selectionType: "standard_meal",
    proteinId: getId(protein),
    carbs: [{ carbId: getId(carb), grams: 150 }],
  };
}

function buildPremiumSlot({ slotIndex = 1, protein, carb }) {
  const id = getId(protein);
  const key = getKey(protein);
  return {
    slotIndex,
    slotKey: `slot_${slotIndex}`,
    selectionType: "premium_meal",
    proteinId: id,
    proteinKey: key || undefined,
    premiumKey: key || undefined,
    carbs: [{ carbId: getId(carb), grams: 150 }],
  };
}

function buildSandwichSlot({ slotIndex = 1, sandwich }) {
  return {
    slotIndex,
    slotKey: `slot_${slotIndex}`,
    selectionType: "sandwich",
    sandwichId: getId(sandwich),
  };
}

function buildSaladSlot({ slotIndex = 1, protein, sauce, extraGroups = {} }) {
  return {
    slotIndex,
    slotKey: `slot_${slotIndex}`,
    selectionType: "premium_large_salad",
    proteinId: getId(protein),
    salad: {
      groups: {
        protein: [getId(protein)],
        sauce: [getId(sauce)],
        ...extraGroups,
      },
    },
  };
}

function getErrorCode(json) {
  return String(
    (json && (json.code || json.errorCode))
      || (json && json.error && (json.error.code || json.error.errorCode))
      || ""
  );
}

function getErrorMessage(json) {
  return String(
    (json && json.message)
      || (json && json.error && json.error.message)
      || ""
  );
}

function getSlotErrors(json) {
  const error = json && json.error;
  const details = error && error.details;
  return []
    .concat(Array.isArray(json && json.slotErrors) ? json.slotErrors : [])
    .concat(Array.isArray(error && error.slotErrors) ? error.slotErrors : [])
    .concat(Array.isArray(details && details.slotErrors) ? details.slotErrors : []);
}

function responseCodes(json) {
  return new Set([getErrorCode(json), ...getSlotErrors(json).map((row) => String(row.code || ""))].filter(Boolean));
}

function isValidationSuccess(result) {
  return result && result.status === 200 && result.json && result.json.status === true && result.json.data;
}

function isActiveSubscription(sub) {
  return sub && String(sub.status || sub.subscriptionStatus || "").toLowerCase() === "active";
}

function dataArray(json) {
  const data = getData(json);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data && data.subscriptions)) return data.subscriptions;
  if (Array.isArray(data && data.items)) return data.items;
  if (data && typeof data === "object") return [data];
  return [];
}

async function verifySubscriptionAccess(subscriptionId) {
  const getRes = await requestJson("GET", `/api/subscriptions/${subscriptionId}`, { token: appToken, allowError: true });
  if (getRes.ok) {
    return { ok: true, subscription: getData(getRes.json) || null };
  }
  if (getRes.status === 403 || getRes.status === 404) {
    skip("subscription access", "APP_TOKEN does not own or cannot access SUBSCRIPTION_ID");
    skip("subscription access", "cannot validate with this APP_TOKEN; use token for subscription owner or create QA subscription.");
    return { ok: false };
  }

  const timelineRes = await requestJson("GET", `/api/subscriptions/${subscriptionId}/timeline`, { token: appToken, allowError: true });
  if (timelineRes.ok) {
    return { ok: true, subscription: null };
  }
  if (timelineRes.status === 403 || timelineRes.status === 404) {
    skip("subscription access", "APP_TOKEN does not own or cannot access SUBSCRIPTION_ID");
    skip("subscription access", "cannot validate with this APP_TOKEN; use token for subscription owner or create QA subscription.");
    return { ok: false };
  }

  warn("subscription access", `access preflight unclear: GET /subscriptions/:id HTTP ${getRes.status}, timeline HTTP ${timelineRes.status}`);
  return { ok: true, subscription: null };
}

async function discoverSubscription() {
  if (process.env.SUBSCRIPTION_ID) {
    pass("active subscription discovery", "using SUBSCRIPTION_ID env");
    return { id: process.env.SUBSCRIPTION_ID, subscription: null };
  }

  const list = await requestJson("GET", "/api/subscriptions", { token: appToken });
  let subscriptions = dataArray(list.json).filter((sub) => sub && getId(sub));
  let active = subscriptions.find(isActiveSubscription);

  if (!active) {
    const overview = await requestJson("GET", "/api/subscriptions/current/overview", { token: appToken, allowError: true });
    if (overview.ok && getData(overview.json) && getId(getData(overview.json))) {
      subscriptions = [getData(overview.json)];
      active = isActiveSubscription(subscriptions[0]) ? subscriptions[0] : null;
    }
  }

  if (!active) {
    skip("active subscription discovery", "No active subscription found; no validation POSTs will run");
    return null;
  }

  pass("active subscription discovery", `subscriptionId=${getId(active)}`);
  return { id: getId(active), subscription: active };
}

function canUseTimelineDay(day) {
  if (!day || !day.date) return false;
  const status = String(day.status || day.timelineStatus || "").toLowerCase();
  if (["locked", "delivered", "consumed_without_preparation", "delivery_canceled", "canceled_at_branch", "no_show", "frozen", "skipped"].includes(status)) return false;
  if (day.canEdit === false || day.canModify === false) return false;
  const max = Number(day.maxSlotCount ?? day.maxConsumableMealsNow ?? day.requiredMealCount ?? day.requiredMeals ?? 1);
  return !Number.isFinite(max) || max > 0;
}

async function discoverDayDate(subscriptionId) {
  if (process.env.DAY_DATE) {
    pass("day date discovery", "using DAY_DATE env");
    return process.env.DAY_DATE;
  }

  const timeline = await requestJson("GET", `/api/subscriptions/${subscriptionId}/timeline`, { token: appToken, allowError: true });
  if (!timeline.ok) {
    skip("day date discovery", `timeline unavailable HTTP ${timeline.status}`);
    return null;
  }

  const days = Array.isArray(getData(timeline.json) && getData(timeline.json).days) ? getData(timeline.json).days : [];
  const selected = days.find(canUseTimelineDay);
  if (!selected) {
    skip("day date discovery", "No clearly editable/open timeline day found");
    return null;
  }

  pass("day date discovery", `date=${selected.date}`);
  return selected.date;
}

async function validate(subscriptionId, dayDate, body) {
  return requestJson("POST", `/api/subscriptions/${subscriptionId}/days/${dayDate}/selection/validate`, {
    token: appToken,
    body,
    allowError: true,
  });
}

async function expectValid(label, subscriptionId, dayDate, payload, check) {
  const result = await validate(subscriptionId, dayDate, payload);
  if (!isValidationSuccess(result)) {
    fail(label, `HTTP ${result.status} ${getErrorCode(result.json) || getErrorMessage(result.json)}`);
    return null;
  }
  const detail = check ? check(result.json.data) : "";
  pass(label, detail);
  return result.json.data;
}

async function expectInvalid(label, subscriptionId, dayDate, payload, expectedCodes) {
  const result = await validate(subscriptionId, dayDate, payload);
  if (isValidationSuccess(result)) {
    fail(label, "validation unexpectedly succeeded");
    return;
  }

  const codes = responseCodes(result.json);
  const expected = new Set(expectedCodes);
  const matched = [...codes].some((code) => expected.has(code));
  if (matched || result.status === 422 || result.status === 400) {
    const codeText = [...codes].join(",") || getErrorCode(result.json) || `HTTP ${result.status}`;
    pass(label, codeText);
  } else {
    fail(label, `HTTP ${result.status} codes=${[...codes].join(",") || "none"}`);
  }
}

async function testLegacyExposure({
  label,
  keys,
  catalog,
  subscriptionId,
  dayDate,
  buildPayload,
  expectedCodes,
}) {
  const found = findByKey(catalog, keys);
  if (!found) {
    pass(label, "exposure blocked; legacy keys not present in planner catalog");
    return;
  }
  if (!isObjectId(getId(found))) {
    skip(label, "legacy key present but no ObjectId available for direct rejection test");
    return;
  }
  const result = await validate(subscriptionId, dayDate, buildPayload(found));
  if (isValidationSuccess(result)) {
    fail(label, `legacy key ${getKey(found)} unexpectedly validated`);
    return;
  }
  const codes = responseCodes(result.json);
  const matched = expectedCodes.some((code) => codes.has(code));
  if (matched || result.status === 422 || result.status === 400) {
    pass(label, `legacy key ${getKey(found)} rejected`);
  } else {
    fail(label, `legacy key ${getKey(found)} rejection unclear HTTP ${result.status}`);
  }
}

function hasJuiceEntitlement(subscription) {
  const candidates = []
    .concat(Array.isArray(subscription && subscription.addonSubscriptions) ? subscription.addonSubscriptions : [])
    .concat(Array.isArray(subscription && subscription.addonBalance) ? subscription.addonBalance : []);
  return candidates.some((row) => String(row && (row.category || row.categoryKey || row.addonCategory) || "") === "juice");
}

async function main() {
  if (process.env.QA_ALLOW_VALIDATION_POST !== "true") {
    console.error("Refusing to run: set QA_ALLOW_VALIDATION_POST=true to allow validation-only POST requests.");
    process.exitCode = 2;
    return;
  }

  if (!appToken) appToken = await promptSecret("APP_TOKEN");
  if (!appToken) {
    console.error("APP_TOKEN is required.");
    process.exitCode = 2;
    return;
  }

  console.log(`Base URL: ${BASE_URL}`);

  const discovered = await discoverSubscription();
  if (!discovered) {
    skip("day date discovery", "No active subscription");
    console.log(`SUMMARY failures=${failures} warnings=${warnings} skips=${skips}`);
    return;
  }

  if (process.env.SUBSCRIPTION_ID) {
    const access = await verifySubscriptionAccess(discovered.id);
    if (!access.ok) {
      console.log(`SUMMARY failures=${failures} warnings=${warnings} skips=${skips}`);
      return;
    }
    if (access.subscription) discovered.subscription = access.subscription;
  }

  const dayDate = await discoverDayDate(discovered.id);
  if (!dayDate) {
    console.log(`SUMMARY failures=${failures} warnings=${warnings} skips=${skips}`);
    return;
  }

  const menu = await requestJson("GET", "/api/subscriptions/meal-planner-menu?includeLegacy=true&lang=en");
  const menuData = getData(menu.json);
  const catalog = extractCatalog(menuData);
  if (!catalog.builderCatalogV2 || !Array.isArray(catalog.builderCatalogV2.sections)) {
    fail("planner catalog", "missing data.builderCatalogV2.sections");
    console.log(`SUMMARY failures=${failures} warnings=${warnings} skips=${skips}`);
    return;
  }

  const standardProteinOptions = groupOptions(catalog.standardProteinGroup);
  const standardCarbOptions = groupOptions(catalog.standardCarbGroup);
  const premiumProteinOptions = groupOptions(catalog.premiumProteinGroup);
  const premiumCarbOptions = groupOptions(catalog.premiumCarbGroup);
  const saladProteinOptions = groupOptions(catalog.saladProteinGroup);
  const saladSauceOptions = groupOptions(catalog.saladSauceGroup);
  const extraProteinOptions = groupOptions(catalog.saladExtraProteinGroup);

  const standardProtein = findOptionByKeys(standardProteinOptions, ["chicken"])
    || findAnyOption(standardProteinOptions);
  const standardCarb = findOptionByKeys(standardCarbOptions, ["white_rice"])
    || findAnyOption(standardCarbOptions);
  const premiumCarb = findOptionByKeys(premiumCarbOptions, ["white_rice"])
    || findAnyOption(premiumCarbOptions)
    || standardCarb;
  const forbiddenSaladPremiumProteins = new Map();
  for (const key of FORBIDDEN_SALAD_PREMIUM_PROTEIN_KEYS) {
    forbiddenSaladPremiumProteins.set(
      key,
      findOptionByKeys(premiumProteinOptions, [key])
        || findOptionByKeys(catalog.premiumSection, [key])
    );
  }
  const beefSteak = forbiddenSaladPremiumProteins.get("beef_steak");
  const sandwich = findOptionByKeys(catalog.sandwichSection && catalog.sandwichSection.products, SANDWICH_KEYS);
  const saladAllowedProtein = findOptionByKeys(saladProteinOptions, ALLOWED_SALAD_PROTEIN_KEYS)
    || findAnyOption(saladProteinOptions);
  const saladSauce = findAnyOption(saladSauceOptions);
  const shrimp = forbiddenSaladPremiumProteins.get("shrimp");
  const salmon = forbiddenSaladPremiumProteins.get("salmon");
  const meatballs = forbiddenSaladPremiumProteins.get("meatballs");
  const beefStroganoff = forbiddenSaladPremiumProteins.get("beef_stroganoff");
  const extraProteinOption = findOptionByKeys(extraProteinOptions, ["extra_protein_50g"])
    || findAnyOption(extraProteinOptions);

  debugCatalogExtraction(menuData, catalog, {
    standardProtein,
    standardCarb,
    beefSteak,
    shrimp,
    salmon,
    meatballs,
    beefStroganoff,
    sandwich,
    saladAllowedProtein,
    saladSauce,
    extraProteinOption,
  });

  if (standardProtein && standardCarb) {
    await expectValid("standard_meal valid", discovered.id, dayDate, {
      mealSlots: [buildStandardSlot({ protein: standardProtein, carb: standardCarb })],
    });
  } else if (!catalog.standardSection) {
    fail("standard_meal valid", "standard_meal section missing from builderCatalogV2");
  } else {
    skip("standard_meal valid", "could not locate standard protein/carb id in builderCatalogV2; run with QA_DEBUG_CATALOG=true.");
  }

  if (beefSteak && premiumCarb) {
    await expectValid("premium_meal valid", discovered.id, dayDate, {
      mealSlots: [buildPremiumSlot({ protein: beefSteak, carb: premiumCarb })],
    }, (data) => {
      const slot = Array.isArray(data.mealSlots) ? data.mealSlots[0] : null;
      const fee = Number(slot && slot.premiumExtraFeeHalala);
      return fee === 2000 ? "premiumExtraFeeHalala=2000" : "";
    });
  } else if (!catalog.premiumSection) {
    fail("premium_meal valid", "premium_meal section missing from builderCatalogV2");
  } else {
    skip("premium_meal valid", "could not locate beef_steak/carb id in builderCatalogV2; run with QA_DEBUG_CATALOG=true.");
  }

  if (sandwich) {
    await expectValid("sandwich valid", discovered.id, dayDate, {
      mealSlots: [buildSandwichSlot({ sandwich })],
    });
  } else if (!catalog.sandwichSection) {
    fail("sandwich valid", "sandwich section missing from builderCatalogV2");
  } else {
    skip("sandwich valid", "could not locate allowed sandwich id in builderCatalogV2; run with QA_DEBUG_CATALOG=true.");
  }

  if (saladAllowedProtein && saladSauce) {
    await expectValid("premium_large_salad valid", discovered.id, dayDate, {
      mealSlots: [buildSaladSlot({ protein: saladAllowedProtein, sauce: saladSauce })],
    });
  } else if (!catalog.saladSection) {
    fail("premium_large_salad valid", "premium_large_salad section missing from builderCatalogV2");
  } else {
    skip("premium_large_salad valid", "could not locate allowed salad protein/sauce id in builderCatalogV2; run with QA_DEBUG_CATALOG=true.");
  }

  if (beefSteak && saladSauce) {
    await expectInvalid("premium_large_salad rejects beef_steak", discovered.id, dayDate, {
      mealSlots: [buildSaladSlot({ protein: beefSteak, sauce: saladSauce })],
    }, ["SALAD_PROTEIN_NOT_ALLOWED"]);
  } else {
    skip("premium_large_salad rejects beef_steak", "missing beef_steak or sauce ID");
  }

  if (shrimp && saladSauce) {
    await expectInvalid("premium_large_salad rejects shrimp", discovered.id, dayDate, {
      mealSlots: [buildSaladSlot({ protein: shrimp, sauce: saladSauce })],
    }, ["SALAD_PROTEIN_NOT_ALLOWED"]);
  } else {
    skip("premium_large_salad rejects shrimp", "missing shrimp or sauce ID");
  }

  if (salmon && saladSauce) {
    await expectInvalid("premium_large_salad rejects salmon", discovered.id, dayDate, {
      mealSlots: [buildSaladSlot({ protein: salmon, sauce: saladSauce })],
    }, ["SALAD_PROTEIN_NOT_ALLOWED"]);
  } else {
    skip("premium_large_salad rejects salmon", "missing salmon or sauce ID");
  }

  if (meatballs && saladSauce) {
    await expectInvalid("premium_large_salad rejects meatballs", discovered.id, dayDate, {
      mealSlots: [buildSaladSlot({ protein: meatballs, sauce: saladSauce })],
    }, ["SALAD_PROTEIN_NOT_ALLOWED"]);
  } else {
    skip("premium_large_salad rejects meatballs", "missing meatballs or sauce ID");
  }

  if (beefStroganoff && saladSauce) {
    await expectInvalid("premium_large_salad rejects beef_stroganoff", discovered.id, dayDate, {
      mealSlots: [buildSaladSlot({ protein: beefStroganoff, sauce: saladSauce })],
    }, ["SALAD_PROTEIN_NOT_ALLOWED"]);
  } else {
    skip("premium_large_salad rejects beef_stroganoff", "missing beef_stroganoff or sauce ID");
  }

  if (saladAllowedProtein && saladSauce) {
    const extraProteinId = extraProteinOption ? getId(extraProteinOption) : getId(saladAllowedProtein);
    await expectInvalid("premium_large_salad rejects extra_protein_50g", discovered.id, dayDate, {
      mealSlots: [
        buildSaladSlot({
          protein: saladAllowedProtein,
          sauce: saladSauce,
          extraGroups: { extra_protein_50g: [extraProteinId] },
        }),
      ],
    }, ["SALAD_OPTION_NOT_ALLOWED"]);
  } else {
    skip("premium_large_salad rejects extra_protein_50g", "missing base salad protein or sauce ID");
  }

  if (standardProtein) {
    await testLegacyExposure({
      label: "legacy carbs exposure/rejection",
      keys: LEGACY_CARB_KEYS,
      catalog: menuData,
      subscriptionId: discovered.id,
      dayDate,
      buildPayload: (legacyCarb) => ({
        mealSlots: [buildStandardSlot({ protein: standardProtein, carb: legacyCarb })],
      }),
      expectedCodes: ["INVALID_CARB_ID"],
    });
  } else {
    skip("legacy carbs exposure/rejection", "missing standard protein for direct rejection test");
  }

  await testLegacyExposure({
    label: "legacy sandwich exposure/rejection",
    keys: LEGACY_SANDWICH_KEYS,
    catalog: menuData,
    subscriptionId: discovered.id,
    dayDate,
    buildPayload: (legacySandwich) => ({
      mealSlots: [buildSandwichSlot({ sandwich: legacySandwich })],
    }),
    expectedCodes: ["INVALID_SANDWICH_MEAL"],
  });

  if (standardProtein && standardCarb) {
    const juiceChoices = await requestJson("GET", "/api/subscriptions/addon-choices?category=juice&lang=en", { allowError: true });
    const choices = getData(juiceChoices.json) && getData(juiceChoices.json).juice && Array.isArray(getData(juiceChoices.json).juice.choices)
      ? getData(juiceChoices.json).juice.choices
      : [];
    const juice = choices.find((item) => isObjectId(getId(item)));
    if (!juice) {
      skip("daily addon MenuProduct selection", "No juice MenuProduct choice available");
    } else if (discovered.subscription && !hasJuiceEntitlement(discovered.subscription)) {
      skip("daily addon MenuProduct selection", "No matching entitlement on active subscription");
    } else {
      const result = await validate(discovered.id, dayDate, {
        mealSlots: [buildStandardSlot({ protein: standardProtein, carb: standardCarb })],
        addonsOneTime: [getId(juice)],
      });
      if (!isValidationSuccess(result)) {
        fail("daily addon MenuProduct selection", `HTTP ${result.status} ${getErrorCode(result.json) || getErrorMessage(result.json)}`);
      } else {
        const addonSelections = Array.isArray(result.json.data && result.json.data.addonSelections)
          ? result.json.data.addonSelections
          : [];
        const selected = addonSelections.find((row) => String(row.addonId) === getId(juice));
        if (!selected) {
          fail("daily addon MenuProduct selection", "validation succeeded but selected juice was not echoed");
        } else if (selected.source === "subscription") {
          pass("daily addon MenuProduct selection", "MenuProduct id accepted and covered by subscription entitlement");
        } else {
          skip("daily addon MenuProduct selection", "No matching entitlement on active subscription");
        }
      }
    }
  } else {
    skip("daily addon MenuProduct selection", "missing standard slot data for addon validation");
  }

  console.log(`SUMMARY failures=${failures} warnings=${warnings} skips=${skips}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  fail("script runtime", err.message);
  console.log(`SUMMARY failures=${failures} warnings=${warnings} skips=${skips}`);
  process.exitCode = 1;
});
