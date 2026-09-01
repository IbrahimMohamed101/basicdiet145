#!/usr/bin/env node
"use strict";

const mongoose = require("mongoose");

const MenuProduct = require("../../src/models/MenuProduct");
const MenuOptionGroup = require("../../src/models/MenuOptionGroup");
const MenuOption = require("../../src/models/MenuOption");
const ProductGroupOption = require("../../src/models/ProductGroupOption");
const PremiumUpgradeConfig = require("../../src/models/PremiumUpgradeConfig");

const BASIC_MEAL_PRODUCT_ID = "6a62197079ee075a57f70106";
const BASIC_MEAL_PRODUCT_KEY = "basic_meal";
const BASIC_MEAL_PROTEIN_GROUP_ID = "6a62197279ee075a57f70107";
const BASIC_MEAL_PROTEIN_GROUP_KEY = "proteins";
const BASIC_MEAL_CARB_GROUP_ID = "6a62197279ee075a57f70108";
const BASIC_MEAL_CARB_GROUP_KEY = "carbs";

const EXECUTE_CONFIRMATION = "FINAL_BASIC_MEAL_DATA_2026_09_01";

const LEMON_BBQ_CHICKEN = Object.freeze({
  key: "lemon_bbq_chicken",
  name: Object.freeze({ ar: "دجاج ليمون باربكيو", en: "Lemon BBQ Chicken" }),
  sortOrder: 7,
});

const CARBS = Object.freeze([
  Object.freeze({ id: "6a969fa543e420ebe617bdb1", key: "lentil_rice", sortOrder: 1 }),
  Object.freeze({ id: "6a969fce43e420ebe617bdc7", key: "javanese_white_rice", sortOrder: 2 }),
  Object.freeze({ id: "6a969ff743e420ebe617bdd8", key: "basmati_white_rice", sortOrder: 3 }),
  Object.freeze({ id: "6a96a00a43e420ebe617bde6", key: "white_pasta", sortOrder: 9 }),
]);

const PAID_PROTEIN_KEYS = Object.freeze([
  "meatballs",
  "beef_stroganoff",
  "beef_steak",
  "shrimp",
  "salmon",
]);

function strId(value) {
  if (value == null) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

function clonePlain(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function argValue(argv, name) {
  const prefix = `--${name}=`;
  const token = argv.find((item) => String(item).startsWith(prefix));
  return token ? String(token).slice(prefix.length) : "";
}

function hasFlag(argv, name) {
  return argv.includes(`--${name}`);
}

function requireLiveConfirmations(argv) {
  const required = [
    ["confirm-live-basic-meal-data", EXECUTE_CONFIRMATION],
    ["confirm-product", BASIC_MEAL_PRODUCT_ID],
    ["confirm-protein-group", BASIC_MEAL_PROTEIN_GROUP_ID],
    ["confirm-carb-group", BASIC_MEAL_CARB_GROUP_ID],
  ];
  for (const [name, expected] of required) {
    if (argValue(argv, name) !== expected) {
      throw new Error(`Refusing live execute: --${name} must equal ${expected}`);
    }
  }
}

function safeMongoTarget(uri) {
  const raw = String(uri || "");
  const noCredentials = raw.replace(/\/\/([^/@]+)@/, "//[REDACTED]@");
  const dbMatch = noCredentials.match(/\/([^/?]+)(?:\?|$)/);
  const hostMatch = noCredentials.match(/^[^:]+:\/\/(?:\[REDACTED\]@)?([^/]+)/);
  return {
    host: hostMatch ? hostMatch[1] : "unknown",
    database: dbMatch ? dbMatch[1] : "driver-default",
  };
}

function valuesEqual(left, right) {
  return stableJson(clonePlain(left)) === stableJson(clonePlain(right));
}

function setIfChanged(patch, current, key, value) {
  if (!valuesEqual(current?.[key], value)) patch[key] = value;
}

function subscriptionChannels(current) {
  const result = [];
  for (const value of Array.isArray(current) ? current : []) {
    if (!["one_time", "subscription"].includes(value)) {
      throw new Error(`Unexpected availableFor channel: ${value}`);
    }
    if (!result.includes(value)) result.push(value);
  }
  if (!result.includes("subscription")) result.push("subscription");
  return result;
}

function assertZeroPrice(row, label) {
  for (const key of ["extraPriceHalala", "extraFeeHalala"]) {
    if (Number(row?.[key] || 0) !== 0) {
      throw new Error(`${label} has unexpected paid metadata: ${key}=${row[key]}`);
    }
  }
  if (String(row?.premiumKey || "").trim()) {
    throw new Error(`${label} unexpectedly has premiumKey=${row.premiumKey}`);
  }
}

function assertZeroRelationPrice(row, label) {
  for (const key of ["extraPriceHalala", "extraWeightPriceHalala"]) {
    if (row?.[key] != null && Number(row[key]) !== 0) {
      throw new Error(`${label} has unexpected relation pricing: ${key}=${row[key]}`);
    }
  }
}

async function assertIdentityByIdAndKey(Model, id, key, label) {
  const [byId, byKey] = await Promise.all([
    Model.findById(id).lean(),
    Model.find({ key }).limit(2).lean(),
  ]);
  if (!byId || byId.key !== key) {
    throw new Error(`${label} identity mismatch: expected ${id}/${key}`);
  }
  if (byKey.length !== 1 || strId(byKey[0]._id) !== id) {
    throw new Error(`${label} key identity is missing or ambiguous: ${key}`);
  }
  return byId;
}

async function assertCanonicalIdentities() {
  await Promise.all([
    assertIdentityByIdAndKey(
      MenuProduct,
      BASIC_MEAL_PRODUCT_ID,
      BASIC_MEAL_PRODUCT_KEY,
      "Basic Meal product"
    ),
    assertIdentityByIdAndKey(
      MenuOptionGroup,
      BASIC_MEAL_PROTEIN_GROUP_ID,
      BASIC_MEAL_PROTEIN_GROUP_KEY,
      "Basic Meal protein group"
    ),
    assertIdentityByIdAndKey(
      MenuOptionGroup,
      BASIC_MEAL_CARB_GROUP_ID,
      BASIC_MEAL_CARB_GROUP_KEY,
      "Basic Meal carb group"
    ),
  ]);
}

async function assertProteinChannelConvention() {
  const anchors = await MenuOption.find({
    groupId: BASIC_MEAL_PROTEIN_GROUP_ID,
    key: "grilled_chicken",
  }).limit(2).lean();
  if (anchors.length !== 1) {
    throw new Error("Canonical protein channel anchor is missing or ambiguous: grilled_chicken");
  }
  const [anchor] = anchors;
  if (strId(anchor._id) !== "6a62197b79ee075a57f70128") {
    throw new Error(`Canonical protein channel anchor ID mismatch: ${strId(anchor._id)}`);
  }
  const channels = [...new Set(anchor.availableFor || [])].sort();
  if (!valuesEqual(channels, ["one_time", "subscription"])) {
    throw new Error(`Canonical protein channel convention mismatch: ${channels.join(",")}`);
  }
  if (!anchor.publishedAt || anchor.availableForSubscription === false) {
    throw new Error("Canonical protein channel anchor is not subscription-publishable");
  }
}

async function relationFor({ optionId, groupId, label }) {
  const rows = await ProductGroupOption.find({
    productId: BASIC_MEAL_PRODUCT_ID,
    groupId,
    optionId,
  }).limit(2).lean();
  if (rows.length > 1) throw new Error(`${label} Basic Meal relation is ambiguous`);
  if (rows.length === 1) assertZeroRelationPrice(rows[0], label);
  return rows[0] || null;
}

function buildRelationPatch(relation, sortOrder) {
  const patch = {};
  setIfChanged(patch, relation, "isActive", true);
  setIfChanged(patch, relation, "isVisible", true);
  setIfChanged(patch, relation, "isAvailable", true);
  setIfChanged(patch, relation, "sortOrder", sortOrder);
  setIfChanged(patch, relation, "extraPriceHalala", 0);
  return patch;
}

function buildCarbOptionPatch(option, definition, now) {
  const selectionType = String(option.selectionType || "").trim();
  if (selectionType && selectionType !== "standard_meal") {
    throw new Error(`${definition.key} has unexpected selectionType=${selectionType}`);
  }
  const displayCategoryKey = String(option.displayCategoryKey || "").trim();
  if (displayCategoryKey && displayCategoryKey !== "standard_carbs") {
    throw new Error(`${definition.key} has unexpected displayCategoryKey=${displayCategoryKey}`);
  }
  assertZeroPrice(option, definition.key);

  const patch = {};
  setIfChanged(patch, option, "selectionType", "standard_meal");
  setIfChanged(patch, option, "displayCategoryKey", "standard_carbs");
  setIfChanged(patch, option, "availableForSubscription", true);
  setIfChanged(patch, option, "availableFor", subscriptionChannels(option.availableFor));
  setIfChanged(patch, option, "isActive", true);
  setIfChanged(patch, option, "isVisible", true);
  setIfChanged(patch, option, "isAvailable", true);
  setIfChanged(patch, option, "sortOrder", definition.sortOrder);
  if (!option.publishedAt) patch.publishedAt = now;
  return patch;
}

function buildLemonOptionPatch(option, now) {
  const selectionType = String(option.selectionType || "").trim();
  if (selectionType && selectionType !== "standard_meal") {
    throw new Error(`lemon_bbq_chicken has unexpected selectionType=${selectionType}`);
  }
  const family = String(option.proteinFamilyKey || "").trim();
  if (family && family !== "chicken") {
    throw new Error(`lemon_bbq_chicken has unexpected proteinFamilyKey=${family}`);
  }
  const category = String(option.displayCategoryKey || "").trim();
  if (category && category !== "chicken") {
    throw new Error(`lemon_bbq_chicken has unexpected displayCategoryKey=${category}`);
  }
  assertZeroPrice(option, "lemon_bbq_chicken");

  const patch = {};
  setIfChanged(patch, option, "name", LEMON_BBQ_CHICKEN.name);
  setIfChanged(patch, option, "selectionType", "standard_meal");
  setIfChanged(patch, option, "proteinFamilyKey", "chicken");
  setIfChanged(patch, option, "displayCategoryKey", "chicken");
  setIfChanged(patch, option, "availableForSubscription", true);
  setIfChanged(patch, option, "availableFor", subscriptionChannels(option.availableFor));
  setIfChanged(patch, option, "isActive", true);
  setIfChanged(patch, option, "isVisible", true);
  setIfChanged(patch, option, "isAvailable", true);
  setIfChanged(patch, option, "sortOrder", LEMON_BBQ_CHICKEN.sortOrder);
  if (!option.publishedAt) patch.publishedAt = now;
  return patch;
}

async function resolveCarbPlan(definition, now) {
  const option = await MenuOption.findById(definition.id).lean();
  if (!option) throw new Error(`Required canonical carb is missing: ${definition.id}/${definition.key}`);
  if (strId(option.groupId) !== BASIC_MEAL_CARB_GROUP_ID || option.key !== definition.key) {
    throw new Error(
      `Canonical carb identity mismatch: expected ${definition.id}/${definition.key}/${BASIC_MEAL_CARB_GROUP_ID}, ` +
      `got ${strId(option._id)}/${option.key}/${strId(option.groupId)}`
    );
  }
  const sameKey = await MenuOption.find({
    groupId: BASIC_MEAL_CARB_GROUP_ID,
    key: definition.key,
  }).limit(2).lean();
  if (sameKey.length !== 1 || strId(sameKey[0]._id) !== definition.id) {
    throw new Error(`Canonical carb key is missing or ambiguous: ${definition.key}`);
  }

  const relation = await relationFor({
    optionId: definition.id,
    groupId: BASIC_MEAL_CARB_GROUP_ID,
    label: definition.key,
  });
  const optionPatch = buildCarbOptionPatch(option, definition, now);
  const relationPatch = relation ? buildRelationPatch(relation, definition.sortOrder) : null;
  return {
    key: definition.key,
    id: definition.id,
    currentState: "existing_canonical_option",
    option,
    optionPatch,
    optionAction: Object.keys(optionPatch).length ? "patch_canonical_metadata" : "reuse",
    relation,
    relationPatch,
    relationAction: relation
      ? (Object.keys(relationPatch).length ? "patch_basic_meal_relation" : "reuse")
      : "create_basic_meal_relation",
    sortOrder: definition.sortOrder,
  };
}

async function resolveLemonPlan(now) {
  const options = await MenuOption.find({
    groupId: BASIC_MEAL_PROTEIN_GROUP_ID,
    key: LEMON_BBQ_CHICKEN.key,
  }).limit(2).lean();
  if (options.length > 1) throw new Error("Canonical lemon_bbq_chicken is ambiguous");

  if (options.length === 0) {
    return {
      key: LEMON_BBQ_CHICKEN.key,
      id: null,
      currentState: "missing",
      option: null,
      optionPatch: null,
      optionAction: "create_canonical_menu_option",
      relation: null,
      relationPatch: null,
      relationAction: "create_basic_meal_relation",
      sortOrder: LEMON_BBQ_CHICKEN.sortOrder,
    };
  }

  const [option] = options;
  const relation = await relationFor({
    optionId: option._id,
    groupId: BASIC_MEAL_PROTEIN_GROUP_ID,
    label: LEMON_BBQ_CHICKEN.key,
  });
  const optionPatch = buildLemonOptionPatch(option, now);
  const relationPatch = relation ? buildRelationPatch(relation, LEMON_BBQ_CHICKEN.sortOrder) : null;
  return {
    key: LEMON_BBQ_CHICKEN.key,
    id: strId(option._id),
    currentState: "existing_canonical_option",
    option,
    optionPatch,
    optionAction: Object.keys(optionPatch).length ? "patch_canonical_metadata" : "reuse",
    relation,
    relationPatch,
    relationAction: relation
      ? (Object.keys(relationPatch).length ? "patch_basic_meal_relation" : "reuse")
      : "create_basic_meal_relation",
    sortOrder: LEMON_BBQ_CHICKEN.sortOrder,
  };
}

async function protectedFingerprint() {
  const [premiumConfigs, paidOptions] = await Promise.all([
    PremiumUpgradeConfig.find({}).sort({ _id: 1 }).lean(),
    MenuOption.find({ key: { $in: PAID_PROTEIN_KEYS } }).sort({ _id: 1 }).lean(),
  ]);
  const paidRelations = await ProductGroupOption.find({
    optionId: { $in: paidOptions.map((row) => row._id) },
  }).sort({ _id: 1 }).lean();
  return stableJson({
    premiumConfigs: premiumConfigs.map(clonePlain),
    paidOptions: paidOptions.map(clonePlain),
    paidRelations: paidRelations.map(clonePlain),
  });
}

function summarizePlan(lemon, carbs) {
  const rows = [lemon, ...carbs];
  return {
    creates: {
      MenuOption: rows.filter((row) => row.optionAction === "create_canonical_menu_option").length,
      ProductGroupOption: rows.filter((row) => row.relationAction === "create_basic_meal_relation").length,
    },
    updates: {
      MenuOption: rows.filter((row) => row.optionAction === "patch_canonical_metadata").length,
      ProductGroupOption: rows.filter((row) => row.relationAction === "patch_basic_meal_relation").length,
    },
  };
}

async function buildPlan(now = new Date()) {
  await assertCanonicalIdentities();
  await assertProteinChannelConvention();
  const lemon = await resolveLemonPlan(now);
  const carbs = [];
  for (const definition of CARBS) carbs.push(await resolveCarbPlan(definition, now));
  return { lemon, carbs, summary: summarizePlan(lemon, carbs) };
}

function lemonCreatePayload(now) {
  return {
    groupId: BASIC_MEAL_PROTEIN_GROUP_ID,
    key: LEMON_BBQ_CHICKEN.key,
    name: LEMON_BBQ_CHICKEN.name,
    selectionType: "standard_meal",
    proteinFamilyKey: "chicken",
    displayCategoryKey: "chicken",
    premiumKey: "",
    extraFeeHalala: 0,
    extraPriceHalala: 0,
    extraWeightUnitGrams: 0,
    extraWeightPriceHalala: 0,
    availableForSubscription: true,
    availableFor: ["one_time", "subscription"],
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
    sortOrder: LEMON_BBQ_CHICKEN.sortOrder,
  };
}

function relationCreatePayload({ optionId, groupId, sortOrder }) {
  return {
    productId: BASIC_MEAL_PRODUCT_ID,
    groupId,
    optionId,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder,
    extraPriceHalala: 0,
    extraWeightUnitGrams: 0,
    extraWeightPriceHalala: 0,
  };
}

async function executePlan(plan, now) {
  let lemonId = plan.lemon.id;
  if (plan.lemon.optionAction === "create_canonical_menu_option") {
    const created = await MenuOption.create(lemonCreatePayload(now));
    lemonId = strId(created._id);
  } else if (plan.lemon.optionAction === "patch_canonical_metadata") {
    const result = await MenuOption.updateOne(
      { _id: plan.lemon.id, groupId: BASIC_MEAL_PROTEIN_GROUP_ID, key: LEMON_BBQ_CHICKEN.key },
      { $set: plan.lemon.optionPatch },
      { timestamps: false }
    );
    if (result.matchedCount !== 1) throw new Error("Canonical lemon option changed during execute");
  }

  for (const row of plan.carbs) {
    if (row.optionAction !== "patch_canonical_metadata") continue;
    const result = await MenuOption.updateOne(
      { _id: row.id, groupId: BASIC_MEAL_CARB_GROUP_ID, key: row.key },
      { $set: row.optionPatch },
      { timestamps: false }
    );
    if (result.matchedCount !== 1) throw new Error(`Canonical carb changed during execute: ${row.key}`);
  }

  const relationRows = [
    { ...plan.lemon, id: lemonId, groupId: BASIC_MEAL_PROTEIN_GROUP_ID },
    ...plan.carbs.map((row) => ({ ...row, groupId: BASIC_MEAL_CARB_GROUP_ID })),
  ];
  for (const row of relationRows) {
    if (row.relationAction === "create_basic_meal_relation") {
      await ProductGroupOption.create(relationCreatePayload({
        optionId: row.id,
        groupId: row.groupId,
        sortOrder: row.sortOrder,
      }));
    } else if (row.relationAction === "patch_basic_meal_relation") {
      const result = await ProductGroupOption.updateOne(
        {
          _id: row.relation._id,
          productId: BASIC_MEAL_PRODUCT_ID,
          groupId: row.groupId,
          optionId: row.id,
        },
        { $set: row.relationPatch },
        { timestamps: false }
      );
      if (result.matchedCount !== 1) throw new Error(`Canonical relation changed during execute: ${row.key}`);
    }
  }

  return { lemonId };
}

function publicRow(row, idOverride = null) {
  return {
    key: row.key,
    id: idOverride || row.id,
    currentState: row.currentState,
    optionAction: row.optionAction,
    optionPatchFields: Object.keys(row.optionPatch || {}).sort(),
    relationAction: row.relationAction,
    relationPatchFields: Object.keys(row.relationPatch || {}).sort(),
    sortOrder: row.sortOrder,
  };
}

async function runPreparation({
  argv = process.argv.slice(2),
  closeConnection = true,
  connectionUri = null,
} = {}) {
  const execute = hasFlag(argv, "execute");
  if (execute) requireLiveConfirmations(argv);

  const alreadyConnected = mongoose.connection.readyState !== 0;
  const uri = connectionUri || process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!alreadyConnected) {
    if (!uri) {
      throw new Error("MONGO_URI or MONGODB_URI is required. MONGO_URI_TEST is intentionally ignored.");
    }
    await mongoose.connect(uri);
  }
  const target = alreadyConnected
    ? { host: mongoose.connection.host || "existing-connection", database: mongoose.connection.name || "unknown" }
    : safeMongoTarget(uri);

  try {
    const now = new Date();
    const protectedBefore = await protectedFingerprint();
    const plan = await buildPlan(now);
    let execution = null;
    let verifiedPlan = null;

    if (execute) {
      execution = await executePlan(plan, now);
      verifiedPlan = await buildPlan(now);
      const remaining = verifiedPlan.summary;
      if (
        remaining.creates.MenuOption !== 0
        || remaining.creates.ProductGroupOption !== 0
        || remaining.updates.MenuOption !== 0
        || remaining.updates.ProductGroupOption !== 0
      ) {
        throw new Error(`Prerequisite execute did not converge: ${JSON.stringify(remaining)}`);
      }
    }

    if (protectedBefore !== await protectedFingerprint()) {
      throw new Error("Paid protein or PremiumUpgradeConfig state changed; refusing to certify preparation");
    }

    const lemonId = execution?.lemonId || plan.lemon.id;
    const result = {
      ok: true,
      mode: execute ? "execute" : "dry_run",
      target,
      identities: {
        product: { id: BASIC_MEAL_PRODUCT_ID, key: BASIC_MEAL_PRODUCT_KEY },
        proteinGroup: { id: BASIC_MEAL_PROTEIN_GROUP_ID, key: BASIC_MEAL_PROTEIN_GROUP_KEY },
        carbGroup: { id: BASIC_MEAL_CARB_GROUP_ID, key: BASIC_MEAL_CARB_GROUP_KEY },
      },
      plan: {
        lemonBbqChicken: publicRow(plan.lemon, lemonId),
        carbs: plan.carbs.map((row) => publicRow(row)),
        creates: plan.summary.creates,
        updates: plan.summary.updates,
      },
      verification: execute ? {
        converged: true,
        lemonBbqChickenId: lemonId,
        remainingCreates: verifiedPlan.summary.creates,
        remainingUpdates: verifiedPlan.summary.updates,
      } : null,
      safety: {
        deletedRecords: 0,
        historicalRewrites: 0,
        groupMoves: 0,
        groupMerges: 0,
        premiumConfigChanges: 0,
        paidProteinChanges: 0,
        basicSaladChanges: 0,
        premiumLargeSaladChanges: 0,
        subscriptionChanges: 0,
        orderChanges: 0,
      },
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (closeConnection && !alreadyConnected && mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

if (require.main === module) {
  runPreparation().catch((error) => {
    console.error(`[prepare-final-basic-meal] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  BASIC_MEAL_PRODUCT_ID,
  BASIC_MEAL_PROTEIN_GROUP_ID,
  BASIC_MEAL_CARB_GROUP_ID,
  EXECUTE_CONFIRMATION,
  LEMON_BBQ_CHICKEN,
  CARBS,
  buildPlan,
  runPreparation,
};
