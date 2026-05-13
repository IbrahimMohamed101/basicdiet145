const AppUser = require("../models/AppUser");
const User = require("../models/User");
const Subscription = require("../models/Subscription");
const Order = require("../models/Order");
const { resolveReadLabel } = require("../utils/subscription/subscriptionReadLocalization");

async function getClientProfile(req, res) {
  try {
    const userId = req.userId;

    // 1. Basic User Data
    const [appUser, coreUser] = await Promise.all([
      AppUser.findOne({ coreUserId: userId }).lean(),
      User.findById(userId).lean(),
    ]);

    if (!coreUser) {
      return res.status(401).json({ status: false, message: "User not found" });
    }

    const userData = {
      id: String(coreUser._id),
      displayName: appUser?.fullName || coreUser.name || "عميل",
      email: coreUser.email || appUser?.email || null,
      phone: coreUser.phone || null,
      avatarUrl: coreUser.avatarUrl || null, // Assuming it might exist or stay null
    };

    // 2. Subscription Summary
    const activeSub = await Subscription.findOne({
      userId: userId,
      status: { $in: ["active", "frozen"] },
    })
      .sort({ createdAt: -1 })
      .lean();

    let subscriptionSummary = {
      hasActiveSubscription: false,
      planName: null,
      status: "none",
      statusLabelAr: null,
      remainingMeals: 0,
      totalMeals: 0,
    };

    if (activeSub) {
      // Get plan name from contract snapshot or plan ID
      let planNameAr = null;
      if (activeSub.contractSnapshot?.plan?.planName) {
        planNameAr = activeSub.contractSnapshot.plan.planName.ar || activeSub.contractSnapshot.plan.planName;
      }

      subscriptionSummary = {
        hasActiveSubscription: true,
        planName: planNameAr,
        status: activeSub.status,
        statusLabelAr: resolveReadLabel("subscriptionStatuses", activeSub.status, "ar"),
        remainingMeals: activeSub.remainingMeals || 0,
        totalMeals: activeSub.totalMeals || 0,
      };
    }

    // 3. Profile Menu Items
    const [ordersCount, subscriptionAddresses, orderAddresses] = await Promise.all([
      Order.countDocuments({ userId: userId, status: { $ne: "cancelled" } }),
      Subscription.find({ userId: userId }).select("deliveryAddress").lean(),
      Order.find({ userId: userId }).select("deliveryAddress").lean(),
    ]);

    // Unique addresses logic
    const uniqueAddresses = new Set();
    
    subscriptionAddresses.forEach(sub => {
      if (sub.deliveryAddress && sub.deliveryAddress.line1) {
        uniqueAddresses.add(`${sub.deliveryAddress.line1}-${sub.deliveryAddress.city}`);
      }
    });
    
    orderAddresses.forEach(order => {
      if (order.deliveryAddress && order.deliveryAddress.line1) {
        uniqueAddresses.add(`${order.deliveryAddress.line1}-${order.deliveryAddress.city}`);
      }
    });

    const addressesCount = uniqueAddresses.size;

    const profileMenu = {
      orders: {
        labelAr: "طلباتي",
        count: ordersCount,
      },
      addresses: {
        labelAr: "عناويني",
        count: addressesCount,
      },
      language: {
        labelAr: "اللغة",
        current: "العربية",
        code: "ar",
      },
      support: {
        labelAr: "الدعم",
        phone: null, // Placeholder
        whatsapp: null, // Placeholder
        email: null, // Placeholder
      },
      legal: {
        labelAr: "الشروط والخصوصية",
        termsUrl: `${process.env.BASE_URL || ""}/terms`,
        privacyUrl: `${process.env.BASE_URL || ""}/privacy`,
      },
    };

    return res.status(200).json({
      status: true,
      data: {
        user: userData,
        subscriptionSummary,
        profileMenu,
      },
    });
  } catch (error) {
    console.error("getClientProfile error:", error);
    return res.status(500).json({ status: false, message: "Internal server error" });
  }
}

module.exports = {
  getClientProfile,
};
