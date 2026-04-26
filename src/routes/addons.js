const { Router } = require("express");
const controller = require("../controllers/addonController");
const asyncHandler = require("../middleware/asyncHandler");

const router = Router();

router.get("/", asyncHandler(controller.listAddons));

module.exports = router;
