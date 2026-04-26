const { Router } = require("express");

const controller = require("../controllers/paymentController");
const asyncHandler = require("../middleware/asyncHandler");

const publicRouter = Router();
const apiRouter = Router();

publicRouter.get("/payments/success", asyncHandler(controller.handlePaymentSuccess));
publicRouter.get("/payments/cancel", asyncHandler(controller.handlePaymentCancel));

apiRouter.get("/verify", asyncHandler(controller.verifyPayment));

module.exports = {
  publicRouter,
  apiRouter,
};
