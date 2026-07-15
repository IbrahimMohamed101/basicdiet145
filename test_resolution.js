const mongoose = require('mongoose');
const { resolveCanonicalPremiumIdentity } = require('./src/utils/subscription/premiumIdentity');
const { resolveSubscriptionPremiumUpgradePricing } = require('./src/services/subscription/premiumUpgradeConfigService');

async function run() {
  await mongoose.connect('mongodb://localhost:27017/basicdiet145_test');
  
  try {
    const resolved = await resolveCanonicalPremiumIdentity({
      premiumKey: 'shrimp'
    });
    console.log("Resolved:", resolved);
    
    const upgrade = await resolveSubscriptionPremiumUpgradePricing('shrimp', {
      fallbackPriceHalala: resolved.unitExtraFeeHalala
    });
    console.log("Upgrade:", upgrade);
  } catch (err) {
    console.error("Error:", err);
  }
  
  mongoose.disconnect();
}
run().catch(console.error);
