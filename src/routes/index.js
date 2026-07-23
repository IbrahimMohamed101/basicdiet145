const { Router } = require("express");

// Premium upgrades are authored directly from the current menu catalog. Install
// this authority before subscription and route modules capture service methods.
require("../services/installIndependentPremiumAuthority");
// A Premium meal upgrades one configurable base meal. Keep all base groups
// authored for standard_meal (carbs and any future side groups) available while
// the Premium section remains authoritative for the upgraded source option.
require("../services/installPremiumMealBaseBuilderInheritance");
require("../services/installSubscriptionBackendRepairComposition");
// A paid Premium selection is an upgrade of one subscription meal, never a
// replacement for its base meal credit. Install this invariant before payment,
// subscription controller, and webhook modules capture settlement functions.
require("../services/installPaidPremiumBaseMealEntitlement");
// Reservation writes update the Subscription atomically outside the original
// planning document instance. Re-read it after confirmation so mobile responses
// never show the balance from immediately before the latest reservation.
require("../services/installFreshPlanningSubscriptionBalance");
// Install transaction retry only after the add-on/entitlement repair composition
// has finalized service references. This prevents early subscription service
// loading from capturing legacy carryover pricing functions.
require("../services/installSubscriptionPlanningTransientRetry");
// Install after entitlement/payment composition but before any route module
// captures payment initiation or settlement functions.
require("../services/installSubscriptionAddonPaymentBoundaryGuard");
// Operations cards are a food-preparation contract. Install before dashboard
// route modules capture DTO builders or the canonical serializer.
require("../services/dashboard/installKitchenPreparationContract");
require("../services/orders/installWeightPricingAuthority");
// The one-time Basic Meal must expose every published customer carb and preserve
// Flutter's selected grams without charging included carb weight.
require("../services/installOneTimeCarbGramContract");
require("../services/installDashboardCatalogCompatibility");
// Add-on administration must see the complete catalog even when an older
// dashboard build sends customer-visibility filters with picker requests.
require("../services/installDashboardAddonCatalogAuthoring");
require("../services/installDashboardMealBuilderFinalization");
require("../services/installDashboardMealBuilderExplicitDirectCardPolicy");
require("../services/installDashboardMealPlannerFlutterCardPolicy");
require("../services/installDashboardMealPlannerCardActionDecorator");
require("../services/installDashboardMealPlannerTwoTypePolicy");
// The public planner canonicalizes old sandwich cards to full_meal_product. Keep
// validator membership compatible with already-published versions that still
// store those direct products under the historical sandwich selection type.
require("../services/installFullMealProductMembershipCompatibility");
require("../services/installDashboardMealBuilderDraftGuard");
// Keep the historical bootstrap compatible when its source data exists, but do
// not require old fixed products/groups for a fresh dashboard-owned catalog.
require("../services/installIndependentMealBuilderAuthoring");
// Flutter reads premium card media from imageUrl. Install this after all Premium
// and catalog composition so the final service export is hydrated before the
// builder controller captures it.
require("../services/installPremiumUpgradeImageHydration");
// Flutter must receive every eligible option/product attached to a published
// card, while the membership validator accepts the exact same expanded catalog.
// Install last so it decorates the final Meal Builder service composition.
require("../services/installFlutterMealPlannerCatalogExpansion");

const authRoutes = require("./auth");
const dashboardAuthRoutes = require("./dashboardAuth");
const dashboardStaffUserRoutes = require("./dashboardStaffUsers");
const appAuthRoutes = require("./appAuth");
const planRoutes = require("./plans");
const popularPackageRoutes = require("./popularPackages");
const subscriptionMealPlannerV4Routes = require("./subscriptionMealPlannerV4");
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
const dashboardPremiumUpgradesRoutes = require("./dashboardPremiumUpgrades");
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
router.use("/dashboard/staff-users", dashboardStaffUserRoutes);
router.use("/app", appAuthRoutes);
router.use("/plans", planRoutes);
router.use("/popular_packages", popularPackageRoutes);
// Canonical Meal Planner v4 is mounted before the legacy subscription router so
// the public endpoint has exactly one response contract and no version mirrors.
router.use("/subscriptions", subscriptionMealPlannerV4Routes);
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
router.use("/dashboard/premium-upgrades", dashboardPremiumUpgradesRoutes);
router.use("/dashboard/ops", dashboardOpsRoutes);
router.use("/dashboard/operations", dashboardOpsRoutes);
router.use("/dashboard/subscriptions", dashboardSubscriptionRoutes);
router.use("/dashboard/accounting", dashboardAccountingRoutes);
router.use("/dashboard/orders", dashboardOrderRoutes);
router.use("/dashboard", dashboardBoardRoutes);
router.use("/dashboard", adminRoutes);
router.use("/dashboard/menu-identities-audit", dashboardMenuIdentityRoutes);
router.use("/dashboard", dashboardMenuIdentityRoutes);
router.use("/admin", adminRoutes);
router.use("/health", healthRoutes);
router.use("/client", clientRoutes);

router.use("/courier", courierRoutes);
router.use("/kitchen", kitchenRoutes);
router.get("/categories-with-meals", asyncHandler(listCategoriesWithMeals));
router.get("/settings", asyncHandler(getSettings));

module.exports = router;
