#!/usr/bin/env node

"use strict";

require("dotenv").config();
require("./workbook-production-readiness-policy");

const mongoose = require("mongoose");
const Setting = require("../../src/models/Setting");
const { resolveMongoUri } = require("../../src/utils/mongoUriResolver");
const { bootstrapDefaultAccounts } = require("./seed-default-accounts");
const { seedSettings } = require("./seed-catalog");
const { seedWorkbookPremiumLargeSalad } = require("./seed-workbook-premium-large-salad");
const { seedBasicSaladBuilder } = require("./seed-basic-salad-builder");
const { verifyBootstrapReadiness } = require("./verify-bootstrap-readiness");
const {
  IMPORT_KEY: WORKBOOK_PRODUCTION_IMPORT_KEY,
  runWorkbookProductionImport,
  verifyWorkbookProductionImport,
} = require("./workbook-production-import");
const {
  BOOTSTRAP_MARKER_KEY,
  runBootstrap,
  writeBootstrapState,
} = require("./index");

function isTruthy(value) {
  return ["1", "true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    force: argv.includes("--force"),
    dryRun: argv.includes("--dry-run"),
    includeAccounts: isTruthy(process.env.ALLOW_ACCOUNT_BOOTSTRAP),
    allowFullBootstrap: isTruthy(process.env.ALLOW_FULL_BOOTSTRAP),
    requestedAccountSync: isTruthy(process.env.ACCOUNT_BOOTSTRAP_SYNC),
  };
}

async function disconnectIfNeeded() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}

function printFullDryRun({ includeAccounts }, log = console) {
  log.log("[bootstrap:full:dry-run] No database writes will be attempted.");
  log.log("[bootstrap:full:dry-run] Workbook menu, Meal Builder, custom-order meal and salad builders, premium upgrades, subscription plans, add-ons, settings, pickup locations, and delivery zones will be synchronized.");
  log.log("[bootstrap:full:dry-run] Existing subscriptions, balances, reservations, orders, and account passwords will be preserved.");
  log.log(`[bootstrap:full:dry-run] Missing default accounts will be created: ${includeAccounts ? "yes" : "no"}`);
  log.log("[bootstrap:full:dry-run] Final workbook verification and bootstrap readiness checks must pass.");
}

async function markFailure({ uri, error, phase }) {
  try {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    }
    await writeBootstrapState(Setting, "failed", {
      mode: "guarded-full-rebuild",
      phase,
      error: {
        code: error.code || "FULL_BOOTSTRAP_FAILED",
        message: error.message,
      },
    });
  } finally {
    await disconnectIfNeeded();
  }
}

async function runFullBootstrap({
  includeAccounts = isTruthy(process.env.ALLOW_ACCOUNT_BOOTSTRAP),
  log = console,
} = {}) {
  const uri = resolveMongoUri();
  let dataResult = null;
  let premiumLargeSalad = null;
  let basicSaladBuilder = null;
  let accountSummary = null;

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    log.log("Connected to MongoDB for guarded full bootstrap rebuild.");
    await writeBootstrapState(Setting, "running", {
      mode: "guarded-full-rebuild",
      phase: "data",
      startedAt: new Date().toISOString(),
    });

    await Setting.deleteOne({ key: WORKBOOK_PRODUCTION_IMPORT_KEY });
    dataResult = await runWorkbookProductionImport({ log, connect: false });
    await seedSettings({ sync: true });
    premiumLargeSalad = await seedWorkbookPremiumLargeSalad({ sync: true, log });
    basicSaladBuilder = await seedBasicSaladBuilder();
  } catch (error) {
    await markFailure({ uri, error, phase: "data" });
    throw error;
  } finally {
    await disconnectIfNeeded();
  }

  if (includeAccounts) {
    try {
      accountSummary = await bootstrapDefaultAccounts({ sync: false });
    } catch (error) {
      await disconnectIfNeeded();
      await markFailure({ uri, error, phase: "accounts" });
      throw error;
    } finally {
      await disconnectIfNeeded();
    }
  } else {
    log.log("Default accounts were not requested. Set ALLOW_ACCOUNT_BOOTSTRAP=true to create missing bootstrap accounts.");
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    const workbookVerification = await verifyWorkbookProductionImport();
    const readiness = await verifyBootstrapReadiness();
    const state = await writeBootstrapState(Setting, "completed", {
      mode: "guarded-full-rebuild",
      phase: "completed",
      workbookProductionImport: dataResult?.verification || null,
      premiumLargeSalad,
      basicSaladBuilder,
      readiness: readiness.map((row) => ({ check: row.check, status: row.status })),
      accounts: accountSummary
        ? {
            created: accountSummary.created.length,
            skipped: accountSummary.skipped.length,
            verificationWarnings: accountSummary.failedVerification.length,
          }
        : null,
    });
    log.log("Guarded full bootstrap rebuild completed and passed readiness verification.");
    return {
      forced: true,
      state,
      dataResult,
      premiumLargeSalad,
      basicSaladBuilder,
      accountSummary,
      verification: { workbook: workbookVerification, readiness },
    };
  } catch (error) {
    await markFailure({ uri, error, phase: "verification" });
    throw error;
  } finally {
    await disconnectIfNeeded();
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.force) return runBootstrap({ argv });
  if (!args.allowFullBootstrap) {
    throw new Error(
      "Refusing the full bootstrap rebuild. Run with ALLOW_FULL_BOOTSTRAP=true and --force."
    );
  }
  if (args.requestedAccountSync) {
    throw new Error(
      "ACCOUNT_BOOTSTRAP_SYNC is not allowed in the full bootstrap. Existing account passwords are preserved."
    );
  }
  if (args.dryRun) {
    printFullDryRun(args);
    return { dryRun: true, forced: true };
  }
  return runFullBootstrap({ includeAccounts: args.includeAccounts });
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`[bootstrap:data] ${error.code ? `${error.code}: ` : ""}${error.message}`);
    if (Array.isArray(error.details)) console.error(JSON.stringify(error.details, null, 2));
    await disconnectIfNeeded();
    process.exit(1);
  });
}

module.exports = {
  BOOTSTRAP_MARKER_KEY,
  main,
  parseArgs,
  printFullDryRun,
  runFullBootstrap,
};
