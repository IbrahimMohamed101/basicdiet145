const { Router } = require("express");
const controller = require("../controllers/kitchenController");
const orderController = require("../controllers/orderKitchenController");
const { authMiddleware, roleMiddleware } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

router.use(authMiddleware, roleMiddleware(["kitchen", "admin"]));

router.get("/days/:date", asyncHandler(controller.listDailyOrders));
router.put("/subscriptions/:id/days/:date/assign", asyncHandler(controller.assignMeals));
router.post("/subscriptions/:id/days/:date/lock", asyncHandler((req, res) => controller.transitionDay(req, res, "locked")));
router.post("/subscriptions/:id/days/:date/in-preparation", asyncHandler((req, res) => controller.transitionDay(req, res, "in_preparation")));
router.post("/subscriptions/:id/days/:date/out-for-delivery", asyncHandler((req, res) => controller.transitionDay(req, res, "out_for_delivery")));
router.post("/subscriptions/:id/days/:date/ready-for-pickup", asyncHandler((req, res) => controller.transitionDay(req, res, "ready_for_pickup")));
router.post("/subscriptions/:id/days/:date/fulfill-pickup", asyncHandler(controller.fulfillPickup));

router.get("/orders/:date", asyncHandler(orderController.listOrdersByDate));
router.post("/orders/:id/preparing", asyncHandler((req, res) => orderController.transitionOrder(req, res, "preparing")));
router.post("/orders/:id/out-for-delivery", asyncHandler((req, res) => orderController.transitionOrder(req, res, "out_for_delivery")));
router.post("/orders/:id/ready-for-pickup", asyncHandler((req, res) => orderController.transitionOrder(req, res, "ready_for_pickup")));

module.exports = router;
