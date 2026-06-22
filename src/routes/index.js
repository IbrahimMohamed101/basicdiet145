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
const builderPremiumMealRoutes = require("./builderPremiumMeals");
const addonRoutes = require("./addons");
const contentRoutes = require("./content");
const adminRoutes = require("./admin");
const adminMealPlannerMenuRoutes = require("./adminMealPlannerMenu.routes");
const dashboardMenuRoutes = require("./dashboardMenu");
const dashboardMealBuilderRoutes = require("./dashboardMealBuilder");
const courierRoutes = require("./courier");
const kitchenRoutes = require("./kitchen");
const dashboardOpsRoutes = require("./dashboardOps");
const dashboardSubscriptionRoutes = require("./dashboardSubscriptions");
const dashboardAccountingRoutes = require("./dashboardAccounting");
const dashboardOrderRoutes = require("./dashboardOrders");
const dashboardBoardRoutes = require("./dashboardBoards");
const dashboardMenuIdentityRoutes = require("./dashboardMenuIdentity");
const dashboardCatalogItemRoutes = require("./dashboardCatalogItems");
const paymentRoutes = require("./payments");
const healthRoutes = require("./health");
const clientRoutes = require("./client");
const accountDeletionRoutes = require("./accountDeletion");

const { getSettings } = require("../controllers/settingsController");
const { listCategoriesWithMeals } = require("../controllers/mealController");
const asyncHandler = require("../middleware/asyncHandler");

const webhookRoutes = require("./webhooks");

const router = Router();

router.use("/webhooks", webhookRoutes);
router.use("/payments", paymentRoutes.apiRouter);
router.use("/account-deletion", accountDeletionRoutes);
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
router.use("/builder/premium-meals", builderPremiumMealRoutes);
router.use("/addons", addonRoutes);
router.use("/content", contentRoutes);
router.use("/admin/meal-planner-menu", adminMealPlannerMenuRoutes);
router.use("/dashboard/meal-planner", adminMealPlannerMenuRoutes);
router.use("/dashboard/menu", dashboardMenuRoutes);
router.use("/dashboard/meal-builder", dashboardMealBuilderRoutes);
router.use("/dashboard/catalog-items", dashboardCatalogItemRoutes);
router.use("/dashboard/ops", dashboardOpsRoutes);
router.use("/dashboard/operations", dashboardOpsRoutes);
router.use("/dashboard/subscriptions", dashboardSubscriptionRoutes);
router.use("/dashboard/accounting", dashboardAccountingRoutes);
router.use("/dashboard/orders", dashboardOrderRoutes);
router.use("/dashboard", dashboardBoardRoutes);
router.use("/dashboard/menu-identities-audit", dashboardMenuIdentityRoutes); // For internal audit
router.use("/dashboard", dashboardMenuIdentityRoutes);
router.use("/dashboard", adminRoutes);
router.use("/admin", adminRoutes);
router.use("/health", healthRoutes);
router.use("/client", clientRoutes);


/**
 * DEPRECATED: Standard Kitchen/Courier operational routes.
 * Replaced by the Unified Dashboard Ops API (/api/dashboard/ops).
 */
router.use("/courier", courierRoutes);
router.use("/kitchen", kitchenRoutes);
router.get("/categories-with-meals", asyncHandler(listCategoriesWithMeals));
router.get("/settings", asyncHandler(getSettings));

module.exports = router;
