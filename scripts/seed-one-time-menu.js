#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");

const { resolveMongoUri } = require("../src/utils/mongoUriResolver");
const source = require("./bootstrap/fixtures/menu-workbook-source");
const { seedNewMenu } = require("./bootstrap/seed-new-menu");

async function seedOneTimeMenu(options = {}) {
  if (options.sync === true || options.force === true || process.argv.includes("--sync") || process.argv.includes("--force")) {
    throw new Error(
      "seed-one-time-menu is a compatibility wrapper for the uploaded workbook and never supports sync/force mode"
    );
  }
  return seedNewMenu({
    sync: false,
    replaceExisting: false,
    log: options.log || console,
  });
}

async function main() {
  await mongoose.connect(resolveMongoUri(), { serverSelectionTimeoutMS: 10000 });
  try {
    await seedOneTimeMenu({ log: console });
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`[seed-one-time-menu] ${error.message}`);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = {
  categoryRows: source.categories,
  productRows: source.products,
  seedOneTimeMenu,
};
