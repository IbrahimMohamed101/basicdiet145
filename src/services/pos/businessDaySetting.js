"use strict";

// POS/closing setting is read at operation time, never from the browser.
// All money operations use the same Asia/Riyadh cutoff, default 00:00.
const Setting = require("../../models/Setting");
const { parseBusinessDayCutoff } = require("./businessDate");
async function getBusinessDayCutoff() {
  const doc = await Setting.findOne({ key: "businessDayCutoff" }).select("value").lean();
  return parseBusinessDayCutoff(doc ? doc.value : "00:00");
}
module.exports = { getBusinessDayCutoff };
