"use strict";

const accountingDailyReportService = require("../../services/dashboard/accountingDailyReportService");
const subscriptionPaymentMethodReportService = require("../../services/dashboard/subscriptionPaymentMethodReportService");

function handleError(res, err) {
  if (err instanceof accountingDailyReportService.AccountingReportError) {
    const messageArByCode = {
      INVALID_DATE: "صيغة التاريخ غير صحيحة. استخدم YYYY-MM-DD",
      INVALID_FULFILLMENT_METHOD: "طريقة التنفيذ غير صحيحة. استخدم all أو pickup أو delivery",
      INVALID_INCLUDE_DETAILS: "قيمة عرض التفاصيل غير صحيحة. استخدم true أو false",
    };
    const messageAr = messageArByCode[err.code] || "تعذر إنشاء تقرير طرق دفع الاشتراكات";
    return res.status(err.status).json({
      status: false,
      message: err.message,
      messageAr,
      error: { code: err.code, message: err.message, messageAr },
    });
  }
  throw err;
}

async function getDailySubscriptionPayments(req, res) {
  try {
    const data = await subscriptionPaymentMethodReportService.buildDailySubscriptionPaymentReport({
      date: req.query.date,
      fulfillmentMethod: req.query.fulfillmentMethod,
      includeDetails: req.query.includeDetails,
    });
    return res.status(200).json({ status: true, data });
  } catch (err) {
    return handleError(res, err);
  }
}

module.exports = {
  getDailySubscriptionPayments,
};
