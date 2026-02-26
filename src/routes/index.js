const { Router } = require("express");

const authRoutes = require("./auth");
const appAuthRoutes = require("./appAuth");
const planRoutes = require("./plans");
const subscriptionRoutes = require("./subscriptions");
const orderRoutes = require("./orders");
const saladIngredientRoutes = require("./saladIngredients");
const customSaladRoutes = require("./customSalads");
const adminRoutes = require("./admin");
const courierRoutes = require("./courier");
const kitchenRoutes = require("./kitchen");
const { getSettings } = require("../controllers/settingsController");
const asyncHandler = require("../middleware/asyncHandler");

const webhookRoutes = require("./webhooks");

const router = Router();

router.use("/webhooks", webhookRoutes);
router.use("/auth", authRoutes);
router.use("/app", appAuthRoutes);
router.use("/plans", planRoutes);
router.use("/subscriptions", subscriptionRoutes);
router.use("/orders", orderRoutes);
router.use("/salad-ingredients", saladIngredientRoutes);
router.use("/custom-salads", customSaladRoutes);
router.use("/dashboard", adminRoutes);
router.use("/admin", adminRoutes);
router.use("/courier", courierRoutes);
router.use("/kitchen", kitchenRoutes);
router.get("/settings", asyncHandler(getSettings));

module.exports = router;
