#!/usr/bin/env node

// Compatibility wrapper. Active bootstrap code lives in scripts/bootstrap/.
const subscriptionPlans = require("./bootstrap/seed-subscription-plans");

if (require.main === module) {
  subscriptionPlans.main().catch(async (err) => {
    console.error(err);
    const mongoose = require("mongoose");
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    process.exit(1);
  });
}

module.exports = subscriptionPlans;
