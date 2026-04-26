const { localizeErrorMessage } = require("./errorLocalization");

module.exports = (res, status, code, message, details) => {
  const resolvedDetails =
    details !== undefined
      ? details
      : message && typeof message === "object" && !Array.isArray(message) && message.details !== undefined
        ? message.details
        : undefined;

  return res.status(status).json({
    ok: false,
    error: {
      code,
      message: localizeErrorMessage(message, res && res.req ? res.req : undefined),
      ...(resolvedDetails && { details: resolvedDetails }),
    },
  });
};
