"use strict";

const { Router } = require("express");
const adminController = require("../controllers/adminController");
const asyncHandler = require("../middleware/asyncHandler");
const {
  dashboardAuthMiddleware,
  dashboardRoleMiddleware,
} = require("../middleware/dashboardAuth");

const router = Router();

// Restaurant staff may create a customer account before creating that
// customer's subscription. Keep authorization on this exact endpoint so the
// scoped router never blocks legacy cashier/kitchen reads on other paths.
router.post(
  "/users",
  dashboardAuthMiddleware,
  dashboardRoleMiddleware(["admin", "restaurant"]),
  asyncHandler(adminController.createAppUserAdmin)
);

module.exports = router;
