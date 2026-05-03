const orderDashboardService = require("../../services/orders/orderDashboardService");
const errorResponse = require("../../utils/errorResponse");

function buildActor(req) {
  return {
    userId: req.dashboardUserId || req.userId || null,
    role: req.dashboardUserRole || req.userRole || "",
  };
}

function sendServiceError(res, err) {
  if (err && err.status && err.code) {
    return errorResponse(res, err.status, err.code, err.message, err.details);
  }
  console.error("Dashboard order error:", err);
  return errorResponse(res, 500, "INTERNAL_ERROR", "Dashboard order request failed");
}

async function listOrders(req, res) {
  try {
    const data = await orderDashboardService.listDashboardOrders({
      filters: {
        status: req.query.status,
        paymentStatus: req.query.paymentStatus,
        fulfillmentMethod: req.query.fulfillmentMethod,
        from: req.query.from,
        to: req.query.to,
        date: req.query.date,
        zoneId: req.query.zoneId,
        q: req.query.q,
      },
      pagination: {
        page: req.query.page,
        limit: req.query.limit,
      },
      actor: buildActor(req),
    });
    return res.status(200).json({ status: true, data });
  } catch (err) {
    return sendServiceError(res, err);
  }
}

async function getOrder(req, res) {
  try {
    const data = await orderDashboardService.getDashboardOrder({
      orderId: req.params.orderId,
      actor: buildActor(req),
    });
    return res.status(200).json({ status: true, data });
  } catch (err) {
    return sendServiceError(res, err);
  }
}

async function handleOrderAction(req, res) {
  try {
    const data = await orderDashboardService.executeDashboardOrderAction({
      orderId: req.params.orderId,
      action: req.params.action,
      actor: buildActor(req),
      payload: req.body || {},
    });
    return res.status(200).json({ status: true, data });
  } catch (err) {
    return sendServiceError(res, err);
  }
}

module.exports = {
  listOrders,
  getOrder,
  handleOrderAction,
};
