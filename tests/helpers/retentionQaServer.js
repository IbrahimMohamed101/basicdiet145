"use strict";
// Local synthetic QA only: never loads .env or connects to an external database.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "local-retention-qa-user-secret";
process.env.DASHBOARD_JWT_SECRET = "local-retention-qa-dashboard-secret";
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const bcrypt = require("bcryptjs");
const { createApp } = require("../../src/app");
const User = require("../../src/models/User");
const Staff = require("../../src/models/DashboardUser");
const Plan = require("../../src/models/Plan");
const Subscription = require("../../src/models/Subscription");
const { dateKey, addDays } = require("../../src/services/dashboard/customerRetentionReadService");
let memory, server;
async function main() {
  memory = await MongoMemoryServer.create({ instance: { dbName: "retention_browser_qa_test", args: ["--nounixsocket"] } });
  await mongoose.connect(memory.getUri("retention_browser_qa_test"));
  const passwordHash = await bcrypt.hash("SyntheticQa123!", 4);
  await Staff.insertMany(["superadmin", "admin", "restaurant", "kitchen", "courier", "cashier"].map((role) => ({
    email: role + "@retention.example.test", passwordHash, role, isActive: true,
  })));
  const plan = await Plan.create({ key: "retention-qa", name: { ar: "باقة اختبار صناعية", en: "Synthetic QA plan" }, daysCount: 26 });
  const today = dateKey(new Date());
  for (let i = 0; i < 24; i++) {
    const name = i === 0 ? "عميل اختبار التجديد" : "عميل صناعي " + i;
    const user = await User.create({ name, phone: "+966500009" + String(i).padStart(3, "0"),
      phoneE164: "+966500009" + String(i).padStart(3, "0"), role: "client", isActive: true });
    await Subscription.create({ userId: user._id, planId: plan._id, status: "active", deliveryMode: "pickup",
      startDate: addDays(today, -26) + "T00:00:00+03:00", endDate: addDays(today, i === 1 ? -20 : 20) + "T00:00:00+03:00",
      validityEndDate: addDays(today, i === 1 ? -20 : 20) + "T00:00:00+03:00",
      totalMeals: 26, remainingMeals: 10, reservedMeals: 2, totalPriceHalala: 10000,
    });
  }
  const app = createApp();
  app.get("/__retention_qa__/identity", (_req, res) => res.json({ mode: "synthetic_disposable_retention_qa", customers: 24 }));
  server = app.listen(3000, "127.0.0.1", () => console.log("RETENTION_QA_READY: loopback app + disposable synthetic MongoDB"));
}
async function close() { if (server) await new Promise((r) => server.close(r)); await mongoose.disconnect(); if (memory) await memory.stop(); }
process.on("SIGTERM", () => close().finally(() => process.exit()));
process.on("SIGINT", () => close().finally(() => process.exit()));
main().catch(async (error) => { console.error(error.name); await close(); process.exitCode = 1; });
