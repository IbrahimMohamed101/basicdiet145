#!/usr/bin/env node

// Compatibility wrapper. Active bootstrap code lives in scripts/bootstrap/.
const bootstrapCatalog = require("./bootstrap/seed-catalog");

if (require.main === module) {
  bootstrapCatalog.main().catch(async (err) => {
    console.error(err);
    const mongoose = require("mongoose");
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    process.exit(1);
  });
}

module.exports = bootstrapCatalog;
