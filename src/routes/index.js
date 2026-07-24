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
// Dashboard and legacy clients may send an exact delivery window without the
// canonical slotId. Resolve only unambiguous selections before controllers
// capture the subscription quote service.
require("../services/installDashboardDeliverySlotCompatibility");
// Add-on plan availability is owned by the plan and its price matrix. Plan-only
// checkout filters stale product links instead of rejecting the whole plan, and
// still permits a temporarily empty product catalog.
require("../services/installSubscriptionAddonPlanAvailabilityPolicy");
// Flutter's generated current-overview parser uses strict String/num/bool casts.
// Normalize only known values before subscription controllers capture the service;
// preserve the endpoint keys and response shape exactly as published.
require("../services/installCurrentSubscriptionOverviewFlutterCompatibility");
// Protein/carb ids may belong to the live MenuOption catalog rather than the
// legacy Builder collections. Resolve both sources before ops readers capture
// the kitchen catalog service so every returned component has its real name.
require("../services/dashboard/installKitchenCatalogNameResolution");
// Snapshot labels are historical evidence, not the food-name authority. Resolve
// products, proteins, carbs, options, salads, and add-ons from the live bilingual
// catalog before DTO builders capture the payload service.
require("../services/dashboard/installKitchenArabicCatalogAuthority");
// An add-on plan describes allowance and pricing; it is never the selected food
// product. Keep a missing product explicit instead of displaying the plan as food.
require("../services/dashboard/installKitchenAddonProductIdentityGuard");
// Operations cards are a food-preparation contract. Install before dashboard
// route modules capture DTO builders or the canonical serializer.
require("../services/dashboard/installKitchenPreparationContract");
// The preparation layer may inherit malformed legacy snapshot display strings.
// Re-resolve final protein/carb names from the catalog and rebuild meal titles.
require("../services/dashboard/installKitchenFinalNameRepair");
require("../services/orders/installWeightPricingAuthority");
// The published product/group relations are the one-time carb source of truth.
// Install this before the gram decorator so every database-authorized carb gets
// the same free 50g contract and order routes capture the final service export.
require("../services/installOneTimeCarbCatalogAuthority");
// One-time Builder carbs may be included by grams without an added price. Apply
// this after menu deduplication/weight pricing and before order routes capture
// menu and pricing service exports.
require("../services/installOneTimeCarbGramContract");
require("../services/installDashboardCatalogCompatibility");
// Add-on administration must see the complete catalog even when an older
// dashboard build sends customer-visibility filters with picker requests.
require("../services/installDashboardAddonCatalogAuthoring");
// The add-on picker is customer-facing authoring data even when it is requested
// from dashboard routes. Re-apply active/visible/available state at the final
// service boundary and keep category counts on that exact filtered list.
require("../services/installAddonPickerAvailabilityGuard");
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
// Direct subscription meals are owned by the live product catalog. The
// historical sandwich card remains the Flutter-compatible presentation shell,
// but its product membership is never sourced from stored selectedProductIds.
require("../services/installDynamicDirectMealCatalogPolicy");
// Re-apply the canonical meal-product classifier after the dashboard's explicit
// authoring layer so add-ons/builders cannot appear as direct meal candidates.
require("../services/installDashboardDirectPickerClassificationGuard");
// Hydrate missing product/option media, deliver bounded Cloudinary images, and
// cache only the static catalog layer before controllers capture service exports.
const {
  menuMutationCacheInvalidationMiddleware,
} = require("../services/installMenuDeliveryOptimization");

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

// Successful dashboard catalog writes invalidate both static catalog caches.
// User-specific subscription balances/add-on allowances are never cached here.
router.use(menuMutationCacheInvalidationMiddleware);

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
