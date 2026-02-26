class ApiError extends Error {
  constructor({ status = 500, code = "INTERNAL", message = "Unexpected error", details } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isApiError(err) {
  return err instanceof ApiError;
}

module.exports = { ApiError, isApiError };
