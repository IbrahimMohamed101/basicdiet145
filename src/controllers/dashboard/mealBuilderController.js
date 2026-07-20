"use strict";

const mealBuilderService = require("../../services/subscription/dashboardMealPlannerCardFacadeService");
const dashboardCatalogService = require("../../services/subscription/dashboardMealBuilderCatalogService");
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

function handleMealBuilderError(err, res) {
  console.error("MealBuilderController error:", err);
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

const getMealBuilder = wrap(async (req, res) => {
  const lang = getRequestLang(req);
  const [state, catalog] = await Promise.all([
    mealBuilderService.getDashboardState({ lang }),
    dashboardCatalogService.getCompleteCatalog({ lang }),
  ]);
  return send(res, {
    ...state,
    cardContract:
      state.cardContract ||
      (typeof mealBuilderService.getCardContract === "function"
        ? mealBuilderService.getCardContract()
        : null),
    catalog,
  });
});

const getCatalog = wrap(async (req, res) =>
  send(
    res,
    await dashboardCatalogService.getCompleteCatalog({
      lang: getRequestLang(req),
    })
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
  send(
    res,
    await mealBuilderService.updateDraft({
      sections: req.body?.sections,
      notes: req.body?.notes,
      actor: actorFromRequest(req),
    })
  )
);

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

const createSection = wrap(async (req, res) =>
  send(
    res,
    await mealBuilderService.createProductSection({
      section: req.body?.section || req.body || {},
      actor: actorFromRequest(req),
    }),
    201
  )
);

const updateSection = wrap(async (req, res) =>
  send(
    res,
    await mealBuilderService.updateProductSection({
      sectionKey: req.params.sectionKey,
      patch: req.body?.patch || req.body || {},
      actor: actorFromRequest(req),
    })
  )
);

const deleteSection = wrap(async (req, res) =>
  send(
    res,
    await mealBuilderService.deleteProductSection({
      sectionKey: req.params.sectionKey,
      actor: actorFromRequest(req),
    })
  )
);

const replaceItems = wrap(async (req, res) =>
  send(
    res,
    await mealBuilderService.replaceSectionItems({
      sectionKey: req.params.sectionKey,
      productIds: req.body?.productIds || req.body?.selectedProductIds,
      optionIds: req.body?.optionIds || req.body?.selectedOptionIds,
      actor: actorFromRequest(req),
    })
  )
);

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

const addOptions = wrap(async (req, res) =>
  send(
    res,
    await mealBuilderService.addOptionsToSection({
      sectionKey: req.params.sectionKey,
      optionIds:
        req.body?.optionIds ||
        (req.body?.optionId ? [req.body.optionId] : []),
      actor: actorFromRequest(req),
    })
  )
);

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
