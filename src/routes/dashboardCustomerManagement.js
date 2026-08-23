"use strict";

const { Router } = require("express");
const controller = require("../controllers/dashboardCustomerManagementController");
const asyncHandler = require("../middleware/asyncHandler");
const {
  dashboardAuthMiddleware,
  dashboardRoleMiddleware,
} = require("../middleware/dashboardAuth");

const router = Router();

router.use(dashboardAuthMiddleware, dashboardRoleMiddleware(["superadmin"]));
router.get("/:id", asyncHandler(controller.getCustomer));
router.patch("/:id", asyncHandler(controller.updateCustomer));
router.post("/:id/meal-compensations", asyncHandler(controller.grantMealCompensation));

module.exports = router;
