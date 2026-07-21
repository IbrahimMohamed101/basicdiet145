"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const {
  safeAsId,
} = require("../src/services/installPickupCanonicalQueryGuard");

function run() {
  const objectId = new mongoose.Types.ObjectId();

  assert.doesNotThrow(() => safeAsId(objectId));
  assert.strictEqual(safeAsId(objectId), objectId.toHexString());
  assert.strictEqual(safeAsId({ _id: objectId }), objectId.toHexString());

  const selfReferential = {};
  selfReferential._id = selfReferential;
  assert.doesNotThrow(() => safeAsId(selfReferential));
  assert.strictEqual(safeAsId(selfReferential), "[object Object]");

  console.log("pickup canonical query ObjectId guard checks passed");
}

run();
