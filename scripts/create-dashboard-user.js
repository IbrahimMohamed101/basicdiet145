#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");
const { connectDb } = require("../src/db");
const DashboardUser = require("../src/models/DashboardUser");
const {
  normalizeDashboardEmail,
  buildDashboardEmailQuery,
  isValidEmailFormat,
  validateDashboardPassword,
  hashDashboardPassword,
} = require("../src/services/dashboardPasswordService");

const VALID_ROLES = new Set(["superadmin", "admin", "kitchen", "courier"]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const [rawKey, inlineValue] = item.slice(2).split("=");
    if (inlineValue !== undefined) {
      args[rawKey] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[rawKey] = true;
      continue;
    }
    args[rawKey] = next;
    i += 1;
  }
  return args;
}

function parseBoolean(value) {
  if (value === undefined) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  throw new Error("Invalid boolean value. Use true/false");
}

function printUsage() {
  console.log("Usage:");
  console.log(
    "  node scripts/create-dashboard-user.js --email admin@example.com --password 'StrongPass123' --role superadmin --active true"
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    process.exit(0);
  }

  const email = normalizeDashboardEmail(args.email);
  const password = args.password;
  const role = args.role ? String(args.role).trim() : undefined;
  let isActive;

  try {
    isActive = parseBoolean(args.active);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(2);
  }

  if (!email) {
    console.error("❌ --email is required");
    process.exit(2);
  }
  if (!isValidEmailFormat(email)) {
    console.error("❌ invalid email format");
    process.exit(2);
  }
  if (role && !VALID_ROLES.has(role)) {
    console.error("❌ invalid role. Allowed: superadmin, admin, kitchen, courier");
    process.exit(2);
  }
  if (password !== undefined) {
    const passwordValidation = validateDashboardPassword(password);
    if (!passwordValidation.ok) {
      console.error(`❌ ${passwordValidation.message}`);
      process.exit(2);
    }
  }

  try {
    await connectDb();

    const existing = await DashboardUser.findOne(buildDashboardEmailQuery(email));
    if (!existing) {
      if (!password) {
        console.error("❌ --password is required when creating a new dashboard user");
        process.exitCode = 2;
        return;
      }
      if (!role) {
        console.error("❌ --role is required when creating a new dashboard user");
        process.exitCode = 2;
        return;
      }

      const passwordHash = await hashDashboardPassword(password);
      const created = await DashboardUser.create({
        email,
        passwordHash,
        role,
        isActive: isActive === undefined ? true : isActive,
        passwordChangedAt: new Date(),
      });

      console.log(`created email=${created.email} role=${created.role} isActive=${created.isActive}`);
      process.exitCode = 0;
      return;
    }

    let changed = false;
    if (role && existing.role !== role) {
      existing.role = role;
      changed = true;
    }
    if (isActive !== undefined && existing.isActive !== isActive) {
      existing.isActive = isActive;
      changed = true;
    }
    if (password !== undefined) {
      existing.passwordHash = await hashDashboardPassword(password);
      existing.passwordChangedAt = new Date();
      existing.failedAttempts = 0;
      existing.lockUntil = null;
      changed = true;
    }

    if (changed) {
      await existing.save();
      console.log(`updated email=${existing.email} role=${existing.role} isActive=${existing.isActive}`);
    } else {
      console.log(`existing email=${existing.email} role=${existing.role} isActive=${existing.isActive}`);
    }
    process.exitCode = 0;
    return;
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exitCode = 1;
    return;
  } finally {
    await mongoose.disconnect();
  }
}

main();
