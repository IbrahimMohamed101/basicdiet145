#!/usr/bin/env node

require("dotenv").config();
const mongoose = require("mongoose");

const { connectDb } = require("../src/db");
const User = require("../src/models/User");
const Plan = require("../src/models/Plan");
const Meal = require("../src/models/Meal");
const BuilderCarb = require("../src/models/BuilderCarb");
const BuilderProtein = require("../src/models/BuilderProtein");
const Zone = require("../src/models/Zone");
const Setting = require("../src/models/Setting");

async function main() {
  await connectDb();

  const [plans, meals, carbs, proteins, zones, deliveryWindows] = await Promise.all([
    Plan.find({ isActive: true }).sort({ sortOrder: 1 }).lean(),
    Meal.find({ isActive: true }).lean(),
    BuilderCarb.find({ isActive: true }).lean(),
    BuilderProtein.find({ isActive: true }).sort({ sortOrder: 1 }).lean(),
    Zone.find({ isActive: true }).lean(),
    Setting.findOne({ key: "delivery_windows" }).lean()
  ]);

  const selectedPlan = plans.find(p => p.daysCount === 7);
  const selectedCarb = carbs.find(c => (c.name?.en || "").toLowerCase().includes("large salad")) || carbs[0];
  const selectedSandwich = meals.find(m => (m.name?.en || m.name?.ar || "").toLowerCase().includes("sandwich")) || meals[0];
  const selectedZone = zones[0];
  
  const sampleUser = await User.findOne({ role: "client" }).lean();
  const windows = deliveryWindows?.value || ["09:00-12:00", "13:00-16:00", "18:00-21:00"];
  const sampleAddress = {
    line1: "Test Residence 1",
    line2: "Building 101",
    city: "Riyadh",
    district: selectedZone?.name?.en || "Al Malqa",
    street: "King Fahd Road",
    building: "101",
    apartment: "1A",
    notes: "Test delivery"
  };

  const premium = proteins.find(p => p.isPremium) || proteins[0];
  const window = windows[0] || "09:00-12:00";

  console.log("\n╔═══════════════════════════════════════════════════════════════╗");
  console.log("║     POSTMAN TEST DATA - SUBSCRIPTION CHECKOUT               ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");

  console.log("=== REQUIRED IDs ===");
  console.log(`planId:        ${selectedPlan?._id}`);
  console.log(`carbId:       ${selectedCarb?._id}`);
  console.log(`sandwichId:    ${selectedSandwich?._id}`);
  console.log(`proteinId:    ${premium?._id}`);
  console.log(`userId:       ${sampleUser?._id}`);
  console.log(`zoneId:       ${selectedZone?._id}`);

  console.log("\n=== SAMPLE DELIVERY ADDRESS ===");
  console.log(JSON.stringify(sampleAddress, null, 2));

  console.log("\n=== COMPLETE CHECKOUT PAYLOAD ===");
  console.log(JSON.stringify({
    planId: selectedPlan?._id?.toString(),
    grams: 150,
    mealsPerDay: 2,
    startDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    deliveryMode: "delivery",
    deliveryAddress: sampleAddress,
    deliveryWindow: window,
    premiumItems: premium ? [{
      proteinId: premium._id.toString(),
      qty: 1
    }] : []
  }, null, 2));

  console.log("\n=== CURL COMMANDS ===\n");
  
  const checkoutPayload = {
    planId: selectedPlan?._id?.toString(),
    grams: 150,
    mealsPerDay: 2,
    startDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    deliveryMode: "delivery",
    deliveryAddress: sampleAddress,
    deliveryWindow: window,
    premiumItems: premium ? [{ proteinId: premium._id?.toString(), qty: 1 }] : []
  };

  console.log("# Get Menu (without auth):");
  console.log(`curl -s "http://localhost:3000/api/subscriptions/menu"`);
  
  console.log("\n# Login (Get JWT token):");
  console.log(`curl -s -X POST "http://localhost:3000/api/auth/otp/verify" \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{"phoneE164":"${sampleUser?.phone}","otp":"123456"}'`);

  console.log("\n# Checkout (with JWT token):");
  console.log(`curl -s -X POST "http://localhost:3000/api/subscriptions/checkout" \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -H "Authorization: Bearer <JWT_TOKEN>" \\`);
  console.log(`  -d '${JSON.stringify(checkoutPayload)}'`);

  console.log("\n=== JSON OUTPUT (Copy this) ===\n");
  console.log(JSON.stringify({
    planId: selectedPlan?._id?.toString() || "",
    addressId: selectedZone?._id?.toString() || "",
    carbId: selectedCarb?._id?.toString() || "",
    sandwichId: selectedSandwich?._id?.toString() || "",
    proteinId: premium?._id?.toString() || "",
    userId: sampleUser?._id?.toString() || ""
  }, null, 2));

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});