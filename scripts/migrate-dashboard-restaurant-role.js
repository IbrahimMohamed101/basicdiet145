#!/usr/bin/env node

"use strict";

require("dotenv").config();

const mongoose = require("mongoose");
const DashboardUser = require("../src/models/DashboardUser");
const { resolveMongoUri } = require("../src/utils/mongoUriResolver");

const LEGACY_ROLES = Object.freeze(["kitchen", "cashier"]);
const TARGET_ROLE = "restaurant";

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

function assertExecutionAllowed(execute) {
  if (!execute) return;
  if (
    process.env.NODE_ENV === "production"
    && process.env.ALLOW_DASHBOARD_ROLE_MIGRATION !== "true"
  ) {
    throw new Error(
      "Refusing production migration. Set ALLOW_DASHBOARD_ROLE_MIGRATION=true and rerun with --execute."
    );
  }
}

async function migrateDashboardRestaurantRole({ execute = false } = {}) {
  assertExecutionAllowed(execute);
  await mongoose.connect(resolveMongoUri(), { serverSelectionTimeoutMS: 10000 });

  const filter = { role: { $in: LEGACY_ROLES } };
  const rows = await DashboardUser.find(filter)
    .select("_id email role isActive")
    .sort({ email: 1 })
    .lean();

  console.log(
    `[restaurant-role] mode=${execute ? "execute" : "dry-run"} legacyAccounts=${rows.length}`
  );
  for (const row of rows) {
    console.log(
      `[restaurant-role] ${row.email} ${row.role} -> ${TARGET_ROLE} active=${row.isActive !== false}`
    );
  }

  if (!execute || rows.length === 0) {
    return { matchedCount: rows.length, modifiedCount: 0, execute };
  }

  const result = await DashboardUser.updateMany(
    filter,
    {
      $set: {
        role: TARGET_ROLE,
        updatedAt: new Date(),
      },
    },
    { runValidators: true }
  );

  console.log(
    `[restaurant-role] matched=${result.matchedCount} modified=${result.modifiedCount}`
  );
  return {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    execute,
  };
}

async function main() {
  try {
    await migrateDashboardRestaurantRole({ execute: hasFlag("--execute") });
  } catch (err) {
    console.error(`[restaurant-role] ${err.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  LEGACY_ROLES,
  TARGET_ROLE,
  assertExecutionAllowed,
  migrateDashboardRestaurantRole,
};
