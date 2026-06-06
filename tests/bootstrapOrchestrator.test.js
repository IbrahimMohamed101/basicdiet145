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
  assert.strictEqual(parsed.sync, true);
  assert.strictEqual(parsed.dryRun, true);
  assert.strictEqual(parsed.includeAccounts, false);

  const originalAllowAccounts = process.env.ALLOW_ACCOUNT_BOOTSTRAP;
  const originalAccountSync = process.env.ACCOUNT_BOOTSTRAP_SYNC;
  const originalReset = process.env.ALLOW_CATALOG_RESET;
  const originalNodeEnv = process.env.NODE_ENV;

  try {
    process.env.ALLOW_ACCOUNT_BOOTSTRAP = "true";
    process.env.ACCOUNT_BOOTSTRAP_SYNC = "true";
    const withAccounts = parseArgs(["--dry-run"]);
    assert.strictEqual(withAccounts.includeAccounts, true);
    assert.strictEqual(withAccounts.accountSync, true);

    const messages = [];
    const result = await runBootstrap({
      argv: ["--dry-run"],
      log: { log: (message) => messages.push(message) },
    });
    assert.strictEqual(result.dryRun, true);
    assert(messages.some((message) => message.includes("No database writes")));
    assert(messages.some((message) => message.includes("default dashboard/mobile accounts: yes")));

    delete process.env.ALLOW_CATALOG_RESET;
    assert.throws(
      () => assertResetAllowed({ reset: true }),
      /ALLOW_CATALOG_RESET/
    );

    process.env.ALLOW_CATALOG_RESET = "true";
    process.env.NODE_ENV = "production";
    assert.throws(
      () => assertResetAllowed({ reset: true }),
      /production/
    );
  } finally {
    restoreEnv("ALLOW_ACCOUNT_BOOTSTRAP", originalAllowAccounts);
    restoreEnv("ACCOUNT_BOOTSTRAP_SYNC", originalAccountSync);
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
