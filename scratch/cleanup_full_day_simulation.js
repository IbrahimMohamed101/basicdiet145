require("dotenv").config();
const mongoose = require("mongoose");
const { connectDb } = require("../src/db");

async function run() {
  try {
    await connectDb();
    
    const db = mongoose.connection.db;
    const collectionsToClean = [
      "users",
      "subscriptions",
      "subscriptiondays",
      "subscriptionpickuprequests",
      "checkoutdrafts",
      "orders"
    ];

    console.log("Starting cleanup of test data (isTestData: true)...");

    for (const collName of collectionsToClean) {
      try {
        const result = await db.collection(collName).deleteMany({ 
          $or: [
            { isTestData: true },
            { email: { $regex: /^test\.customer/ } }, // Fallback for users
            { phone: { $regex: /^\+96650000000/ } }, // Fallback for users
            { "deliveryAddress.notes": "TEST_DATA" } // Fallback for subscriptions
          ]
        });
        console.log(`- Deleted ${result.deletedCount} documents from ${collName}`);
      } catch (err) {
        console.warn(`- Could not clean ${collName}: ${err.message}`);
      }
    }

    console.log("Cleanup completed successfully.");
    process.exit(0);

  } catch (err) {
    console.error("Error during cleanup:", err);
    process.exit(1);
  }
}

run();
