require("dotenv").config();
const mongoose = require("mongoose");
const { connectDb } = require("../src/db");

async function run() {
  try {
    await connectDb();

    // Import models
    const User = require("../src/models/User");
    const Subscription = require("../src/models/Subscription");
    const SubscriptionDay = require("../src/models/SubscriptionDay");
    const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
    const MenuProduct = require("../src/models/MenuProduct");
    const MenuCategory = require("../src/models/MenuCategory");
    const Addon = require("../src/models/Addon");
    const BuilderProtein = require("../src/models/BuilderProtein");
    const Plan = require("../src/models/Plan");
    const CheckoutDraft = require("../src/models/CheckoutDraft");
    const Order = require("../src/models/Order");

    // Add isTestData to schemas so we can save it via Mongoose
    [User, Subscription, SubscriptionDay, SubscriptionPickupRequest, CheckoutDraft, Order].forEach((M) => {
      if (M && M.schema) {
        M.schema.add({ isTestData: Boolean });
      }
    });

    console.log("Fetching active catalog from database...");

    const products = await MenuProduct.find({ isActive: true });
    const categories = await MenuCategory.find({ isActive: true });
    const addons = await Addon.find({ isActive: true });
    const proteins = await BuilderProtein.find({ isActive: true });
    const plans = await Plan.find({ isActive: true, "name.en": { $not: /(test|dev|unpaid)/i } });

    if (!plans.length) {
      console.warn("No active sellable plans found. Skipping plan creation.");
      process.exit(1);
    }

    console.log(`Found ${categories.length} categories, ${products.length} products, ${addons.length} addons, ${proteins.length} proteins.`);

    const today = new Date();
    // YYYY-MM-DD KSA
    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(today);

    // Group products by category to ensure we use every category
    const productsByCategory = {};
    categories.forEach((cat) => {
      productsByCategory[cat._id.toString()] = products.filter((p) => p.categoryId && p.categoryId.toString() === cat._id.toString());
    });

    // Filter categories that actually have products
    const categoriesWithProducts = categories.filter(c => productsByCategory[c._id.toString()] && productsByCategory[c._id.toString()].length > 0);

    let categoryQueue = [...categoriesWithProducts];
    function getNextProduct() {
      if (categoryQueue.length === 0) {
        categoryQueue = [...categoriesWithProducts]; // reset
      }
      const catIndex = Math.floor(Math.random() * categoryQueue.length);
      const cat = categoryQueue[catIndex];
      categoryQueue.splice(catIndex, 1); 

      const catProducts = productsByCategory[cat._id.toString()];
      return catProducts[Math.floor(Math.random() * catProducts.length)];
    }

    // Identify addon plans vs simple addons
    const addonPlans = addons.filter((a) => a.isAddonPlan !== false && a.priceHalala > 0);
    const simpleAddons = addons.filter((a) => !addonPlans.includes(a));
    
    let addonQueue = [...simpleAddons];
    function getNextAddon() {
      if (addonQueue.length === 0) {
        addonQueue = [...simpleAddons];
      }
      const addonIndex = Math.floor(Math.random() * addonQueue.length);
      const addon = addonQueue[addonIndex];
      addonQueue.splice(addonIndex, 1);
      return addon;
    }

    const simulatedUsers = [
      { name: "أحمد محمد", email: "test.customer1@example.com", phone: "+966500000001", mode: "pickup", state: "draft" },
      { name: "فاطمة علي", email: "test.customer2@example.com", phone: "+966500000002", mode: "pickup", state: "pickup_requested" },
      { name: "عمر خالد", email: "test.customer3@example.com", phone: "+966500000003", mode: "pickup", state: "ready_for_pickup" },
      { name: "سارة عبدلله", email: "test.customer4@example.com", phone: "+966500000004", mode: "pickup", state: "fulfilled" },
      { name: "نورة سعود", email: "test.customer5@example.com", phone: "+966500000005", mode: "pickup", state: "no_show" },
      { name: "يوسف إبراهيم", email: "test.customer6@example.com", phone: "+966500000006", mode: "delivery", state: "out_for_delivery" },
      { name: "مريم حسن", email: "test.customer7@example.com", phone: "+966500000007", mode: "delivery", state: "fulfilled" },
      { name: "طارق زياد", email: "test.customer8@example.com", phone: "+966500000008", mode: "pickup", state: "canceled" },
      { name: "ليلى حمد", email: "test.customer9@example.com", phone: "+966500000009", mode: "delivery", state: "draft" },
      { name: "عبدالرحمن فهد", email: "test.customer10@example.com", phone: "+966500000010", mode: "pickup", state: "ready_for_pickup" },
      { name: "هند سعيد", email: "test.customer11@example.com", phone: "+966500000011", mode: "delivery", state: "fulfilled" },
      { name: "بدر عبدالله", email: "test.customer12@example.com", phone: "+966500000012", mode: "pickup", state: "no_show" },
    ];

    const selectionTypesToUse = ["standard_meal", "premium_meal", "premium_large_salad", "sandwich"];
    let selectionTypeIndex = 0;

    let totalUsers = 0;
    let totalSubs = 0;
    let totalDays = 0;

    const summary = [];
    const usedCategories = new Set();
    const usedAddons = new Set();

    for (const u of simulatedUsers) {
      // Create user
      const user = await User.create({
        name: u.name,
        email: u.email,
        phone: u.phone,
        phoneE164: u.phone,
        role: "client",
        isActive: true,
        isTestData: true,
      });
      totalUsers++;

      // Create Subscription
      const plan = plans[Math.floor(Math.random() * plans.length)];
      
      // Randomize addons (0 to 3)
      const numAddons = Math.floor(Math.random() * 4);
      const subAddons = [];
      const balanceAddons = [];
      const selectedAddonPlans = addonPlans.slice(0, numAddons);
      
      selectedAddonPlans.forEach(ap => {
        subAddons.push({
          addonId: ap._id,
          addonPlanId: ap._id,
          category: ap.category || "snack",
          maxPerDay: 1,
        });
        balanceAddons.push({
          addonId: ap._id,
          addonPlanId: ap._id,
          category: ap.category || "snack",
          remainingQty: plan.daysCount,
        });
      });

      const sub = await Subscription.create({
        userId: user._id,
        planId: plan._id,
        status: "active",
        startDate: new Date(today.getTime() - 86400000 * 2), // started 2 days ago
        endDate: new Date(today.getTime() + 86400000 * (plan.daysCount - 2)),
        totalMeals: plan.daysCount * (plan.gramsOptions?.[0]?.mealsOptions?.[0]?.mealsPerDay || 2),
        remainingMeals: (plan.daysCount - 2) * (plan.gramsOptions?.[0]?.mealsOptions?.[0]?.mealsPerDay || 2),
        deliveryMode: u.mode,
        addonSubscriptions: subAddons,
        addonBalance: balanceAddons,
        isTestData: true,
      });
      totalSubs++;

      // Determine day status mapping
      let dayStatus = "open";
      let plannerState = "confirmed";
      let pickupRequested = false;
      let pickupPreparedAt = null;
      let pickupVerifiedAt = null;
      let pickupNoShowAt = null;
      let canceledAt = null;
      let cancellationReason = null;

      if (u.state === "draft") {
        plannerState = "draft";
        dayStatus = "open";
      } else if (u.state === "pickup_requested") {
        dayStatus = "in_preparation";
        pickupRequested = true;
      } else if (u.state === "ready_for_pickup") {
        dayStatus = "ready_for_pickup";
        pickupRequested = true;
        pickupPreparedAt = new Date();
      } else if (u.state === "fulfilled") {
        dayStatus = "fulfilled";
        pickupRequested = true;
        pickupPreparedAt = new Date(today.getTime() - 3600000);
        pickupVerifiedAt = new Date();
      } else if (u.state === "no_show") {
        dayStatus = "no_show";
        pickupRequested = true;
        pickupPreparedAt = new Date(today.getTime() - 7200000);
        pickupNoShowAt = new Date();
      } else if (u.state === "out_for_delivery") {
        dayStatus = "out_for_delivery";
      } else if (u.state === "canceled") {
        dayStatus = "canceled_at_branch";
        canceledAt = new Date();
        cancellationReason = "Test cancellation reason";
      }

      // Generate meal slots
      const mealSlots = [];
      const numSlots = plan.gramsOptions?.[0]?.mealsOptions?.[0]?.mealsPerDay || 2;
      for (let i = 1; i <= numSlots; i++) {
        const product = getNextProduct();
        if (product && product.categoryId) {
          usedCategories.add(product.categoryId.toString());
        }

        const selType = selectionTypesToUse[selectionTypeIndex % selectionTypesToUse.length];
        selectionTypeIndex++;

        mealSlots.push({
          slotIndex: i,
          status: "complete",
          selectionType: selType,
          productId: product ? product._id : null,
          proteinId: proteins.length > 0 ? proteins[0]._id : null,
          isPremium: selType.startsWith("premium"),
        });
      }

      // Generate addon selections for today
      const addonSelections = [];
      const dailyAddonCount = Math.floor(Math.random() * 3) + 1; // 1 to 3
      for (let i = 0; i < dailyAddonCount; i++) {
        const addon = getNextAddon();
        if (addon) {
          usedAddons.add(addon._id.toString());
          addonSelections.push({
            addonId: addon._id,
            category: addon.category || "snack",
            source: subAddons.length > 0 ? "subscription" : "wallet",
            consumedAt: new Date(),
          });
        }
      }

      // Create SubscriptionDay
      const day = await SubscriptionDay.create({
        subscriptionId: sub._id,
        date: todayStr,
        status: dayStatus,
        plannerState: plannerState,
        mealSlots,
        addonSelections,
        pickupRequested,
        pickupRequestedAt: pickupRequested ? new Date(today.getTime() - 7200000) : null,
        pickupPreparedAt,
        pickupVerifiedAt,
        pickupNoShowAt,
        canceledAt,
        cancellationReason,
        isTestData: true,
      });
      totalDays++;

      summary.push({
        userName: u.name,
        userId: user._id,
        subId: sub._id,
        dayId: day._id,
        mode: u.mode,
        state: u.state,
      });
    }

    console.log("\n=================================");
    console.log("SEEDING SUMMARY (TEST DATA)");
    console.log("=================================");
    console.log(`Created ${totalUsers} Users`);
    console.log(`Created ${totalSubs} Subscriptions`);
    console.log(`Created ${totalDays} SubscriptionDays`);
    console.log("=================================");
    summary.forEach(s => {
      console.log(`- ${s.userName} (${s.mode} | ${s.state})`);
      console.log(`  UserID: ${s.userId}`);
      console.log(`  SubID : ${s.subId}`);
      console.log(`  DayID : ${s.dayId}`);
    });
    console.log("=================================");
    
    // Check Menu Coverage
    console.log("\nMENU COVERAGE VERIFICATION:");
    const unusedCategories = categoriesWithProducts.filter(c => !usedCategories.has(c._id.toString()));
    if (unusedCategories.length === 0) {
      console.log("✅ All active MenuCategories (that contain products) are represented in the simulated orders.");
    } else {
      console.log(`⚠️ Unused Categories: ${unusedCategories.map(c => c.name?.en || c.key).join(", ")}`);
    }

    const unusedAddons = simpleAddons.filter(a => !usedAddons.has(a._id.toString()));
    if (unusedAddons.length === 0) {
      console.log("✅ All active simple Addons are represented.");
    } else {
      console.log(`⚠️ ${unusedAddons.length} simple addons were not used: ${unusedAddons.map(a => a.name?.en || a._id).join(", ")}`);
    }

    console.log("\nSeeding completed successfully.");
    process.exit(0);

  } catch (err) {
    console.error("Error running seed script:", err);
    process.exit(1);
  }
}

run();
