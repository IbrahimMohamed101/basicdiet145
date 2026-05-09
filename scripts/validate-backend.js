#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const packageJsonPath = path.join(rootDir, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const npmScripts = packageJson.scripts || {};

const RUN_DB_CHECKS = process.env.VALIDATE_BACKEND_WITH_LOCAL_DB === "true";
const RUN_CATALOG_DB_CHECK = process.env.VALIDATE_BACKEND_CATALOG_DB === "true";
const RUN_NEWMAN = process.env.VALIDATE_BACKEND_NEWMAN === "true";

const steps = [
  {
    title: "Core unit/static smoke tests",
    command: "npm",
    args: ["test"],
    requiredScript: "test",
  },
  {
    title: "One-time menu catalog contract",
    command: "npm",
    args: ["run", "test:one-time-menu"],
    requiredScript: "test:one-time-menu",
  },
  {
    title: "One-time pickup order full E2E flow",
    command: "npm",
    args: ["run", "test:one-time-full-flow"],
    requiredScript: "test:one-time-full-flow",
  },
  {
    title: "Mobile API response contracts",
    command: "npm",
    args: ["run", "test:mobile-contracts"],
    requiredScript: "test:mobile-contracts",
  },
  {
    title: "Payment init logging and redirect safety",
    command: "npm",
    args: ["run", "test:payment-init-logging"],
    requiredScript: "test:payment-init-logging",
  },
  {
    title: "Menu identity mapping safety",
    command: "npm",
    args: ["run", "test:menu-identity"],
    requiredScript: "test:menu-identity",
  },
  {
    title: "Menu identity mapping dashboard visibility",
    command: "npm",
    args: ["run", "test:dashboard-menu-identity"],
    requiredScript: "test:dashboard-menu-identity",
  },
  {
    title: "Menu identity mapping suggestion logic",
    command: "npm",
    args: ["run", "test:menu-identity-suggestions"],
    requiredScript: "test:menu-identity-suggestions",
  },
  {
    title: "Menu identity mapping approval workflow",
    command: "npm",
    args: ["run", "test:menu-identity-suggestions-approval"],
    requiredScript: "test:menu-identity-suggestions-approval",
  },
  {
    title: "Moyasar retry safety",
    command: "node",
    args: ["tests/moyasar_retry.test.js"],
    env: { NODE_ENV: "test" },
    requiredFile: "tests/moyasar_retry.test.js",
  },
  {
    title: "Webhook security checks (optional local/test MongoDB)",
    command: "node",
    args: ["tests/webhookSecurity.test.js"],
    env: { NODE_ENV: "test" },
    requiredFile: "tests/webhookSecurity.test.js",
    optional: true,
    enabled: RUN_DB_CHECKS,
    skipReason: "Set VALIDATE_BACKEND_WITH_LOCAL_DB=true with a non-production MONGO_URI to run this check.",
  },
  {
    title: "Order payment idempotency checks (optional local/test MongoDB)",
    command: "node",
    args: ["tests/orderPaymentIdempotency.test.js"],
    env: { NODE_ENV: "test" },
    requiredFile: "tests/orderPaymentIdempotency.test.js",
    optional: true,
    enabled: RUN_DB_CHECKS,
    skipReason: "Set VALIDATE_BACKEND_WITH_LOCAL_DB=true with a non-production MONGO_URI to run this check.",
  },
  {
    title: "Catalog health read-only database check (optional test/staging MongoDB)",
    command: "node",
    args: ["scripts/checkCatalogHealth.js"],
    requiredFile: "scripts/checkCatalogHealth.js",
    optional: true,
    enabled: RUN_CATALOG_DB_CHECK,
    skipReason: "Set VALIDATE_BACKEND_CATALOG_DB=true with a non-production MONGO_URI to run this read-only check.",
  },
  {
    title: "Postman/Newman API contract collection (optional)",
    command: "npx",
    args: ["newman", "run", "basicdiet145_postman_collection_v2.json"],
    requiredFile: "basicdiet145_postman_collection_v2.json",
    optional: true,
    enabled: RUN_NEWMAN,
    skipReason: "Set VALIDATE_BACKEND_NEWMAN=true and provide any needed Newman environment externally.",
  },
];

function printHeader(title) {
  console.log("\n============================================================");
  console.log(title);
  console.log("============================================================");
}

function hasNpmScript(name) {
  return Boolean(npmScripts[name]);
}

function hasFile(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function shouldSkip(step) {
  if (step.requiredScript && !hasNpmScript(step.requiredScript)) {
    return `npm script "${step.requiredScript}" does not exist.`;
  }
  if (step.requiredFile && !hasFile(step.requiredFile)) {
    return `required file "${step.requiredFile}" does not exist.`;
  }
  if (step.optional && !step.enabled) {
    return step.skipReason || "optional check is disabled.";
  }
  return null;
}

function isUnsafeProductionDbStep(step) {
  if (!step.optional) return false;
  if (!step.enabled) return false;
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || "";
  const lowered = mongoUri.toLowerCase();
  return lowered.includes("prod") || lowered.includes("production");
}

function runStep(step) {
  printHeader(step.title);

  const skipReason = shouldSkip(step);
  if (skipReason) {
    console.warn(`WARNING: skipped - ${skipReason}`);
    return;
  }

  if (isUnsafeProductionDbStep(step)) {
    console.warn("WARNING: skipped - MONGO_URI appears to reference production. Use a test or staging database only.");
    return;
  }

  const env = { ...process.env, ...(step.env || {}) };
  const displayCommand = [step.command, ...step.args].join(" ");
  console.log(`Running: ${displayCommand}`);

  const result = spawnSync(step.command, step.args, {
    cwd: rootDir,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  const exitCode = typeof result.status === "number" ? result.status : 1;
  console.log(`Exit code: ${exitCode}`);

  if (result.error) {
    console.error(`Failed to start command: ${result.error.message}`);
    process.exit(exitCode);
  }

  if (exitCode !== 0) {
    console.error(`Backend validation failed at step: ${step.title}`);
    process.exit(exitCode);
  }
}

console.log("BasicDiet Backend Validation");
console.log("Default mode avoids production DB, production seeds, and live payment provider calls.");
console.log("Optional DB checks require explicit opt-in environment flags.");

for (const step of steps) {
  runStep(step);
}

console.log("\nAll enabled backend validation checks passed.");
