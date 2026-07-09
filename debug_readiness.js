const mongoose = require('mongoose');
const { getReadiness } = require('./src/services/subscription/premiumUpgradeConfigService');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/basicdiet145');
  const readiness = await getReadiness();
  console.log(JSON.stringify(readiness, null, 2));
  process.exit(0);
}
run();
