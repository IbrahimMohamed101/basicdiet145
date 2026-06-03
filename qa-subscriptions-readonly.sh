#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://basicdiet145.onrender.com}"
OUT_DIR="${OUT_DIR:-/tmp/basicdiet145-subscriptions-qa}"

mkdir -p "$OUT_DIR"

if [ -z "${APP_TOKEN:-}" ]; then
  echo "Enter APP_TOKEN. It will not be printed:"
  read -r -s APP_TOKEN
  echo
fi

APP_AUTH_HEADER="Authorization: Bearer ${APP_TOKEN}"

echo "QA output dir: $OUT_DIR"
echo "Base URL: $BASE_URL"
echo

fetch_public() {
  local name="$1"
  local url="$2"
  echo "GET $url"
  curl -fsS "$url" > "$OUT_DIR/$name.json"
  echo "saved: $OUT_DIR/$name.json"
}

fetch_auth() {
  local name="$1"
  local url="$2"
  echo "GET $url"
  curl -fsS -H "$APP_AUTH_HEADER" "$url" > "$OUT_DIR/$name.json"
  echo "saved: $OUT_DIR/$name.json"
}

echo "== Fetching public read-only endpoints =="
fetch_public "addons_subscription" "$BASE_URL/api/addons?type=subscription"
fetch_public "addon_choices_all" "$BASE_URL/api/subscriptions/addon-choices"
fetch_public "addon_choices_juice" "$BASE_URL/api/subscriptions/addon-choices?category=juice"
fetch_public "addon_choices_snack" "$BASE_URL/api/subscriptions/addon-choices?category=snack"
fetch_public "addon_choices_small_salad" "$BASE_URL/api/subscriptions/addon-choices?category=small_salad"
fetch_public "meal_planner_ar" "$BASE_URL/api/subscriptions/meal-planner-menu?includeLegacy=true&lang=ar"
fetch_public "meal_planner_en" "$BASE_URL/api/subscriptions/meal-planner-menu?includeLegacy=true&lang=en"

echo
echo "== Fetching authenticated read-only endpoints =="
fetch_auth "plans" "$BASE_URL/api/plans"

echo
echo "== Verifying responses =="
node <<'NODE'
const fs = require("fs");
const path = require("path");

const OUT_DIR = process.env.OUT_DIR || "/tmp/basicdiet145-subscriptions-qa";

let failures = 0;
let warnings = 0;

function readJson(name) {
  const p = path.join(OUT_DIR, `${name}.json`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function pass(msg) {
  console.log(`PASS  ${msg}`);
}

function fail(msg) {
  failures += 1;
  console.log(`FAIL  ${msg}`);
}

function warn(msg) {
  warnings += 1;
  console.log(`WARN  ${msg}`);
}

function getData(json) {
  return json && typeof json === "object" ? json.data : undefined;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.plans)) return value.plans;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function collectKeys(value, out = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (
        ["key", "category", "categoryKey", "sectionKey", "selectionType", "premiumKey", "productKey", "proteinKey", "carbKey", "sandwichKey", "groupKey"].includes(k)
        && typeof v === "string"
      ) {
        out.add(v);
      }
      collectKeys(v, out);
    }
  }
  return out;
}

function sectionByKey(sections, key) {
  if (!sections) return undefined;
  if (!Array.isArray(sections) && typeof sections === "object") {
    return sections[key] || Object.values(sections).find((s) => s?.key === key || s?.sectionKey === key || s?.type === key);
  }
  if (Array.isArray(sections)) {
    return sections.find((s) => s?.key === key || s?.sectionKey === key || s?.type === key);
  }
  return undefined;
}

function findNumbersNearKey(value, targetKey, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) findNumbersNearKey(item, targetKey, out);
    return out;
  }
  if (value && typeof value === "object") {
    const values = Object.values(value);
    const hasTarget = values.includes(targetKey) || value.key === targetKey || value.premiumKey === targetKey;
    if (hasTarget) out.push(value);
    for (const item of values) findNumbersNearKey(item, targetKey, out);
  }
  return out;
}

function getPlanKey(plan) {
  return plan.key || plan.code || plan.slug || plan.planKey;
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

function getGramsRows(plan) {
  return plan.gramsOptions || plan.weightOptions || [];
}

function getMealRows(gramsRow) {
  return gramsRow.mealsOptions || gramsRow.mealOptions || gramsRow.options || [];
}

// 1) Addons subscription plans
{
  const json = readJson("addons_subscription");
  const rows = asArray(getData(json));
  const categories = rows.map((x) => x.category).sort();

  const expected = ["juice", "small_salad", "snack"].sort();
  const okCats = JSON.stringify(categories) === JSON.stringify(expected);

  if (rows.length === 3 && okCats) pass("GET /api/addons?type=subscription returns exactly juice/snack/small_salad plans");
  else fail(`subscription addons expected [juice,snack,small_salad], got ${JSON.stringify(categories)}`);

  for (const row of rows) {
    if (row.kind === "plan" && row.type === "subscription") pass(`subscription addon ${row.category} has kind=plan/type=subscription`);
    else fail(`subscription addon ${row.category} has wrong kind/type: kind=${row.kind}, type=${row.type}`);
  }
}

// 2) Addon choices
{
  const json = readJson("addon_choices_all");
  const data = getData(json) || {};
  const expectedGroups = ["juice", "snack", "small_salad"];

  for (const group of expectedGroups) {
    if (data[group]) pass(`addon choices includes group ${group}`);
    else fail(`addon choices missing group ${group}`);
  }

  const groupChecks = [
    ["juice", ["juices", "drinks"]],
    ["snack", ["desserts"]],
    ["small_salad", ["light_options"]],
  ];

  for (const [group, expectedSources] of groupChecks) {
    const entry = data[group];
    if (!entry) continue;

    const sources = entry.sourceCategories || [];
    for (const src of expectedSources) {
      if (sources.includes(src)) pass(`${group} sourceCategories includes ${src}`);
      else fail(`${group} sourceCategories missing ${src}`);
    }

    const choices = entry.choices || [];
    if (choices.length > 0) pass(`${group} has ${choices.length} daily choices`);
    else warn(`${group} has no daily choices`);

    for (const choice of choices) {
      if (choice.type === "menu_product") pass(`${group} choice ${choice.key || choice.name} is MenuProduct`);
      else fail(`${group} choice ${choice.key || choice.name} is not menu_product: type=${choice.type}`);

      if (choice.kind === "plan" || choice.type === "subscription") {
        fail(`${group} daily choices must not include subscription plan rows: ${choice.key || choice.name}`);
      }

      if (choice.calories == null || choice.prepTimeMinutes == null) {
        warn(`${group} choice ${choice.key || choice.name} has calories/prepTimeMinutes null`);
      }
    }
  }
}

// 3) Plans/prices
{
  const json = readJson("plans");
  const plans = asArray(getData(json));

  const expectedPlanKeys = ["subscription_7_days", "subscription_26_days", "subscription_30_days"];
  const actualKeys = plans.map(getPlanKey).filter(Boolean).sort();

  const extraKeys = actualKeys.filter((k) => !expectedPlanKeys.includes(k));
  const missingKeys = expectedPlanKeys.filter((k) => !actualKeys.includes(k));

  if (missingKeys.length === 0 && extraKeys.length === 0 && actualKeys.length === 3) {
    pass("GET /api/plans returns exactly 3 canonical plans");
  } else {
    fail(`plans mismatch. actual=${JSON.stringify(actualKeys)}, missing=${JSON.stringify(missingKeys)}, extra=${JSON.stringify(extraKeys)}`);
  }

  const expectedSar = {
    subscription_7_days: {
      100: [138, 276, 414, 552, 690],
      150: [174, 348, 522, 696, 870],
      200: [210, 420, 630, 840, 1050],
    },
    subscription_26_days: {
      100: [516, 935, 1355, 1806, 2257],
      150: [659, 1186, 1732, 2309, 2886],
      200: [750, 1421, 2012, 2683, 3354],
    },
    subscription_30_days: {
      100: [587, 1079, 1511, 2014, 2518],
      150: [720, 1331, 1943, 2590, 3238],
      200: [828, 1619, 2279, 3038, 3798],
    },
  };

  let checkedPrices = 0;

  for (const planKey of expectedPlanKeys) {
    const plan = plans.find((p) => getPlanKey(p) === planKey);
    if (!plan) continue;

    const gramsRows = getGramsRows(plan);
    for (const grams of [100, 150, 200]) {
      const gramsRow = gramsRows.find((r) => getGrams(r) === grams);
      if (!gramsRow) {
        fail(`${planKey} missing grams ${grams}`);
        continue;
      }

      const mealRows = getMealRows(gramsRow);
      for (let mealIndex = 0; mealIndex < 5; mealIndex++) {
        const mealsPerDay = mealIndex + 1;
        const expectedHalala = expectedSar[planKey][grams][mealIndex] * 100;
        const mealRow = mealRows.find((r) => getMeals(r) === mealsPerDay);

        if (!mealRow) {
          fail(`${planKey} ${grams}g missing ${mealsPerDay} meals/day`);
          continue;
        }

        const actualHalala = getPriceHalala(mealRow);
        if (actualHalala === expectedHalala) {
          checkedPrices += 1;
        } else {
          fail(`${planKey} ${grams}g ${mealsPerDay} meals/day expected ${expectedHalala}, got ${actualHalala}`);
        }
      }
    }
  }

  if (checkedPrices === 45) pass("All 45 subscription price points match expected matrix");
  else fail(`Expected 45 price points, checked ${checkedPrices}`);
}

// 4) Meal planner sections and key restrictions
for (const lang of ["ar", "en"]) {
  const json = readJson(`meal_planner_${lang}`);
  const data = getData(json) || {};
  const sections = data.builderCatalogV2?.sections;

  if (!sections) {
    fail(`meal planner ${lang} missing data.builderCatalogV2.sections`);
    continue;
  }

  const requiredSections = ["standard_meal", "premium_meal", "sandwich", "premium_large_salad"];
  for (const key of requiredSections) {
    if (sectionByKey(sections, key)) pass(`meal planner ${lang} includes section ${key}`);
    else fail(`meal planner ${lang} missing section ${key}`);
  }

  const standard = sectionByKey(sections, "standard_meal");
  const premium = sectionByKey(sections, "premium_meal");
  const sandwich = sectionByKey(sections, "sandwich");
  const salad = sectionByKey(sections, "premium_large_salad");

  if (standard) {
    const keys = collectKeys(standard);
    for (const forbidden of ["brown_rice", "potato", "pasta", "beef_steak", "shrimp", "salmon", "extra_protein_50g"]) {
      if (keys.has(forbidden)) fail(`standard_meal ${lang} contains forbidden ${forbidden}`);
    }
    pass(`standard_meal ${lang} does not expose obvious forbidden legacy/premium keys`);
  }

  if (premium) {
    const keys = collectKeys(premium);
    for (const required of ["beef_steak", "shrimp", "salmon"]) {
      if (keys.has(required) || JSON.stringify(premium).includes(required)) pass(`premium_meal ${lang} includes ${required}`);
      else fail(`premium_meal ${lang} missing ${required}`);

      const objs = findNumbersNearKey(premium, required);
      const hasFee2000 = objs.some((o) => Number(o.extraFeeHalala ?? o.priceHalala ?? o.extraPriceHalala) === 2000);
      if (hasFee2000) pass(`premium_meal ${lang} ${required} has 2000 halala fee`);
      else warn(`premium_meal ${lang} ${required} fee 2000 not found in obvious fields`);
    }
  }

  if (sandwich) {
    const keys = collectKeys(sandwich);
    const expected = [
      "beef_burger_sandwich",
      "turkey_cold_sandwich",
      "boiled_egg_sandwich",
      "tuna_sandwich",
      "mexican_chicken_sandwich",
      "grilled_chicken_sandwich",
    ];
    const forbidden = ["chicken_sandwich", "sourdough_turkey"];

    for (const key of expected) {
      if (keys.has(key)) pass(`sandwich ${lang} includes ${key}`);
      else fail(`sandwich ${lang} missing ${key}`);
    }
    for (const key of forbidden) {
      if (keys.has(key)) fail(`sandwich ${lang} contains legacy ${key}`);
    }
  }

  if (salad) {
    const text = JSON.stringify(salad);
    const forbidden = ["extra_protein_50g", "beef_steak", "shrimp", "salmon", "meatballs", "beef_stroganoff"];
    for (const key of forbidden) {
      if (text.includes(key)) fail(`premium_large_salad ${lang} contains forbidden ${key}`);
    }
    pass(`premium_large_salad ${lang} does not expose premium/extra-protein forbidden keys`);
  }
}

console.log("");
console.log(`SUMMARY failures=${failures} warnings=${warnings}`);

if (failures > 0) {
  process.exitCode = 1;
}
NODE

echo
echo "== Done =="
echo "Send me the terminal output from the verification section."
echo "Raw JSON files are in: $OUT_DIR"
echo "Do not send tokens."
