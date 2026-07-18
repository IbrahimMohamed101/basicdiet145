const MealBuilderConfig = require("../../../models/MealBuilderConfig");
const MenuProduct = require("../../../models/MenuProduct");
const { CONTRACT_VERSION, CONFIG_VERSION, DynamicMealPlannerError } = require("./constants");
const {
  uniqueIds,
  slugify,
  normalizeBoolean,
  isPremiumDynamicSection,
  normalizeSection,
  normalizeSections,
  draftHashForSections,
  serializeConfig,
} = require("./core");
const { buildProductPicker, buildOptionPicker } = require("./catalog");
const { buildDefaultSections, compileSections, validateConfigObject, compileContract } = require("./compiler");

async function getCurrentDraftConfig() {
  return MealBuilderConfig.findOne({ status: "draft", isCurrent: true }).sort({ updatedAt: -1 }).lean();
}

async function getCurrentPublishedConfig() {
  return MealBuilderConfig.findOne({ status: "published", isCurrent: true }).sort({ versionNumber: -1, publishedAt: -1 }).lean();
}

async function createDraft({ sections, notes = "", actor = {} } = {}) {
  const published = await getCurrentPublishedConfig();
  const normalizedSections = sections
    ? normalizeSections(sections)
    : published
      ? normalizeSections(published.sections || [])
      : await buildDefaultSections();
  await MealBuilderConfig.updateMany({ status: "draft", isCurrent: true }, { $set: { isCurrent: false } });
  const draft = await MealBuilderConfig.create({
    status: "draft",
    isCurrent: true,
    contractVersion: CONFIG_VERSION,
    basedOnPublishedVersionId: published?._id || null,
    source: "dashboard",
    createdBySystem: false,
    sections: normalizedSections,
    notes: String(notes || ""),
    createdBy: actor.userId || null,
    updatedBy: actor.userId || null,
  });
  return serializeConfig(draft);
}

async function openWorkingDraft({ actor = {} } = {}) {
  const existing = await getCurrentDraftConfig();
  if (existing) return serializeConfig(existing);
  return createDraft({ actor });
}

async function requireDraft({ actor = {} } = {}) {
  const existing = await getCurrentDraftConfig();
  if (existing) return existing;
  await createDraft({ actor });
  return getCurrentDraftConfig();
}

function assertExpectedDraftHash(draft, expectedDraftHash) {
  if (!expectedDraftHash) return;
  const actual = draftHashForSections(draft.sections || []);
  if (actual !== String(expectedDraftHash)) {
    throw new DynamicMealPlannerError(
      "Meal Planner draft changed since it was loaded",
      "MEAL_PLANNER_DRAFT_CONFLICT",
      409,
      { expectedDraftHash: String(expectedDraftHash), actualDraftHash: actual }
    );
  }
}

async function saveDraftSections(draft, sections, { notes, actor = {} } = {}) {
  const normalizedSections = normalizeSections(sections);
  const row = await MealBuilderConfig.findById(draft._id);
  if (!row) throw new DynamicMealPlannerError("Meal Planner draft not found", "MEAL_PLANNER_DRAFT_NOT_FOUND", 404);
  row.contractVersion = CONFIG_VERSION;
  row.sections = normalizedSections;
  if (notes !== undefined) row.notes = String(notes || "");
  row.updatedBy = actor.userId || null;
  await row.save();
  return serializeConfig(row);
}

async function updateDraft({ sections, notes, actor = {}, expectedDraftHash } = {}) {
  const draft = await requireDraft({ actor });
  assertExpectedDraftHash(draft, expectedDraftHash);
  return saveDraftSections(draft, sections || [], { notes, actor });
}

async function resetDraftToPublished({ actor = {} } = {}) {
  const published = await getCurrentPublishedConfig();
  if (!published) throw new DynamicMealPlannerError("No published Meal Planner exists", "MEAL_PLANNER_NOT_PUBLISHED", 404);
  await MealBuilderConfig.updateMany({ status: "draft", isCurrent: true }, { $set: { isCurrent: false } });
  const draft = await MealBuilderConfig.create({
    status: "draft",
    isCurrent: true,
    contractVersion: CONFIG_VERSION,
    basedOnPublishedVersionId: published._id,
    source: "dashboard",
    createdBySystem: false,
    sections: normalizeSections(published.sections || []),
    notes: published.notes || "",
    createdBy: actor.userId || null,
    updatedBy: actor.userId || null,
  });
  return { reset: true, draft: serializeConfig(draft) };
}

async function createSection({ section = {}, actor = {}, expectedDraftHash } = {}) {
  const draft = await requireDraft({ actor });
  assertExpectedDraftHash(draft, expectedDraftHash);
  const sections = normalizeSections(draft.sections || []);
  const normalized = normalizeSection(section, sections.length);
  if (sections.some((row) => row.key === normalized.key)) {
    throw new DynamicMealPlannerError("Meal Planner section key already exists", "MEAL_PLANNER_DUPLICATE_SECTION_KEY", 409, { sectionKey: normalized.key });
  }
  const saved = await saveDraftSections(draft, [...sections, normalized], { actor });
  return { action: "section_created", section: normalized, draft: saved };
}

async function updateSection({ sectionKey, patch = {}, actor = {}, expectedDraftHash } = {}) {
  const draft = await requireDraft({ actor });
  assertExpectedDraftHash(draft, expectedDraftHash);
  const sections = normalizeSections(draft.sections || []);
  const key = String(sectionKey || "").trim().toLowerCase();
  const index = sections.findIndex((row) => row.key === key);
  if (index < 0) throw new DynamicMealPlannerError("Meal Planner section not found", "MEAL_PLANNER_SECTION_NOT_FOUND", 404);
  const merged = normalizeSection({ ...sections[index], ...patch }, index);
  if (merged.key !== sections[index].key && sections.some((row, rowIndex) => rowIndex !== index && row.key === merged.key)) {
    throw new DynamicMealPlannerError("Meal Planner section key already exists", "MEAL_PLANNER_DUPLICATE_SECTION_KEY", 409);
  }
  sections[index] = merged;
  const saved = await saveDraftSections(draft, sections, { actor });
  return { action: "section_updated", section: merged, draft: saved };
}

async function deleteSection({ sectionKey, actor = {}, expectedDraftHash } = {}) {
  const draft = await requireDraft({ actor });
  assertExpectedDraftHash(draft, expectedDraftHash);
  const sections = normalizeSections(draft.sections || []);
  const key = String(sectionKey || "").trim().toLowerCase();
  if (!sections.some((row) => row.key === key)) {
    throw new DynamicMealPlannerError("Meal Planner section not found", "MEAL_PLANNER_SECTION_NOT_FOUND", 404);
  }
  const saved = await saveDraftSections(draft, sections.filter((row) => row.key !== key), { actor });
  return { action: "section_deleted", deletedSectionKey: key, draft: saved };
}

async function addProductsToSection({ sectionKey, productIds = [], actor = {}, expectedDraftHash } = {}) {
  const ids = uniqueIds(productIds);
  if (!ids.length) throw new DynamicMealPlannerError("productIds is required", "MEAL_PLANNER_PRODUCT_IDS_REQUIRED", 400);
  const products = await MenuProduct.find({ _id: { $in: ids } }).select("_id").lean();
  const found = new Set(products.map((row) => String(row._id)));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    throw new DynamicMealPlannerError("One or more Menu products do not exist", "MEAL_PLANNER_PRODUCT_NOT_FOUND", 404, { productIds: missing });
  }
  const draft = await requireDraft({ actor });
  assertExpectedDraftHash(draft, expectedDraftHash);
  const sections = normalizeSections(draft.sections || []);
  const key = String(sectionKey || "").trim().toLowerCase();
  const index = sections.findIndex((row) => row.key === key);
  if (index < 0) throw new DynamicMealPlannerError("Meal Planner section not found", "MEAL_PLANNER_SECTION_NOT_FOUND", 404);
  const section = sections[index];
  sections[index] = normalizeSection({
    ...section,
    sectionType: section.sectionType === "option_group" ? "product_list" : section.sectionType,
    sourceKind: isPremiumDynamicSection(section) ? "premium_visual" : "product_list",
    includeMode: "selected",
    selectedProductIds: [...section.selectedProductIds, ...ids],
  }, index);
  const saved = await saveDraftSections(draft, sections, { actor });
  return { action: "products_added", sectionKey: key, addedProductIds: ids, draft: saved };
}

async function removeProductFromSection({ sectionKey, productId, actor = {}, expectedDraftHash } = {}) {
  const draft = await requireDraft({ actor });
  assertExpectedDraftHash(draft, expectedDraftHash);
  const sections = normalizeSections(draft.sections || []);
  const key = String(sectionKey || "").trim().toLowerCase();
  const index = sections.findIndex((row) => row.key === key);
  if (index < 0) throw new DynamicMealPlannerError("Meal Planner section not found", "MEAL_PLANNER_SECTION_NOT_FOUND", 404);
  const id = String(productId || "");
  sections[index] = normalizeSection({
    ...sections[index],
    includeMode: "selected",
    selectedProductIds: sections[index].selectedProductIds.filter((value) => value !== id),
  }, index);
  const saved = await saveDraftSections(draft, sections, { actor });
  return { action: "product_removed", sectionKey: key, removedProductId: id, draft: saved };
}

async function validatePayload(payload = {}) {
  return validateConfigObject({ sections: normalizeSections(payload.sections || []) });
}

async function publishDraft({ notes = "", actor = {}, expectedDraftHash } = {}) {
  const draft = await getCurrentDraftConfig();
  if (!draft) throw new DynamicMealPlannerError("No current Meal Planner draft exists", "MEAL_PLANNER_DRAFT_NOT_FOUND", 404);
  assertExpectedDraftHash(draft, expectedDraftHash);
  const validation = await validateConfigObject(draft);
  if (!validation.ready) {
    throw new DynamicMealPlannerError("Meal Planner draft is not publishable", "MEAL_PLANNER_VALIDATION_FAILED", 422, validation);
  }
  const sections = normalizeSections(draft.sections || []);
  const revisionHash = draftHashForSections(sections);
  const latestPublished = await MealBuilderConfig.findOne({ status: { $in: ["published", "archived"] } })
    .sort({ versionNumber: -1, publishedAt: -1 })
    .lean();
  const versionNumber = Number(latestPublished?.versionNumber || 0) + 1;
  await MealBuilderConfig.updateMany({ status: "published", isCurrent: true }, { $set: { status: "archived", isCurrent: false } });
  const published = await MealBuilderConfig.create({
    status: "published",
    isCurrent: true,
    contractVersion: CONFIG_VERSION,
    versionNumber,
    basedOnPublishedVersionId: draft.basedOnPublishedVersionId || null,
    revisionHash,
    source: "dashboard",
    createdBySystem: false,
    sections,
    notes: String(notes || draft.notes || ""),
    publishedAt: new Date(),
    publishedBy: actor.userId || null,
    createdBy: draft.createdBy || actor.userId || null,
    updatedBy: actor.userId || null,
  });
  await MealBuilderConfig.updateOne({ _id: draft._id }, { $set: { isCurrent: false } });
  return {
    action: "published",
    config: serializeConfig(published),
    validation,
    contract: await compileContract({ config: published.toObject(), lang: "en", source: "published_config" }),
  };
}

async function buildPublishedContract({ config = null, lang = "en" } = {}) {
  const published = config || await getCurrentPublishedConfig();
  return compileContract({ config: published, lang, source: published ? "published_config" : "catalog_fallback" });
}

async function getHydratedDraft({ lang = "en" } = {}) {
  const draft = await getCurrentDraftConfig();
  if (!draft) {
    return {
      contractVersion: CONTRACT_VERSION,
      draft: null,
      ready: false,
      errors: [{ level: "error", code: "MEAL_PLANNER_DRAFT_NOT_FOUND" }],
      warnings: [],
      sections: [],
    };
  }
  const sections = normalizeSections(draft.sections || []);
  const compiled = await compileSections(sections, lang);
  const validation = await validateConfigObject(draft);
  return {
    contractVersion: CONTRACT_VERSION,
    draft: serializeConfig(draft),
    draftHash: draftHashForSections(sections),
    ready: validation.ready,
    sections: compiled.sections,
    errors: validation.errors,
    warnings: validation.warnings,
    validation,
  };
}

async function getDashboardState({ lang = "en" } = {}) {
  const [draft, published] = await Promise.all([getCurrentDraftConfig(), getCurrentPublishedConfig()]);
  const draftValidation = draft ? await validateConfigObject(draft) : null;
  return {
    contractVersion: CONTRACT_VERSION,
    dataSource: "menu_catalog",
    draft: serializeConfig(draft),
    published: serializeConfig(published),
    validation: { draft: draftValidation },
    publishedContract: published ? await buildPublishedContract({ config: published, lang }) : null,
    metadata: {
      hasDraft: Boolean(draft),
      hasPublished: Boolean(published),
      hasUnpublishedChanges: Boolean(draft),
      draftHash: draft ? draftHashForSections(draft.sections || []) : null,
      publishedRevisionHash: published?.revisionHash || null,
    },
  };
}

async function getSectionPicker({
  sectionKey,
  lang = "en",
  q = "",
  includeUnavailable = true,
  page,
  limit,
  kind,
  categoryId,
  productContextId,
  sourceGroupId,
} = {}) {
  const draft = await getCurrentDraftConfig();
  const sections = draft ? normalizeSections(draft.sections || []) : [];
  const key = slugify(sectionKey, "new_section");
  const optionPickerRequested = kind === "option" && productContextId && sourceGroupId;
  const section = sections.find((row) => row.key === key) || normalizeSection({
    key,
    sectionType: optionPickerRequested ? "option_group" : "product_list",
    sourceKind: optionPickerRequested ? "visual_family" : "product_list",
    titleOverride: { ar: key, en: key },
    productContextId: optionPickerRequested ? productContextId : null,
    sourceGroupId: optionPickerRequested ? sourceGroupId : null,
  });
  const showUnavailable = normalizeBoolean(includeUnavailable, true);
  const picker = (kind === "option" || section.sectionType === "option_group")
    ? await buildOptionPicker({ section, lang, q, includeUnavailable: showUnavailable, page, limit })
    : await buildProductPicker({ section, lang, q, includeUnavailable: showUnavailable, page, limit, categoryId });
  return {
    contractVersion: CONTRACT_VERSION,
    sectionKey: key,
    sectionType: section.sectionType,
    draftHash: draft ? draftHashForSections(draft.sections || []) : null,
    ...picker,
  };
}

async function getReadinessReport() {
  const [draft, published] = await Promise.all([getCurrentDraftConfig(), getCurrentPublishedConfig()]);
  const draftValidation = draft ? await validateConfigObject(draft) : {
    status: "error",
    ready: false,
    errors: [{ level: "error", code: "MEAL_PLANNER_DRAFT_NOT_FOUND" }],
    warnings: [],
    checks: [],
    summary: { sections: 0, products: 0, errors: 1, warnings: 0 },
  };
  const publishedContract = published ? await buildPublishedContract({ config: published, lang: "en" }) : null;
  return {
    contractVersion: CONTRACT_VERSION,
    status: draftValidation.status,
    ready: draftValidation.ready,
    draftHash: draft ? draftHashForSections(draft.sections || []) : null,
    publishedRevisionHash: published?.revisionHash || null,
    catalogHash: publishedContract?.catalogHash || null,
    errors: draftValidation.errors,
    warnings: draftValidation.warnings,
    checks: draftValidation.checks,
    summary: { ...draftValidation.summary, draft: Boolean(draft), published: Boolean(published) },
  };
}

module.exports = {
  getCurrentDraftConfig,
  getCurrentPublishedConfig,
  createDraft,
  openWorkingDraft,
  updateDraft,
  resetDraftToPublished,
  createSection,
  updateSection,
  deleteSection,
  addProductsToSection,
  removeProductFromSection,
  validatePayload,
  publishDraft,
  buildPublishedContract,
  getHydratedDraft,
  getDashboardState,
  getSectionPicker,
  getReadinessReport,
};
