"use strict";

const { Router } = require("express");
const adminController = require("../controllers/adminController");
const asyncHandler = require("../middleware/asyncHandler");
const {
  dashboardAuthMiddleware,
  dashboardRoleMiddleware,
} = require("../middleware/dashboardAuth");

const router = Router();

router.use(
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "restaurant"])
);

// Restaurant staff may create a customer account before creating that
// customer's subscription. The broader admin router remains protected, so
// this grant does not expose settings, payments, staff management, or reports.
router.post("/users", asyncHandler(adminController.createAppUserAdmin));

module.exports = router;
