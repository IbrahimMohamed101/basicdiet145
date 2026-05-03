const { Router } = require("express");
const controller = require("../controllers/admin/mealPlannerMenu.controller");
const {
  dashboardAuthMiddleware: adminAuthMiddleware,
  dashboardRoleMiddleware,
} = require("../middleware/dashboardAuth");

const router = Router();

router.use(adminAuthMiddleware, dashboardRoleMiddleware(["admin"]));

router.get("/categories", controller.listCategories);
router.post("/categories", controller.createCategory);
router.patch("/categories/:id/toggle", controller.toggleCategory);
router.get("/categories/:id", controller.getCategory);
router.put("/categories/:id", controller.updateCategory);
router.delete("/categories/:id", controller.deleteCategory);

router.get("/proteins", controller.listProteins);
router.post("/proteins", controller.createProtein);
router.patch("/proteins/:id/toggle", controller.toggleProtein);
router.get("/proteins/:id", controller.getProtein);
router.put("/proteins/:id", controller.updateProtein);
router.delete("/proteins/:id", controller.deleteProtein);

router.get("/premium-proteins", controller.listPremiumProteins);
router.post("/premium-proteins", controller.createPremiumProtein);
router.patch("/premium-proteins/:id/toggle", controller.togglePremiumProtein);
router.get("/premium-proteins/:id", controller.getPremiumProtein);
router.put("/premium-proteins/:id", controller.updatePremiumProtein);
router.delete("/premium-proteins/:id", controller.deletePremiumProtein);

router.get("/sandwiches", controller.listSandwiches);
router.post("/sandwiches", controller.createSandwich);
router.patch("/sandwiches/:id/toggle", controller.toggleSandwich);
router.get("/sandwiches/:id", controller.getSandwich);
router.put("/sandwiches/:id", controller.updateSandwich);
router.delete("/sandwiches/:id", controller.deleteSandwich);

router.get("/carbs", controller.listCarbs);
router.post("/carbs", controller.createCarb);
router.patch("/carbs/:id/toggle", controller.toggleCarb);
router.get("/carbs/:id", controller.getCarb);
router.put("/carbs/:id", controller.updateCarb);
router.delete("/carbs/:id", controller.deleteCarb);

router.get("/addons", controller.listAddons);
router.post("/addons", controller.createAddon);
router.patch("/addons/:id/toggle", controller.toggleAddon);
router.get("/addons/:id", controller.getAddon);
router.put("/addons/:id", controller.updateAddon);
router.delete("/addons/:id", controller.deleteAddon);

router.get("/salad-ingredients", controller.listSaladIngredients);
router.post("/salad-ingredients", controller.createSaladIngredient);
router.patch("/salad-ingredients/:id/toggle", controller.toggleSaladIngredient);
router.get("/salad-ingredients/:id", controller.getSaladIngredient);
router.put("/salad-ingredients/:id", controller.updateSaladIngredient);
router.delete("/salad-ingredients/:id", controller.deleteSaladIngredient);

module.exports = router;
