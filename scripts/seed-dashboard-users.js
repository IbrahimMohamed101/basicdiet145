#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");
const { connectDb } = require("../src/db");
const DashboardUser = require("../src/models/DashboardUser");
const { collectDefaultDashboardUsersFromEnv } = require("../src/services/dashboardDefaultUsersService");
const {
  normalizeDashboardEmail,
  buildDashboardEmailQuery,
  isValidEmailFormat,
  validateDashboardPassword,
  hashDashboardPassword,
} = require("../src/services/dashboardPasswordService");

async function upsertDashboardUser({ email, password, role, isActive }) {
  const normalizedEmail = normalizeDashboardEmail(email);
  if (!isValidEmailFormat(normalizedEmail)) {
    return { status: "skipped", message: `invalid email for role=${role}` };
  }

  const passwordValidation = validateDashboardPassword(password);
  if (!passwordValidation.ok) {
    return { status: "skipped", message: `weak password for role=${role}: ${passwordValidation.message}` };
  }

  const passwordHash = await hashDashboardPassword(password);
  const existing = await DashboardUser.findOne(buildDashboardEmailQuery(normalizedEmail));
  if (!existing) {
    const created = await DashboardUser.create({
      email: normalizedEmail,
      role,
      passwordHash,
      isActive,
      passwordChangedAt: new Date(),
    });
    return {
      status: "created",
      message: `created email=${created.email} role=${created.role} isActive=${created.isActive}`,
    };
  }

  existing.role = role;
  existing.passwordHash = passwordHash;
  existing.isActive = isActive;
  existing.passwordChangedAt = new Date();
  existing.failedAttempts = 0;
  existing.lockUntil = null;
  await existing.save();
  return {
    status: "updated",
    message: `updated email=${existing.email} role=${existing.role} isActive=${existing.isActive}`,
  };
}

async function main() {
  const seedUsers = collectDefaultDashboardUsersFromEnv();
  if (seedUsers.length === 0) {
    console.log("No dashboard default users found in env. Nothing to seed.");
    process.exitCode = 0;
    return;
  }

  try {
    await connectDb();
    for (const user of seedUsers) {
      const result = await upsertDashboardUser(user);
      console.log(result.message);
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
