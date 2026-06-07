const assert = require("assert");

const bootstrap = require("../scripts/bootstrap");

assert.strictEqual(typeof bootstrap.runBootstrap, "function");
assert.strictEqual(typeof bootstrap.parseArgs, "function");
assert.strictEqual(typeof bootstrap.printDryRunPlan, "function");

const args = bootstrap.parseArgs(["--dry-run", "--sync"]);
assert.strictEqual(args.dryRun, true);
assert.strictEqual(args.sync, true);

console.log("bootstrap module resolution test passed");
