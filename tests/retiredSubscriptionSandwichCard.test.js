"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const routesPath = path.join(__dirname, "../src/routes/index.js");
const injectorPath = path.join(
  __dirname,
  "../src/services/installDynamicDirectMealCatalogPolicy.js"
);

const routesSource = fs.readFileSync(routesPath, "utf8");
const injectorSource = fs.readFileSync(injectorPath, "utf8");

assert(
  injectorSource.includes('const DYNAMIC_SECTION_KEY = "sandwich"'),
  "fixture must continue to identify the legacy app-only sandwich injector"
);
assert(
  injectorSource.includes("nextSections.push"),
  "fixture must prove the legacy policy can append an un-authored public section"
);
assert(
  !routesSource.includes(
    'require("../services/installDynamicDirectMealCatalogPolicy")'
  ),
  "the app-only live-catalog sandwich injector must not be installed"
);
assert(
  routesSource.includes(
    'require("../services/installDashboardMealBuilderExplicitDirectCardPolicy")'
  ),
  "dashboard-authored direct product cards must remain supported"
);
assert(
  routesSource.includes(
    'require("../services/installDashboardDirectPickerClassificationGuard")'
  ),
  "dashboard direct-product catalog classification must remain installed"
);
assert(
  routesSource.includes(
    'require("../services/installDashboardPremiumCardHydration")'
  ),
  "dashboard system Premium cards must mirror active PremiumUpgradeConfig rows"
);
assert(
  routesSource.includes(
    'require("../services/installFlutterPublishedSelectionAuthority")'
  ),
  "Flutter planner output must remain constrained to published dashboard selections"
);

require("./dashboardPremiumCardHydration.test");
require("./flutterPublishedSelectionAuthority.test");

console.log("app-only subscription sandwich card injector is retired");
