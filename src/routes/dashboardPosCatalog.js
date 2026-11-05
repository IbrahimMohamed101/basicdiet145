"use strict";

const { Router } = require("express");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");
const asyncHandler = require("../middleware/asyncHandler");
const errorResponse = require("../utils/errorResponse");
const { normalizePosCatalog } = require("../services/pos/catalogValidation");
const { getCatalog, saveDraft, publishDraft } = require("../services/pos/catalogService");

const router = Router();
const manage = dashboardRoleMiddleware(["admin"]);
router.use(dashboardAuthMiddleware);
const readers = new Set(["cashier", "admin", "superadmin"]);

function adminView({ revision, publishedRevision, published, draft }) {
  return { revision, publishedRevision, published, draft };
}

router.get("/catalog", asyncHandler(async (req, res) => {
  if (!readers.has(req.dashboardUserRole)) return errorResponse(res, 403, "FORBIDDEN", "منيو الكاشير غير متاح لهذا الدور.");
  const doc = await getCatalog();
  if (!doc) return errorResponse(res, 404, "POS_CATALOG_NOT_FOUND", "منيو الكاشير غير متاح.");
  const { categories, products } = doc.published;
  return res.json({ status: true, data: {
    revision: doc.publishedRevision, categories, products: products.filter((item) => item.active),
  } });
}));

router.get("/catalog/manage", manage, asyncHandler(async (_req, res) => {
  const doc = await getCatalog();
  if (!doc) return errorResponse(res, 404, "POS_CATALOG_NOT_FOUND", "منيو الكاشير غير متاح.");
  return res.json({ status: true, data: adminView(doc) });
}));

router.put("/catalog/draft", manage, asyncHandler(async (req, res) => {
  const { revision, catalog } = req.body || {};
  if (!Number.isSafeInteger(revision) || revision < 1) {
    return errorResponse(res, 400, "VALIDATION_ERROR", "نسخة المنيو غير صالحة.");
  }
  let draft;
  try {
    draft = normalizePosCatalog(catalog);
  } catch (error) {
    return errorResponse(res, 400, "VALIDATION_ERROR", error.message);
  }
  const doc = await saveDraft(revision, draft);
  if (!doc) return errorResponse(res, 409, "POS_CATALOG_CONFLICT", "المنيو اتغير. حمّل آخر نسخة وحاول مرة أخرى.");
  return res.json({ status: true, data: adminView(doc) });
}));

router.post("/catalog/publish", manage, asyncHandler(async (req, res) => {
  const { revision } = req.body || {};
  if (!Number.isSafeInteger(revision) || revision < 1) {
    return errorResponse(res, 400, "VALIDATION_ERROR", "نسخة المنيو غير صالحة.");
  }
  const doc = await publishDraft(revision);
  if (!doc) return errorResponse(res, 409, "POS_CATALOG_CONFLICT", "لا توجد مسودة مطابقة. حمّل آخر نسخة.");
  return res.json({ status: true, data: adminView(doc) });
}));

module.exports = router;
