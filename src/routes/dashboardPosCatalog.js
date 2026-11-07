"use strict";

const { Router } = require("express");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");
const asyncHandler = require("../middleware/asyncHandler");
const errorResponse = require("../utils/errorResponse");
const { normalizePosCatalog, normalizePosChannels } = require("../services/pos/catalogValidation");
const { getCatalog, saveDraft, publishDraft, getCatalogRevisions, getCatalogRevision } = require("../services/pos/catalogService");
const { quotePosCart, PosQuoteError } = require("../services/pos/quoteService");
const { verifiedActor } = require("../services/pos/financialLedgerService");

const router = Router();
// POS management is an operational duty of cashier and restaurant; financial
// admin privileges and customer-app menu publication remain separately guarded.
const manage = dashboardRoleMiddleware(["admin", "restaurant", "cashier"]);
router.use(dashboardAuthMiddleware);
const readers = new Set(["cashier", "restaurant", "admin", "superadmin"]);

function adminView({ revision, publishedRevision, published, draft, draftSavedBy, draftSavedAt, publishedBy, publishedAt }) {
  return { revision, publishedRevision, published, draft, draftSavedBy, draftSavedAt, publishedBy, publishedAt };
}

router.get("/catalog", asyncHandler(async (req, res) => {
  if (!readers.has(req.dashboardUserRole)) return errorResponse(res, 403, "FORBIDDEN", "منيو الكاشير غير متاح لهذا الدور.");
  const doc = await getCatalog();
  if (!doc) return errorResponse(res, 404, "POS_CATALOG_NOT_FOUND", "منيو الكاشير غير متاح.");
  const { categories, products } = doc.published;
  return res.json({ status: true, data: {
    revision: doc.publishedRevision, channels: normalizePosChannels(doc.published.channels), categories, products: products.filter((item) => item.active),
  } });
}));

// Deliberately read-only. A quote has no payment or invoice authority.
router.post("/quote", asyncHandler(async (req, res) => {
  if (!readers.has(req.dashboardUserRole)) {
    return errorResponse(res, 403, "FORBIDDEN", "تسعير الكاشير غير متاح لهذا الدور.");
  }
  const doc = await getCatalog();
  try {
    const quote = quotePosCart(doc, req.body);
    return res.json({ status: true, data: quote });
  } catch (error) {
    if (error instanceof PosQuoteError) {
      return errorResponse(res, error.status, error.code, error.message);
    }
    throw error;
  }
}));

router.get("/catalog/manage", manage, asyncHandler(async (_req, res) => {
  const doc = await getCatalog();
  if (!doc) return errorResponse(res, 404, "POS_CATALOG_NOT_FOUND", "منيو الكاشير غير متاح.");
  return res.json({ status: true, data: adminView(doc) });
}));

// Prior published prices are read-only and available to POS catalog operators.
// A receipt can reference the exact revision hash without mutable prices.
router.get("/catalog/revisions", manage, asyncHandler(async (_req, res) => {
  const revisions = await getCatalogRevisions(50);
  return res.json({ status: true, data: revisions });
}));

router.get("/catalog/revisions/:revision", manage, asyncHandler(async (req, res) => {
  const revision = Number(req.params.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    return errorResponse(res, 400, "VALIDATION_ERROR", "نسخة المنيو غير صالحة.");
  }
  const history = await getCatalogRevision(revision);
  if (!history) return errorResponse(res, 404, "POS_REVISION_NOT_FOUND", "النسخة المطلوبة غير محفوظة.");
  return res.json({ status: true, data: history });
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
  const actor = await verifiedActor(req);
  const doc = await saveDraft(revision, draft, actor);
  if (!doc) return errorResponse(res, 409, "POS_CATALOG_CONFLICT", "المنيو اتغير. حمّل آخر نسخة وحاول مرة أخرى.");
  return res.json({ status: true, data: adminView(doc) });
}));

router.post("/catalog/publish", manage, asyncHandler(async (req, res) => {
  const { revision } = req.body || {};
  if (!Number.isSafeInteger(revision) || revision < 1) {
    return errorResponse(res, 400, "VALIDATION_ERROR", "نسخة المنيو غير صالحة.");
  }
  const actor = await verifiedActor(req);
  const doc = await publishDraft(revision, actor);
  if (!doc) return errorResponse(res, 409, "POS_CATALOG_CONFLICT", "لا توجد مسودة مطابقة. حمّل آخر نسخة.");
  return res.json({ status: true, data: adminView(doc) });
}));

// Financial endpoints are additionally guarded by exact isolated Staging runtime.
router.use("/", require("./dashboardPosFinancial"));

module.exports = router;
