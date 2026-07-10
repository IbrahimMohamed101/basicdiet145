require("dotenv").config();
const mongoose = require("mongoose");
const { performDaySelectionValidation } = require("../src/services/subscription/subscriptionSelectionService");
const Subscription = require("../src/models/Subscription");
const Addon = require("../src/models/Addon");

async function verifyRealCustomer() {
  await mongoose.connect(process.env.MONGO_URI_TEST);
  console.log("Connected to Real Database.");

  // Find a real, active subscription that has an existing addon balance
  const subscription = await Subscription.findOne({
    status: "active",
    "addonBalance.remainingQty": { $gt: 0 }
  });

  if (!subscription) {
    console.log("No active subscription with a positive addon balance found in the database.");
    process.exit(1);
  }

  // Find which category has balance
  const activeBucket = subscription.addonBalance.find(b => b.remainingQty > 0);
  const category = activeBucket.category;
  const remaining = activeBucket.remainingQty;

  console.log(`\nFound Real Subscription: ${subscription._id}`);
  console.log(`Has existing balance for category: '${category}' (Remaining: ${remaining})`);

  // Find a real active addon product for this category
  const realAddon = await Addon.findOne({ category, isActive: true, kind: "item" });
  if (!realAddon) {
    console.log(`No active addon found for category ${category}.`);
    process.exit(1);
  }

  console.log(`Using real Addon ID: ${realAddon._id} (Price: ${realAddon.priceHalala} Halala)`);

  const targetDate = "2026-08-15"; // Future date to avoid locking
  
  // Scenario: Request exactly the remaining amount + 1 to force overage
  const requestCount = remaining + 1;
  const requestedIds = Array(requestCount).fill(realAddon._id.toString());

  console.log(`\n===========================================`);
  console.log(`SCENARIO: Request ${requestCount} ${category} (Remaining: ${remaining})`);
  console.log(`===========================================`);

  try {
    const result = await performDaySelectionValidation({
      userId: subscription.userId.toString(),
      subscriptionId: subscription._id.toString(),
      date: targetDate,
      mealSlots: [],
      contractVersion: "canonical",
      requestedOneTimeAddonIds: requestedIds
    });
    
    console.log("\n[TEST COMPLETED] Final Result Object:");
    console.log(JSON.stringify({
      expectedInclusive: remaining,
      actualInclusive: result.addonSummary.inclusiveCount,
      expectedPending: 1,
      actualPending: result.addonSummary.pendingPaymentCount,
      amountDue: result.addonSummary.totalExtraHalala
    }, null, 2));

  } catch (err) {
    console.error("Error during validation:", err.message);
  }

  await mongoose.disconnect();
}

verifyRealCustomer().catch(console.error);
