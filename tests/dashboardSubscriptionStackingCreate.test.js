"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  isCreateRequest,
  isSafeRequest,
} = require("../src/middleware/dashboardSubscriptionStackingWriteGuard");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function run() {
  const createRequest = {
    method: "POST",
    originalUrl: "/api/dashboard/subscriptions",
    body: { userId: "66b000000000000000000001" },
  };
  assert.strictEqual(isCreateRequest(createRequest), true);
  assert.strictEqual(
    isSafeRequest(createRequest),
    true,
    "dashboard create must not be rejected by the legacy combined-package guard"
  );

  const routeSource = read("src/routes/dashboardSubscriptions.js");
  const installerIndex = routeSource.indexOf(
    'require("../services/installDashboardSubscriptionStackingFlow")'
  );
  const promoInstallerIndex = routeSource.indexOf(
    'require("../services/installDashboardSubscriptionPromoFlow")'
  );
  const paymentControllerIndex = routeSource.indexOf(
    'require("../controllers/dashboard/subscriptionPaymentRecordingController")'
  );
  assert.ok(installerIndex >= 0, "dashboard stacking installer is wired");
  assert.ok(promoInstallerIndex > installerIndex, "promo wrapper composes over stacking");
  assert.ok(
    promoInstallerIndex < paymentControllerIndex,
    "stacking and promo installers must run before dashboard controllers capture activation exports"
  );

  const bootSource = read("src/index.js");
  const bootStackingIndex = bootSource.indexOf(
    'require("./services/installDashboardSubscriptionStackingFlow")'
  );
  const bootPromoIndex = bootSource.indexOf(
    'require("./services/installDashboardSubscriptionPromoFlow")'
  );
  const createAppIndex = bootSource.indexOf('require("./app")');
  assert.ok(bootStackingIndex >= 0, "production boot installs dashboard stacking");
  assert.ok(bootPromoIndex > bootStackingIndex, "production boot composes promo over stacking");
  assert.ok(
    bootPromoIndex < createAppIndex,
    "dashboard activation composition must finish before createApp loads adminController"
  );

  const stackingSource = read(
    "src/services/installDashboardSubscriptionStackingFlow.js"
  );
  assert.ok(
    stackingSource.includes("buildCanonicalContractActivationPayload"),
    "dashboard additive activation reuses the canonical subscription payload"
  );
  assert.ok(
    stackingSource.includes('sourceType: "dashboard"'),
    "dashboard purchases persist as dashboard entitlement batches"
  );
  assert.ok(
    stackingSource.includes("checkoutDraftId: null"),
    "dashboard batches must not point at synthetic checkout drafts"
  );
  assert.ok(
    stackingSource.includes(
      "activatePinnedExtrasPaidDraftIntoExistingContainerTransactional"
    ),
    "premium/add-on purchases use the pinned stacking activation path"
  );
  assert.ok(
    stackingSource.includes("materializeStackingSubscriptionDaysTransactional"),
    "stacked dashboard purchases materialize subscription days"
  );
  assert.ok(
    stackingSource.includes("stackingActivationLease"),
    "standalone MongoDB path retains the stacking concurrency lease"
  );

  console.log("✅ dashboard subscription create uses additive stacking");
}

try {
  run();
} catch (err) {
  console.error("❌ dashboard subscription stacking create regression");
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
}
