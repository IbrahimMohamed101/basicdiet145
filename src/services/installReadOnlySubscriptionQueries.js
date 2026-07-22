"use strict";

const SubscriptionDay = require("../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../models/SubscriptionPickupRequest");
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
    const diagnostic = await consistencyService.diagnoseDailyAddonsForUser({ userId: args.userId });
    result.data.readConsistency = readOnlyMarker();
    result.data.dailyAddonReconciliation = diagnostic;
    return result;
  });
}

function installPickupReadDiagnostics() {
  const service = require("./subscription/subscriptionPickupRequestClientService");

  wrapExport(service, "getPickupAvailabilityForClient", (original) => async function readOnlyAvailability(args = {}) {
    const result = await original(args);
    const dayId = result && result.subscriptionDayId;
    const diagnostic = dayId
      ? await consistencyService.diagnoseDayDailyAddonState({ dayId })
      : null;
    return {
      ...result,
      readConsistency: readOnlyMarker(),
      dailyAddonReconciliation: diagnostic,
    };
  });

  wrapExport(service, "getSubscriptionPickupRequestStatusForClient", (original) => async function readOnlyPickupStatus(args = {}) {
    const result = await original(args);
    const diagnostic = await consistencyService.diagnosePickupRequest({ requestId: args.requestId });
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
    return consistencyService.diagnoseDayDailyAddonState({ dayId: args.entityId });
  }
  if (args.entityType === "subscription_pickup_request") {
    return consistencyService.diagnosePickupRequest({ requestId: args.entityId });
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
  installReadOnlySubscriptionQueries,
  readOnlyMarker,
};
