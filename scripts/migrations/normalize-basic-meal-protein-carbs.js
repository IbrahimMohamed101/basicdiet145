#!/usr/bin/env node
"use strict";

const mongoose = require("mongoose");

const MenuProduct = require("../../src/models/MenuProduct");
const MenuOptionGroup = require("../../src/models/MenuOptionGroup");
const MenuOption = require("../../src/models/MenuOption");
const ProductOptionGroup = require("../../src/models/ProductOptionGroup");
const ProductGroupOption = require("../../src/models/ProductGroupOption");
const MealBuilderConfig = require("../../src/models/MealBuilderConfig");
const PremiumUpgradeConfig = require("../../src/models/PremiumUpgradeConfig");
const {
  getDashboardState,
  publishDraft,
  updateDraft,
} = require("../../src/services/subscription/mealBuilderConfigService");

const BASIC_MEAL_PRODUCT_ID = "6a62197079ee075a57f70106";
const BASIC_MEAL_PRODUCT_KEY = "basic_meal";
const BASIC_MEAL_PROTEIN_GROUP_ID = "6a62197279ee075a57f70107";
const BASIC_MEAL_PROTEIN_GROUP_KEY = "proteins";
const BASIC_MEAL_CARB_GROUP_ID = "6a62197279ee075a57f70108";
const BASIC_MEAL_CARB_GROUP_KEY = "carbs";

const EXECUTE_CONFIRMATION = "FINAL_BASIC_MEAL_2026_09_01";
const PUBLISH_CONFIRMATION = "PUBLISH_FINAL_BASIC_MEAL_2026_09_01";

const FINAL_PROTEINS = Object.freeze([
  { key: "kofta", ar: "لحم كفتة", en: "Beef Kofta", family: "beef", order: 1, expectedId: "6a62197d79ee075a57f70130" },
  { key: "mushroom_beef", ar: "لحم ماشروم", en: "Mushroom Beef", family: "beef", order: 2, expectedId: "6a62197c79ee075a57f7012c" },
  { key: "asian_beef", ar: "لحم آسيوي", en: "Asian Beef", family: "beef", order: 3, expectedId: "6a62197c79ee075a57f7012e" },
  { key: "grilled_chicken", ar: "دجاج مشوي", en: "Grilled Chicken", family: "chicken", order: 4, expectedId: "6a62197b79ee075a57f70128" },
  { key: "mexican_chicken", ar: "دجاج مكسيكي", en: "Mexican Chicken", family: "chicken", order: 5, expectedId: "6a62197379ee075a57f7010c" },
  { key: "creamy_chicken", ar: "دجاج كريمة", en: "Creamy Chicken", family: "chicken", order: 6, expectedId: "6a62197479ee075a57f70110" },
  { key: "lemon_bbq_chicken", ar: "دجاج ليمون باربكيو", en: "Lemon BBQ Chicken", family: "chicken", order: 7, expectedId: null },
  { key: "chicken_65", ar: "دجاج 65", en: "Chicken 65", family: "chicken", order: 8, expectedId: "6a62197579ee075a57f70112" },
  { key: "chicken_with_okra", ar: "دجاج بامية", en: "Chicken with Okra", family: "chicken", order: 9, expectedId: "6a62197879ee075a57f7011e" },
  { key: "shish_tawook", ar: "دجاج شيش طاووق", en: "Shish Tawook Chicken", family: "chicken", order: 10, expectedId: "6a62197b79ee075a57f7012a" },
  { key: "creamy_fish", ar: "سمك كريمة", en: "Creamy Fish", family: "fish", order: 11, expectedId: "6a62197e79ee075a57f70134" },
  { key: "grilled_fish", ar: "سمك مشوي", en: "Grilled Fish", family: "fish", order: 12, expectedId: "6a62197f79ee075a57f70136" },
  { key: "asian_chicken", ar: "دجاج آسيوي", en: "Asian Chicken", family: "chicken", order: 13, expectedId: "6a62197779ee075a57f7011a" },
]);

const FINAL_CARBS = Object.freeze([
  { key: "lentil_rice", ar: "رز عدس", en: "Lentil Rice", order: 1, expectedId: "6a969fa543e420ebe617bdb1" },
  { key: "javanese_white_rice", ar: "رز أبيض جاوي", en: "Javanese White Rice", order: 2, expectedId: "6a969fce43e420ebe617bdc7" },
  { key: "basmati_white_rice", ar: "رز أبيض بسمتي", en: "Basmati White Rice", order: 3, expectedId: "6a969ff743e420ebe617bdd8" },
  { key: "mashed_potatoes", ar: "بطاطس مهروسة", en: "Mashed Potatoes", order: 4, expectedId: "6a62198179ee075a57f70140" },
  { key: "roasted_potatoes", ar: "بطاطس مشوية", en: "Roasted Potatoes", order: 5, expectedId: "6a62198479ee075a57f70148" },
  { key: "sweet_potatoes", ar: "بطاطا حلوة", en: "Sweet Potatoes", order: 6, expectedId: "6a62198479ee075a57f7014a" },
  { key: "mixed_vegetables", ar: "خضار مشكل", en: "Mixed Vegetables", order: 7, expectedId: "6a62198379ee075a57f70146" },
  { key: "red_sauce_pasta", ar: "مكرونة حمراء", en: "Red Sauce Pasta", order: 8, expectedId: "6a62198379ee075a57f70144" },
  { key: "white_pasta", ar: "مكرونة بيضاء", en: "White Pasta", order: 9, expectedId: "6a96a00a43e420ebe617bde6" },
]);

const PRESERVED_PAID_PROTEIN_KEYS = Object.freeze([
  "meatballs",
  "beef_stroganoff",
  "beef_steak",
  "shrimp",
  "salmon",
]);

function argValue(argv, name) {
  const prefix = `--${name}=`;
  const token = argv.find((item) => String(item).startsWith(prefix));
  return token ? String(token).slice(prefix.length) : "";
}

function hasFlag(argv, name) {
  return argv.includes(`--${name}`);
}

function strId(value) {
  if (value == null) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
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

function requireLiveConfirmations(argv) {
  if (process.env.NODE_ENV === "test") return;
  const required = [
    ["confirm-live-basic-meal", EXECUTE_CONFIRMATION],
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

function requirePublishConfirmation(argv) {
  if (process.env.NODE_ENV === "test") return;
  if (argValue(argv, "confirm-publish") !== PUBLISH_CONFIRMATION) {
    throw new Error(`Refusing publish: --confirm-publish must equal ${PUBLISH_CONFIRMATION}`);
  }
}

async function assertCanonicalIdentity() {
  const [product, proteinGroup, carbGroup] = await Promise.all([
    MenuProduct.findById(BASIC_MEAL_PRODUCT_ID).lean(),
    MenuOptionGroup.findById(BASIC_MEAL_PROTEIN_GROUP_ID).lean(),
    MenuOptionGroup.findById(BASIC_MEAL_CARB_GROUP_ID).lean(),
  ]);

  if (!product || product.key !== BASIC_MEAL_PRODUCT_KEY) {
    throw new Error("Basic Meal product identity mismatch");
  }
  if (!proteinGroup || proteinGroup.key !== BASIC_MEAL_PROTEIN_GROUP_KEY) {
    throw new Error("Basic Meal protein group identity mismatch");
  }
  if (!carbGroup || carbGroup.key !== BASIC_MEAL_CARB_GROUP_KEY) {
    throw new Error("Basic Meal carb group identity mismatch");
  }

  for (const groupId of [BASIC_MEAL_PROTEIN_GROUP_ID, BASIC_MEAL_CARB_GROUP_ID]) {
    const activeOwners = await ProductOptionGroup.find({
      groupId,
      isActive: true,
      isVisible: true,
      isAvailable: true,
    }).lean();
    const foreignOwners = activeOwners.filter((row) => strId(row.productId) !== BASIC_MEAL_PRODUCT_ID);
    if (foreignOwners.length) {
      throw new Error(
        `Refusing normalization: group ${groupId} has another active product owner: ` +
        foreignOwners.map((row) => strId(row.productId)).join(",")
      );
    }
    if (!activeOwners.some((row) => strId(row.productId) === BASIC_MEAL_PRODUCT_ID)) {
      throw new Error(`Refusing normalization: Basic Meal is not the active owner of group ${groupId}`);
    }
  }
}

function assertSubscriptionReadyOption(option, definition, kind) {
  if (!option.publishedAt) {
    throw new Error(`Approved option is unpublished: ${definition.key}`);
  }
  if (option.availableForSubscription === false) {
    throw new Error(`Approved option is disabled for subscriptions: ${definition.key}`);
  }
  if (Array.isArray(option.availableFor) && option.availableFor.length && !option.availableFor.includes("subscription")) {
    throw new Error(`Approved option is not subscription-channel enabled: ${definition.key}`);
  }
  if (String(option.selectionType || "").trim() !== "standard_meal") {
    throw new Error(`Approved option has unexpected selectionType: ${definition.key}`);
  }
  if (kind === "protein") {
    if (String(option.proteinFamilyKey || "").trim() !== definition.family) {
      throw new Error(`Approved protein family mismatch: ${definition.key}`);
    }
    if (String(option.displayCategoryKey || "").trim() !== definition.family) {
      throw new Error(`Approved protein display category mismatch: ${definition.key}`);
    }
    if (String(option.premiumKey || "").trim()) {
      throw new Error(`Approved regular protein unexpectedly has premiumKey: ${definition.key}`);
    }
  } else if (String(option.displayCategoryKey || "").trim() !== "standard_carbs") {
    throw new Error(`Approved carb display category mismatch: ${definition.key}`);
  }
}

async function resolveRequiredOptions(definitions, groupId, kind, { strictIdentityPins }) {
  const rows = [];
  for (const definition of definitions) {
    const option = await MenuOption.findOne({ groupId, key: definition.key }).lean();
    if (!option) {
      throw new Error(`Approved option missing from canonical group: ${definition.key}`);
    }
    if (strictIdentityPins && definition.expectedId && strId(option._id) !== definition.expectedId) {
      throw new Error(
        `Identity pin mismatch for ${definition.key}: expected ${definition.expectedId}, got ${strId(option._id)}`
      );
    }
    assertSubscriptionReadyOption(option, definition, kind);

    const relation = await ProductGroupOption.findOne({
      productId: BASIC_MEAL_PRODUCT_ID,
      groupId,
      optionId: option._id,
    }).lean();
    if (!relation) {
      throw new Error(`Approved option is not linked to Basic Meal: ${definition.key}`);
    }

    rows.push({
      key: definition.key,
      id: strId(option._id),
      groupId,
      family: definition.family || "",
      order: definition.order,
      option,
      relation,
    });
  }
  return rows;
}

async function resolvePreservedPaidProteins() {
  const rows = [];
  for (const key of PRESERVED_PAID_PROTEIN_KEYS) {
    const option = await MenuOption.findOne({
      groupId: BASIC_MEAL_PROTEIN_GROUP_ID,
      key,
    }).lean();
    if (!option) throw new Error(`Preserved paid protein missing from canonical group: ${key}`);
    if (!option.publishedAt) throw new Error(`Preserved paid protein is unpublished: ${key}`);
    if (option.availableForSubscription === false) {
      throw new Error(`Preserved paid protein is disabled for subscriptions: ${key}`);
    }
    const relation = await ProductGroupOption.findOne({
      productId: BASIC_MEAL_PRODUCT_ID,
      groupId: BASIC_MEAL_PROTEIN_GROUP_ID,
      optionId: option._id,
    }).lean();
    if (!relation) throw new Error(`Preserved paid protein is not linked to Basic Meal: ${key}`);
    rows.push({ key, id: strId(option._id), option, relation });
  }
  return rows;
}

async function activateRequiredRows(rows, { execute, preserveSortOrder = false }) {
  const report = [];
  for (const row of rows) {
    const optionPatch = { isActive: true, isVisible: true, isAvailable: true };
    const relationPatch = { isActive: true, isVisible: true, isAvailable: true };
    if (!preserveSortOrder) {
      optionPatch.sortOrder = row.order;
      relationPatch.sortOrder = row.order;
    }

    if (execute) {
      await MenuOption.updateOne(
        { _id: row.id, groupId: row.groupId || BASIC_MEAL_PROTEIN_GROUP_ID },
        { $set: optionPatch }
      );
      await ProductGroupOption.updateOne(
        { _id: row.relation._id },
        { $set: relationPatch }
      );
    }

    report.push({
      key: row.key,
      id: row.id,
      action: "reuse",
      targetActive: true,
      sortOrder: preserveSortOrder ? Number(row.relation.sortOrder || row.option.sortOrder || 0) : row.order,
    });
  }
  return report;
}

async function premiumFingerprint() {
  const configs = await PremiumUpgradeConfig.find({}).sort({ premiumKey: 1, revision: 1, _id: 1 }).lean();
  return stableJson(configs.map((row) => ({
    id: strId(row._id),
    premiumKey: row.premiumKey,
    sourceType: row.sourceType,
    sourceId: strId(row.sourceId),
    sourceProductId: strId(row.sourceProductId),
    sourceGroupId: strId(row.sourceGroupId),
    selectionType: row.selectionType,
    upgradeDeltaHalala: row.upgradeDeltaHalala,
    currency: row.currency,
    isEnabled: row.isEnabled,
    isVisible: row.isVisible,
    status: row.status,
    sortOrder: row.sortOrder,
    revision: row.revision,
  })));
}

async function premiumBuilderFingerprint() {
  const configs = await MealBuilderConfig.find({
    status: { $in: ["draft", "published"] },
    isCurrent: true,
  }).lean();
  const rows = configs.map((config) => {
    const premiumSection = (config.sections || []).find((section) => section.key === "premium");
    return {
      status: config.status,
      section: premiumSection ? {
        key: premiumSection.key,
        sectionType: premiumSection.sectionType,
        sourceKind: premiumSection.sourceKind,
        productContextId: strId(premiumSection.productContextId),
        sourceGroupId: strId(premiumSection.sourceGroupId),
        selectedOptionIds: (premiumSection.selectedOptionIds || []).map(strId),
        selectedProductIds: (premiumSection.selectedProductIds || []).map(strId),
        selectionType: premiumSection.selectionType,
        visible: premiumSection.visible,
        metadata: premiumSection.metadata || {},
        rules: premiumSection.rules || {},
      } : null,
    };
  }).sort((a, b) => a.status.localeCompare(b.status));
  return stableJson(rows);
}

async function paidProteinMetadataFingerprint() {
  const rows = await resolvePreservedPaidProteins();
  return stableJson(rows.map(({ key, id, option, relation }) => ({
    key,
    id,
    option: {
      name: option.name || {},
      description: option.description || {},
      extraPriceHalala: option.extraPriceHalala,
      extraFeeHalala: option.extraFeeHalala,
      extraWeightUnitGrams: option.extraWeightUnitGrams,
      extraWeightPriceHalala: option.extraWeightPriceHalala,
      currency: option.currency,
      availableFor: option.availableFor || [],
      availableForSubscription: option.availableForSubscription,
      nutrition: option.nutrition || {},
      proteinFamilyKey: option.proteinFamilyKey,
      displayCategoryKey: option.displayCategoryKey,
      premiumKey: option.premiumKey,
      ruleTags: option.ruleTags || [],
      selectionType: option.selectionType,
      publishedAt: option.publishedAt,
    },
    relation: {
      extraPriceHalala: relation.extraPriceHalala,
      extraWeightUnitGrams: relation.extraWeightUnitGrams,
      extraWeightPriceHalala: relation.extraWeightPriceHalala,
    },
  })));
}

async function protectedProteinOptionIds(paidRows) {
  const protectedIds = new Set(paidRows.map((row) => row.id));

  const configs = await PremiumUpgradeConfig.find({
    sourceType: "menu_option",
    status: { $ne: "archived" },
  }).lean();
  for (const row of configs) {
    const sourceProductId = strId(row.sourceProductId);
    const sourceGroupId = strId(row.sourceGroupId);
    if ((!sourceProductId || sourceProductId === BASIC_MEAL_PRODUCT_ID)
      && (!sourceGroupId || sourceGroupId === BASIC_MEAL_PROTEIN_GROUP_ID)) {
      protectedIds.add(strId(row.sourceId));
    }
  }

  const currentConfigs = await MealBuilderConfig.find({
    status: { $in: ["draft", "published"] },
    isCurrent: true,
  }).lean();
  for (const config of currentConfigs) {
    const premiumSection = (config.sections || []).find((section) => section.key === "premium");
    for (const optionId of premiumSection?.selectedOptionIds || []) {
      protectedIds.add(strId(optionId));
    }
  }

  return protectedIds;
}

function isBasicMealRegularTargetSection(section) {
  if (!section) return false;
  const productId = strId(section.productContextId);
  const groupId = strId(section.sourceGroupId);
  if (productId !== BASIC_MEAL_PRODUCT_ID) return false;
  if (groupId === BASIC_MEAL_CARB_GROUP_ID) return true;
  return groupId === BASIC_MEAL_PROTEIN_GROUP_ID
    && String(section.selectionType || "").trim() === "standard_meal";
}

async function currentDraftNonTargetFingerprint() {
  const draft = await MealBuilderConfig.findOne({
    status: "draft",
    isCurrent: true,
  }).sort({ updatedAt: -1 }).lean();
  if (!draft) return "";
  const protectedSections = (draft.sections || [])
    .filter((section) => !isBasicMealRegularTargetSection(section))
    .map((section) => {
      const copy = clonePlain(section);
      delete copy._id;
      return copy;
    });
  return stableJson(protectedSections);
}

function exactIdsByFamily(proteinRows) {
  const byKey = new Map(proteinRows.map((row) => [row.key, row.id]));
  const result = { chicken: [], beef: [], fish: [] };
  for (const definition of FINAL_PROTEINS) {
    result[definition.family].push(byKey.get(definition.key));
  }
  return result;
}

async function buildDraftPlan(proteinRows, carbRows) {
  const currentDraft = await MealBuilderConfig.findOne({
    status: "draft",
    isCurrent: true,
  }).sort({ updatedAt: -1 });
  if (!currentDraft) throw new Error("No current Meal Builder draft exists");

  const sections = clonePlain(currentDraft.sections || []);
  const familyIds = exactIdsByFamily(proteinRows);
  const expected = {
    chicken: familyIds.chicken,
    beef: familyIds.beef,
    fish: familyIds.fish,
    carbs: carbRows.map((row) => row.id),
  };

  for (const [sectionKey, selectedOptionIds] of Object.entries(expected)) {
    const section = sections.find((item) => item.key === sectionKey);
    if (!section) throw new Error(`Meal Builder draft section missing: ${sectionKey}`);
    const expectedGroupId = sectionKey === "carbs"
      ? BASIC_MEAL_CARB_GROUP_ID
      : BASIC_MEAL_PROTEIN_GROUP_ID;
    if (strId(section.productContextId) !== BASIC_MEAL_PRODUCT_ID) {
      throw new Error(`Draft section ${sectionKey} productContextId mismatch`);
    }
    if (strId(section.sourceGroupId) !== expectedGroupId) {
      throw new Error(`Draft section ${sectionKey} sourceGroupId mismatch`);
    }
    section.selectedOptionIds = selectedOptionIds;
    section.includeMode = "selected";
    section.selectionType = "standard_meal";
    section.visible = true;
  }

  for (const section of sections) {
    if (!isBasicMealRegularTargetSection(section)) continue;
    if (["chicken", "beef", "fish", "carbs"].includes(section.key)) continue;
    section.selectedOptionIds = [];
    section.includeMode = "selected";
    section.visible = false;
  }

  return {
    draftId: strId(currentDraft._id),
    previousRevisionHash: currentDraft.revisionHash || "",
    sections,
    expected,
  };
}

function collectPlannerKeys(plannerCatalog, sectionKeys) {
  const keys = [];
  for (const section of plannerCatalog?.sections || []) {
    if (!sectionKeys.includes(section.key)) continue;
    for (const product of section.products || []) {
      for (const group of product.optionGroups || []) {
        for (const option of group.options || []) {
          if (option?.key) keys.push(String(option.key));
        }
      }
    }
  }
  return [...new Set(keys)];
}

function assertSetEqual(actual, expected, label) {
  const a = [...new Set(actual)].sort();
  const e = [...new Set(expected)].sort();
  if (JSON.stringify(a) !== JSON.stringify(e)) {
    throw new Error(`${label} mismatch. expected=${e.join(",")} actual=${a.join(",")}`);
  }
}

async function assertPublishedPlannerFinal() {
  const state = await getDashboardState({ lang: "en" });
  if (!state?.published || !state?.plannerCatalog) {
    throw new Error("Published Meal Builder or planner catalog is missing");
  }

  const proteinKeys = collectPlannerKeys(state.plannerCatalog, ["chicken", "beef", "fish", "eggs", "other"]);
  const carbKeys = collectPlannerKeys(state.plannerCatalog, ["carbs"]);
  assertSetEqual(proteinKeys, FINAL_PROTEINS.map((row) => row.key), "Published planner regular proteins");
  assertSetEqual(carbKeys, FINAL_CARBS.map((row) => row.key), "Published planner carbs");

  if (state.published.revisionHash !== state.plannerCatalog.builderRevisionHash) {
    throw new Error(
      `Published/planner revision mismatch: ${state.published.revisionHash} != ${state.plannerCatalog.builderRevisionHash}`
    );
  }

  return {
    publishedVersionId: state.published.versionId || state.published.id,
    revisionHash: state.published.revisionHash,
    proteinKeys,
    carbKeys,
  };
}

async function assertPreservedPaidActive(paidRows) {
  for (const row of paidRows) {
    const [option, relation] = await Promise.all([
      MenuOption.findById(row.id).lean(),
      ProductGroupOption.findById(row.relation._id).lean(),
    ]);
    if (!option || option.isActive === false || option.isVisible === false || option.isAvailable === false) {
      throw new Error(`Preserved paid protein is not active after normalization: ${row.key}`);
    }
    if (!relation || relation.isActive === false || relation.isVisible === false || relation.isAvailable === false) {
      throw new Error(`Preserved paid protein relation is not active after normalization: ${row.key}`);
    }
  }
}

async function deactivateNonApprovedAfterPublish({ execute, regularProteinRows, carbRows, paidRows }) {
  const approvedProteinIds = new Set(regularProteinRows.map((row) => row.id));
  const approvedCarbIds = new Set(carbRows.map((row) => row.id));
  const protectedProteinIds = await protectedProteinOptionIds(paidRows);
  const plans = [];

  for (const { groupId, approvedIds, kind } of [
    { groupId: BASIC_MEAL_PROTEIN_GROUP_ID, approvedIds: approvedProteinIds, kind: "protein" },
    { groupId: BASIC_MEAL_CARB_GROUP_ID, approvedIds: approvedCarbIds, kind: "carb" },
  ]) {
    const relations = await ProductGroupOption.find({
      productId: BASIC_MEAL_PRODUCT_ID,
      groupId,
    }).lean();

    for (const relation of relations) {
      const optionId = strId(relation.optionId);
      if (approvedIds.has(optionId)) continue;
      if (kind === "protein" && protectedProteinIds.has(optionId)) continue;

      const option = await MenuOption.findById(optionId).lean();
      if (!option) throw new Error(`Orphan Basic Meal relation found for option ${optionId}`);

      const otherActiveRelations = await ProductGroupOption.find({
        optionId,
        productId: { $ne: BASIC_MEAL_PRODUCT_ID },
        isActive: true,
        isVisible: true,
        isAvailable: true,
      }).lean();
      const canDeactivateOptionDocument = otherActiveRelations.length === 0;

      plans.push({
        optionId,
        key: option.key,
        groupId,
        deactivateRelation: true,
        deactivateOptionDocument: canDeactivateOptionDocument,
        protectedOtherProductIds: otherActiveRelations.map((row) => strId(row.productId)),
      });

      if (!execute) continue;
      await ProductGroupOption.updateOne(
        { _id: relation._id },
        { $set: { isActive: false, isVisible: false, isAvailable: false } }
      );
      if (canDeactivateOptionDocument) {
        await MenuOption.updateOne(
          { _id: optionId, groupId },
          { $set: { isActive: false, isVisible: false, isAvailable: false } }
        );
      }
    }
  }

  return plans;
}

async function runNormalization({
  argv = process.argv.slice(2),
  closeConnection = true,
  connectionUri = null,
  skipDraftSync = false,
} = {}) {
  const execute = hasFlag(argv, "execute");
  const publish = hasFlag(argv, "publish");
  if (publish && !execute) throw new Error("--publish requires --execute");
  if (execute) requireLiveConfirmations(argv);
  if (publish) requirePublishConfirmation(argv);

  const alreadyConnected = mongoose.connection.readyState !== 0;
  const uri = connectionUri || process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!alreadyConnected) {
    if (!uri) throw new Error("MONGO_URI or MONGODB_URI is required. MONGO_URI_TEST is intentionally ignored.");
    await mongoose.connect(uri);
  }
  const target = alreadyConnected
    ? { host: mongoose.connection.host || "existing-connection", database: mongoose.connection.name || "unknown" }
    : safeMongoTarget(uri);

  try {
    const strictIdentityPins = process.env.NODE_ENV !== "test";
    await assertCanonicalIdentity();

    const premiumBefore = await premiumFingerprint();
    const premiumBuilderBefore = await premiumBuilderFingerprint();
    const paidMetadataBefore = await paidProteinMetadataFingerprint();
    const nonTargetDraftBefore = skipDraftSync ? null : await currentDraftNonTargetFingerprint();

    const regularProteinRows = await resolveRequiredOptions(
      FINAL_PROTEINS,
      BASIC_MEAL_PROTEIN_GROUP_ID,
      "protein",
      { strictIdentityPins }
    );
    const carbRows = await resolveRequiredOptions(
      FINAL_CARBS,
      BASIC_MEAL_CARB_GROUP_ID,
      "carb",
      { strictIdentityPins }
    );
    const paidRows = await resolvePreservedPaidProteins();

    const proteinReport = await activateRequiredRows(regularProteinRows, { execute });
    const carbReport = await activateRequiredRows(carbRows, { execute });
    const paidReport = await activateRequiredRows(
      paidRows.map((row) => ({ ...row, groupId: BASIC_MEAL_PROTEIN_GROUP_ID })),
      { execute, preserveSortOrder: true }
    );

    let draftPlan = null;
    let draftResult = null;
    let publishedVerification = null;
    let deactivationPlans = [];

    if (!skipDraftSync) {
      draftPlan = await buildDraftPlan(regularProteinRows, carbRows);
      if (execute) {
        draftResult = await updateDraft({
          sections: draftPlan.sections,
          notes: "Final Basic Meal restaurant menu: 13 regular proteins + 9 carbs; preserved paid proteins unchanged",
        });

        const draftProteinIds = []
          .concat(
            draftResult.sections.find((s) => s.key === "chicken")?.selectedOptionIds || [],
            draftResult.sections.find((s) => s.key === "beef")?.selectedOptionIds || [],
            draftResult.sections.find((s) => s.key === "fish")?.selectedOptionIds || []
          )
          .map(strId);
        const draftCarbIds = (draftResult.sections.find((s) => s.key === "carbs")?.selectedOptionIds || []).map(strId);
        if (new Set(draftProteinIds).size !== 13) {
          throw new Error(`Draft regular protein count is ${new Set(draftProteinIds).size}, expected 13`);
        }
        if (new Set(draftCarbIds).size !== 9) {
          throw new Error(`Draft carb count is ${new Set(draftCarbIds).size}, expected 9`);
        }

        const nonTargetDraftAfter = await currentDraftNonTargetFingerprint();
        if (nonTargetDraftBefore !== nonTargetDraftAfter) {
          throw new Error("A non-Basic-Meal draft section changed; refusing to publish");
        }
        if (premiumBefore !== await premiumFingerprint() || premiumBuilderBefore !== await premiumBuilderFingerprint()) {
          throw new Error("Premium state changed during draft preparation; refusing to publish");
        }
        if (paidMetadataBefore !== await paidProteinMetadataFingerprint()) {
          throw new Error("Preserved paid protein pricing/metadata changed during preparation; refusing to publish");
        }
      }

      if (publish) {
        await publishDraft({
          notes: "Publish final Basic Meal restaurant menu (13 regular proteins / 9 carbs)",
        });
        publishedVerification = await assertPublishedPlannerFinal();
        deactivationPlans = await deactivateNonApprovedAfterPublish({
          execute: true,
          regularProteinRows,
          carbRows,
          paidRows,
        });
        publishedVerification = await assertPublishedPlannerFinal();
        await assertPreservedPaidActive(paidRows);
      } else {
        deactivationPlans = await deactivateNonApprovedAfterPublish({
          execute: false,
          regularProteinRows,
          carbRows,
          paidRows,
        });
      }
    }

    if (premiumBefore !== await premiumFingerprint()) {
      throw new Error("PremiumUpgradeConfig fingerprint changed; refusing to certify the migration");
    }
    if (premiumBuilderBefore !== await premiumBuilderFingerprint()) {
      throw new Error("Meal Builder Premium section changed; refusing to certify the migration");
    }
    if (paidMetadataBefore !== await paidProteinMetadataFingerprint()) {
      throw new Error("Preserved paid protein pricing/metadata changed; refusing to certify the migration");
    }

    const result = {
      ok: true,
      mode: execute ? (publish ? "execute_and_publish" : "execute_prepare_only") : "dry_run",
      target,
      identities: {
        product: { id: BASIC_MEAL_PRODUCT_ID, key: BASIC_MEAL_PRODUCT_KEY },
        proteinGroup: { id: BASIC_MEAL_PROTEIN_GROUP_ID, key: BASIC_MEAL_PROTEIN_GROUP_KEY },
        carbGroup: { id: BASIC_MEAL_CARB_GROUP_ID, key: BASIC_MEAL_CARB_GROUP_KEY },
      },
      finalMenu: {
        regularProteins: proteinReport,
        preservedPaidProteins: paidReport,
        carbs: carbReport,
      },
      draft: draftPlan ? {
        draftId: draftPlan.draftId,
        previousRevisionHash: draftPlan.previousRevisionHash || "",
        updatedRevisionHash: draftResult?.revisionHash || null,
      } : null,
      publish: publishedVerification,
      deactivationPlans,
      safety: {
        createdOptions: 0,
        createdRelations: 0,
        deletedRecords: 0,
        historicalRewrites: 0,
        groupMerges: 0,
        premiumConfigChanges: 0,
        paidProteinPricingMetadataChanges: 0,
        basicSaladChanges: 0,
        premiumLargeSaladChanges: 0,
        wrongContextMoves: 0,
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
  runNormalization().catch((error) => {
    console.error(`[normalize-basic-meal] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  BASIC_MEAL_PRODUCT_ID,
  BASIC_MEAL_PRODUCT_KEY,
  BASIC_MEAL_PROTEIN_GROUP_ID,
  BASIC_MEAL_PROTEIN_GROUP_KEY,
  BASIC_MEAL_CARB_GROUP_ID,
  BASIC_MEAL_CARB_GROUP_KEY,
  EXECUTE_CONFIRMATION,
  PUBLISH_CONFIRMATION,
  FINAL_PROTEINS,
  FINAL_CARBS,
  PRESERVED_PAID_PROTEIN_KEYS,
  runNormalization,
};