"use strict";

const service = require("../../src/services/subscription/mealBuilderConfigService");

if (!service.__workbookProductionReadinessPolicyInstalled) {
  const originalGetReadinessReport = service.getReadinessReport;
  service.getReadinessReport = async function workbookProductionReadinessReport(...args) {
    const report = await originalGetReadinessReport(...args);
    const errors = Number(report?.summary?.errors || 0);
    if (report?.status === "warning" && errors === 0) {
      return {
        ...report,
        status: "ready",
        originalStatus: "warning",
        acceptedWithWarnings: true,
      };
    }
    return report;
  };
  service.__workbookProductionReadinessPolicyInstalled = true;
}
