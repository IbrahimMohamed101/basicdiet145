"use strict";

const SubscriptionDay = require("../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../models/SubscriptionPickupRequest");
const { logger } = require("../utils/logger");
const consistencyService = require("./subscription/subscriptionReadConsistencyService");

const INSTALL_KEY = Symbol.for("basicdiet.readOnlySubscriptionQueries.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.readOnlySubscriptionQueries.wrapped");

function readOnlyMarker() {
  return {
    readOnly: true,
    reconciliationApplied: false,
    reconciliationSource: "explicit_commands_and_recovery_workers",
  };
}

function diagnosticUnavailableMarker(error = null) {
  return {
    ...readOnlyMarker(),
    state: "diagnostic_unavailable",
    diagnosticAvailable: false,
    diagnosticErrorCode: String(error && error.code || "READ_DIAGNOSTIC_FAILED"),
  };
}

async function runReadDiagnosticSafely({
  operation,
  context = {},
  diagnose,
} = {}) {
  if (typeof diagnose !== "function") {
    return diagnosticUnavailableMarker({ code: "READ_DIAGNOSTIC_NOT_CONFIGURED" });
  }

  try {
    return await diagnose();
  } catch (error) {
    logger.warn("Optional subscription read diagnostic failed open", {
      operation: operation || "unknown",
      errorCode: error && error.code || "READ_DIAGNOSTIC_FAILED",
      error: error && error.message || "Read diagnostic failed",
      ...context,
    });
    return diagnosticUnavailableMarker(error);
  }
}

function wrapExport(target, name, factory) {
  const original = target && target[name];
  if (typeof original !== "function" || original[WRAPPED_KEY]) return original;
  const wrapped = factory(original);
  wrapped[WRAPPED_KEY] = true;
  wrapped.__original = original;
  target[name] = wrapped;
  return wrapped;
}

function installReadOnlyDailyAddonReconciliation() {
  const dailyAddonService = require("./subscription/subscriptionDailyAddonService");
  if (!dailyAddonService.applyDayDailyAddonReconciliation) {
    dailyAddonService.applyDayDailyAddonReconciliation = dailyAddonService.reconcileDayDailyAddonState;
  }
  if (!dailyAddonService.applyDailyAddonReconciliationForDate) {
    dailyAddonService.applyDailyAddonReconciliationForDate = dailyAddonService.reconcileDailyAddonsForDate;
  }
  if (!dailyAddonService.applyDailyAddonReconciliationForUser) {
    dailyAddonService.applyDailyAddonReconciliationForUser = dailyAddonService.reconcileDailyAddonsForUser;
  }

  dailyAddonService.reconcileDayDailyAddonState = async function readOnlyDayReconciliation(args = {}) {
    if (!args.dayId) return readOnlyMarker();
    return consistencyService.diagnoseDayDailyAddonState({ dayId: args.dayId });
  };
  dailyAddonService.reconcileDailyAddonsForDate = async function readOnlyDateReconciliation(args = {}) {
    return {
      ...readOnlyMarker(),
      date: args.date || null,
      state: "diagnostics_available_on_entity_read",
    };
  };
  dailyAddonService.reconcileDailyAddonsForUser = async function readOnlyUserReconciliation(args = {}) {
    return consistencyService.diagnoseDailyAddonsForUser({ userId: args.userId });
  };
  dailyAddonService.reconcileDayDailyAddonState.__readOnlyDiagnostic = true;
  dailyAddonService.reconcileDailyAddonsForDate.__readOnlyDiagnostic = true;
  dailyAddonService.reconcileDailyAddonsForUser.__readOnlyDiagnostic = true;
}

function installOverviewDiagnostics() {
  const service = require("./subscription/subscriptionClientOverviewService");
  wrapExport(service, "buildCurrentSubscriptionOverview", (original) => async function readOnlyOverview(args = {}) {
    const result = await original(args);
    if (!result || !result.data) return result;
    const diagnostic = await runReadDiagnosticSafely({
      operation: "current_subscription_overview",
      context: { userId: args.userId ? String(args.userId) : null },
      diagnose: () => consistencyService.diagnoseDailyAddonsForUser({ userId: args.userId }),
    });
    result.data.readConsistency = readOnlyMarker();
    result.data.dailyAddonReconciliation = diagnostic;
    return result;
  });
}

function buildReadOnlyAvailabilityWrapper(original, {
  diagnoseDayDailyAddonState = (args) => consistencyService.diagnoseDayDailyAddonState(args),
} = {}) {
  const wrapped = async function readOnlyAvailability(args = {}) {
    // The availability contract is authoritative for Flutter. Diagnostics are
    // optional observability only and must never turn a valid meal list into 500.
    const result = await original(args);
    const dayId = result && result.subscriptionDayId;
    const diagnostic = dayId
      ? await runReadDiagnosticSafely({
        operation: "pickup_availability",
        context: {
          subscriptionId: args.subscriptionId ? String(args.subscriptionId) : null,
          date: args.date || null,
          dayId: String(dayId),
        },
        diagnose: () => diagnoseDayDailyAddonState({ dayId }),
      })
      : null;
    return {
      ...result,
      readConsistency: readOnlyMarker(),
      dailyAddonReconciliation: diagnostic,
    };
  };
  wrapped.__pickupAvailabilityDiagnosticFailOpen = true;
  return wrapped;
}

function installPickupReadDiagnostics() {
  const service = require("./subscription/subscriptionPickupRequestClientService");

  wrapExport(service, "getPickupAvailabilityForClient", (original) => (
    buildReadOnlyAvailabilityWrapper(original)
  ));

  wrapExport(service, "getSubscriptionPickupRequestStatusForClient", (original) => async function readOnlyPickupStatus(args = {}) {
    const result = await original(args);
    const diagnostic = await runReadDiagnosticSafely({
      operation: "pickup_request_status",
      context: {
        subscriptionId: args.subscriptionId ? String(args.subscriptionId) : null,
        requestId: args.requestId ? String(args.requestId) : null,
      },
      diagnose: () => consistencyService.diagnosePickupRequest({ requestId: args.requestId }),
    });
    return {
      ...result,
      readConsistency: readOnlyMarker(),
      reconciliationDiagnostic: diagnostic,
    };
  });

  wrapExport(service, "listSubscriptionPickupRequestsForClient", (original) => async function readOnlyPickupList(args = {}) {
    const result = await original(args);
    return {
      ...result,
      readConsistency: readOnlyMarker(),
      reconciliationDiagnostic: {
        ...readOnlyMarker(),
        state: "inspect_individual_request_for_details",
      },
    };
  });
}

async function resolveEntityDiagnostic(args = {}) {
  if (args.entityType === "subscription") {
    return runReadDiagnosticSafely({
      operation: "ops_subscription_entity",
      context: { entityId: args.entityId ? String(args.entityId) : null },
      diagnose: () => consistencyService.diagnoseDayDailyAddonState({ dayId: args.entityId }),
    });
  }
  if (args.entityType === "subscription_pickup_request") {
    return runReadDiagnosticSafely({
      operation: "ops_pickup_request_entity",
      context: { entityId: args.entityId ? String(args.entityId) : null },
      diagnose: () => consistencyService.diagnosePickupRequest({ requestId: args.entityId }),
    });
  }
  return null;
}

function installOpsReadDiagnostics() {
  const service = require("./dashboard/opsReadServiceV2");
  wrapExport(service, "listOperations", (original) => async function readOnlyOpsList(args = {}) {
    const result = await original(args);
    return (Array.isArray(result) ? result : []).map((row) => ({
      ...row,
      readConsistency: readOnlyMarker(),
      reconciliationDiagnostic: row && ["subscription_day", "subscription_pickup_request"].includes(row.entityType)
        ? {
          ...readOnlyMarker(),
          state: "inspect_entity_for_details",
        }
        : null,
    }));
  });
  wrapExport(service, "getEnrichedDTO", (original) => async function readOnlyOpsEntity(args = {}) {
    const result = await original(args);
    if (!result) return result;
    return {
      ...result,
      readConsistency: readOnlyMarker(),
      reconciliationDiagnostic: await resolveEntityDiagnostic(args),
    };
  });
}

function installReadOnlySubscriptionQueries() {
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;
  installReadOnlyDailyAddonReconciliation();
  installOverviewDiagnostics();
  installPickupReadDiagnostics();
  installOpsReadDiagnostics();
}

installReadOnlySubscriptionQueries();

module.exports = {
  buildReadOnlyAvailabilityWrapper,
  diagnosticUnavailableMarker,
  installReadOnlySubscriptionQueries,
  readOnlyMarker,
  runReadDiagnosticSafely,
};
