module.exports = (res, status, code, message, details) =>
  res.status(status).json({
    ok: false,
    error: { code, message, ...(details && { details }) },
  });
