const { localizeErrorMessage } = require("./errorLocalization");

module.exports = (res, status, code, message, details) => {
  const resolvedDetails =
    details !== undefined
      ? details
      : message && typeof message === "object" && !Array.isArray(message) && message.details !== undefined
        ? message.details
        : undefined;

  const localizedMsg = localizeErrorMessage(message, res && res.req ? res.req : undefined);

  if (code === "HISTORICAL_MUTATION_FORBIDDEN") {
    return res.status(status || 409).json({
      ok: false,
      status: false,
      message: localizedMsg || "Historical operational records cannot be modified",
      messageAr: "لا يمكن تعديل سجلات تشغيلية تخص تاريخًا سابقًا",
      error: {
        code,
        message: localizedMsg || "Historical operational records cannot be modified",
        ...(resolvedDetails && { details: resolvedDetails }),
      },
    });
  }

  const paymentRequirement = resolvedDetails
    && resolvedDetails.paymentRequirement
    && typeof resolvedDetails.paymentRequirement === "object"
    ? resolvedDetails.paymentRequirement
    : null;

  if (Number(status) === 402 && paymentRequirement) {
    return res.status(status).json({
      ok: false,
      status,
      code,
      message: localizedMsg,
      paymentRequirement,
      error: {
        code,
        message: localizedMsg,
        details: resolvedDetails,
      },
    });
  }

  return res.status(status).json({
    ok: false,
    error: {
      code,
      message: localizedMsg,
      ...(resolvedDetails && { details: resolvedDetails }),
    },
  });
};
