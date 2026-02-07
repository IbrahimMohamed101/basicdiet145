const { Router } = require("express");
const controller = require("../controllers/kitchenController");
const orderController = require("../controllers/orderKitchenController");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");

const router = Router();

router.use(dashboardAuthMiddleware, dashboardRoleMiddleware(["kitchen", "admin"]));

router.get("/days/:date", controller.listDailyOrders);
router.put("/subscriptions/:id/days/:date/assign", controller.assignMeals);
router.post("/subscriptions/:id/days/:date/lock", (req, res) => controller.transitionDay(req, res, "locked"));
router.post("/subscriptions/:id/days/:date/in-preparation", (req, res) => controller.transitionDay(req, res, "in_preparation"));
router.post("/subscriptions/:id/days/:date/out-for-delivery", (req, res) => controller.transitionDay(req, res, "out_for_delivery"));
router.post("/subscriptions/:id/days/:date/ready-for-pickup", (req, res) => controller.transitionDay(req, res, "ready_for_pickup"));
router.post("/subscriptions/:id/days/:date/fulfill-pickup", controller.fulfillPickup);

router.get("/orders/:date", orderController.listOrdersByDate);
router.post("/orders/:id/preparing", (req, res) => orderController.transitionOrder(req, res, "preparing"));
router.post("/orders/:id/out-for-delivery", (req, res) => orderController.transitionOrder(req, res, "out_for_delivery"));
router.post("/orders/:id/ready-for-pickup", (req, res) => orderController.transitionOrder(req, res, "ready_for_pickup"));

module.exports = router;
