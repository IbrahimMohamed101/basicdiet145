const { Router } = require("express");

const authRoutes = require("./auth");
const dashboardAuthRoutes = require("./dashboardAuth");
const appAuthRoutes = require("./appAuth");
const planRoutes = require("./plans");
const popularPackageRoutes = require("./popularPackages");
const subscriptionRoutes = require("./subscriptions");
const orderRoutes = require("./orders");
const saladIngredientRoutes = require("./saladIngredients");
const mealIngredientRoutes = require("./mealIngredients");
const customSaladRoutes = require("./customSalads");
const customMealRoutes = require("./customMeals");
const mealRoutes = require("./meals");
const premiumMealRoutes = require("./premiumMeals");
const addonRoutes = require("./addons");
const adminRoutes = require("./admin");
const courierRoutes = require("./courier");
const kitchenRoutes = require("./kitchen");
const { getSettings } = require("../controllers/settingsController");
const asyncHandler = require("../middleware/asyncHandler");

const webhookRoutes = require("./webhooks");

const router = Router();

router.use("/webhooks", webhookRoutes);
router.use("/auth", authRoutes);
router.use("/dashboard/auth", dashboardAuthRoutes);
router.use("/app", appAuthRoutes);
router.use("/plans", planRoutes);
router.use("/popular_packages", popularPackageRoutes);
router.use("/subscriptions", subscriptionRoutes);
router.use("/orders", orderRoutes);
router.use("/salad-ingredients", saladIngredientRoutes);
router.use("/meal-ingredients", mealIngredientRoutes);
router.use("/custom-salads", customSaladRoutes);
router.use("/custom-meals", customMealRoutes);
router.use("/meals", mealRoutes);
router.use("/premium-meals", premiumMealRoutes);
router.use("/addons", addonRoutes);
router.use("/dashboard", adminRoutes);
router.use("/admin", adminRoutes);
router.use("/courier", courierRoutes);
router.use("/kitchen", kitchenRoutes);
router.get("/settings", asyncHandler(getSettings));

module.exports = router;
