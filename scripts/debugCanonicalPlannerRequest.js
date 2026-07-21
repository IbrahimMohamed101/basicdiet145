/**
 * Command-line utility to debug canonical meal planner requests.
 * Usage: node scripts/debugCanonicalPlannerRequest.js path/to/request.json [subscriptionId]
 */

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");

const { validateCanonicalMealSlots, formatSlotDiagnosticReport } = require("../src/services/subscription/canonicalMealSlotPlannerService");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const { resolveMealSlotPlanningLimits, buildPlanningDraftSubscriptionView } = require("../src/services/subscription/subscriptionSelectionService");

async function main() {
  const requestPath = process.argv[2];
  if (!requestPath) {
    console.error("Error: Please provide path to request.json");
    console.error("Usage: node scripts/debugCanonicalPlannerRequest.js <path/to/request.json> [subscriptionId]");
    process.exit(1);
  }

  const absolutePath = path.resolve(requestPath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`Error: File not found at ${absolutePath}`);
    process.exit(1);
  }

  let requestData;
  try {
    requestData = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (err) {
    console.error(`Error parsing JSON from ${absolutePath}:`, err.message);
    process.exit(1);
  }

  const mealSlots = requestData.mealSlots || requestData;
  if (!Array.isArray(mealSlots)) {
    console.error("Error: request.json must contain a mealSlots array at the top level or inside a mealSlots property");
    process.exit(1);
  }

  // Connect to database
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL || process.env.MONGO_URI_TEST;
  if (!mongoUri) {
    console.error("Error: MONGO_URI, MONGODB_URI, MONGO_URL, or MONGO_URI_TEST is required");
    process.exit(1);
  }
  console.log("Connecting to database...");
  await mongoose.connect(mongoUri);

  try {
    // Resolve subscription
    let subscriptionId = process.argv[3] || requestData.subscriptionId;
    let subscription;
    if (subscriptionId) {
      subscription = await Subscription.findById(subscriptionId).lean();
    }
    if (!subscription) {
      // Find any active or existing subscription
      subscription = await Subscription.findOne({ status: "active" }).lean() || await Subscription.findOne().lean();
    }

    if (!subscription) {
      console.error("Error: No subscription found in database to validate against.");
      process.exit(1);
    }

    console.log(`Using Subscription: ID=${subscription._id}, status=${subscription.status}, planId=${subscription.planId}`);

    const date = requestData.date || new Date().toISOString().split("T")[0];
    const day = await SubscriptionDay.findOne({ subscriptionId: subscription._id, date }).lean();

    const planningLimits = await resolveMealSlotPlanningLimits(subscription);
    const mealsPerDayLimit = planningLimits.requiredSlotCount;
    const planningDraftSubscription = buildPlanningDraftSubscriptionView(subscription, day);

    console.log("Running validateCanonicalMealSlots...");
    const result = await validateCanonicalMealSlots({
      mealSlots,
      mealsPerDayLimit,
      maxSlotCount: planningLimits.maxSlotCount,
      subscription: planningDraftSubscription,
    });

    const debug = result.debug || { slots: [] };

    // Print per-slot report
    for (const slot of debug.slots) {
      console.log(formatSlotDiagnosticReport(slot));
    }

    console.log(`\n=================================================`);
    console.log(`FINAL RESULT`);
    console.log(`=================================================`);
    console.log(`VALID: ${result.valid}`);
    if (!result.valid) {
      console.log(`ERROR CODE: ${result.errorCode}`);
      console.log(`ERROR MESSAGE: ${result.errorMessage}`);
      console.log(`SLOT ERRORS:`, JSON.stringify(result.slotErrors, null, 2));
    } else {
      console.log(`SUCCESS! Planner is valid.`);
    }

  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from database.");
  }
}

main().catch((err) => {
  console.error("Fatal Error:", err);
  mongoose.disconnect();
});
