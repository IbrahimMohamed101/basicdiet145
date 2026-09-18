"use strict";

const crypto = require("node:crypto");

const Subscription = require("../models/Subscription");
const subscriptionActivationService = require("./subscription/subscriptionActivationService");
const {
  activatePaidDraftIntoExistingContainerStandalone,
  activatePinnedExtrasPaidDraftIntoExistingContainerTransactional,
} = require("./subscription/subscriptionStackingActivationService");
const {
  materializeStackingSubscriptionDaysIdempotent,
  materializeStackingSubscriptionDaysTransactional,
} = require("./subscription/subscriptionStackingDayMaterializationService");
const {
  attachPinnedExtraActivationSnapshot,
} = require("./subscription/subscriptionStackingExtraActivationAuthorityService");
const {
  getRestaurantBusinessDate,
} = require("./restaurantHoursService");
const {
  ensureBatchByPayload,
} = require("./subscription/subscriptionEntitlementBatchPersistenceService");

const INSTALL_FLAG = Symbol.for(
  "basicdiet.dashboardSubscriptionStackingFlow.installed"
);

function resolveDashboardSubscriptionMode(contract) {
  const snapshot = contract && contract.contractSnapshot && typeof contract.contractSnapshot === "object"
    ? contract.contractSnapshot
    : {};
  const meta = snapshot.meta && typeof snapshot.meta === "object"
    ? snapshot.meta
    : {};
  const raw =
    contract && contract.dashboardSubscriptionMode
      ? contract.dashboardSubscriptionMode
      : meta.dashboardSubscriptionMode;
  if (raw === "standalone") return "standalone";
  if (raw === "stack_into_current") return "stack_into_current";
  return "legacy";
}

function isDashboardDirectContract(contract) {
  const snapshot = contract && contract.contractSnapshot;
  return Boolean(
    contract
      && (
        contract.contractSource === "admin_create"
        || (snapshot && snapshot.meta && snapshot.meta.source === "admin_create")
      )
  );
}

function hasActiveTransaction(session) {
  return Boolean(
    session
      && session.supportsTransactions !== false
      && typeof session.inTransaction === "function"
      && session.inTransaction()
  );
}

function buildDashboardPurchaseDraft({
  userId,
  planId,
  contract,
  subscriptionPayload,
  activeSubscriptionId,
} = {}) {
  const snapshot = contract && contract.contractSnapshot && typeof contract.contractSnapshot === "object"
    ? contract.contractSnapshot
    : {};
  const plan = snapshot.plan && typeof snapshot.plan === "object"
    ? snapshot.plan
    : {};
  const entitlementContract = snapshot.entitlementContract
    && typeof snapshot.entitlementContract === "object"
    ? snapshot.entitlementContract
    : {};
  const premiumItems = Array.isArray(snapshot.premiumSelections)
    ? snapshot.premiumSelections
    : [];
  const addonSubscriptions = Array.isArray(entitlementContract.addonSubscriptions)
    ? entitlementContract.addonSubscriptions
    : [];
  const daysCount = Number(
    contract && contract.derivedFields && contract.derivedFields.daysCount
      || plan.daysCount
      || 0
  );
  const dashboardPurchaseId = subscriptionPayload && subscriptionPayload._id;
  if (!dashboardPurchaseId || !Number.isInteger(daysCount) || daysCount < 1) {
    const err = new Error("Dashboard stacking purchase identity is invalid");
    err.code = "DASHBOARD_STACKING_PURCHASE_INVALID";
    err.status = 422;
    throw err;
  }

  return {
    _id: dashboardPurchaseId,
    dashboardPurchaseId,
    sourceType: "dashboard",
    userId,
    planId,
    daysCount,
    startDate: subscriptionPayload.startDate,
    premiumItems,
    addonSubscriptions,
    contractSnapshot: subscriptionPayload.contractSnapshot || snapshot,
    stackingFinalization: attachPinnedExtraActivationSnapshot(
      {
        mode: "dashboard_additive",
        targetSubscriptionId: String(activeSubscriptionId),
      },
      {
        premiumItems,
        addonSubscriptions,
        daysCount,
      }
    ),
  };
}

function dashboardBatchRuntime(dashboardPurchaseId) {
  const sourceKey = `dashboard:${String(dashboardPurchaseId)}`;
  return {
    ensureBatchByPayload({ payload, session }) {
      if (!payload || String(payload.sourceType || "") === "legacy_seed") {
        return ensureBatchByPayload({ payload, session });
      }
      return ensureBatchByPayload({
        payload: {
          ...payload,
          checkoutDraftId: null,
          sourceKey,
          sourceType: "dashboard",
          metadata: {
            ...(payload.metadata || {}),
            dashboardPurchaseId: String(dashboardPurchaseId),
          },
        },
        session,
      });
    },
  };
}

async function acquireStandaloneLease({
  containerId,
  userId,
  sourceKey,
  session,
  now = new Date(),
} = {}) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + 30 * 1000);
  const leased = await Subscription.findOneAndUpdate(
    {
      _id: containerId,
      userId,
      status: "active",
      $or: [
        { "stackingActivationLease.expiresAt": null },
        { "stackingActivationLease.expiresAt": { $exists: false } },
        { "stackingActivationLease.expiresAt": { $lte: now } },
      ],
    },
    {
      $set: {
        stackingActivationLease: {
          token,
          sourceKey,
          acquiredAt: now,
          expiresAt,
        },
      },
    },
    { new: true, ...(session ? { session } : {}) }
  );
  if (!leased) {
    const err = new Error("Another subscription is being added to this customer");
    err.code = "STACKING_ACTIVATION_BUSY";
    err.status = 409;
    err.retryable = true;
    throw err;
  }
  return token;
}

async function releaseStandaloneLease({
  containerId,
  token,
  session,
} = {}) {
  if (!containerId || !token) return;
  await Subscription.updateOne(
    {
      _id: containerId,
      "stackingActivationLease.token": token,
    },
    {
      $set: {
        stackingActivationLease: {
          token: "",
          sourceKey: "",
          acquiredAt: null,
          expiresAt: null,
        },
      },
      $inc: { stackingRevision: 1 },
    },
    session ? { session } : undefined
  );
}

async function activateDashboardPurchaseIntoExistingContainer({
  userId,
  planId,
  contract,
  legacyRuntimeData,
  session,
} = {}) {
  let activeQuery = Subscription.findOne({
    userId,
    status: "active",
  }).sort({ createdAt: -1 });
  if (session) activeQuery = activeQuery.session(session);
  const activeContainer = await activeQuery;
  if (!activeContainer) return null;

  const { subscriptionPayload } =
    subscriptionActivationService.buildCanonicalContractActivationPayload({
      userId,
      planId,
      contract,
      legacyRuntimeData,
    });
  const draft = buildDashboardPurchaseDraft({
    userId,
    planId,
    contract,
    subscriptionPayload,
    activeSubscriptionId: activeContainer._id,
  });
  const payment = {
    status: "paid",
    userId,
  };
  const businessDate = await getRestaurantBusinessDate();
  const now = new Date();

  if (hasActiveTransaction(session)) {
    const result =
      await activatePinnedExtrasPaidDraftIntoExistingContainerTransactional({
        draft,
        payment,
        subscriptionPayload,
        businessDate,
        session,
        expectedParentSubscriptionId: activeContainer._id,
        now,
        deferDocumentFinalization: true,
        runtime: dashboardBatchRuntime(draft.dashboardPurchaseId),
      });
    await materializeStackingSubscriptionDaysTransactional({
      container: result.container,
      batch: result.purchaseBatch,
      session,
    });
    return result.container;
  }

  const sourceKey = `dashboard:${String(draft.dashboardPurchaseId)}`;
  const leaseToken = await acquireStandaloneLease({
    containerId: activeContainer._id,
    userId,
    sourceKey,
    session,
    now,
  });
  try {
    const result = await activatePaidDraftIntoExistingContainerStandalone({
      draft,
      payment,
      subscriptionPayload,
      businessDate,
      session,
      expectedParentSubscriptionId: activeContainer._id,
      now,
      seedExtraWallets: true,
      runtime: dashboardBatchRuntime(draft.dashboardPurchaseId),
    });
    await materializeStackingSubscriptionDaysIdempotent({
      container: result.container,
      batch: result.purchaseBatch,
      session,
    });
    return result.container;
  } finally {
    await releaseStandaloneLease({
      containerId: activeContainer._id,
      token: leaseToken,
      session,
    });
  }
}

function install() {
  if (globalThis[INSTALL_FLAG]) return;
  globalThis[INSTALL_FLAG] = true;

  const originalActivate =
    subscriptionActivationService.activateSubscriptionFromCanonicalContract;

  subscriptionActivationService.activateSubscriptionFromCanonicalContract =
    async function activateWithDashboardStacking(args) {
      const input = args && typeof args === "object" ? args : {};
      if (!isDashboardDirectContract(input.contract)) {
        return originalActivate(args);
      }

      const mode = resolveDashboardSubscriptionMode(input.contract);
      if (mode === "standalone") {
        let activeQuery = Subscription.findOne({
          userId: input.userId,
          status: "active",
        }).sort({ createdAt: -1 });
        if (input.session) activeQuery = activeQuery.session(input.session);
        const activeSubscription = await activeQuery.lean();
        if (activeSubscription) {
          const err = new Error(
            "Cannot create a standalone subscription while the customer has an active subscription. Choose stack_into_current to add this purchase to the existing balance."
          );
          err.code = "STANDALONE_ACTIVE_SUBSCRIPTION_CONFLICT";
          err.status = 409;
          err.details = {
            activeSubscriptionId: String(activeSubscription._id),
          };
          throw err;
        }
        return originalActivate(args);
      }

      const stacked = await activateDashboardPurchaseIntoExistingContainer({
        userId: input.userId,
        planId: input.planId,
        contract: input.contract,
        legacyRuntimeData: input.legacyRuntimeData || {},
        session: input.session || null,
      });
      if (stacked) return stacked;
      if (mode === "stack_into_current") {
        const err = new Error(
          "Cannot add the purchase to the current balance because the customer has no active subscription."
        );
        err.code = "STACK_TARGET_NOT_FOUND";
        err.status = 409;
        throw err;
      }

      return originalActivate(args);
    };
}

install();

module.exports = {
  activateDashboardPurchaseIntoExistingContainer,
  buildDashboardPurchaseDraft,
  dashboardBatchRuntime,
  hasActiveTransaction,
  install,
  isDashboardDirectContract,
  resolveDashboardSubscriptionMode,
};
