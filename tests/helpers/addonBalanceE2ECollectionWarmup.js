"use strict";

const mongoose = require("mongoose");

const originalConnect = mongoose.connect.bind(mongoose);
let warmed = false;

function ignoreNamespaceExists(err) {
  if (!err) return;
  if (err.code === 48 || err.codeName === "NamespaceExists") return;
  throw err;
}

mongoose.connect = async function connectAndWarmAddonLifecycleCollections(...args) {
  const result = await originalConnect(...args);
  if (warmed) return result;

  const Addon = require("../../src/models/Addon");
  const AddonPlanPrice = require("../../src/models/AddonPlanPrice");

  await Addon.createCollection().catch(ignoreNamespaceExists);
  await AddonPlanPrice.createCollection().catch(ignoreNamespaceExists);
  await Addon.syncIndexes();
  await AddonPlanPrice.syncIndexes();
  warmed = true;

  return result;
};
