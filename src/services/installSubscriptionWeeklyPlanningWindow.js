"use strict";

const subscriptionController = require("../controllers/subscriptionController");
const { getRequestLang } = require("../utils/i18n");
const { getRestaurantBusinessDate } = require("./restaurantHoursService");
const subscriptionService = require("./subscription/subscriptionService");
const timelineService = require("./subscription/subscriptionTimelineService");
const {
  INVALID_PLANNING_WINDOW_DATE_CODE,
  PLANNING_WINDOW_REASONS,
  evaluatePlanningDate,
  isWeeklyPlanningWindowEnabled,
  resolveSubscriptionPlanningWindow,
} = require("./subscription/subscriptionPlanningWindowService");

const STATE_KEY = Symbol.for(
  "basicdiet.subscriptionWeeklyPlanningWindow.state"
);
const WRAPPER_MARKER = "__subscriptionWeeklyPlanningWindow";
const CONTROLLER_WRAPPER_MARKER = Symbol.for(
  "basicdiet.subscriptionWeeklyPlanningWindow.controllerWrapped"
);
const TIMELINE_PLANNING_WINDOW_VERSION =
  "subscription_weekly_planning_window.v2";

const LOCKED_MESSAGES = Object.freeze({
  ar: "يمكن اختيار الوجبات خلال فترة التخطيط المتاحة فقط",
  en: "Meal planning is available only within the active planning window",
});
const INVALID_WINDOW_MESSAGES = Object.freeze({
  ar: "تعذر تحديد فترة اختيار الوجبات لهذا الاشتراك",
  en: "The planning window could not be determined for this subscription",
});

function localizedMessage(messages, lang) {
  return String(lang || "").toLowerCase() === "en"
    ? messages.en
    : messages.ar;
}

function lockEditableTimelineDay(day, {
  reason,
  message,
  evaluation = null,
} = {}) {
  if (!day || typeof day !== "object" || day.canEdit !== true) {
    return day;
  }

  const status = String(day.status || "");
  const dayStatus = String(day.dayStatus || "");
  const openStatus = !status || status === "open";
  const openDayStatus = !dayStatus || dayStatus === "open";

  return {
    ...day,
    canEdit: false,
    ...(openStatus ? { status: "locked" } : {}),
    ...(openDayStatus ? { dayStatus: "locked" } : {}),
    locked: openStatus || openDayStatus || day.locked === true,
    lockedReason: day.lockedReason || reason,
    lockedMessage: day.lockedMessage || message,
    planningWindowReason: reason,
    withinPlanningWindow: false,
    withinCurrentMenuWeek: false,
    ...(evaluation ? {
      planningWindowStart: evaluation.planningWindowStart,
      planningWindowEnd: evaluation.planningWindowEnd,
    } : {}),
  };
}

function projectTimelineToWeeklyPlanningWindow(timeline, {
  businessDate,
  lang = "ar",
  enabled = isWeeklyPlanningWindowEnabled(),
} = {}) {
  if (!enabled || !timeline || typeof timeline !== "object") {
    return timeline;
  }
  if (!Array.isArray(timeline.days)) {
    return timeline;
  }
  if (
    timeline.planningWindow
    && timeline.planningWindow.version === TIMELINE_PLANNING_WINDOW_VERSION
    && timeline.planningWindow.businessDate === businessDate
  ) {
    return timeline;
  }

  const validity = timeline.validity && typeof timeline.validity === "object"
    ? timeline.validity
    : {};

  let planningWindow;
  try {
    planningWindow = resolveSubscriptionPlanningWindow({
      businessDate,
      subscriptionStartDate: validity.startDate || null,
      subscriptionValidityEndDate:
        validity.validityEndDate || validity.endDate || null,
    });
  } catch (error) {
    const reason = error && error.code
      ? error.code
      : INVALID_PLANNING_WINDOW_DATE_CODE;
    const message = localizedMessage(INVALID_WINDOW_MESSAGES, lang);
    return {
      ...timeline,
      planningWindow: {
        version: TIMELINE_PLANNING_WINDOW_VERSION,
        enabled: true,
        available: false,
        errorCode: reason,
      },
      days: timeline.days.map((day) => lockEditableTimelineDay(day, {
        reason,
        message,
      })),
    };
  }

  const message = localizedMessage(LOCKED_MESSAGES, lang);
  const days = timeline.days.map((day) => {
    if (!day || typeof day !== "object" || !day.date) return day;

    let evaluation;
    try {
      evaluation = evaluatePlanningDate({
        requestedDate: day.date,
        businessDate: planningWindow.businessDate,
        subscriptionStartDate: planningWindow.subscriptionStartDate,
        subscriptionValidityEndDate:
          planningWindow.subscriptionValidityEndDate,
      });
    } catch (error) {
      return lockEditableTimelineDay(day, {
        reason: error && error.code
          ? error.code
          : INVALID_PLANNING_WINDOW_DATE_CODE,
        message: localizedMessage(INVALID_WINDOW_MESSAGES, lang),
      });
    }

    if (evaluation.allowed) {
      return {
        ...day,
        withinPlanningWindow: true,
        // Compatibility alias for existing Flutter builds that were released
        // while the planning horizon was tied to the menu week.
        withinCurrentMenuWeek: true,
        planningWindowReason: null,
        planningWindowStart: evaluation.planningWindowStart,
        planningWindowEnd: evaluation.planningWindowEnd,
      };
    }

    const annotated = {
      ...day,
      withinPlanningWindow: false,
      withinCurrentMenuWeek: false,
      planningWindowReason: evaluation.reason,
      planningWindowStart: evaluation.planningWindowStart,
      planningWindowEnd: evaluation.planningWindowEnd,
    };

    // Confirmed, fulfilled, frozen, skipped, and already-locked days remain visible
    // with their original operational status. Only a day the legacy timeline still
    // considered editable is converted into a read-only planning row.
    return lockEditableTimelineDay(annotated, {
      reason: evaluation.reason || PLANNING_WINDOW_REASONS.OUTSIDE_CURRENT_MENU_WEEK,
      message,
      evaluation,
    });
  });

  return {
    ...timeline,
    planningWindow: {
      version: TIMELINE_PLANNING_WINDOW_VERSION,
      enabled: true,
      available: planningWindow.hasSelectableDates,
      mode: planningWindow.mode,
      horizonDays: planningWindow.horizonDays,
      businessDate: planningWindow.businessDate,
      menuWeekStart: planningWindow.menuWeekStart,
      menuWeekEnd: planningWindow.menuWeekEnd,
      planningWindowStart: planningWindow.planningWindowStart,
      planningWindowEnd: planningWindow.planningWindowEnd,
      rollingWindowEnd: planningWindow.rollingWindowEnd,
      subscriptionStartDate: planningWindow.subscriptionStartDate,
      subscriptionValidityEndDate:
        planningWindow.subscriptionValidityEndDate,
    },
    days,
  };
}

function buildWeeklyTimelineBuilder(original) {
  if (typeof original !== "function") {
    throw new Error("Missing subscription timeline builder");
  }
  if (original[WRAPPER_MARKER]) return original;

  const wrapped = async function weeklyPlanningTimeline(
    subscriptionId,
    options = {}
  ) {
    if (!isWeeklyPlanningWindowEnabled()) {
      return original.call(timelineService, subscriptionId, options);
    }

    const businessDate = options.businessDate
      || await getRestaurantBusinessDate();
    const timeline = await original.call(timelineService, subscriptionId, {
      ...options,
      businessDate,
    });
    return projectTimelineToWeeklyPlanningWindow(timeline, {
      businessDate,
      lang: options.lang || "ar",
      enabled: true,
    });
  };

  Object.defineProperty(wrapped, WRAPPER_MARKER, { value: true });
  Object.defineProperty(wrapped, "__original", { value: original });
  return wrapped;
}

function projectTimelineResponsePayload(payload, {
  businessDate,
  lang,
} = {}) {
  if (
    !payload
    || typeof payload !== "object"
    || !payload.data
    || typeof payload.data !== "object"
  ) {
    return payload;
  }

  const projected = projectTimelineToWeeklyPlanningWindow(payload.data, {
    businessDate,
    lang,
    enabled: true,
  });
  if (projected === payload.data) return payload;
  return {
    ...payload,
    data: projected,
  };
}

function wrapTimelineControllerHandler() {
  const original = subscriptionController.getSubscriptionTimeline;
  if (typeof original !== "function") {
    throw new Error("subscriptionController.getSubscriptionTimeline is unavailable");
  }
  if (original[CONTROLLER_WRAPPER_MARKER]) return original;

  const wrapped = async function weeklyPlanningTimelineController(
    req,
    res,
    ...rest
  ) {
    if (!isWeeklyPlanningWindowEnabled()) {
      return original.call(this, req, res, ...rest);
    }

    const businessDate = await getRestaurantBusinessDate();
    const lang = getRequestLang(req);
    const originalJson = res.json;
    res.json = function weeklyPlanningTimelineJson(payload) {
      return originalJson.call(
        this,
        projectTimelineResponsePayload(payload, { businessDate, lang })
      );
    };

    try {
      return await original.call(this, req, res, ...rest);
    } finally {
      res.json = originalJson;
    }
  };

  Object.defineProperty(wrapped, CONTROLLER_WRAPPER_MARKER, { value: true });
  Object.defineProperty(wrapped, "__original", { value: original });
  subscriptionController.getSubscriptionTimeline = wrapped;
  return wrapped;
}

function installSubscriptionWeeklyPlanningWindow() {
  const current = globalThis[STATE_KEY];
  if (current && current.status === "installed") return current;

  const state = {
    status: "installing",
    installedAt: null,
  };
  globalThis[STATE_KEY] = state;

  try {
    const wrappedTimelineBuilder = buildWeeklyTimelineBuilder(
      timelineService.buildSubscriptionTimeline
    );
    timelineService.buildSubscriptionTimeline = wrappedTimelineBuilder;

    // subscriptionService may already be cached by another installer and may
    // still expose the pre-decoration function. Rebind the public facade before
    // route modules capture it.
    subscriptionService.buildSubscriptionTimeline = wrappedTimelineBuilder;

    // Some controller-composition installers intentionally preload the public
    // controller. Protect that case at the final JSON boundary without changing
    // its ownership checks, localization, or error handling.
    const timelineController = wrapTimelineControllerHandler();

    Object.assign(state, {
      status: "installed",
      installedAt: new Date(),
      flag: "SUBSCRIPTION_WEEKLY_PLANNING_WINDOW_ENABLED",
      defaultEnabled: false,
      timelineProjection: true,
      serviceFacadeRebound: true,
      controllerResponseBoundary: true,
      timelineController,
    });
    return state;
  } catch (error) {
    state.status = "failed";
    state.errorCode =
      error && error.code
        ? error.code
        : "SUBSCRIPTION_WEEKLY_PLANNING_WINDOW_INSTALL_FAILED";
    state.errorMessage = error && error.message
      ? error.message
      : String(error);
    throw error;
  }
}

installSubscriptionWeeklyPlanningWindow();

module.exports = {
  CONTROLLER_WRAPPER_MARKER,
  LOCKED_MESSAGES,
  STATE_KEY,
  TIMELINE_PLANNING_WINDOW_VERSION,
  buildWeeklyTimelineBuilder,
  installSubscriptionWeeklyPlanningWindow,
  lockEditableTimelineDay,
  projectTimelineResponsePayload,
  projectTimelineToWeeklyPlanningWindow,
  wrapTimelineControllerHandler,
};
