#!/usr/bin/env node
"use strict";

require("dotenv").config();

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
const { BSON } = require("mongodb");

const MealBuilderConfig = require("../src/models/MealBuilderConfig");
const MenuOption = require("../src/models/MenuOption");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const mealBuilderService = require("../src/services/subscription/mealBuilderConfigService");
const { getDbNameFromUri, resolveMongoUri } = require("../src/utils/mongoUriResolver");
const {
  readDocument,
  recordMutation,
  rollbackPrepublishMutations,
} = require("./lib/weeklyMenuSafeRollback");

const manifest = require("./fixtures/subscription-weekly-menu-2026-10-16.json");

const BASIC_MEAL_ID = "6a62197079ee075a57f70106";
const GROUP_IDS = {
  chicken: "6a62197279ee075a57f70107",
  beef: "6a62197279ee075a57f70107",
  fish: "6a62197279ee075a57f70107",
  carbs: "6a62197279ee075a57f70108",
};
const TARGET_SECTION_KEYS = Object.keys(manifest.sections);
const EXPECTED_COUNTS = { chicken: 11, beef: 3, fish: 2, carbs: 9 };
const NEW_OPTION_DEFINITIONS = {
  mushroom_chicken: { sectionKey: "chicken", proteinFamilyKey: "chicken", displayCategoryKey: "chicken" },
  honey_mustard_chicken: { sectionKey: "chicken", proteinFamilyKey: "chicken", displayCategoryKey: "chicken" },
  spicy_chicken: { sectionKey: "chicken", proteinFamilyKey: "chicken", displayCategoryKey: "chicken" },
  chinese_rice: { sectionKey: "carbs", proteinFamilyKey: "", displayCategoryKey: "standard_carbs" },
};
const REACTIVATE_IDS = new Set(
  Object.values(manifest.sections).flat()
    .filter((row) => row.action === "reactivate_subscription_only")
    .map((row) => String(row.optionId))
);

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function readArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex")}`;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function optionRows() {
  return Object.entries(manifest.sections).flatMap(([sectionKey, rows]) => rows.map((row, sectionIndex) => ({
    ...row,
    sectionKey,
    sectionIndex,
  })));
}

function assertManifest() {
  for (const [sectionKey, expected] of Object.entries(EXPECTED_COUNTS)) {
    assert.equal(manifest.sections[sectionKey]?.length, expected, `${sectionKey} manifest count`);
  }
  assert.equal(optionRows().length, 25, "manifest must contain exactly 25 options");
  const names = optionRows().flatMap((row) => [row.name.ar, row.name.en]);
  assert.equal(new Set(names).size, 50, "manifest bilingual names must be unique");
}

async function customerState() {
  const result = {};
  for (const collectionName of ["orders", "subscriptions", "subscriptiondays"]) {
    const rows = await mongoose.connection.db.collection(collectionName)
      .find({}, { projection: { _id: 1, updatedAt: 1 } })
      .sort({ _id: 1 })
      .toArray();
    result[collectionName] = {
      count: rows.length,
      identityRevision: digest(rows.map((row) => [String(row._id), row.updatedAt ? new Date(row.updatedAt).toISOString() : null])),
    };
  }
  return result;
}

async function currentPublished() {
  return MealBuilderConfig.findOne({ status: "published", isCurrent: true })
    .sort({ publishedAt: -1, updatedAt: -1 })
    .lean();
}

function targetSections(config) {
  return new Map((config.sections || []).filter((section) => TARGET_SECTION_KEYS.includes(section.key)).map((section) => [section.key, section]));
}

async function isAlreadyPublished(config) {
  if (!config) return false;
  const sections = targetSections(config);
  if (sections.size !== TARGET_SECTION_KEYS.length) return false;
  const ids = optionRows().map((row) => row.optionId).filter(Boolean);
  const knownOptions = await MenuOption.find({ _id: { $in: ids } }).lean();
  const byId = new Map(knownOptions.map((row) => [String(row._id), row]));
  for (const row of optionRows()) {
    const option = row.optionId ? byId.get(String(row.optionId)) : await MenuOption.findOne({
      groupId: GROUP_IDS[row.sectionKey],
      key: row.proposedKey,
    }).lean();
    if (!option) return false;
    const section = sections.get(row.sectionKey);
    if (!(section.selectedOptionIds || []).map(String).includes(String(option._id))) return false;
    const override = section.metadata?.optionNameOverrides?.[String(option._id)];
    if (override?.ar !== row.name.ar || override?.en !== row.name.en) return false;
  }
  return TARGET_SECTION_KEYS.every((key) => (sections.get(key).selectedOptionIds || []).length === EXPECTED_COUNTS[key]);
}

async function createBackup(before, destination) {
  const targetIds = optionRows().map((row) => row.optionId).filter(Boolean).map((id) => new mongoose.Types.ObjectId(id));
  const data = {
    createdAt: new Date(),
    database: mongoose.connection.name,
    manifestRevision: digest(manifest),
    mealBuilderConfigs: await MealBuilderConfig.find({}).lean(),
    menuOptions: await MenuOption.find({
      $or: [
        { _id: { $in: targetIds } },
        ...Object.entries(NEW_OPTION_DEFINITIONS).map(([key, definition]) => ({ groupId: GROUP_IDS[definition.sectionKey], key })),
      ],
    }).lean(),
    productGroupOptions: await ProductGroupOption.find({
      productId: BASIC_MEAL_ID,
      groupId: { $in: [...new Set(Object.values(GROUP_IDS))] },
    }).lean(),
    customerState: before,
  };
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.writeFileSync(destination, BSON.EJSON.stringify(data, { relaxed: false, indent: 2 }), { mode: 0o600 });
  return data;
}

async function resolveOptions({ apply, journal = [] }) {
  const resolved = [];
  const createdOptionIds = [];
  const createdRelationIds = [];
  for (const row of optionRows()) {
    let option = row.optionId ? await MenuOption.findById(row.optionId) : null;
    if (!option && row.proposedKey) {
      option = await MenuOption.findOne({ groupId: GROUP_IDS[row.sectionKey], key: row.proposedKey });
    }
    if (!option && apply) {
      const definition = NEW_OPTION_DEFINITIONS[row.proposedKey];
      assert.ok(definition, `new option definition missing for ${row.proposedKey}`);
      option = await MenuOption.create({
        groupId: GROUP_IDS[row.sectionKey],
        key: row.proposedKey,
        name: row.name,
        description: { ar: "", en: "" },
        imageUrl: "",
        extraPriceHalala: 0,
        extraWeightUnitGrams: 0,
        extraWeightPriceHalala: 0,
        extraFeeHalala: 0,
        availableFor: ["subscription"],
        availableForSubscription: true,
        nutrition: { calories: null, proteinGrams: null, carbGrams: null, fatGrams: null },
        nutritionDataStatus: "unknown",
        proteinFamilyKey: definition.proteinFamilyKey,
        displayCategoryKey: definition.displayCategoryKey,
        selectionType: "standard_meal",
        ruleTags: [],
        isActive: true,
        isVisible: true,
        isAvailable: true,
        sortOrder: row.sectionIndex + 1,
        publishedAt: new Date(),
      });
      createdOptionIds.push(String(option._id));
      await recordMutation(mongoose.connection.db, journal, "menuoptions", null, option._id);
    }
    if (!option) {
      resolved.push({ ...row, option: null });
      continue;
    }
    assert.equal(String(option.groupId), GROUP_IDS[row.sectionKey], `${row.name.en} belongs to the wrong option group`);
    if (apply && REACTIVATE_IDS.has(String(option._id))) {
      const beforeOption = await readDocument(mongoose.connection.db, "menuoptions", option._id);
      option.isActive = true;
      option.isVisible = true;
      option.isAvailable = true;
      option.availableFor = ["subscription"];
      option.availableForSubscription = true;
      if (!option.publishedAt) option.publishedAt = new Date();
      await option.save();
      await recordMutation(mongoose.connection.db, journal, "menuoptions", beforeOption, option._id);
    }
    if (apply) {
      let relation = await ProductGroupOption.findOne({
        productId: BASIC_MEAL_ID,
        groupId: GROUP_IDS[row.sectionKey],
        optionId: option._id,
      });
      if (!relation) {
        relation = await ProductGroupOption.create({
          productId: BASIC_MEAL_ID,
          groupId: GROUP_IDS[row.sectionKey],
          optionId: option._id,
          extraPriceHalala: null,
          extraWeightUnitGrams: null,
          extraWeightPriceHalala: null,
          isActive: true,
          isVisible: true,
          isAvailable: true,
          sortOrder: Number(option.sortOrder || 0),
        });
        createdRelationIds.push(String(relation._id));
        await recordMutation(mongoose.connection.db, journal, "productgroupoptions", null, relation._id);
      } else if (REACTIVATE_IDS.has(String(option._id)) || createdOptionIds.includes(String(option._id))) {
        const beforeRelation = await readDocument(mongoose.connection.db, "productgroupoptions", relation._id);
        relation.isActive = true;
        relation.isVisible = true;
        relation.isAvailable = true;
        await relation.save();
        await recordMutation(mongoose.connection.db, journal, "productgroupoptions", beforeRelation, relation._id);
      }
    }
    resolved.push({ ...row, option });
  }
  return { rows: resolved, createdOptionIds, createdRelationIds };
}

function desiredSections(published, resolvedRows) {
  const rowsBySection = new Map(TARGET_SECTION_KEYS.map((key) => [key, resolvedRows.filter((row) => row.sectionKey === key)]));
  return plain(published.sections).map((section) => {
    if (!rowsBySection.has(section.key)) return section;
    const rows = rowsBySection.get(section.key);
    assert.equal(rows.filter((row) => row.option).length, EXPECTED_COUNTS[section.key], `${section.key} must resolve completely`);
    const overrides = Object.fromEntries(rows.map((row) => [String(row.option._id), row.name]));
    return {
      ...section,
      selectedOptionIds: rows.map((row) => String(row.option._id)),
      includeMode: "selected",
      metadata: { ...(section.metadata || {}), optionNameOverrides: overrides },
    };
  });
}

function flattenPlannerOptions(catalog, sectionKey) {
  const section = (catalog.sections || []).find((item) => item.key === sectionKey);
  assert.ok(section, `planner section ${sectionKey} missing`);
  return (section.products || []).flatMap((product) =>
    (product.optionGroups || []).flatMap((group) => group.options || [])
  );
}

async function verifyPublished(config, resolvedRows, originalConfig) {
  const reports = {};
  for (const lang of ["ar", "en"]) {
    const planner = await mealBuilderService.buildPlannerCatalogFromPublishedBuilder({ config, lang });
    reports[lang] = {};
    for (const sectionKey of TARGET_SECTION_KEYS) {
      const expected = resolvedRows.filter((row) => row.sectionKey === sectionKey);
      const actual = flattenPlannerOptions(planner, sectionKey);
      assert.equal(actual.length, EXPECTED_COUNTS[sectionKey], `${sectionKey}/${lang} count`);
      assert.deepEqual(actual.map((item) => item.id), expected.map((row) => String(row.option._id)), `${sectionKey}/${lang} order and IDs`);
      assert.deepEqual(actual.map((item) => item.name), expected.map((row) => row.name[lang]), `${sectionKey}/${lang} names`);
      assert.deepEqual(actual.map((item) => item.nameI18n), expected.map((row) => row.name), `${sectionKey}/${lang} bilingual names`);
      reports[lang][sectionKey] = actual.length;
    }
    const excludedIds = new Set(manifest.excludeFromWeeklySectionsOnly.map((row) => row.optionId));
    assert.equal(TARGET_SECTION_KEYS.flatMap((key) => flattenPlannerOptions(planner, key)).some((row) => excludedIds.has(row.id)), false, `excluded options visible in ${lang}`);
  }
  const withoutGeneratedSectionId = (section) => {
    const { _id, ...rest } = section;
    return rest;
  };
  const beforeOutside = plain(originalConfig.sections)
    .filter((section) => !TARGET_SECTION_KEYS.includes(section.key))
    .map(withoutGeneratedSectionId);
  const afterOutside = plain(config.sections)
    .filter((section) => !TARGET_SECTION_KEYS.includes(section.key))
    .map(withoutGeneratedSectionId);
  assert.deepEqual(afterOutside, beforeOutside, "non-target Meal Builder sections changed");
  return reports;
}

async function resumeInterruptedPublication({ published, backupPath }) {
  assert.ok(backupPath, "--resume-interrupted-prepublish requires --backup <path>");
  const backup = BSON.EJSON.parse(fs.readFileSync(path.resolve(backupPath), "utf8"));
  const resolution = await resolveOptions({ apply: false });
  assert.equal(resolution.rows.filter((row) => !row.option).length, 0, "all 25 options must already exist before resuming");
  const sections = desiredSections(published, resolution.rows);
  const draft = await MealBuilderConfig.findOne({ status: "draft", isCurrent: true }).sort({ updatedAt: -1 }).lean();
  assert.ok(draft, "interrupted current draft not found");
  assert.equal(
    mealBuilderService.computeRevisionHash({ sections: draft.sections }),
    mealBuilderService.computeRevisionHash({ sections }),
    "current draft does not match the reviewed 25-option menu"
  );
  const validation = await mealBuilderService.validatePayload({ sections: draft.sections });
  assert.equal(validation.ready, true, JSON.stringify(validation));
  const publication = await mealBuilderService.publishDraft({
    actor: {},
    notes: "Subscription weekly menu: 16 Protein + 9 Carbs, bilingual names confirmed by restaurant on 2026-10-16",
  });
  const newPublished = await currentPublished();
  assert.equal(String(newPublished._id), publication.config.id, "published config identity mismatch");
  assert.equal(newPublished.versionNumber, Number(published.versionNumber) + 1, "published version did not increment once");
  const apiVerification = await verifyPublished(newPublished, resolution.rows, published);
  const afterCustomerState = await customerState();
  const customerStateUnchanged = JSON.stringify(afterCustomerState) === JSON.stringify(backup.customerState);
  console.log(JSON.stringify({
    status: "published_after_interrupted_prepublish",
    database: mongoose.connection.name,
    backupPath: path.resolve(backupPath),
    previousVersion: published.versionNumber,
    versionNumber: newPublished.versionNumber,
    versionId: String(newPublished._id),
    revisionHash: newPublished.revisionHash,
    apiVerification,
    validation: { ready: publication.validation.ready, errors: publication.validation.errors.length, warnings: publication.validation.warnings.length },
    customerStateBefore: backup.customerState,
    customerStateAfter: afterCustomerState,
    customerStateUnchanged,
  }, null, 2));
}

async function main() {
  assertManifest();
  const apply = hasFlag("execute");
  if (apply && process.env.ALLOW_SUBSCRIPTION_WEEKLY_MENU_PRODUCTION_UPDATE !== "true") {
    throw new Error("--execute requires ALLOW_SUBSCRIPTION_WEEKLY_MENU_PRODUCTION_UPDATE=true");
  }
  const uri = resolveMongoUri();
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, autoIndex: false });
  let backup;
  let createdOptionIds = [];
  let createdRelationIds = [];
  let publishedByThisRun = false;
  let draftMutationStarted = false;
  let originalPublished = null;
  let backupPath = null;
  const journal = [];
  try {
    const published = await currentPublished();
    assert.ok(published, "current published MealBuilderConfig not found");
    originalPublished = published;
    if (await isAlreadyPublished(published)) {
      console.log(JSON.stringify({ status: "already_published", database: mongoose.connection.name, versionNumber: published.versionNumber, revisionHash: published.revisionHash }, null, 2));
      return;
    }
    assert.equal(String(published._id), manifest.expectedPublishedVersionId, "published MealBuilderConfig changed since audit");
    assert.equal(published.revisionHash, manifest.expectedPublishedRevisionHash, "published MealBuilderConfig revision changed since audit");

    if (apply && hasFlag("resume-interrupted-prepublish")) {
      await resumeInterruptedPublication({ published, backupPath: readArg("backup") });
      return;
    }

    const beforeCustomerState = apply ? await customerState() : null;
    backupPath = path.resolve(process.cwd(), "tmp", "weekly-menu-release-20261016", `before-${new Date().toISOString().replace(/[:.]/g, "-")}.ejson`);
    if (apply) backup = await createBackup(beforeCustomerState, backupPath);
    const resolution = await resolveOptions({ apply, journal });
    createdOptionIds = resolution.createdOptionIds;
    createdRelationIds = resolution.createdRelationIds;
    const unresolved = resolution.rows.filter((row) => !row.option).map((row) => ({ sectionKey: row.sectionKey, key: row.proposedKey, name: row.name }));

    if (!apply) {
      console.log(JSON.stringify({
        status: "dry_run",
        database: getDbNameFromUri(uri),
        currentVersion: published.versionNumber,
        currentRevision: published.revisionHash,
        retainedExisting: resolution.rows.length - unresolved.length,
        toCreate: unresolved,
        targetCounts: EXPECTED_COUNTS,
      }, null, 2));
      return;
    }

    assert.equal(unresolved.length, 0, "all 25 options must resolve before publication");
    const sections = desiredSections(published, resolution.rows);
    const validation = await mealBuilderService.validatePayload({ sections });
    assert.equal(validation.ready, true, JSON.stringify(validation));
    // From this point, the service may mutate draft/configuration documents.
    // Never restore all configs from a stale backup on failure.
    draftMutationStarted = true;
    await mealBuilderService.resetDraftToPublished({ actor: {} });
    await mealBuilderService.updateDraft({
      sections,
      actor: {},
      notes: "Subscription weekly menu: 16 Protein + 9 Carbs, bilingual names confirmed by restaurant on 2026-10-16",
    });
    const publication = await mealBuilderService.publishDraft({
      actor: {},
      notes: "Subscription weekly menu: 16 Protein + 9 Carbs, bilingual names confirmed by restaurant on 2026-10-16",
    });
    publishedByThisRun = true;
    const newPublished = await currentPublished();
    assert.equal(String(newPublished._id), publication.config.id, "published config identity mismatch");
    assert.equal(newPublished.versionNumber, Number(published.versionNumber) + 1, "published version did not increment once");
    const apiVerification = await verifyPublished(newPublished, resolution.rows, published);
    const afterCustomerState = await customerState();
    const customerStateUnchanged = JSON.stringify(afterCustomerState) === JSON.stringify(beforeCustomerState);

    console.log(JSON.stringify({
      status: "published",
      database: mongoose.connection.name,
      backupPath,
      previousVersion: published.versionNumber,
      versionNumber: newPublished.versionNumber,
      versionId: String(newPublished._id),
      revisionHash: newPublished.revisionHash,
      createdOptionIds,
      createdRelationIds,
      reactivatedOptionIds: [...REACTIVATE_IDS],
      hiddenFromWeeklySectionIds: manifest.excludeFromWeeklySectionsOnly.map((row) => row.optionId),
      apiVerification,
      validation: { ready: publication.validation.ready, errors: publication.validation.errors.length, warnings: publication.validation.warnings.length },
      customerStateBefore: beforeCustomerState,
      customerStateAfter: afterCustomerState,
      customerStateUnchanged,
    }, null, 2));
  } catch (error) {
    if (backup && !publishedByThisRun) {
      if (draftMutationStarted) {
        console.error(`SAFE_RECOVERY_REQUIRED: Draft/publication may have changed. No automatic database-wide restore. Inspect backup ${backupPath} and current published revision before manual recovery.`);
      } else {
        await rollbackPrepublishMutations(mongoose.connection.db, journal, originalPublished).then((report) => {
          console.error(`Safe pre-publish rollback: ${JSON.stringify(report)}. Backup: ${backupPath}`);
        }).catch((rollbackError) => {
          console.error(`SAFE_RECOVERY_REQUIRED: Automatic targeted rollback declined or incomplete; backup ${backupPath}: ${rollbackError.stack || rollbackError}`);
        });
      }
    }
    throw error;
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
