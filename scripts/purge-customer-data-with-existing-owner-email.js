#!/usr/bin/env node

"use strict";

require("dotenv").config();

const {
  BLOCKED_TEST_EMAILS,
  run,
} = require("./purge-customer-data-for-production");

const ALLOWED_EXISTING_OWNER_EMAIL = "basicdite@outlook.sa";
const REQUIRED_OVERRIDE_PHRASE = "KEEP_EXISTING_OWNER_EMAIL_WITH_NEW_PASSWORD";

function isTruthy(value) {
  return ["1", "true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function allowExistingOwnerEmail(env = process.env) {
  const email = String(env.SUPERADMIN_EMAIL || "").trim().toLowerCase();
  const failures = [];

  if (!isTruthy(env.ALLOW_EXISTING_OWNER_EMAIL)) {
    failures.push("ALLOW_EXISTING_OWNER_EMAIL=true");
  }
  if (String(env.EXISTING_OWNER_EMAIL_CONFIRM_PHRASE || "").trim() !== REQUIRED_OVERRIDE_PHRASE) {
    failures.push(`EXISTING_OWNER_EMAIL_CONFIRM_PHRASE=${REQUIRED_OVERRIDE_PHRASE}`);
  }
  if (email !== ALLOWED_EXISTING_OWNER_EMAIL) {
    failures.push(`SUPERADMIN_EMAIL=${ALLOWED_EXISTING_OWNER_EMAIL}`);
  }

  if (failures.length) {
    throw new Error(`Refusing existing-owner-email override:\n- ${failures.join("\n- ")}`);
  }

  BLOCKED_TEST_EMAILS.delete(ALLOWED_EXISTING_OWNER_EMAIL);
  return { email };
}

async function main() {
  allowExistingOwnerEmail(process.env);
  await run();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[db:existing-owner-email-purge] ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  ALLOWED_EXISTING_OWNER_EMAIL,
  REQUIRED_OVERRIDE_PHRASE,
  allowExistingOwnerEmail,
  main,
};
