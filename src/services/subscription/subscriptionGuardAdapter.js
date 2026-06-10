"use strict";

/**
 * Adapter helper to convert throw-based guards to result-based errors.
 * Payment services use result-based error handling (buildErrorResult/buildSuccessResult)
 * while centralized guards use throw-based errors. This adapter bridges the gap.
 */

/**
 * Wraps a throw-based guard function and converts thrown errors to result-based error objects.
 * @param {Function} guardFn - The guard function that may throw errors
 * @param {Function} buildErrorFn - The function to build error result objects (e.g., buildErrorResult)
 * @returns {Object} - Returns { ok: false, status, code, message, details } if guard throws, or undefined if guard passes
 */
function guardToErrorResult(guardFn, buildErrorFn) {
  try {
    guardFn();
    return undefined; // Guard passed
  } catch (err) {
    // Convert throw-based error to result-based error
    const status = err.status || 403;
    const code = err.code || "FORBIDDEN";
    const message = err.message || "Guard failed";
    const details = err.details || undefined;
    
    return buildErrorFn(status, code, message, details);
  }
}

/**
 * Wraps an async throw-based guard function and converts thrown errors to result-based error objects.
 * @param {Function} guardFn - The async guard function that may throw errors
 * @param {Function} buildErrorFn - The function to build error result objects (e.g., buildErrorResult)
 * @returns {Promise<Object>} - Returns { ok: false, status, code, message, details } if guard throws, or undefined if guard passes
 */
async function guardToErrorResultAsync(guardFn, buildErrorFn) {
  try {
    await guardFn();
    return undefined; // Guard passed
  } catch (err) {
    // Convert throw-based error to result-based error
    const status = err.status || 403;
    const code = err.code || "FORBIDDEN";
    const message = err.message || "Guard failed";
    const details = err.details || undefined;
    
    return buildErrorFn(status, code, message, details);
  }
}

module.exports = {
  guardToErrorResult,
  guardToErrorResultAsync,
};
