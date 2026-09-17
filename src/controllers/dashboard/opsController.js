"use strict";

const opsReadService = require("../../services/dashboard/opsReadServiceV2");
const opsSearchService = require("../../services/dashboard/opsSearchService");
const errorResponse = require("../../utils/errorResponse");
const { getRequestLang } = require("../../utils/i18n");
const {
  isTruthyQuery,
  serializeKitchenOperation,
} = require("../../services/dashboard/kitchenOperationsContractService");

function cleanDiagnosticMessage(err) {
  const message = err && err.message ? String(err.message) : "Unknown error";
  return message
    .replace(/[a-fA-F0-9]{24}/g, "<object-id>")
    .replace(/\b\+?\d{8,15}\b/g, "<phone>")
    .slice(0, 300);
}

function sanitizeOperationForRetry(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;

  const sanitized = { ...item };
  sanitized.kitchenCards = (Array.isArray(item.kitchenCards) ? item.kitchenCards : [])
    .filter((card) => card && typeof card === "object" && !Array.isArray(card))
    .map((card) => ({
      ...card,
      sections: (Array.isArray(card.sections) ? card.sections : [])
        .filter((section) => section && typeof section === "object" && !Array.isArray(section))
        .map((section) => ({
          ...section,
          items: (Array.isArray(section.items) ? section.items : [])
            .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)),
        })),
      components: card.components && typeof card.components === "object" && !Array.isArray(card.components)
        ? {
          ...card.components,
          carbs: (Array.isArray(card.components.carbs) ? card.components.carbs : [])
            .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)),
        }
        : {},
      warnings: Array.isArray(card.warnings) ? card.warnings.filter((warning) => warning !== undefined) : [],
    }));

  sanitized.kitchenAddonGroups = (Array.isArray(item.kitchenAddonGroups) ? item.kitchenAddonGroups : [])
    .filter((group) => group && typeof group === "object" && !Array.isArray(group))
    .map((group) => ({
      ...group,
      items: (Array.isArray(group.items) ? group.items : [])
        .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)),
    }));

  sanitized.items = (Array.isArray(item.items) ? item.items : [])
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));

  if (item.kitchenDetails && typeof item.kitchenDetails === "object" && !Array.isArray(item.kitchenDetails)) {
    sanitized.kitchenDetails = {
      ...item.kitchenDetails,
      mealSlots: (Array.isArray(item.kitchenDetails.mealSlots) ? item.kitchenDetails.mealSlots : [])
        .filter((slot) => slot && typeof slot === "object" && !Array.isArray(slot))
        .map((slot) => ({
          ...slot,
          selectedOptions: (Array.isArray(slot.selectedOptions) ? slot.selectedOptions : [])
            .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)),
        })),
      addons: (Array.isArray(item.kitchenDetails.addons) ? item.kitchenDetails.addons : [])
        .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)),
    };
  }

  return sanitized;
}

function serializeOperationWithRetry(item, options, index) {
  try {
    return serializeKitchenOperation(item, options);
  } catch (firstError) {
    try {
      return serializeKitchenOperation(sanitizeOperationForRetry(item), options);
    } catch (secondError) {
      secondError.opsStage = "serialize_operation";
      secondError.opsIndex = index;
      secondError.opsEntityId = item && (item.entityId || item.id || item.orderId || item.requestId) || null;
      secondError.opsEntityType = item && item.entityType || null;
      secondError.originalSerializationError = firstError && firstError.message ? String(firstError.message) : null;
      throw secondError;
    }
  }
}

async function listOperations(req, res) {
  let stage = "validate_request";
  try {
    const date = req.query.date;
    if (!date) {
      return errorResponse(res, 400, "INVALID", "date query parameter is required (YYYY-MM-DD)");
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return errorResponse(res, 400, "INVALID", "date must be in YYYY-MM-DD format");
    }

    const lang = getRequestLang(req);
    const role = req.userRole;

    stage = "read_operations";
    const operations = await opsReadService.listOperations({ date, role, lang });

    stage = "serialize_operations";
    const options = {
      includeLegacy: isTruthyQuery(req.query.includeLegacy),
      includeRaw: isTruthyQuery(req.query.includeRaw),
    };
    const data = operations.map((item, index) => serializeOperationWithRetry(item, options, index));

    stage = "send_response";
    return res.status(200).json({
      status: true,
      data,
    });
  } catch (err) {
    const resolvedStage = err && err.opsStage ? err.opsStage : stage;
    const diagnostics = {
      requestId: req.requestId || null,
      stage: resolvedStage,
      errorName: err && err.name ? String(err.name) : "Error",
      errorMessage: cleanDiagnosticMessage(err),
      ...(err && err.opsIndex !== undefined ? { operationIndex: err.opsIndex } : {}),
      ...(err && err.opsEntityId ? { entityId: String(err.opsEntityId) } : {}),
      ...(err && err.opsEntityType ? { entityType: String(err.opsEntityType) } : {}),
    };
    console.error("Error in listOperations:", diagnostics, err && err.stack ? err.stack : err);
    return errorResponse(res, 500, "INTERNAL_ERROR", "An unexpected error occurred", diagnostics);
  }
}

async function searchOperations(req, res) {
  try {
    const q = req.query.q;
    if (!q || q.length < 3) {
      return res.status(200).json({ status: true, data: [] });
    }

    const lang = getRequestLang(req);
    const role = req.userRole;
    const operations = await opsSearchService.search({ q, role, lang });
    const data = operations.map((item, index) => serializeOperationWithRetry(item, {}, index));

    return res.status(200).json({
      status: true,
      data,
    });
  } catch (err) {
    console.error("Error in searchOperations:", err);
    return errorResponse(res, 500, "INTERNAL_ERROR", "An unexpected error occurred", {
      requestId: req.requestId || null,
      stage: err && err.opsStage ? err.opsStage : "search_operations",
      errorName: err && err.name ? String(err.name) : "Error",
      errorMessage: cleanDiagnosticMessage(err),
    });
  }
}

module.exports = {
  listOperations,
  searchOperations,
};
