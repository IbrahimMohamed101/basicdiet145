const { Router } = require("express");
const controller = require("../controllers/dashboard/opsBoardController");
const asyncHandler = require("../middleware/asyncHandler");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");

const router = Router();

router.use(dashboardAuthMiddleware);

router.get(
  "/delivery-schedule",
  dashboardRoleMiddleware(["admin", "courier"]),
  asyncHandler(controller.deliverySchedule)
);

for (const screen of ["kitchen", "courier", "pickup"]) {
  router.get(
    `/${screen}/queue`,
    dashboardRoleMiddleware(["admin", "kitchen", "courier"]),
    (req, _res, next) => {
      req.params.screen = screen;
      next();
    },
    asyncHandler(controller.queue)
  );
  router.get(
    `/${screen}/queue/:dayId`,
    dashboardRoleMiddleware(["admin", "kitchen", "courier"]),
    (req, _res, next) => {
      req.params.screen = screen;
      next();
    },
    asyncHandler(controller.queueDetail)
  );
  router.post(
    `/${screen}/actions/:action`,
    dashboardRoleMiddleware(["admin", "kitchen", "courier"]),
    (req, _res, next) => {
      req.params.screen = screen;
      next();
    },
    asyncHandler(controller.action)
  );
}

module.exports = router;
