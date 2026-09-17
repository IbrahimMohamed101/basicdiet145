#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");

const Setting = require("../../src/models/Setting");
const MenuCategory = require("../../src/models/MenuCategory");
const MenuProduct = require("../../src/models/MenuProduct");
const MenuOptionGroup = require("../../src/models/MenuOptionGroup");
const MenuOption = require("../../src/models/MenuOption");
const Plan = require("../../src/models/Plan");
const Addon = require("../../src/models/Addon");
const { seedSettings } = require("./seed-catalog");
const { seedSubscriptionPlans } = require("./seed-subscription-plans");
const { bootstrapDefaultAccounts } = require("./seed-default-accounts");
const { seedNewMenu } = require("./seed-new-menu");
const { verifyMenuWorkbookSource } = require("./verify-menu-workbook-source");
const { verifyBootstrapStructure } = require("./verify-bootstrap-structure");
const { backfillPremiumUpgrades } = require("../backfill-premium-upgrades");
const { resolveMongoUri } = require("../../src/utils/mongoUriResolver");
const menuSource = require("./fixtures/menu-workbook-source");

const BOOTSTRAP_MARKER_KEY = "initial_data_bootstrap_v2";
const BOOTSTRAP_VERSION = 2;

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
      "bootstrap:data never resets database rows. Use the guarded workbook reconciliation command before adoption."
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
  if (args.includeMealBuilder) {
    throw new Error(
      "MEAL_BUILDER_BOOTSTRAP is disabled for workbook v2 because the uploaded workbook does not define complete product-group relations."
    );
  }
}

function printDryRunPlan(args, log = console) {
  log.log("[bootstrap:dry-run] No database writes will be attempted.");
  log.log("[bootstrap:dry-run] mode=one-time-workbook-initial-import");
  log.log(`[bootstrap:dry-run] workbook=${menuSource.metadata.sourceWorkbook}`);
  log.log(`[bootstrap:dry-run] workbookSha256=${menuSource.metadata.sha256}`);
  log.log(
    `[bootstrap:dry-run] menu rows: categories=${menuSource.metadata.categoryCount} `
    + `products=${menuSource.metadata.productCount} ready=${menuSource.metadata.readyProductCount} `
    + `review=${menuSource.metadata.draftProductCount} builderOptions=${menuSource.metadata.builderOptionCount}`
  );
  log.log("[bootstrap:dry-run] product candidates are retained in the source snapshot but are not inserted into menu collections");
  log.log("[bootstrap:dry-run] existing database/dashboard rows will never be changed after completion");
  log.log(`[bootstrap:dry-run] existing-data adoption: ${args.adoptExisting ? "yes (exact workbook verification and mark only)" : "no"}`);
  log.log("[bootstrap:dry-run] subscription plans/settings/pickup locations: create missing initial rows only");
  log.log("[bootstrap:dry-run] subscription add-on plans are not inferred because the workbook does not define them");
  log.log(`[bootstrap:dry-run] premium configs: create missing discoverable configs only${args.strictPremium ? " (strict unresolved check)" : ""}`);
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
    sourceWorkbook: menuSource.metadata.sourceWorkbook,
    sourceSha256: menuSource.metadata.sha256,
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
        description: "One-time workbook initial data import state. Database/dashboard data is authoritative after completion.",
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
    MenuOptionGroup: MenuOptionGroupModel = MenuOptionGroup,
    MenuOption: MenuOptionModel = MenuOption,
    Plan: PlanModel = Plan,
    Addon: AddonModel = Addon,
  } = models;

  const [categories, products, optionGroups, options, plans, addons] = await Promise.all([
    MenuCategoryModel.countDocuments({}),
    MenuProductModel.countDocuments({}),
    MenuOptionGroupModel.countDocuments({}),
    MenuOptionModel.countDocuments({}),
    PlanModel.countDocuments({}),
    AddonModel.countDocuments({}),
  ]);

  return {
    categories: Number(categories || 0),
    products: Number(products || 0),
    optionGroups: Number(optionGroups || 0),
    options: Number(options || 0),
    plans: Number(plans || 0),
    addons: Number(addons || 0),
    total: [categories, products, optionGroups, options, plans, addons]
      .reduce((sum, value) => sum + Number(value || 0), 0),
  };
}

function defaultDependencies() {
  return {
    mongoose,
    Setting,
    MenuCategory,
    MenuProduct,
    MenuOptionGroup,
    MenuOption,
    Plan,
    Addon,
    seedNewMenu,
    seedSubscriptionPlans,
    seedSettings,
    backfillPremiumUpgrades,
    bootstrapDefaultAccounts,
    verifyMenuWorkbookSource,
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
  log.log("Connected to MongoDB for one-time workbook initial data import.");

  let result;
  try {
    const currentState = await readBootstrapState(deps.Setting);
    if (currentState && currentState.status === "completed") {
      log.log("Workbook initial data import already completed. No database rows were touched.");
      result = { dryRun: false, skipped: true, state: currentState, args };
    } else {
      const existingData = await inspectManagedData(deps);
      const resumable = currentState && ["running", "failed"].includes(currentState.status);

      if (existingData.total > 0 && !resumable && !args.adoptExisting) {
        const error = new Error(
          "Managed menu/subscription data already exists and has no workbook-v2 marker. "
          + "Run bootstrap:menu:verify. If extra live rows are reported, run the guarded reconciliation. "
          + "Then use bootstrap:data:adopt."
        );
        error.code = "BOOTSTRAP_EXISTING_DATA_REQUIRES_WORKBOOK_RECONCILIATION";
        error.details = existingData;
        throw error;
      }

      if (args.adoptExisting) {
        const menuVerification = await deps.verifyMenuWorkbookSource({ strict: true, log });
        const structuralVerification = await deps.verifyBootstrapStructure({ strict: false, log });
        const state = await writeBootstrapState(deps.Setting, "completed", {
          mode: "adopted-existing-workbook-data",
          existingData,
          verification: {
            menu: menuVerification.summary,
            structure: structuralVerification.summary,
          },
        });
        log.log("Existing workbook data verified and adopted. No menu rows were created or changed.");
        result = {
          dryRun: false,
          skipped: false,
          adopted: true,
          state,
          verification: { menu: menuVerification, structure: structuralVerification },
          args,
        };
      } else {
        await writeBootstrapState(deps.Setting, "running", {
          mode: resumable ? "resume-workbook-import" : "workbook-initial-import",
          existingData,
        });

        try {
          await deps.seedNewMenu({ sync: false, replaceExisting: false, log });
          await deps.seedSubscriptionPlans({ sync: false, cleanupFlatPlans: false, log });
          await deps.seedSettings({ sync: false });

          log.log("Creating missing Premium Upgrade Config records discoverable from workbook rows...");
          await deps.backfillPremiumUpgrades({
            sync: false,
            failOnUnresolved: args.strictPremium,
            log,
          });

          const menuVerification = await deps.verifyMenuWorkbookSource({ strict: true, log });
          const structuralVerification = await deps.verifyBootstrapStructure({ strict: false, log });
          const state = await writeBootstrapState(deps.Setting, "completed", {
            mode: resumable ? "resumed-workbook-import" : "workbook-initial-import",
            verification: {
              menu: menuVerification.summary,
              structure: structuralVerification.summary,
            },
          });

          result = {
            dryRun: false,
            skipped: false,
            adopted: false,
            state,
            verification: { menu: menuVerification, structure: structuralVerification },
            args,
          };
        } catch (error) {
          await writeBootstrapState(deps.Setting, "failed", {
            mode: resumable ? "resume-workbook-import" : "workbook-initial-import",
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
    if (Array.isArray(err.details)) console.error(JSON.stringify(err.details, null, 2));
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
