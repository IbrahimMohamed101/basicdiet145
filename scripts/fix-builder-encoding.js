#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");

const BuilderCategory = require("../src/models/BuilderCategory");
const BuilderProtein = require("../src/models/BuilderProtein");
const BuilderCarb = require("../src/models/BuilderCarb");
const SaladIngredient = require("../src/models/SaladIngredient");

const CORRECTION_MAP = {
  "هلينو": "هالينو",
  "هلينو": "هالينو",
  "هلين": "هالين",
  "": "",
};

function fixString(str) {
  if (typeof str !== "string") return str;
  let fixed = str;
  for (const [corrupted, correct] of Object.entries(CORRECTION_MAP)) {
    fixed = fixed.replace(new RegExp(corrupted, "g"), correct);
  }
  fixed = fixed.replace(/\ufffd/g, "");
  return fixed;
}

function fixBilingualName(name) {
  if (!name || typeof name !== "object") return name;
  const fixed = {};
  if (name.ar) fixed.ar = fixString(name.ar);
  if (name.en) fixed.en = fixString(name.en);
  return fixed;
}

async function fixCollection(Model, collectionName) {
  const docs = await Model.find({}).lean();
  let fixed = 0;

  for (const doc of docs) {
    const updates = {};
    let needsUpdate = false;

    if (doc.name && typeof doc.name === "object") {
      const fixedName = fixBilingualName(doc.name);
      if (fixedName.ar !== doc.name.ar || fixedName.en !== doc.name.en) {
        updates.name = fixedName;
        needsUpdate = true;
      }
    }

    if (doc.description && typeof doc.description === "object") {
      const fixedDesc = fixBilingualName(doc.description);
      if (fixedDesc.ar !== doc.description.ar || fixedDesc.en !== doc.description.en) {
        updates.description = fixedDesc;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      await Model.findByIdAndUpdate(doc._id, updates);
      fixed++;
      console.log(`Fixed ${collectionName} ${doc._id}`);
    }
  }

  console.log(`Fixed ${fixed} documents in ${collectionName}`);
  return fixed;
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("Missing MongoDB connection string");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(uri);

  console.log("\n=== Fixing Builder Data Encoding ===\n");

  await fixCollection(BuilderCategory, "BuilderCategory");
  await fixCollection(BuilderProtein, "BuilderProtein");
  await fixCollection(BuilderCarb, "BuilderCarb");
  await fixCollection(SaladIngredient, "SaladIngredient");

  console.log("\n=== Done ===");
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});