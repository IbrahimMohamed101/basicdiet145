#!/usr/bin/env node

// Compatibility wrapper. Active bootstrap code lives in scripts/bootstrap/.
const defaultAccounts = require("./bootstrap/seed-default-accounts");

if (require.main === module) {
  defaultAccounts.main();
}

module.exports = defaultAccounts;
