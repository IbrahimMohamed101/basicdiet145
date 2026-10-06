"use strict";

const {
  MarketingAnalyticsError,
  buildMarketingAnalyticsReport,
} = require("../../services/dashboard/marketingAnalyticsService");

async function getMarketingAnalytics(req, res) {
  try {
    const data = await buildMarketingAnalyticsReport({
      from: req.query.from,
      to: req.query.to,
      comparePrevious: req.query.comparePrevious,
      promoCode: req.query.promoCode,
      fulfillmentMethod: req.query.fulfillmentMethod,
      paymentProvider: req.query.paymentProvider,
      daysCount: req.query.daysCount,
      grams: req.query.grams,
      mealsPerDay: req.query.mealsPerDay,
    });

    return res.status(200).json({
      status: true,
      message: "تم إنشاء تقرير تحليلات التسويق بنجاح",
      messageAr: "تم إنشاء تقرير تحليلات التسويق بنجاح",
      data,
    });
  } catch (err) {
    if (err instanceof MarketingAnalyticsError) {
      return res.status(err.status).json({
        status: false,
        message: err.message,
        messageAr: err.message,
        error: {
          code: err.code,
          message: err.message,
          messageAr: err.message,
        },
      });
    }
    throw err;
  }
}

module.exports = {
  getMarketingAnalytics,
};
