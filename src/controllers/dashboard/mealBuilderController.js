"use strict";

const mealBuilderService = require("../../services/subscription/dashboardMealPlannerDashboardService");
const dashboardCatalogService = require("../../services/subscription/dashboardMealBuilderAuthoringContractService");
const menuCatalogService = require("../../services/orders/menuCatalogService");
const errorResponse = require("../../utils/errorResponse");
const { getRequestLang } = require("../../utils/i18n");

function actorFromRequest(req) {
  return {
    userId: req.dashboardUserId,
    role: req.dashboardUserRole,
  };
}

function noStore(res) {
  res.set("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
}

function send(res, data, statusCode = 200) {
  noStore(res);
  return res.status(statusCode).json({ status: true, data });
}

function catalogOptions(req, { allowDiagnostic = false } = {}) {
  return {
    lang: getRequestLang(req),
    includeQuarantined:
      allowDiagnostic &&
      ["admin", "superadmin"].includes(String(req.dashboardUserRole || "")) &&
      String(req.query.includeQuarantined || "").toLowerCase() === "true",
  };
}

function handleMealBuilderError(err, res) {
  const handledDomain4xx = Boolean(
    err &&
    err.status >= 400 &&
    err.status < 500 &&
    err.code
  );
  if (handledDomain4xx) {
    console.warn("MealBuilderController validation:", {
      code: err.code,
      status: err.status,
      message: err.message,
      details: err.details,
    });
  } else {
    console.error("MealBuilderController error:", err);
  }
  if (err && err.status && err.code) {
    return errorResponse(res, err.status, err.code, err.message, err.details);
  }
  if (err && err.name === "ValidationError") {
    return errorResponse(
      res,
      400,
      "MEAL_BUILDER_VALIDATION_ERROR",
      "Meal Builder validation failed",
      Object.values(err.errors || {}).map((item) => item.message)
    );
  }
  if (err && err.code === 11000) {
    return errorResponse(
      res,
      409,
      "MEAL_BUILDER_CONFLICT",
      "Meal Builder conflict",
      err.keyValue || undefined
    );
  }
  return errorResponse(
    res,
    500,
    "MEAL_BUILDER_INTERNAL_ERROR",
    "Unexpected Meal Builder error"
  );
}

function wrap(handler) {
  return async (req, res, next) => {
    try {
      return await handler(req, res);
    } catch (err) {
      try {
        noStore(res);
        return handleMealBuilderError(err, res);
      } catch (unhandled) {
        return next(unhandled);
      }
    }
  };
}

function selectedOptionIds(payload = {}) {
  const source = Array.isArray(payload.selectedOptionIds)
    ? payload.selectedOptionIds
    : Array.isArray(payload.optionIds)
      ? payload.optionIds
      : payload.optionId
        ? [payload.optionId]
        : [];
  return [...new Set(source.map((value) => String(value || "").trim()).filter(Boolean))];
}

function sectionKeyOf(section = {}) {
  return String(section.key || section.sectionKey || "").trim().toLowerCase();
}

async function resolveOptionContext({ payload = {}, sectionKey, actor }) {
  let productContextId = String(payload.productContextId || "").trim();
  let sourceGroupId = String(payload.sourceGroupId || "").trim();
  let familyKey = String(
    payload.familyKey ||
    payload.metadata?.proteinFamilyKey ||
    payload.metadata?.familyKey ||
    ""
  ).trim().toLowerCase();
  if ((!productContextId || !sourceGroupId || !familyKey) && sectionKey) {
    const draft = await mealBuilderService.openWorkingDraft({ actor });
    const current = (draft.sections || []).find(
      (section) => sectionKeyOf(section) === String(sectionKey).trim().toLowerCase()
    );
    productContextId = productContextId || String(current?.productContextId || "").trim();
    sourceGroupId = sourceGroupId || String(current?.sourceGroupId || "").trim();
    familyKey = familyKey || String(
      current?.metadata?.proteinFamilyKey || current?.metadata?.familyKey || ""
    ).trim().toLowerCase();
  }
  return { productContextId, sourceGroupId, familyKey };
}

function mealBuilderMutationError(code, message, status, details) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

async function ensureProductScopedOptionRelations({
  payload = {},
  sectionKey,
  actor,
} = {}) {
  const optionIds = selectedOptionIds(payload);
  if (!optionIds.length) return;

  const { productContextId, sourceGroupId, familyKey } = await resolveOptionContext({
    payload,
    sectionKey,
    actor,
  });
  if (!productContextId || !sourceGroupId) return;

  // Selecting an option inside a product-scoped Meal Builder card is an explicit
  // request to attach that option to this product/group. Keep ProductGroupOption
  // as the authority, but create/reactivate it here so employees cannot create
  // a globally-valid option and then hit a relation error simply because they
  // are editing the card directly.
  //
  // Premium/system-managed options remain excluded: a standard Meal Builder
  // card must never create product relations for them as a side effect.
  for (const optionId of optionIds) {
    const detail = await menuCatalogService.getOption(optionId, { includeInactive: true });
    const option = detail?.option || detail;
    const optionGroup = detail?.optionGroup || null;
    const premiumLike = Boolean(
      String(option?.premiumKey || "").trim() ||
      ["premium_meal", "premium_large_salad"].includes(
        String(option?.selectionType || "").trim().toLowerCase()
      )
    );
    if (premiumLike) {
      throw mealBuilderMutationError(
        "MEAL_BUILDER_PREMIUM_OPTION_SYSTEM_MANAGED",
        "Premium options are managed by the system Premium card",
        422,
        { optionId }
      );
    }
    if (String(option?.groupId || "") !== sourceGroupId) {
      throw mealBuilderMutationError(
        "MEAL_BUILDER_OPTION_GROUP_MISMATCH",
        "An option belongs to a different option group",
        422,
        { optionId, sourceGroupId, actualGroupId: String(option?.groupId || "") }
      );
    }
    if (
      familyKey &&
      !["protein", "proteins"].includes(
        String(optionGroup?.key || "").trim().toLowerCase()
      )
    ) {
      throw mealBuilderMutationError(
        "MEAL_BUILDER_OPTION_ROLE_GROUP_MISMATCH",
        "The selected option group does not match the card option role",
        422,
        { sourceGroupId, groupKey: optionGroup?.key || "" }
      );
    }
    if (familyKey) {
      await menuCatalogService.ensureOptionProteinFamilyForCard(
        optionId,
        { groupId: sourceGroupId, familyKey },
        actor
      );
    }
    await menuCatalogService.createProductGroupOption(
      productContextId,
      sourceGroupId,
      {
        optionId,
        isActive: true,
        isVisible: true,
        isAvailable: true,
      },
      actor
    );
  }
}

async function ensureRelationsForSections(sections, actor) {
  if (!Array.isArray(sections)) return;
  for (const section of sections) {
    await ensureProductScopedOptionRelations({ payload: section || {}, actor });
  }
}

const getMealBuilder = wrap(async (req, res) => {
  const lang = getRequestLang(req);
  const [state, catalog] = await Promise.all([
    mealBuilderService.getDashboardState({ lang }),
    dashboardCatalogService.getCompleteCatalog({ lang, includeQuarantined: false }),
  ]);
  return send(res, {
    ...state,
    cardContract:
      state.cardContract ||
      (typeof mealBuilderService.getCardContract === "function"
        ? mealBuilderService.getCardContract()
        : dashboardCatalogService.getCardContract()),
    catalog,
  });
});

const getCatalog = wrap(async (req, res) =>
  send(
    res,
    await dashboardCatalogService.getCompleteCatalog(catalogOptions(req, { allowDiagnostic: true }))
  )
);

const getHydratedDraft = wrap(async (req, res) =>
  send(
    res,
    await mealBuilderService.getHydratedDraft({ lang: getRequestLang(req) })
  )
);

const getPublished = wrap(async (req, res) => {
  const published = await mealBuilderService.getCurrentPublishedConfig({
    allowVirtualFallback: true,
  });
  if (!published) return send(res, null);
  return send(res, {
    config: mealBuilderService.serializeConfig(published),
    contract: await mealBuilderService.buildPublishedContract({
      config: published,
      lang: getRequestLang(req),
    }),
  });
});

const openDraft = wrap(async (req, res) =>
  send(
    res,
    await mealBuilderService.openWorkingDraft({ actor: actorFromRequest(req) })
  )
);

const resetDraft = wrap(async (req, res) =>
  send(
    res,
    await mealBuilderService.resetDraftToPublished({
      actor: actorFromRequest(req),
    })
  )
);

const createDraft = wrap(async (req, res) => {
  const actor = actorFromRequest(req);
  await ensureRelationsForSections(req.body?.sections, actor);
  return send(
    res,
    await mealBuilderService.createDraft({
      sections: req.body?.sections,
      notes: req.body?.notes,
      actor,
    }),
    201
  );
});

const updateDraft = wrap(async (req, res) => {
  const actor = actorFromRequest(req);
  await ensureRelationsForSections(req.body?.sections, actor);
  return send(
    res,
    await mealBuilderService.updateDraft({
      sections: req.body?.sections,
      notes: req.body?.notes,
      actor,
    })
  );
});

const validateDraft = wrap(async (req, res) => {
  if (Array.isArray(req.body?.sections)) {
    return send(res, await mealBuilderService.validatePayload(req.body));
  }
  const state = await mealBuilderService.getDashboardState({
    lang: getRequestLang(req),
  });
  return send(
    res,
    state.validation.draft || {
      status: "error",
      ready: false,
      errors: [
        {
          level: "error",
          code: "MEAL_BUILDER_DRAFT_NOT_FOUND",
          message: "No current Meal Builder draft found",
        },
      ],
      warnings: [],
      checks: [],
      summary: { sections: 0, errors: 1, warnings: 0 },
    }
  );
});

const publishDraft = wrap(async (req, res) =>
  send(
    res,
    await mealBuilderService.publishDraft({
      notes: req.body?.notes,
      actor: actorFromRequest(req),
    })
  )
);

const getPicker = wrap(async (req, res) =>
  send(
    res,
    await mealBuilderService.getSectionPicker({
      sectionKey: req.params.sectionKey,
      targetSectionKey: req.query.targetSectionKey,
      productContextId: req.query.productContextId,
      sourceGroupId: req.query.sourceGroupId,
      optionRole: req.query.optionRole,
      familyKey: req.query.familyKey,
      lang: getRequestLang(req),
      q: req.query.q || req.query.search,
      include: req.query.include,
      diagnostics: req.query.diagnostics,
      includeUnavailable: req.query.includeUnavailable,
      includeNotLinked: req.query.includeNotLinked,
      unassignedOnly: req.query.unassignedOnly,
      page: req.query.page,
      limit: req.query.limit,
    })
  )
);

const getReadiness = wrap(async (_req, res) =>
  send(res, await mealBuilderService.getReadinessReport())
);

const createSection = wrap(async (req, res) => {
  const actor = actorFromRequest(req);
  const section = req.body?.section || req.body || {};
  await ensureProductScopedOptionRelations({ payload: section, actor });
  return send(
    res,
    await mealBuilderService.createProductSection({ section, actor }),
    201
  );
});

const updateSection = wrap(async (req, res) => {
  const actor = actorFromRequest(req);
  const patch = req.body?.patch || req.body || {};
  await ensureProductScopedOptionRelations({
    payload: patch,
    sectionKey: req.params.sectionKey,
    actor,
  });
  return send(
    res,
    await mealBuilderService.updateProductSection({
      sectionKey: req.params.sectionKey,
      patch,
      actor,
    })
  );
});

const deleteSection = wrap(async (req, res) =>
  send(
    res,
    await mealBuilderService.deleteProductSection({
      sectionKey: req.params.sectionKey,
      actor: actorFromRequest(req),
    })
  )
);

const replaceItems = wrap(async (req, res) => {
  const actor = actorFromRequest(req);
  const optionIds = req.body?.optionIds || req.body?.selectedOptionIds;
  await ensureProductScopedOptionRelations({
    payload: { optionIds },
    sectionKey: req.params.sectionKey,
    actor,
  });
  return send(
    res,
    await mealBuilderService.replaceSectionItems({
      sectionKey: req.params.sectionKey,
      productIds: req.body?.productIds || req.body?.selectedProductIds,
      optionIds,
      actor,
    })
  );
});

const addProducts = wrap(async (req, res) =>
  send(
    res,
    await mealBuilderService.addProductsToSection({
      sectionKey: req.params.sectionKey,
      productIds:
        req.body?.productIds ||
        (req.body?.productId ? [req.body.productId] : []),
      actor: actorFromRequest(req),
    })
  )
);

const removeProduct = wrap(async (req, res) =>
  send(
    res,
    await mealBuilderService.removeProductFromSection({
      sectionKey: req.params.sectionKey,
      productId: req.params.productId,
      actor: actorFromRequest(req),
    })
  )
);

const addOptions = wrap(async (req, res) => {
  const actor = actorFromRequest(req);
  const optionIds =
    req.body?.optionIds ||
    (req.body?.optionId ? [req.body.optionId] : []);
  await ensureProductScopedOptionRelations({
    payload: { optionIds },
    sectionKey: req.params.sectionKey,
    actor,
  });
  return send(
    res,
    await mealBuilderService.addOptionsToSection({
      sectionKey: req.params.sectionKey,
      optionIds,
      actor,
    })
  );
});

const removeOption = wrap(async (req, res) =>
  send(
    res,
    await mealBuilderService.removeOptionFromSection({
      sectionKey: req.params.sectionKey,
      optionId: req.params.optionId,
      actor: actorFromRequest(req),
    })
  )
);

module.exports = {
  addOptions,
  addProducts,
  createDraft,
  createSection,
  deleteSection,
  getCatalog,
  getHydratedDraft,
  getMealBuilder,
  getPicker,
  getPublished,
  getReadiness,
  openDraft,
  publishDraft,
  removeOption,
  removeProduct,
  replaceItems,
  resetDraft,
  updateDraft,
  updateSection,
  validateDraft,
};
