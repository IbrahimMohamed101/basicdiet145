const mongoose = require('mongoose');
const BuilderProtein = require('./src/models/BuilderProtein');
const { resolveSubscriptionPremiumUpgradePricing } = require('./src/services/subscription/premiumUpgradeConfigService');

async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/basicdiet145_test');
  const shrimp = await BuilderProtein.findOne({ premiumKey: 'shrimp', isPremium: true }).lean();
  console.log("Shrimp:", shrimp ? shrimp.extraFeeHalala : 'NOT FOUND');
  try {
    const pricing = await resolveSubscriptionPremiumUpgradePricing('shrimp', {
      fallbackPriceHalala: shrimp ? shrimp.extraFeeHalala : 0,
      builderProteinDoc: shrimp,
    });
    console.log("Pricing:", pricing);
  } catch (err) {
    console.log("Error:", err.message);
  }
  mongoose.disconnect();
}
run().catch(console.error);
