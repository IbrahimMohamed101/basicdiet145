#!/usr/bin/env node
"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const { validateIdentityLinks } = require("../src/services/menuIdentityMappingService");

// Load all models to ensure mongoose.model(sourceModel) works
require("../src/models/SharedMenuIdentity");
require("../src/models/MenuIdentityLink");
require("../src/models/MenuProduct");
require("../src/models/MenuOption");
require("../src/models/MenuCategory");
require("../src/models/BuilderProtein");
require("../src/models/BuilderCarb");
require("../src/models/SaladIngredient");
require("../src/models/Addon");
require("../src/models/Sandwich");

async function main() {
  if (process.env.VALIDATE_MENU_IDENTITY_LINKS !== "true") {
    console.log("Skipping Menu Identity Validation (VALIDATE_MENU_IDENTITY_LINKS != true)");
    return;
  }

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("Error: MONGO_URI is not defined");
    process.exit(1);
  }

  const isProd = mongoUri.toLowerCase().includes("prod") || mongoUri.toLowerCase().includes("production");
  if (isProd && process.env.READ_ONLY_PRODUCTION_AUDIT !== "true") {
    console.error("Error: Refusing to run on production without READ_ONLY_PRODUCTION_AUDIT=true");
    process.exit(1);
  }

  console.log(`Connecting to database for Read-Only Menu Identity Audit...`);
  await mongoose.connect(mongoUri);

  try {
    const result = await validateIdentityLinks({
      failOnWarnings: process.env.FAIL_ON_MENU_IDENTITY_WARNINGS === "true",
    });

    console.log("\n--- Menu Identity Mapping Audit Report ---");
    console.log(`Identities Count: ${result.identitiesCount}`);
    console.log(`Links Count:      ${result.linksCount}`);

    if (result.warnings.length > 0) {
      console.log("\nWarnings:");
      result.warnings.forEach((w) => console.warn(`[WARNING] ${w}`));
    }

    if (result.errors.length > 0) {
      console.log("\nErrors:");
      result.errors.forEach((e) => console.error(`[ERROR] ${e}`));
      console.log("\nValidation FAILED with errors.");
      process.exit(1);
    }

    if (!result.isValid) {
      console.log("\nValidation FAILED due to warnings (failOnWarnings=true).");
      process.exit(1);
    }

    console.log("\nValidation PASSED.");
  } catch (err) {
    console.error(`Fatal error during validation: ${err.message}`);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
