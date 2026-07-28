"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "meal-builder-premium-composition-test-secret";
process.env.DASHBOARD_JWT_SECRET =
  process.env.DASHBOARD_JWT_SECRET
  || "meal-builder-premium-composition-dashboard-test-secret";

const assert = require("assert");
const path = require("path");
const { execFileSync } = require("child_process");

const projectRoot = path.join(__dirname, "..");

function runChild(lines) {
  execFileSync(process.execPath, ["-e", lines.join(";")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      JWT_SECRET: process.env.JWT_SECRET,
      DASHBOARD_JWT_SECRET: process.env.DASHBOARD_JWT_SECRET,
    },
    stdio: "pipe",
  });
}

function testPreloadedServiceIsReboundInPlace() {
  runChild([
    'const path = require.resolve("./src/services/subscription/mealBuilderConfigService")',
    'const captured = require(path)',
    'const before = captured.buildPlannerCatalogFromPublishedBuilder',
    'require("./src/services/installIndependentPremiumAuthority")',
    'const installer = require("./src/services/installMealBuilderPremiumAuthorityComposition")',
    'const after = require(path)',
    'if (!installer.installation.recomposed) throw new Error("preloaded Meal Builder was not recomposed")',
    'if (captured !== after) throw new Error("preloaded and future imports must share one exports object")',
    'if (captured.buildPlannerCatalogFromPublishedBuilder === before) throw new Error("stale planner closure was not replaced")',
    'if (!installer.installation.reboundExports.includes("buildPlannerCatalogFromPublishedBuilder")) throw new Error("planner export was not recorded as rebound")',
    'if (installer.installMealBuilderPremiumAuthorityComposition() !== installer.installation) throw new Error("installer must be idempotent")',
  ]);
}

function testNormalStartupDoesNotReloadUncachedService() {
  runChild([
    'require("./src/services/installIndependentPremiumAuthority")',
    'const installer = require("./src/services/installMealBuilderPremiumAuthorityComposition")',
    'if (installer.installation.recomposed) throw new Error("normal startup must not reload an uncached service")',
    'if (installer.installation.reason !== "meal_builder_service_not_preloaded") throw new Error("unexpected normal-startup reason")',
    'const service = require("./src/services/subscription/mealBuilderConfigService")',
    'if (typeof service.buildPlannerCatalogFromPublishedBuilder !== "function") throw new Error("Meal Builder service did not load normally")',
  ]);
}

(function run() {
  testPreloadedServiceIsReboundInPlace();
  testNormalStartupDoesNotReloadUncachedService();
  console.log("mealBuilderPremiumAuthorityComposition.test.js passed");
})();
