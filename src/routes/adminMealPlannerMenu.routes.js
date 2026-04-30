const { Router } = require("express");
const controller = require("../controllers/admin/mealPlannerMenu.controller");
const {
  dashboardAuthMiddleware: adminAuthMiddleware,
  dashboardRoleMiddleware,
} = require("../middleware/dashboardAuth");

const router = Router();

router.use(adminAuthMiddleware, dashboardRoleMiddleware(["admin"]));

router.get("/proteins", controller.listProteins);
router.post("/proteins", controller.createProtein);
router.put("/proteins/:id", controller.updateProtein);
router.delete("/proteins/:id", controller.deleteProtein);

router.get("/premium-proteins", controller.listPremiumProteins);
router.post("/premium-proteins", controller.createPremiumProtein);
router.put("/premium-proteins/:id", controller.updatePremiumProtein);
router.delete("/premium-proteins/:id", controller.deletePremiumProtein);

router.get("/sandwiches", controller.listSandwiches);
router.post("/sandwiches", controller.createSandwich);
router.put("/sandwiches/:id", controller.updateSandwich);
router.delete("/sandwiches/:id", controller.deleteSandwich);

router.get("/carbs", controller.listCarbs);
router.post("/carbs", controller.createCarb);
router.put("/carbs/:id", controller.updateCarb);
router.delete("/carbs/:id", controller.deleteCarb);

router.get("/addons", controller.listAddons);
router.post("/addons", controller.createAddon);
router.put("/addons/:id", controller.updateAddon);
router.delete("/addons/:id", controller.deleteAddon);

router.get("/salad-ingredients", controller.listSaladIngredients);
router.post("/salad-ingredients", controller.createSaladIngredient);
router.put("/salad-ingredients/:id", controller.updateSaladIngredient);
router.delete("/salad-ingredients/:id", controller.deleteSaladIngredient);

module.exports = router;
