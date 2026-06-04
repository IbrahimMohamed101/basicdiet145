#!/usr/bin/env node
"use strict";

const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { execFileSync } = require("node:child_process");

const BASE_URL = String(process.env.BASE_URL || "https://basicdiet145.onrender.com").replace(/\/+$/, "");
const EXPECTED_PLAN_KEY = "subscription_7_days";
const EXPECTED_GRAMS = 100;
const EXPECTED_MEALS_PER_DAY = 1;
const EXPECTED_BASE_PRICE_HALALA = 13800;

let failures = 0;
let warnings = 0;
let appToken = process.env.APP_TOKEN || "";
let dashboardToken = process.env.DASHBOARD_TOKEN || "";

function pass(message) {
  console.log(`PASS  ${message}`);
}

function fail(message) {
  failures += 1;
  console.log(`FAIL  ${message}`);
}

function warn(message) {
  warnings += 1;
  console.log(`WARN  ${message}`);
}

function skip(message) {
  console.log(`SKIP  ${message}`);
}

async function promptSecret(name) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    stdout.write(`Enter ${name}. It will not be printed:\n`);
    try {
      execFileSync("stty", ["-echo"], { stdio: ["inherit", "ignore", "ignore"] });
    } catch (_err) {
      warn(`Could not disable terminal echo while reading ${name}; set ${name} in the environment to avoid prompting`);
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

async function requestJson(method, path, { token, body } = {}) {
  const headers = {
    Accept: "application/json",
    ...(token ? authHeader(token) : {}),
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

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
    throw new Error(`${method} ${path} returned non-JSON response with HTTP ${response.status}`);
  }

  if (!response.ok) {
    const code = json && (json.code || json.errorCode) ? ` ${json.code || json.errorCode}` : "";
    const message = json && json.message ? `: ${json.message}` : "";
    throw new Error(`${method} ${path} failed with HTTP ${response.status}${code}${message}`);
  }

  return json;
}

function dataArray(json) {
  const data = json && json.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data && data.items)) return data.items;
  if (Array.isArray(data && data.plans)) return data.plans;
  return [];
}

function getId(row) {
  return String(row.id || row._id || row.planId || row.addonId || "");
}

function getPlanKey(plan) {
  return plan.key || plan.code || plan.slug || plan.planKey;
}

function getGramsRows(plan) {
  return plan.gramsOptions || plan.weightOptions || [];
}

function getMealRows(gramsRow) {
  return gramsRow.mealsOptions || gramsRow.mealOptions || gramsRow.options || [];
}

function getGrams(row) {
  return Number(row.grams ?? row.weightGrams ?? row.value ?? row.gram);
}

function getMeals(row) {
  return Number(row.mealsPerDay ?? row.meals ?? row.count ?? row.value);
}

function getPriceHalala(row) {
  if (row.priceHalala != null) return Number(row.priceHalala);
  if (row.price != null) return Number(row.price);
  if (row.priceSar != null) return Math.round(Number(row.priceSar) * 100);
  return NaN;
}

function futureDate(daysFromNow = 3) {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function computeInclusiveVat(totalHalala, vatPercentage = 15) {
  const total = Math.max(0, Math.round(Number(totalHalala || 0)));
  const divisor = 1 + Number(vatPercentage || 0) / 100;
  const subtotalBeforeVatHalala = divisor > 0 ? Math.round(total / divisor) : total;
  return {
    subtotalBeforeVatHalala,
    vatHalala: total - subtotalBeforeVatHalala,
    totalHalala: total,
  };
}

function assertBreakdownMath(label, breakdown, expectedTotalHalala) {
  const totalHalala = Number(breakdown.totalHalala);
  const subtotalBeforeVatHalala = Number(breakdown.subtotalBeforeVatHalala ?? breakdown.subtotalHalala);
  const vatHalala = Number(breakdown.vatHalala);
  const vatPercentage = Number(breakdown.vatPercentage || 15);
  const expectedVat = computeInclusiveVat(expectedTotalHalala, vatPercentage);

  if (totalHalala === expectedTotalHalala) pass(`${label} totalHalala=${expectedTotalHalala}`);
  else fail(`${label} expected totalHalala=${expectedTotalHalala}, got ${totalHalala}`);

  if (subtotalBeforeVatHalala === expectedVat.subtotalBeforeVatHalala && vatHalala === expectedVat.vatHalala) {
    pass(`${label} VAT inclusive calculation`);
  } else {
    fail(`${label} expected subtotalBeforeVatHalala=${expectedVat.subtotalBeforeVatHalala}, vatHalala=${expectedVat.vatHalala}; got subtotalBeforeVatHalala=${subtotalBeforeVatHalala}, vatHalala=${vatHalala}`);
  }

  if (subtotalBeforeVatHalala + vatHalala === totalHalala) {
    pass(`${label} subtotalBeforeVat + vat == total`);
  } else {
    fail(`${label} subtotalBeforeVat + vat != total`);
  }
}

function buildQuotePayload(planId, promoCode = null, addons = []) {
  return {
    planId,
    grams: EXPECTED_GRAMS,
    mealsPerDay: EXPECTED_MEALS_PER_DAY,
    startDate: futureDate(),
    deliveryMode: "pickup",
    addons,
    ...(promoCode ? { promoCode } : {}),
  };
}

async function quote(planId, promoCode = null, addons = []) {
  const json = await requestJson("POST", "/api/subscriptions/quote", {
    token: appToken,
    body: buildQuotePayload(planId, promoCode, addons),
  });
  if (!json || json.status !== true || !json.data || !json.data.breakdown) {
    throw new Error("Quote response missing status=true or data.breakdown");
  }
  return json.data;
}

function buildPromoPayload({ code, discountType, discountValue, maxDiscountAmountHalala = null }) {
  const now = Date.now();
  return {
    code,
    title: code,
    name: { en: code, ar: code },
    description: `QA temporary subscription quote promo created by qa-subscription-quote-promo-vat.js`,
    isActive: true,
    appliesTo: "subscription",
    discountType,
    discountValue,
    ...(maxDiscountAmountHalala == null ? {} : { maxDiscountAmountHalala }),
    usageLimitTotal: 3,
    usageLimitPerUser: 3,
    startsAt: new Date(now - 60 * 1000).toISOString(),
    expiresAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    currency: "SAR",
    metadata: {
      qa: true,
      source: "qa-subscription-quote-promo-vat",
      createdFor: "subscription quote promo VAT QA",
    },
  };
}

async function createPromo(payload) {
  const json = await requestJson("POST", "/api/dashboard/promo-codes", {
    token: dashboardToken,
    body: payload,
  });
  const promo = json && json.data;
  if (!json || json.status !== true || !promo || !promo.id || promo.code !== payload.code) {
    throw new Error(`Create promo returned unexpected response for ${payload.code}`);
  }
  return promo;
}

async function disablePromo(promo) {
  if (!promo || !promo.id) return false;
  const latestJson = await requestJson("GET", `/api/dashboard/promo-codes/${promo.id}`, {
    token: dashboardToken,
  });
  const latest = latestJson && latestJson.data;
  if (!latest || latest.code !== promo.code) {
    throw new Error(`Cleanup refused: promo id ${promo.id} did not resolve to expected QA code`);
  }
  if (!String(latest.code || "").startsWith("QA_SUB_")) {
    throw new Error(`Cleanup refused: promo ${latest.code} is not QA_SUB_*`);
  }
  if (latest.isActive === false) {
    return true;
  }

  const toggledJson = await requestJson("PATCH", `/api/dashboard/promo-codes/${promo.id}/toggle`, {
    token: dashboardToken,
  });
  const toggled = toggledJson && toggledJson.data;
  return Boolean(toggled && toggled.code === promo.code && toggled.isActive === false);
}

async function main() {
  console.log("Subscription quote + promo + VAT QA");
  console.log(`Base URL: ${BASE_URL}`);
  console.log("Writes allowed: QA promo code create + disable only");
  console.log("");

  if (process.env.QA_ALLOW_WRITES !== "true") {
    fail("Refusing to run: QA_ALLOW_WRITES must be exactly true");
    console.log("");
    console.log(`SUMMARY failures=${failures} warnings=${warnings}`);
    process.exitCode = 1;
    return;
  }

  if (!appToken) appToken = await promptSecret("APP_TOKEN");
  if (!dashboardToken) dashboardToken = await promptSecret("DASHBOARD_TOKEN");
  if (!appToken || !dashboardToken) {
    fail("APP_TOKEN and DASHBOARD_TOKEN are required");
    console.log("");
    console.log(`SUMMARY failures=${failures} warnings=${warnings}`);
    process.exitCode = 1;
    return;
  }

  const createdPromos = [];
  try {
    const plansJson = await requestJson("GET", "/api/plans", { token: appToken });
    const plans = dataArray(plansJson);
    const plan = plans.find((item) => getPlanKey(item) === EXPECTED_PLAN_KEY);
    if (!plan) {
      fail(`GET /api/plans missing ${EXPECTED_PLAN_KEY}`);
      throw new Error("Cannot continue without canonical plan");
    }

    const gramsRow = getGramsRows(plan).find((row) => getGrams(row) === EXPECTED_GRAMS);
    const mealRow = gramsRow ? getMealRows(gramsRow).find((row) => getMeals(row) === EXPECTED_MEALS_PER_DAY) : null;
    const basePlanPriceHalala = mealRow ? getPriceHalala(mealRow) : NaN;
    const planId = getId(plan);

    if (planId) pass(`Resolved ${EXPECTED_PLAN_KEY} plan id`);
    else {
      fail(`${EXPECTED_PLAN_KEY} missing id`);
      throw new Error("Cannot continue without plan id");
    }

    if (basePlanPriceHalala === EXPECTED_BASE_PRICE_HALALA) pass("Canonical 7-day 100g 1-meal price is 13800 halala");
    else {
      fail(`Expected basePlanPriceHalala=${EXPECTED_BASE_PRICE_HALALA}, got ${basePlanPriceHalala}`);
      throw new Error("Cannot continue with unexpected base plan price");
    }

    const fixedCode = `QA_SUB_FIXED_10_${Date.now()}`;
    const percentCode = `QA_SUB_PERCENT_10_${Date.now()}`;

    const fixedPromo = await createPromo(buildPromoPayload({
      code: fixedCode,
      discountType: "fixed",
      discountValue: 1000,
    }));
    createdPromos.push(fixedPromo);
    pass("Created fixed QA promo code");

    const percentPromo = await createPromo(buildPromoPayload({
      code: percentCode,
      discountType: "percentage",
      discountValue: 10,
      maxDiscountAmountHalala: 1500,
    }));
    createdPromos.push(percentPromo);
    pass("Created percentage QA promo code");

    const quoteWithoutPromo = await quote(planId);
    const withoutPromoBreakdown = quoteWithoutPromo.breakdown;
    if (Number(withoutPromoBreakdown.basePlanPriceHalala) === EXPECTED_BASE_PRICE_HALALA) {
      pass("Subscription quote without promo basePlanPriceHalala");
    } else {
      fail(`Subscription quote without promo expected basePlanPriceHalala=${EXPECTED_BASE_PRICE_HALALA}, got ${withoutPromoBreakdown.basePlanPriceHalala}`);
    }
    if (withoutPromoBreakdown.currency === "SAR") pass("Subscription quote without promo currency SAR");
    else fail(`Subscription quote without promo expected currency SAR, got ${withoutPromoBreakdown.currency}`);
    assertBreakdownMath("Subscription quote without promo", withoutPromoBreakdown, Number(withoutPromoBreakdown.grossTotalHalala));

    const grossTotal = Number(withoutPromoBreakdown.grossTotalHalala);
    const fixedQuote = await quote(planId, fixedCode);
    const fixedExpectedTotal = Math.max(0, grossTotal - 1000);
    const fixedPromoBlock = fixedQuote.promoCode || {};
    if (Number(fixedPromoBlock.discountAmountHalala) === 1000) pass("Fixed promo discount");
    else fail(`Fixed promo expected discountAmountHalala=1000, got ${fixedPromoBlock.discountAmountHalala}`);
    assertBreakdownMath("Fixed promo quote", fixedQuote.breakdown, fixedExpectedTotal);

    const percentQuote = await quote(planId, percentCode);
    const expectedPercentDiscount = Math.min(Math.round(grossTotal * 0.10), 1500);
    const percentExpectedTotal = Math.max(0, grossTotal - expectedPercentDiscount);
    const percentPromoBlock = percentQuote.promoCode || {};
    if (Number(percentPromoBlock.discountAmountHalala) === expectedPercentDiscount) pass("Percentage promo discount");
    else fail(`Percentage promo expected discountAmountHalala=${expectedPercentDiscount}, got ${percentPromoBlock.discountAmountHalala}`);
    assertBreakdownMath("Percentage promo quote", percentQuote.breakdown, percentExpectedTotal);

    const addonsJson = await requestJson("GET", "/api/addons?type=subscription");
    const addonRows = dataArray(addonsJson);
    const addonIds = ["juice", "snack"]
      .map((category) => addonRows.find((row) => row.category === category && row.kind === "plan"))
      .filter(Boolean)
      .map(getId)
      .filter(Boolean);

    if (addonIds.length < 2) {
      skip("Add-ons quote with promo: missing juice/snack subscription add-on plan ids");
    } else {
      const addonQuoteWithoutPromo = await quote(planId, null, addonIds);
      const addonGross = Number(addonQuoteWithoutPromo.breakdown.grossTotalHalala);
      const addonsTotal = Number(addonQuoteWithoutPromo.breakdown.addonsTotalHalala || 0);
      if (addonsTotal > 0 && addonGross === EXPECTED_BASE_PRICE_HALALA + addonsTotal) {
        pass("Add-ons quote gross includes add-ons");
      } else {
        fail(`Add-ons quote expected gross=${EXPECTED_BASE_PRICE_HALALA}+addonsTotal, got gross=${addonGross}, addonsTotal=${addonsTotal}`);
      }

      const addonQuoteWithPromo = await quote(planId, fixedCode, addonIds);
      const expectedAddonDiscountedTotal = Math.max(0, addonGross - 1000);
      if (Number(addonQuoteWithPromo.breakdown.addonsTotalHalala || 0) === addonsTotal) {
        pass("Add-ons quote with promo preserves addonsTotalHalala");
      } else {
        fail("Add-ons quote with promo changed addonsTotalHalala unexpectedly");
      }
      assertBreakdownMath("Add-ons quote with promo", addonQuoteWithPromo.breakdown, expectedAddonDiscountedTotal);
      pass("Add-ons quote with promo");
    }
  } catch (err) {
    fail(err.message);
  } finally {
    for (const promo of createdPromos) {
      try {
        const disabled = await disablePromo(promo);
        if (disabled) pass(`Promo cleanup/disable ${promo.code}`);
        else fail(`Promo cleanup/disable ${promo.code}`);
      } catch (err) {
        fail(`Promo cleanup/disable ${promo.code}`);
        warn(`Promo code ${promo.code} may still be active and needs manual disable: ${err.message}`);
      }
    }
  }

  console.log("");
  console.log(`SUMMARY failures=${failures} warnings=${warnings}`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  fail(err.message);
  console.log("");
  console.log(`SUMMARY failures=${failures} warnings=${warnings}`);
  process.exitCode = 1;
});
