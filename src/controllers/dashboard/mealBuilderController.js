const mealBuilderService = require("../../services/subscription/dynamicMealPlannerService");
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
  if (data?.draftHash) res.set("X-Meal-Planner-Draft-Hash", data.draftHash);
  if (data?.catalogHash) res.set("X-Meal-Planner-Catalog-Hash", data.catalogHash);
  return res.status(statusCode).json({ status: true, data });
}

function handleMealBuilderError(err, res) {
  console.error("DynamicMealPlannerController error:", err);
  if (err && err.status && err.code) {
    return errorResponse(res, err.status, err.code, err.message, err.details);
  }
  if (err && err.name === "ValidationError") {
    return errorResponse(
      res,
      400,
      "MEAL_PLANNER_VALIDATION_ERROR",
      "Meal Planner validation failed",
      Object.values(err.errors || {}).map((item) => item.message)
    );
  }
  if (err && err.code === 11000) {
    return errorResponse(res, 409, "MEAL_PLANNER_CONFLICT", "Meal Planner conflict", err.keyValue || undefined);
  }
  return errorResponse(res, 500, "MEAL_PLANNER_INTERNAL_ERROR", "Unexpected Meal Planner error");
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

const getMealBuilder = wrap(async (req, res) =>
  send(res, await mealBuilderService.getDashboardState({ lang: getRequestLang(req) }))
);

const getHydratedDraft = wrap(async (req, res) =>
  send(res, await mealBuilderService.getHydratedDraft({ lang: getRequestLang(req) }))
);

const getPublished = wrap(async (req, res) => {
  const published = await mealBuilderService.getCurrentPublishedConfig();
  if (!published) return send(res, null);
  return send(res, {
    config: mealBuilderService.serializeConfig(published),
    contract: await mealBuilderService.buildPublishedContract({ config: published, lang: getRequestLang(req) }),
  });
});

const openDraft = wrap(async (req, res) =>
  send(res, await mealBuilderService.openWorkingDraft({ actor: actorFromRequest(req) }))
);

const resetDraft = wrap(async (req, res) =>
  send(res, await mealBuilderService.resetDraftToPublished({ actor: actorFromRequest(req) }))
);

const createDraft = wrap(async (req, res) =>
  send(
    res,
    await mealBuilderService.createDraft({
      sections: req.body?.sections,
      notes: req.body?.notes,
      actor: actorFromRequest(req),
    }),
    201
  )
);

const updateDraft = wrap(async (req, res) =>
  send(res, await mealBuilderService.updateDraft({
    sections: req.body?.sections,
    notes: req.body?.notes,
    expectedDraftHash: req.body?.expectedDraftHash,
    actor: actorFromRequest(req),
  }))
);

const validateDraft = wrap(async (req, res) => {
  if (Array.isArray(req.body?.sections)) {
    return send(res, await mealBuilderService.validatePayload(req.body));
  }
  const state = await mealBuilderService.getDashboardState({ lang: getRequestLang(req) });
  return send(res, state.validation.draft || {
    status: "error",
    ready: false,
    errors: [{ level: "error", code: "MEAL_PLANNER_DRAFT_NOT_FOUND" }],
    warnings: [],
    checks: [],
    summary: { sections: 0, products: 0, errors: 1, warnings: 0 },
  });
});

const publishDraft = wrap(async (req, res) =>
  send(res, await mealBuilderService.publishDraft({
    notes: req.body?.notes,
    expectedDraftHash: req.body?.expectedDraftHash,
    actor: actorFromRequest(req),
  }))
);

const getPicker = wrap(async (req, res) =>
  send(res, await mealBuilderService.getSectionPicker({
    sectionKey: req.params.sectionKey,
    lang: getRequestLang(req),
    q: req.query.q || req.query.search,
    includeUnavailable: req.query.includeUnavailable,
    page: req.query.page,
    limit: req.query.limit,
    kind: req.query.kind,
    categoryId: req.query.categoryId,
    productContextId: req.query.productContextId,
    sourceGroupId: req.query.sourceGroupId,
  }))
);

const getReadiness = wrap(async (_req, res) =>
  send(res, await mealBuilderService.getReadinessReport())
);

const createSection = wrap(async (req, res) =>
  send(
    res,
    await mealBuilderService.createSection({
      section: req.body?.section || req.body || {},
      expectedDraftHash: req.body?.expectedDraftHash,
      actor: actorFromRequest(req),
    }),
    201
  )
);

const updateSection = wrap(async (req, res) =>
  send(res, await mealBuilderService.updateSection({
    sectionKey: req.params.sectionKey,
    patch: req.body?.patch || req.body || {},
    expectedDraftHash: req.body?.expectedDraftHash,
    actor: actorFromRequest(req),
  }))
);

const deleteSection = wrap(async (req, res) =>
  send(res, await mealBuilderService.deleteSection({
    sectionKey: req.params.sectionKey,
    expectedDraftHash: req.body?.expectedDraftHash || req.query.expectedDraftHash,
    actor: actorFromRequest(req),
  }))
);

const addProducts = wrap(async (req, res) =>
  send(res, await mealBuilderService.addProductsToSection({
    sectionKey: req.params.sectionKey,
    productIds: req.body?.productIds || (req.body?.productId ? [req.body.productId] : []),
    expectedDraftHash: req.body?.expectedDraftHash,
    actor: actorFromRequest(req),
  }))
);

const removeProduct = wrap(async (req, res) =>
  send(res, await mealBuilderService.removeProductFromSection({
    sectionKey: req.params.sectionKey,
    productId: req.params.productId,
    expectedDraftHash: req.body?.expectedDraftHash || req.query.expectedDraftHash,
    actor: actorFromRequest(req),
  }))
);

module.exports = {
  createDraft,
  getHydratedDraft,
  getMealBuilder,
  getPublished,
  getPicker,
  getReadiness,
  openDraft,
  publishDraft,
  resetDraft,
  updateDraft,
  validateDraft,
  createSection,
  updateSection,
  deleteSection,
  addProducts,
  removeProduct,
};
