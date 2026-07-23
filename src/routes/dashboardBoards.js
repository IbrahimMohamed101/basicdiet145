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

const boardRoles = Object.freeze({
  kitchen: ["admin", "restaurant", "kitchen", "cashier"],
  pickup: ["admin", "restaurant", "kitchen", "cashier"],
  courier: ["admin", "kitchen", "cashier"],
});

for (const screen of ["kitchen", "courier", "pickup"]) {
  const allowedRoles = boardRoles[screen];
  router.get(
    `/${screen}/queue`,
    dashboardRoleMiddleware(allowedRoles),
    (req, _res, next) => {
      req.params.screen = screen;
      next();
    },
    asyncHandler(controller.queue)
  );
  router.get(
    `/${screen}/queue/:dayId`,
    dashboardRoleMiddleware(allowedRoles),
    (req, _res, next) => {
      req.params.screen = screen;
      next();
    },
    asyncHandler(controller.queueDetail)
  );
  router.post(
    `/${screen}/actions/:action`,
    dashboardRoleMiddleware(allowedRoles),
    (req, _res, next) => {
      req.params.screen = screen;
      next();
    },
    asyncHandler(controller.action)
  );
}

module.exports = router;
