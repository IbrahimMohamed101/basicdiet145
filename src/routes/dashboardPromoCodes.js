"use strict";

const { Router } = require("express");
const promoCodeController = require("../controllers/promoCodeController");
const asyncHandler = require("../middleware/asyncHandler");
const {
  dashboardAuthMiddleware,
  dashboardRoleMiddleware,
} = require("../middleware/dashboardAuth");

const router = Router();

router.use(dashboardAuthMiddleware);
router.use(dashboardRoleMiddleware(["admin", "restaurant"]));

router.get("/", asyncHandler(promoCodeController.listPromoCodesAdmin));
router.post("/validate", asyncHandler(promoCodeController.validatePromoCodeAdmin));
router.get("/:id", asyncHandler(promoCodeController.getPromoCodeAdmin));
router.post("/", asyncHandler(promoCodeController.createPromoCodeAdmin));
router.put("/:id", asyncHandler(promoCodeController.updatePromoCodeAdmin));
router.patch("/:id/toggle", asyncHandler(promoCodeController.togglePromoCodeActive));
router.delete("/:id", asyncHandler(promoCodeController.deletePromoCodeAdmin));

module.exports = router;
