#!/usr/bin/env node

"use strict";

require("dotenv").config();

const mongoose = require("mongoose");
const { resolveMongoUri } = require("../../src/utils/mongoUriResolver");
const {
  seedBasicSaladBuilder,
} = require("./seed-basic-salad-builder");

async function repairBasicSaladPublication() {
  return seedBasicSaladBuilder();
}

async function main() {
  await mongoose.connect(resolveMongoUri(), { serverSelectionTimeoutMS: 10000 });
  try {
    const result = await repairBasicSaladPublication();
    console.log("[repair-basic-salad-publication] completed", JSON.stringify(result, null, 2));
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`[repair-basic-salad-publication:error] ${error.code ? `${error.code}: ` : ""}${error.message}`);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = {
  repairBasicSaladPublication,
};
