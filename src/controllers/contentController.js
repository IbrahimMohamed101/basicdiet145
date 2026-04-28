const appContentService = require("../services/appContentService");
const errorResponse = require("../utils/errorResponse");

async function getSubscriptionTerms(req, res) {
  const locale = req.query.locale || appContentService.DEFAULT_LOCALE;
  const data = await appContentService.getActiveContentOrNull({
    key: appContentService.CONTENT_KEYS.subscriptionTerms,
    locale,
  });

  if (!data) {
    return errorResponse(res, 404, "NOT_FOUND", "Active subscription terms were not found");
  }

  return res.status(200).json({ status: true, data });
}

async function getSubscriptionTermsAdmin(req, res) {
  const locale = req.query.locale || appContentService.DEFAULT_LOCALE;
  const data = await appContentService.getActiveContentOrNull({
    key: appContentService.CONTENT_KEYS.subscriptionTerms,
    locale,
    includeUpdatedBy: true,
  });

  if (!data) {
    return errorResponse(res, 404, "NOT_FOUND", "Active subscription terms were not found");
  }

  return res.status(200).json({ status: true, data });
}

async function upsertSubscriptionTermsAdmin(req, res) {
  try {
    const payload = appContentService.validateWritePayload(req.body);
    const data = await appContentService.saveActiveContent({
      key: appContentService.CONTENT_KEYS.subscriptionTerms,
      title: payload.title,
      content: payload.content,
      locale: payload.locale,
      updatedBy: req.dashboardUserId || req.userId || null,
    });

    return res.status(200).json({ status: true, data });
  } catch (error) {
    if (error && Number.isInteger(error.status) && error.code) {
      return errorResponse(res, error.status, error.code, error.message);
    }
    throw error;
  }
}

module.exports = {
  getSubscriptionTerms,
  getSubscriptionTermsAdmin,
  upsertSubscriptionTermsAdmin,
};
