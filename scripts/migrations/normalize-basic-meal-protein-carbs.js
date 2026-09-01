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
  { key: "lemon_bbq_chicken", ar: "دجاج ليمون باربكيو", en: "Lemon BBQ Chicken", family: "chicken", order: 7, expectedId: null, allowCreate: true },
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
    const actual = argValue(argv, name);
    if (actual !== expected) {
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

    const foreignOwners = activeOwners.filter(
      (relation) => strId(relation.productId) !== BASIC_MEAL_PRODUCT_ID
    );
    if (foreignOwners.length) {
      throw new Error(
        `Refusing normalization: group ${groupId} has another active product owner: ` +
        foreignOwners.map((row) => strId(row.productId)).join(",")
      );
    }

    const own = activeOwners.find(
      (relation) => strId(relation.productId) === BASIC_MEAL_PRODUCT_ID
    );
    if (!own) {
      throw new Error(`Refusing normalization: Basic Meal is not the active owner of group ${groupId}`);
    }
  }

  return { product, proteinGroup, carbGroup };
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

async function protectedPremiumOptionIds() {
  const configs = await PremiumUpgradeConfig.find({
    sourceType: "menu_option",
    status: { $ne: "archived" },
  }).lean();

  const protectedIds = new Set(
    configs
      .filter((row) => {
        const sourceProductId = strId(row.sourceProductId);
        const sourceGroupId = strId(row.sourceGroupId);
        return (!sourceProductId || sourceProductId === BASIC_MEAL_PRODUCT_ID)
          && (!sourceGroupId || sourceGroupId === BASIC_MEAL_PROTEIN_GROUP_ID);
      })
      .map((row) => strId(row.sourceId))
      .filter(Boolean)
  );

  const configsWithPremiumSections = await MealBuilderConfig.find({
    status: { $in: ["draft", "published"] },
    isCurrent: true,
  }).lean();

  for (const config of configsWithPremiumSections) {
    const premiumSection = (config.sections || []).find((section) => section.key === "premium");
    for (const optionId of premiumSection?.selectedOptionIds || []) {
      protectedIds.add(strId(optionId));
    }
  }

  return protectedIds;
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

async function resolveDefinitions(definitions, groupId, { strictIdentityPins }) {
  const resolved = [];
  const missing = [];

  for (const definition of definitions) {
    const option = await MenuOption.findOne({ groupId, key: definition.key }).lean();
    if (!option) {
      if (definition.allowCreate) {
        missing.push(definition);
        resolved.push({ definition, option: null, plannedCreate: true });
        continue;
      }
      throw new Error(`Approved option missing from canonical group: ${definition.key}`);
    }

    if (
      strictIdentityPins &&
      definition.expectedId &&
      strId(option._id) !== definition.expectedId
    ) {
      throw new Error(
        `Identity pin mismatch for ${definition.key}: expected ${definition.expectedId}, got ${strId(option._id)}`
      );
    }

    resolved.push({ definition, option, plannedCreate: false });
  }

  return { resolved, missing };
}

function targetOptionPatch(definition, kind) {
  return {
    name: { ar: definition.ar, en: definition.en },
    availableFor: ["one_time", "subscription"],
    availableForSubscription: true,
    selectionType: "standard_meal",
    proteinFamilyKey: kind === "protein" ? definition.family : "",
    displayCategoryKey: kind === "protein" ? definition.family : "standard_carbs",
    premiumKey: "",
    extraFeeHalala: 0,
    extraPriceHalala: 0,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder: definition.order,
  };
}

async function ensureApprovedOptions(resolution, groupId, kind, { execute }) {
  const rows = [];

  for (const entry of resolution.resolved) {
    const { definition } = entry;
    let option = entry.option;

    if (!option && entry.plannedCreate) {
      if (!execute) {
        rows.push({
          key: definition.key,
          id: null,
          action: "create",
          groupId,
          nameAr: definition.ar,
        });
        continue;
      }

      option = await MenuOption.create({
        groupId,
        key: definition.key,
        description: { ar: definition.ar, en: definition.en },
        ...targetOptionPatch(definition, kind),
        publishedAt: new Date(),
      });
      option = option.toObject();
    } else if (execute) {
      option = await MenuOption.findOneAndUpdate(
        { _id: option._id, groupId, key: definition.key },
        { $set: targetOptionPatch(definition, kind) },
        { new: true, runValidators: true }
      ).lean();
    }

    const optionId = strId(option._id);
    const relationPatch = {
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: definition.order,
    };

    if (execute) {
      await ProductGroupOption.updateOne(
        {
          productId: BASIC_MEAL_PRODUCT_ID,
          groupId,
          optionId,
        },
        {
          $set: relationPatch,
          $setOnInsert: {
            productId: BASIC_MEAL_PRODUCT_ID,
            groupId,
            optionId,
            extraPriceHalala: 0,
            extraWeightPriceHalala: 0,
            extraWeightUnitGrams: 0,
          },
        },
        { upsert: true, runValidators: true }
      );
    }

    rows.push({
      key: definition.key,
      id: optionId,
      action: entry.plannedCreate ? "create" : "reuse",
      groupId,
      nameAr: definition.ar,
    });
  }

  return rows;
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function exactIdsByFamily(proteinRows) {
  const byKey = new Map(proteinRows.map((row) => [row.key, row.id]));
  const result = { chicken: [], beef: [], fish: [] };
  for (const definition of FINAL_PROTEINS) {
    const id = byKey.get(definition.key);
    if (!id) continue;
    result[definition.family].push(id);
  }
  return result;
}

async function currentDraftNonTargetFingerprint() {
  const draft = await MealBuilderConfig.findOne({
    status: "draft",
    isCurrent: true,
  }).sort({ updatedAt: -1 }).lean();
  if (!draft) return "";
  const protectedSections = (draft.sections || [])
    .filter((section) => !["chicken", "beef", "fish", "carbs"].includes(section.key))
    .map((section) => {
      const copy = clonePlain(section);
      delete copy._id;
      return copy;
    });
  return stableJson(protectedSections);
}

async function buildDraftPlan(proteinRows, carbRows) {
  if (proteinRows.some((row) => !row.id) || carbRows.some((row) => !row.id)) {
    return {
      canSync: false,
      reason: "one or more approved options still require creation",
      sections: null,
    };
  }

  const currentDraft = await MealBuilderConfig.findOne({
    status: "draft",
    isCurrent: true,
  }).sort({ updatedAt: -1 });

  if (!currentDraft) {
    throw new Error("No current Meal Builder draft exists");
  }

  const sections = clonePlain(currentDraft.sections || []);
  const familyIds = exactIdsByFamily(proteinRows);
  const carbIds = carbRows.map((row) => row.id);

  const expected = {
    chicken: familyIds.chicken,
    beef: familyIds.beef,
    fish: familyIds.fish,
    carbs: carbIds,
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
  }

  return {
    canSync: true,
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

  const proteinKeys = collectPlannerKeys(state.plannerCatalog, ["chicken", "beef", "fish"]);
  const carbKeys = collectPlannerKeys(state.plannerCatalog, ["carbs"]);

  assertSetEqual(proteinKeys, FINAL_PROTEINS.map((row) => row.key), "Published planner proteins");
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

async function deactivateNonApprovedAfterPublish({ execute }) {
  const approvedProteinIds = new Set(
    (await MenuOption.find({
      groupId: BASIC_MEAL_PROTEIN_GROUP_ID,
      key: { $in: FINAL_PROTEINS.map((row) => row.key) },
    }).select("_id").lean()).map((row) => strId(row._id))
  );
  const approvedCarbIds = new Set(
    (await MenuOption.find({
      groupId: BASIC_MEAL_CARB_GROUP_ID,
      key: { $in: FINAL_CARBS.map((row) => row.key) },
    }).select("_id").lean()).map((row) => strId(row._id))
  );
  const premiumIds = await protectedPremiumOptionIds();

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
      if (kind === "protein" && premiumIds.has(optionId)) continue;

      const option = await MenuOption.findById(optionId).lean();
      if (!option) {
        throw new Error(`Orphan Basic Meal relation found for option ${optionId}`);
      }

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
  if (publish && !execute) {
    throw new Error("--publish requires --execute");
  }

  if (execute) requireLiveConfirmations(argv);
  if (publish) requirePublishConfirmation(argv);

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
    const strictIdentityPins = process.env.NODE_ENV !== "test";
    await assertCanonicalIdentity();

    const premiumBefore = await premiumFingerprint();
    const premiumBuilderBefore = await premiumBuilderFingerprint();
    const nonTargetDraftBefore = skipDraftSync ? null : await currentDraftNonTargetFingerprint();

    const proteinResolution = await resolveDefinitions(
      FINAL_PROTEINS,
      BASIC_MEAL_PROTEIN_GROUP_ID,
      { strictIdentityPins }
    );
    const carbResolution = await resolveDefinitions(
      FINAL_CARBS,
      BASIC_MEAL_CARB_GROUP_ID,
      { strictIdentityPins }
    );

    const proteinRows = await ensureApprovedOptions(
      proteinResolution,
      BASIC_MEAL_PROTEIN_GROUP_ID,
      "protein",
      { execute }
    );
    const carbRows = await ensureApprovedOptions(
      carbResolution,
      BASIC_MEAL_CARB_GROUP_ID,
      "carb",
      { execute }
    );

    let draftPlan = null;
    let draftResult = null;
    let publishedVerification = null;
    let deactivationPlans = [];

    if (!skipDraftSync) {
      draftPlan = await buildDraftPlan(proteinRows, carbRows);

      if (execute && !draftPlan.canSync) {
        throw new Error("Execute created an approved option but draft plan still cannot resolve all IDs");
      }

      if (execute && draftPlan.canSync) {
        draftResult = await updateDraft({
          sections: draftPlan.sections,
          notes: "Final Basic Meal restaurant menu: 13 regular proteins + 9 carbs",
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
          throw new Error(`Draft protein count is ${new Set(draftProteinIds).size}, expected 13`);
        }
        if (new Set(draftCarbIds).size !== 9) {
          throw new Error(`Draft carb count is ${new Set(draftCarbIds).size}, expected 9`);
        }

        const nonTargetDraftAfter = await currentDraftNonTargetFingerprint();
        if (nonTargetDraftBefore !== nonTargetDraftAfter) {
          throw new Error("A non-Basic-Meal draft section changed; refusing to publish");
        }

        const premiumPrePublish = await premiumFingerprint();
        const premiumBuilderPrePublish = await premiumBuilderFingerprint();
        if (premiumBefore !== premiumPrePublish || premiumBuilderBefore !== premiumBuilderPrePublish) {
          throw new Error("Premium state changed during draft preparation; refusing to publish");
        }
      }

      if (publish) {
        await publishDraft({
          notes: "Publish final Basic Meal restaurant menu (13 proteins / 9 carbs)",
        });

        publishedVerification = await assertPublishedPlannerFinal();

        deactivationPlans = await deactivateNonApprovedAfterPublish({ execute: true });

        publishedVerification = await assertPublishedPlannerFinal();
      } else {
        deactivationPlans = await deactivateNonApprovedAfterPublish({ execute: false });
      }
    }

    const premiumAfter = await premiumFingerprint();
    const premiumBuilderAfter = await premiumBuilderFingerprint();
    if (premiumBefore !== premiumAfter) {
      throw new Error("PremiumUpgradeConfig fingerprint changed; refusing to certify the migration");
    }
    if (premiumBuilderBefore !== premiumBuilderAfter) {
      throw new Error("Meal Builder Premium section changed; refusing to certify the migration");
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
        regularProteins: proteinRows,
        carbs: carbRows,
      },
      draft: draftPlan ? {
        canSync: draftPlan.canSync,
        draftId: draftPlan.draftId || null,
        previousRevisionHash: draftPlan.previousRevisionHash || "",
        updatedRevisionHash: draftResult?.revisionHash || null,
      } : null,
      publish: publishedVerification,
      deactivationPlans,
      safety: {
        deletedRecords: 0,
        historicalRewrites: 0,
        groupMerges: 0,
        premiumConfigChanges: 0,
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
  runNormalization,
};
