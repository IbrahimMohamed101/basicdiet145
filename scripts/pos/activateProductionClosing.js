"use strict";
// D-097: operator-only CLI. No date => LEGACY, no write, regardless of approval.
// Never run from deploy/start; execute only under separate maintenance authorization.
const mongoose = require("mongoose");
const DashboardUser = require("../../src/models/DashboardUser");
const { scheduleStartDate } = require("../../src/services/pos/posClosingSetting");

async function main() {
  const startDate = process.env.POS_CLOSING_START_DATE;
  if (!startDate) {
    process.stdout.write("POS_CLOSING_LEGACY_NO_DATE\n");
    return;
  }
  if (process.env.POS_CLOSING_ACTIVATION_APPROVED !== "true" ||
      process.env.POS_PRODUCTION_ENABLED !== "true" ||
      process.env.NODE_ENV !== "production") throw Error("POS_CLOSING_NOT_APPROVED");
  const id = process.env.POS_CLOSING_ADMIN_ID;
  if (!mongoose.isValidObjectId(id)) throw Error("POS_CLOSING_ADMIN_REQUIRED");
  const raw = process.env.MONGO_URI;
  let target;
  try { target = new URL(raw); } catch { throw Error("POS_CLOSING_UNSAFE_TARGET"); }
  if (target.protocol !== "mongodb:" ||
      target.hostname !== "mongodb.railway.internal" ||
      target.pathname !== "/test" || target.searchParams.get("replicaSet") !== "rs0") {
    throw Error("POS_CLOSING_UNSAFE_TARGET");
  }
  try {
    await mongoose.connect(raw, { serverSelectionTimeoutMS: 10000 });
    const user = await DashboardUser.findById(id).select("_id role isActive").lean();
    if (!user?.isActive || !["admin", "superadmin"].includes(user.role)) {
      throw Error("POS_CLOSING_ADMIN_REQUIRED");
    }
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (hello.setName !== "rs0" || hello.isWritablePrimary !== true) {
      throw Error("POS_CLOSING_RS0_REQUIRED");
    }
    await scheduleStartDate({
      startDate, effectiveFrom: startDate, actorId: String(user._id), actorRole: user.role,
    }, { productionApproved: true });
    process.stdout.write("POS_CLOSING_ACTIVATION_SCHEDULED\n");
  } finally {
    await mongoose.disconnect();
  }
}
if (require.main === module) main().catch((error) => {
  const safe = /^POS_CLOSING_[A-Z_]+$/.test(error.message)
    ? error.message : "POS_CLOSING_ACTIVATION_FAILED";
  process.stderr.write(safe + "\n");
  process.exitCode = 1;
});
