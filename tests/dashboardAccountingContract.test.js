"use strict";

require("./helpers/installMongoTestSafetyGuard");

// Canonical command requested by the dashboard contract. The detailed
// integration suite remains in one place to avoid two suites mutating the same
// accounting fixtures independently.
require("dotenv").config();

const configuredMongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test";
if (/\/basicdiet145(?:\?|$)/.test(configuredMongoUri)) {
  process.env.MONGO_URI = configuredMongoUri.replace(/\/basicdiet145(?=\?|$)/, "/basicdiet_test");
}

require("./dashboardAccountingDailyReport.test");
