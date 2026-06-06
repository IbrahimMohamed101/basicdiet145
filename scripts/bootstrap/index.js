#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");

const { seedCatalog } = require("./seed-catalog");
const { seedSubscriptionPlans } = require("./seed-subscription-plans");
const { bootstrapDefaultAccounts } = require("./seed-default-accounts");


function isTruthy(value) {
  return ["1", "true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    dryRun: argv.includes("--dry-run"),
    sync: argv.includes("--sync") || isTruthy(process.env.BOOTSTRAP_SYNC),
    reset: argv.includes("--reset"),
    includeAccounts: isTruthy(process.env.ALLOW_ACCOUNT_BOOTSTRAP),
    accountSync: isTruthy(process.env.ACCOUNT_BOOTSTRAP_SYNC),
  };
}

function getEnvironmentName() {
  return process.env.NODE_ENV || "development";
}

function assertResetAllowed({ reset }) {
  if (!reset) return;
  if (!isTruthy(process.env.ALLOW_CATALOG_RESET)) {
    throw new Error("Refusing reset. Set ALLOW_CATALOG_RESET=true with --reset in a local/test environment.");
  }
  if (getEnvironmentName() === "production") {
    throw new Error("Refusing reset in production.");
  }
}

function printDryRunPlan(args, log = console) {
  log.log("[bootstrap:dry-run] No database writes will be attempted.");
  log.log(`[bootstrap:dry-run] mode=${args.sync ? "sync" : "create-missing-only"}`);
  log.log(`[bootstrap:dry-run] catalog/menu seed: yes${args.reset ? " with guarded reset" : ""}`);
  log.log("[bootstrap:dry-run] subscription plans seed: yes");
  log.log("[bootstrap:dry-run] subscription addons/settings/pickup locations: handled by catalog seed");
  log.log(`[bootstrap:dry-run] default dashboard/mobile accounts: ${args.includeAccounts ? "yes" : "no"}`);
  if (args.includeAccounts) {
    log.log(`[bootstrap:dry-run] account mode=${args.accountSync ? "sync" : "create-missing-only"}`);
  }
}

const { resolveMongoUri } = require("../utils/mongoUriResolver");

async function runBootstrap(options = {}) {
  const args = { ...parseArgs(options.argv), ...options };
  assertResetAllowed(args);

  if (args.dryRun) {
    printDryRunPlan(args, options.log || console);
    return { dryRun: true, args };
  }

  const uri = resolveMongoUri();
  await mongoose.connect(uri);
  console.log("Connected to MongoDB for data bootstrap.");
  try {
    await seedCatalog({
      sync: args.sync && isTruthy(process.env.BOOTSTRAP_SYNC),
      reset: args.reset,
      includeSubscriptionPlans: false,
    });
    await seedSubscriptionPlans({
      sync: args.sync && isTruthy(process.env.BOOTSTRAP_SYNC),
      cleanupFlatPlans: args.sync && isTruthy(process.env.BOOTSTRAP_SYNC),
    });
  } finally {
    await mongoose.disconnect();
  }

  if (args.includeAccounts) {
    await bootstrapDefaultAccounts({ sync: args.accountSync });
  } else {
    console.log("Default account bootstrap skipped. Set ALLOW_ACCOUNT_BOOTSTRAP=true to enable it.");
  }

  return { dryRun: false, args };
}

async function main() {
  await runBootstrap();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(`[bootstrap:data] ${err.message}`);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    process.exit(1);
  });
}

module.exports = {
  assertResetAllowed,
  main,
  parseArgs,
  printDryRunPlan,
  runBootstrap,
};
