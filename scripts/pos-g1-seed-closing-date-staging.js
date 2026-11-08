"use strict";
// Run manually ONLY after explicit Staging database authorization. Never invoked on boot.
// No customer records, PII, tokens, credentials or Production URI are read.
const mongoose = require("mongoose");
const { isPosStagingRuntime } = require("../src/utils/posStagingRuntime");
const { scheduleStartDate } = require("../src/services/pos/posClosingSetting");
async function main() {
  if (!isPosStagingRuntime()) throw new Error("POS_STAGING_ONLY");
  const actorId = process.env.POS_G1_APPROVING_ADMIN_ID;
  if (!mongoose.isValidObjectId(actorId)) throw new Error("Explicit approving Staging admin required");
  if (!process.env.POS_STAGING_MONGO_URL) throw new Error("No isolated Staging database configured");
  // Intended only for guarded isolated Staging; use dedicated private URI.
  await mongoose.connect(process.env.POS_STAGING_MONGO_URL);
  try {
    await scheduleStartDate({ startDate: "2026-11-08", effectiveFrom: "2026-11-08",
      actorId, actorRole: "admin" });
    process.stdout.write("POS closing policy staged; no customer data output.\n");
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
