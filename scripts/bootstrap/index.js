#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");

const Setting = require("../../src/models/Setting");
const MenuCategory = require("../../src/models/MenuCategory");
const MenuProduct = require("../../src/models/MenuProduct");
const Plan = require("../../src/models/Plan");
const Addon = require("../../src/models/Addon");
const { seedCatalog, seedSubscriptionAddons } = require("./seed-catalog");
const { seedSubscriptionPlans } = require("./seed-subscription-plans");
const { bootstrapDefaultAccounts } = require("./seed-default-accounts");
const { seedMealBuilderConfig } = require("./seed-meal-builder");
const { seedNewMenu } = require("./seed-new-menu");
const { verifyBootstrapStructure } = require("./verify-bootstrap-structure");
const { backfillPremiumUpgrades } = require("../backfill-premium-upgrades");
const { resolveMongoUri } = require("../../src/utils/mongoUriResolver");

const BOOTSTRAP_MARKER_KEY = "initial_data_bootstrap_v1";
const BOOTSTRAP_VERSION = 1;

function isTruthy(value) {
  return ["1", "true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    dryRun: argv.includes("--dry-run"),
    adoptExisting: argv.includes("--adopt-existing"),
    requestedSync: argv.includes("--sync") || isTruthy(process.env.BOOTSTRAP_SYNC),
    requestedReset: argv.includes("--reset"),
    includeAccounts: isTruthy(process.env.ALLOW_ACCOUNT_BOOTSTRAP),
    requestedAccountSync: isTruthy(process.env.ACCOUNT_BOOTSTRAP_SYNC),
    includeMealBuilder: isTruthy(process.env.MEAL_BUILDER_BOOTSTRAP),
    requestedMealBuilderSync: isTruthy(process.env.MEAL_BUILDER_BOOTSTRAP_SYNC),
    strictPremium: isTruthy(process.env.PREMIUM_BOOTSTRAP_STRICT),
  };
}

function assertInitialImportOnly(args) {
  if (args.requestedSync) {
    throw new Error(
      "bootstrap:data is an initial import only and never synchronizes database rows. "
      + "Edit catalog data from the dashboard after import."
    );
  }
  if (args.requestedReset) {
    throw new Error(
      "bootstrap:data never resets database rows. Use a dedicated, reviewed maintenance script for destructive work."
    );
  }
  if (args.requestedAccountSync) {
    throw new Error(
      "bootstrap:data never synchronizes existing accounts. Account changes belong to the dashboard/auth administration flow."
    );
  }
  if (args.requestedMealBuilderSync) {
    throw new Error(
      "bootstrap:data never synchronizes an existing Meal Builder configuration. Dashboard-authored configuration is authoritative."
    );
  }
}

function printDryRunPlan(args, log = console) {
  log.log("[bootstrap:dry-run] No database writes will be attempted.");
  log.log("[bootstrap:dry-run] mode=one-time-initial-import");
  log.log("[bootstrap:dry-run] existing database rows will never be updated, reset, deleted, or recreated after completion");
  log.log(`[bootstrap:dry-run] existing-data adoption: ${args.adoptExisting ? "yes (verify and mark only)" : "no"}`);
  log.log("[bootstrap:dry-run] catalog/menu/products/options/relations: create initial data only");
  log.log("[bootstrap:dry-run] subscription plans/add-ons/settings/pickup locations: create initial data only");
  log.log(`[bootstrap:dry-run] premium configs: create missing initial configs only${args.strictPremium ? " (strict unresolved check)" : ""}`);
  log.log(`[bootstrap:dry-run] meal builder initial config: ${args.includeMealBuilder ? "yes" : "no"}`);
  log.log(`[bootstrap:dry-run] demo/default accounts: ${args.includeAccounts ? "yes" : "no"}`);
}

async function findOneLean(Model, query) {
  const result = Model.findOne(query);
  return result && typeof result.lean === "function" ? result.lean() : result;
}

async function readBootstrapState(SettingModel = Setting) {
  const row = await findOneLean(SettingModel, { key: BOOTSTRAP_MARKER_KEY });
  return row && row.value && typeof row.value === "object" ? row.value : null;
}

async function writeBootstrapState(SettingModel, status, details = {}) {
  const now = new Date();
  const value = {
    version: BOOTSTRAP_VERSION,
    status,
    updatedAt: now.toISOString(),
    ...details,
  };
  if (status === "completed") value.completedAt = now.toISOString();

  await SettingModel.updateOne(
    { key: BOOTSTRAP_MARKER_KEY },
    {
      $set: {
        value,
        description: "One-time initial data import state. Database/dashboard data is authoritative after completion.",
      },
    },
    { upsert: true, runValidators: true }
  );
  return value;
}

async function inspectManagedData(models = {}) {
  const {
    MenuCategory: MenuCategoryModel = MenuCategory,
    MenuProduct: MenuProductModel = MenuProduct,
    Plan: PlanModel = Plan,
    Addon: AddonModel = Addon,
  } = models;

  const [categories, products, plans, addons] = await Promise.all([
    MenuCategoryModel.countDocuments({}),
    MenuProductModel.countDocuments({}),
    PlanModel.countDocuments({}),
    AddonModel.countDocuments({}),
  ]);

  return {
    categories: Number(categories || 0),
    products: Number(products || 0),
    plans: Number(plans || 0),
    addons: Number(addons || 0),
    total: Number(categories || 0) + Number(products || 0) + Number(plans || 0) + Number(addons || 0),
  };
}

function defaultDependencies() {
  return {
    mongoose,
    Setting,
    MenuCategory,
    MenuProduct,
    Plan,
    Addon,
    seedCatalog,
    seedNewMenu,
    seedSubscriptionPlans,
    seedSubscriptionAddons,
    backfillPremiumUpgrades,
    seedMealBuilderConfig,
    bootstrapDefaultAccounts,
    verifyBootstrapStructure,
    resolveMongoUri,
  };
}

async function runBootstrap(options = {}) {
  const {
    argv,
    log = console,
    dependencies = {},
    ...argumentOverrides
  } = options;
  const args = { ...parseArgs(argv), ...argumentOverrides };
  assertInitialImportOnly(args);

  if (args.dryRun) {
    printDryRunPlan(args, log);
    return { dryRun: true, args };
  }

  const deps = { ...defaultDependencies(), ...dependencies };
  const uri = deps.resolveMongoUri();
  await deps.mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  log.log("Connected to MongoDB for one-time initial data import.");

  let result;
  try {
    const currentState = await readBootstrapState(deps.Setting);
    if (currentState && currentState.status === "completed") {
      log.log("Initial data import already completed. No database rows were touched.");
      result = { dryRun: false, skipped: true, state: currentState, args };
    } else {
      const existingData = await inspectManagedData(deps);
      const resumable = currentState && ["running", "failed"].includes(currentState.status);

      if (existingData.total > 0 && !resumable && !args.adoptExisting) {
        const error = new Error(
          "Managed catalog/subscription data already exists and has no bootstrap marker. "
          + "Run bootstrap:verify first, then use --adopt-existing to mark it without changing any rows."
        );
        error.code = "BOOTSTRAP_EXISTING_DATA_REQUIRES_ADOPTION";
        error.details = existingData;
        throw error;
      }

      if (args.adoptExisting) {
        const verification = await deps.verifyBootstrapStructure({ strict: true, log });
        const state = await writeBootstrapState(deps.Setting, "completed", {
          mode: "adopted-existing-data",
          existingData,
          verification: verification.summary,
        });
        log.log("Existing data verified and adopted. No catalog rows were created or changed.");
        result = { dryRun: false, skipped: false, adopted: true, state, verification, args };
      } else {
        await writeBootstrapState(deps.Setting, "running", {
          mode: resumable ? "resume-initial-import" : "initial-import",
          existingData,
        });

        try {
          await deps.seedCatalog({
            sync: false,
            reset: false,
            includeSubscriptionPlans: false,
            skipStrictVerify: true,
          });

          await deps.seedNewMenu({ sync: false, log });
          await deps.seedSubscriptionPlans({ sync: false, cleanupFlatPlans: false, log });
          await deps.seedSubscriptionAddons(null, { sync: false });

          log.log("Creating missing initial Premium Upgrade Config records...");
          await deps.backfillPremiumUpgrades({
            sync: false,
            failOnUnresolved: args.strictPremium,
            log,
          });

          if (args.includeMealBuilder) {
            await deps.seedMealBuilderConfig({ sync: false, dryRun: false, log });
          } else {
            log.log("Meal Builder initial config skipped. Configure it from the dashboard or set MEAL_BUILDER_BOOTSTRAP=true for the first import.");
          }

          const verification = await deps.verifyBootstrapStructure({ strict: true, log });
          const state = await writeBootstrapState(deps.Setting, "completed", {
            mode: resumable ? "resumed-initial-import" : "initial-import",
            verification: verification.summary,
          });

          result = { dryRun: false, skipped: false, adopted: false, state, verification, args };
        } catch (error) {
          await writeBootstrapState(deps.Setting, "failed", {
            mode: resumable ? "resume-initial-import" : "initial-import",
            error: {
              code: error.code || "BOOTSTRAP_FAILED",
              message: error.message,
            },
          }).catch(() => {});
          throw error;
        }
      }
    }
  } finally {
    if (deps.mongoose.connection.readyState !== 0) await deps.mongoose.disconnect();
  }

  if (result && !result.skipped && !result.adopted && args.includeAccounts) {
    try {
      await deps.bootstrapDefaultAccounts({ sync: false });
    } finally {
      if (deps.mongoose.connection.readyState !== 0) await deps.mongoose.disconnect();
    }
  } else if (!args.includeAccounts) {
    log.log("Demo/default account bootstrap skipped. Use bootstrap:superadmin for the production owner account.");
  }

  return result;
}

async function main() {
  await runBootstrap();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(`[bootstrap:data] ${err.code ? `${err.code}: ` : ""}${err.message}`);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = {
  BOOTSTRAP_MARKER_KEY,
  BOOTSTRAP_VERSION,
  assertInitialImportOnly,
  inspectManagedData,
  main,
  parseArgs,
  printDryRunPlan,
  readBootstrapState,
  runBootstrap,
  writeBootstrapState,
};
