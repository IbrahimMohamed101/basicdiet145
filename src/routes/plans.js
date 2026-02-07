const { Router } = require("express");
const { listPlans, getPlan } = require("../controllers/planController");
const { authMiddleware } = require("../middleware/auth");

const router = Router();

router.use(authMiddleware);

router.get("/", listPlans);
router.get("/:id", getPlan);

module.exports = router;
