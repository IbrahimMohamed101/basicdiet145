const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const sinon = require("sinon");
const fs = require("fs");

const { performDaySelectionValidation } = require("../src/services/subscription/subscriptionSelectionService");
const { resolveSubscriptionAddonBalanceWithAudit } = require("../src/services/subscription/subscriptionAddonBalanceService");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Addon = require("../src/models/Addon");
const Plan = require("../src/models/Plan");
const MenuProduct = require("../src/models/MenuProduct");

let mongoServer;

async function run() {
  const logs = [];
  const log = (msg) => {
    console.log(msg);
    logs.push(msg);
  };
  
  try {
    log("Starting MongoMemoryServer...");
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());

    const userId = new mongoose.Types.ObjectId();
    const clientId = new mongoose.Types.ObjectId();

    log("Creating Plan and Addon...");
    const plan = new Plan({
      name: { en: "Test Plan", ar: "Test Plan" },
      priceHalala: 10000 
    }); 
    await plan.save({ validateBeforeSave: false });
    
    const juiceProduct = new MenuProduct({
      name: { en: "Juice Product", ar: "Juice Product" },
      category: { key: "juices" },
      priceHalala: 1000,
      currency: "SAR" 
    }); 
    await juiceProduct.save({ validateBeforeSave: false });

    const juiceAddon = new Addon({
      name: { en: "Juice Addon", ar: "Juice Addon" },
      category: "juice",
      priceHalala: 0,
      pricingMode: "fixed",
      menuProductIds: [juiceProduct._id] 
    }); 
    await juiceAddon.save({ validateBeforeSave: false });

    log("Creating Subscription...");
    const sub = new Subscription({
      userId,
      clientId,
      planId: plan._id,
      status: "active",
      totalMeals: 30, selectedMealsPerDay: 1, mealsPerDay: 1,
      duration: 30,
      contractMode: "canonical",
      addonBalance: [{
        addonId: juiceAddon._id,
        category: "juice",
        includedTotalQty: 30,
        remainingQty: 25,
        consumedQty: 5
      }],
      addonSubscriptions: [{
        addonId: juiceAddon._id,
        category: "juice",
        maxPerDay: 2
      }]
    });
    await sub.save({ validateBeforeSave: false });
    
    const date = "2026-08-01";
    const day = new SubscriptionDay({
      subscriptionId: sub._id,
      date,
      status: "open",
    });
    await day.save({ validateBeforeSave: false });

    log("Mocking dependencies/methods if needed or using real...");

    const requestedOneTimeAddonIds = [
      juiceAddon._id.toString(),
      juiceAddon._id.toString(),
      juiceAddon._id.toString(),
      juiceAddon._id.toString(),
      juiceAddon._id.toString(),
    ];
    
    // We don't stub resolveChoiceProductById anymore because juiceAddon is saved and should resolve properly!
    
    sinon.stub(require("../src/utils/subscription/subscriptionDaySelectionSync"), "resolveMealsPerDay").returns(1);
    
    const result = await performDaySelectionValidation({
      userId: userId.toString(),
      subscriptionId: sub._id.toString(),
      date,
      mealSlots: [],
      contractVersion: "canonical",
      requestedOneTimeAddonIds
    });

    log("=== RESULT ===");
    log(JSON.stringify(result.addonSelections, null, 2));
    log("=== ADDON SUMMARY ===");
    log(JSON.stringify(result.addonSummary, null, 2));
    
    const { buildClientAddonBalance } = require("../src/services/subscription/subscriptionAddonBalanceService");
    log("=== buildClientAddonBalance output ===");
    const subAgain = await Subscription.findById(sub._id);
    await resolveSubscriptionAddonBalanceWithAudit(subAgain);
    const balanceObj = buildClientAddonBalance(subAgain, null);
    log(JSON.stringify(balanceObj, null, 2));
    
    fs.writeFileSync("repro_output.txt", logs.join("\n"));
  } catch (err) {
    log("ERROR: " + err.message);
    log(err.stack);
    fs.writeFileSync("repro_output.txt", logs.join("\n"));
  } finally {
    if (mongoServer) await mongoServer.stop();
    await mongoose.disconnect();
  }
}
run();
