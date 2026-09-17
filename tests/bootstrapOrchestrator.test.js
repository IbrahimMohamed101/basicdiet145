const assert = require("assert");

const {
  assertResetAllowed,
  parseArgs,
  runBootstrap,
} = require("../scripts/bootstrap");

function restoreEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

async function run() {
  const parsed = parseArgs(["--sync", "--dry-run"]);
  assert.strictEqual(parsed.requestedSync, true);
  assert.strictEqual(parsed.dryRun, true);
  assert.strictEqual(parsed.includeAccounts, false);

  const originalAllowAccounts = process.env.ALLOW_ACCOUNT_BOOTSTRAP;
  const originalAccountSync = process.env.ACCOUNT_BOOTSTRAP_SYNC;
  const originalMealBuilder = process.env.MEAL_BUILDER_BOOTSTRAP;
  const originalMealBuilderSync = process.env.MEAL_BUILDER_BOOTSTRAP_SYNC;
  const originalReset = process.env.ALLOW_CATALOG_RESET;
  const originalNodeEnv = process.env.NODE_ENV;

  try {
    process.env.ALLOW_ACCOUNT_BOOTSTRAP = "true";
    delete process.env.ACCOUNT_BOOTSTRAP_SYNC;
    delete process.env.MEAL_BUILDER_BOOTSTRAP;
    delete process.env.MEAL_BUILDER_BOOTSTRAP_SYNC;
    const withAccounts = parseArgs(["--dry-run"]);
    assert.strictEqual(withAccounts.includeAccounts, true);
    assert.strictEqual(withAccounts.requestedAccountSync, false);
    assert.strictEqual(withAccounts.includeMealBuilder, false);

    process.env.MEAL_BUILDER_BOOTSTRAP_SYNC = "true";
    const withMealBuilderSync = parseArgs(["--dry-run", "--sync"]);
    assert.strictEqual(withMealBuilderSync.requestedMealBuilderSync, true);

    delete process.env.MEAL_BUILDER_BOOTSTRAP_SYNC;
    const messages = [];
    const result = await runBootstrap({
      argv: ["--dry-run"],
      log: { log: (message) => messages.push(message) },
    });
    assert.strictEqual(result.dryRun, true);
    assert(messages.some((message) => message.includes("No database writes")));
    assert(messages.some((message) => message.includes("demo/default accounts: yes")));
  } finally {
    restoreEnv("ALLOW_ACCOUNT_BOOTSTRAP", originalAllowAccounts);
    restoreEnv("ACCOUNT_BOOTSTRAP_SYNC", originalAccountSync);
    restoreEnv("MEAL_BUILDER_BOOTSTRAP", originalMealBuilder);
    restoreEnv("MEAL_BUILDER_BOOTSTRAP_SYNC", originalMealBuilderSync);
    restoreEnv("ALLOW_CATALOG_RESET", originalReset);
    restoreEnv("NODE_ENV", originalNodeEnv);
  }
}

run()
  .then(() => {
    console.log("bootstrapOrchestrator.test.js passed");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
