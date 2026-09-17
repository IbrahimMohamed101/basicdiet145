"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "subscription-quote-composition-test-secret";
process.env.DASHBOARD_JWT_SECRET =
  process.env.DASHBOARD_JWT_SECRET
  || "subscription-quote-composition-dashboard-test-secret";

const assert = require("assert");
const path = require("path");
const { execFileSync } = require("child_process");

const projectRoot = path.join(__dirname, "..");

function runPreloadedControllerSmoke() {
  const script = [
    'const controller = require("./src/controllers/subscriptionController")',
    'const earlyResolver = controller.resolveCheckoutQuoteOrThrow',
    'require("./src/routes/index")',
    'const quoteService = require("./src/services/subscription/subscriptionQuoteService")',
    'if (typeof earlyResolver !== "function") throw new Error("early controller resolver missing")',
    'if (!quoteService.resolveCheckoutQuoteOrThrow.__dashboardDeliverySlotCompatible) {',
    '  throw new Error("final service resolver lost delivery-slot compatibility")',
    '}',
    'if (!quoteService.resolveCheckoutQuoteOrThrow.__subscriptionAddonPlanAvailabilityPolicy) {',
    '  throw new Error("final service resolver lost add-on plan availability policy")',
    '}',
    'if (controller.resolveCheckoutQuoteOrThrow !== quoteService.resolveCheckoutQuoteOrThrow) {',
    '  throw new Error("controller resolver is not rebound to the final service export")',
    '}',
    'if (!controller.quoteSubscription.__subscriptionQuoteControllerComposition) {',
    '  throw new Error("quote handler was not rebound to dynamic composition")',
    '}',
    'if (!controller.checkoutSubscription.__subscriptionQuoteControllerComposition) {',
    '  throw new Error("checkout handler was not rebound to dynamic composition")',
    '}',
  ].join(";");

  execFileSync(process.execPath, ["-e", script], {
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

async function runDynamicRuntimeSmoke() {
  const quoteService = require(
    "../src/services/subscription/subscriptionQuoteService"
  );
  const {
    buildDynamicQuoteRuntime,
  } = require(
    "../src/services/installSubscriptionQuoteControllerComposition"
  );

  const original = quoteService.resolveCheckoutQuoteOrThrow;
  try {
    const runtime = buildDynamicQuoteRuntime();
    const first = async () => "first";
    const second = async () => "second";

    quoteService.resolveCheckoutQuoteOrThrow = first;
    assert.strictEqual(await runtime.resolveCheckoutQuoteOrThrow(), "first");

    quoteService.resolveCheckoutQuoteOrThrow = second;
    assert.strictEqual(
      await runtime.resolveCheckoutQuoteOrThrow(),
      "second",
      "the same runtime must resolve the current service export at call time"
    );

    const explicit = async () => "explicit";
    const explicitRuntime = buildDynamicQuoteRuntime({
      resolveCheckoutQuoteOrThrow: explicit,
      marker: "preserved",
    });
    assert.strictEqual(explicitRuntime.resolveCheckoutQuoteOrThrow, explicit);
    assert.strictEqual(explicitRuntime.marker, "preserved");

    const expressNextRuntime = buildDynamicQuoteRuntime(() => {});
    quoteService.resolveCheckoutQuoteOrThrow = first;
    assert.strictEqual(
      await expressNextRuntime.resolveCheckoutQuoteOrThrow(),
      "first",
      "Express next must not be mistaken for a runtime override object"
    );
  } finally {
    quoteService.resolveCheckoutQuoteOrThrow = original;
  }
}

(async function run() {
  runPreloadedControllerSmoke();
  await runDynamicRuntimeSmoke();
  console.log("subscriptionQuoteControllerComposition.test.js passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
