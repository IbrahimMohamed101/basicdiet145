"use strict";

const accountingDailyReportService = require("../../services/dashboard/accountingDailyReportService");
const subscriptionPaymentMethodReportService = require("../../services/dashboard/subscriptionPaymentMethodReportService");

function handleError(res, err) {
  if (err instanceof accountingDailyReportService.AccountingReportError) {
    const messageArByCode = {
      INVALID_DATE: "صيغة التاريخ غير صحيحة. استخدم YYYY-MM-DD",
      INVALID_MONTH: "صيغة الشهر غير صحيحة. استخدم YYYY-MM",
      INVALID_FULFILLMENT_METHOD: "طريقة التنفيذ غير صحيحة. استخدم الكل أو الاستلام أو التوصيل",
      INVALID_INCLUDE_DETAILS: "قيمة عرض التفاصيل غير صحيحة. استخدم true أو false",
    };
    const messageAr = messageArByCode[err.code] || "تعذر إنشاء تقرير تحصيل الاشتراكات";
    return res.status(err.status).json({
      status: false,
      message: messageAr,
      messageAr,
      error: {
        code: err.code,
        codeLabelAr: "خطأ في بيانات التقرير",
        message: messageAr,
        messageAr,
      },
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
    return res.status(200).json({
      status: true,
      message: "تم إنشاء التقرير اليومي بنجاح",
      messageAr: "تم إنشاء التقرير اليومي بنجاح",
      data,
    });
  } catch (err) {
    return handleError(res, err);
  }
}

async function getMonthlySubscriptionPayments(req, res) {
  try {
    const data = await subscriptionPaymentMethodReportService.buildMonthlySubscriptionPaymentReport({
      month: req.query.month,
      fulfillmentMethod: req.query.fulfillmentMethod,
      includeDetails: req.query.includeDetails,
    });
    return res.status(200).json({
      status: true,
      message: "تم إنشاء التقرير الشهري بنجاح",
      messageAr: "تم إنشاء التقرير الشهري بنجاح",
      data,
    });
  } catch (err) {
    return handleError(res, err);
  }
}

module.exports = {
  getDailySubscriptionPayments,
  getMonthlySubscriptionPayments,
};
