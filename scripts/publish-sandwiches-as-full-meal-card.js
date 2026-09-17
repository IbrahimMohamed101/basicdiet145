#!/usr/bin/env node
"use strict";

require("dotenv").config();

const mongoose = require("mongoose");
const MealBuilderConfig = require("../src/models/MealBuilderConfig");
const MenuProduct = require("../src/models/MenuProduct");
const baseService = require("../src/services/subscription/mealBuilderConfigService");
const { resolveMongoUri } = require("../src/utils/mongoUriResolver");

const APPLY_ENV = "ALLOW_PUBLISH_SANDWICH_FULL_MEAL_CARD";
const SECTION_KEY = "sandwich";
const SELECTION_TYPE = "full_meal_product";

function parseArgs(argv = process.argv.slice(2)) {
  const allowed = new Set(["--apply", "--use-current-draft"]);
  const unknown = argv.filter((argument) => !allowed.has(argument));
  if (unknown.length) {
    throw new Error(`Unknown argument(s): ${unknown.join(" ")}`);
  }
  const applyRequested = argv.includes("--apply");
  const useCurrentDraft = argv.includes("--use-current-draft");
  if (useCurrentDraft && !applyRequested) {
    throw new Error("--use-current-draft can only be used with --apply");
  }
  return { applyRequested, useCurrentDraft };
}

function resolveApplyMode(applyRequested, env = process.env) {
  if (!applyRequested) return false;
  if (String(env[APPLY_ENV] || "").trim().toLowerCase() !== "true") {
    throw new Error(`--apply requires ${APPLY_ENV}=true`);
  }
  return true;
}

function sectionKeyOf(section = {}) {
  return String(section.key || section.sectionKey || "").trim().toLowerCase();
}

function isProductList(section = {}) {
  return String(section.sectionType || section.type || "") === "product_list";
}

function selectedProductIdsOf(section = {}) {
  return [
    ...new Set(
      (section.selectedProductIds || section.productIds || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    ),
  ];
}

function readySandwichQuery() {
  return {
    $and: [
      {
        $or: [
          { itemType: "cold_sandwich" },
          { "ui.cardVariant": "sandwich_card" },
        ],
      },
      { isActive: { $ne: false } },
      { isVisible: { $ne: false } },
      { isAvailable: { $ne: false } },
      { publishedAt: { $ne: null } },
      {
        $or: [
          { availableFor: "subscription" },
          { availableFor: { $exists: false } },
          { availableFor: { $size: 0 } },
        ],
      },
      { availableForSubscription: { $ne: false } },
    ],
  };
}

async function loadBaseSections() {
  const draft = await MealBuilderConfig.findOne({
    status: "draft",
    isCurrent: true,
  })
    .sort({ updatedAt: -1 })
    .lean();
  if (draft) {
    return {
      source: "current_draft",
      notes: draft.notes || "",
      sections: baseService.normalizeSections(draft.sections || []),
    };
  }

  const published = await baseService.getCurrentPublishedConfig();
  if (published) {
    return {
      source: "current_published",
      notes: published.notes || "",
      sections: baseService.normalizeSections(published.sections || []),
    };
  }

  return {
    source: "default_visual_template",
    notes: "",
    sections: await baseService.buildDefaultVisualTemplateSections(),
  };
}

function buildExplicitSandwichFullMealSection(productIds, existingSection = null) {
  return {
    key: SECTION_KEY,
    sectionType: "product_list",
    sourceKind: "product_list",
    includeMode: "selected",
    selectedOptionIds: [],
    selectedProductIds: productIds,
    selectionType: SELECTION_TYPE,
    titleOverride: {
      ar: existingSection?.titleOverride?.ar || "ساندويتشات",
      en: existingSection?.titleOverride?.en || "Sandwiches",
    },
    required: false,
    minSelections: 0,
    maxSelections: 1,
    multiSelect: false,
    visible: existingSection?.visible !== false,
    availableFor: ["subscription"],
    metadata: {
      ...(existingSection?.metadata || {}),
      requiresBuilder: false,
      treatAsFullMeal: true,
      configuredExplicitly: true,
      configuredBy: "publish_sandwiches_as_full_meal_card_script",
      cardKind: "full_meal_product",
    },
    rules: {
      ...(existingSection?.rules || {}),
      carbsRequired: false,
    },
    sortOrder: Number(existingSection?.sortOrder ?? 20),
  };
}

function buildNextSections(baseSections, sandwichProductIds) {
  const sandwichSet = new Set(sandwichProductIds.map(String));
  const existingSandwichSection = baseSections.find(
    (section) => sectionKeyOf(section) === SECTION_KEY
  );
  const movedFrom = [];
  const next = [];

  for (const section of baseSections) {
    const key = sectionKeyOf(section);
    if (key === SECTION_KEY) continue;

    if (!isProductList(section)) {
      next.push(section);
      continue;
    }

    const currentIds = selectedProductIdsOf(section);
    const retainedIds = currentIds.filter((id) => !sandwichSet.has(id));
    const removedIds = currentIds.filter((id) => sandwichSet.has(id));
    if (removedIds.length) {
      movedFrom.push({ sectionKey: key, productIds: removedIds });
    }

    if (section.includeMode === "selected" && retainedIds.length === 0) {
      continue;
    }

    next.push({
      ...section,
      selectedProductIds: retainedIds,
    });
  }

  next.push(
    buildExplicitSandwichFullMealSection(
      sandwichProductIds,
      existingSandwichSection
    )
  );

  return {
    sections: baseService.normalizeSections(next),
    movedFrom,
  };
}

async function publishSandwichesAsFullMealCard({
  apply = false,
  useCurrentDraft = false,
} = {}) {
  const products = await MenuProduct.find(readySandwichQuery())
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();
  if (!products.length) {
    throw new Error(
      "No active published subscription sandwich products were found by explicit itemType/cardVariant markers"
    );
  }

  const productIds = products.map((product) => String(product._id));
  const base = await loadBaseSections();
  if (apply && base.source === "current_draft" && !useCurrentDraft) {
    throw new Error(
      "A current Meal Builder draft exists. Dry-run it first, then rerun with --apply --use-current-draft only when publishing all current draft changes is intended."
    );
  }
  const built = buildNextSections(base.sections, productIds);
  const validation = await baseService.validatePayload({ sections: built.sections });

  const report = {
    mode: apply ? "apply" : "dry_run",
    source: base.source,
    requiresUseCurrentDraft:
      base.source === "current_draft" && useCurrentDraft !== true,
    sectionKey: SECTION_KEY,
    selectionType: SELECTION_TYPE,
    treatAsFullMeal: true,
    requiresBuilder: false,
    productCount: products.length,
    products: products.map((product) => ({
      id: String(product._id),
      key: product.key || "",
      itemType: product.itemType || "",
      cardVariant: product?.ui?.cardVariant || "",
    })),
    movedFrom: built.movedFrom,
    validation: {
      ready: validation.ready === true,
      errorCount: (validation.errors || []).length,
      warningCount: (validation.warnings || []).length,
      errors: validation.errors || [],
      warnings: validation.warnings || [],
    },
  };

  if (!validation.ready) {
    throw new Error(
      `Refusing to publish invalid Meal Builder: ${JSON.stringify(report.validation)}`
    );
  }
  if (!apply) return { ...report, status: "ready_to_publish" };

  const actor = { role: "script", userId: null };
  const draft = await baseService.updateDraft({
    sections: built.sections,
    notes: `${base.notes || ""}\nExplicit sandwich Full Meal card publication`.trim(),
    actor,
  });
  const published = await baseService.publishDraft({
    notes: "Publish all sandwich products as explicit Full Meals",
    actor,
  });

  const publishedSection = (published.config?.sections || []).find(
    (section) => sectionKeyOf(section) === SECTION_KEY
  );
  if (!publishedSection) {
    throw new Error("Published result is missing the sandwich section");
  }
  if (publishedSection.selectionType !== SELECTION_TYPE) {
    throw new Error(
      `Published sandwich section has unexpected selectionType: ${publishedSection.selectionType}`
    );
  }
  if (publishedSection.metadata?.treatAsFullMeal !== true) {
    throw new Error("Published sandwich section is not marked treatAsFullMeal=true");
  }

  return {
    ...report,
    status: "published",
    draftVersionId: draft.id || null,
    publishedVersionId: published.config?.id || null,
    revisionHash: published.config?.revisionHash || "",
  };
}

async function main() {
  const { applyRequested, useCurrentDraft } = parseArgs();
  const apply = resolveApplyMode(applyRequested);
  await mongoose.connect(resolveMongoUri(), {
    serverSelectionTimeoutMS: 10000,
    autoCreate: false,
    autoIndex: false,
  });
  try {
    const report = await publishSandwichesAsFullMealCard({
      apply,
      useCurrentDraft,
    });
    console.log(
      JSON.stringify({ database: mongoose.connection.name, ...report }, null, 2)
    );
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`[publish-sandwich-full-meal-card] ${error.message}`);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exitCode = 1;
  });
}

module.exports = {
  APPLY_ENV,
  buildNextSections,
  parseArgs,
  publishSandwichesAsFullMealCard,
  resolveApplyMode,
};
