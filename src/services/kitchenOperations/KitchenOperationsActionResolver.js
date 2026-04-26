"use strict";

function buildAction({
  key,
  label,
  endpoint,
  enabled = true,
  variant = "secondary",
  requiresConfirmation = false,
  confirmationMessage = null,
}) {
  return {
    key,
    label,
    method: "POST",
    endpoint,
    enabled: Boolean(enabled),
    variant,
    confirm: Boolean(requiresConfirmation),
    requiresConfirmation: Boolean(requiresConfirmation),
    confirmationMessage: requiresConfirmation ? confirmationMessage || label : null,
  };
}

function resolveSubscriptionActions(row) {
  const { meta, rawStatus, mode, badges, operationFlags } = row;
  const subscriptionId = meta.subscriptionId;
  const date = row.date;
  const dayId = meta.dayId;
  const canPrepare = row.items.length > 0;

  switch (rawStatus) {
    case "open":
      return row.items.length > 0
        ? [buildAction({
          key: "lock",
          label: "قفل اليوم",
          endpoint: `/api/kitchen/subscriptions/${subscriptionId}/days/${date}/lock`,
          variant: "primary",
        })]
        : [];
    case "locked": {
      const actions = [];
      const pickupOperationalReady = mode !== "pickup" || badges.pickupRequested;
      actions.push(buildAction({
        key: "reopen",
        label: "إعادة فتح",
        endpoint: `/api/kitchen/subscriptions/${subscriptionId}/days/${date}/reopen`,
        enabled: !badges.pickupRequested && !operationFlags.creditsDeducted,
        variant: "secondary",
        requiresConfirmation: true,
        confirmationMessage: "هل أنت متأكد من إعادة فتح هذا اليوم؟",
      }));
      actions.push(buildAction({
        key: "start_preparation",
        label: "بدء التحضير",
        endpoint: `/api/kitchen/subscriptions/${subscriptionId}/days/${date}/in-preparation`,
        enabled: canPrepare && pickupOperationalReady,
        variant: "primary",
      }));
      if (mode === "pickup") {
        actions.push(buildAction({
          key: "ready_for_pickup",
          label: "جاهز للاستلام",
          endpoint: `/api/kitchen/subscriptions/${subscriptionId}/days/${date}/ready-for-pickup`,
          enabled: false,
          variant: "primary",
        }));
        actions.push(buildAction({
          key: "cancel_at_branch",
          label: "إلغاء من الفرع",
          endpoint: `/api/kitchen/subscriptions/${subscriptionId}/days/${date}/cancel-at-branch`,
          variant: "danger",
          requiresConfirmation: true,
          confirmationMessage: "هل أنت متأكد من إلغاء هذا الطلب من الفرع؟",
        }));
      } else {
        actions.push(buildAction({
          key: "out_for_delivery",
          label: "خرج للتوصيل",
          endpoint: `/api/kitchen/subscriptions/${subscriptionId}/days/${date}/out-for-delivery`,
          variant: "primary",
        }));
      }
      return actions;
    }
    case "in_preparation":
      if (mode === "pickup") {
      return [
        buildAction({
          key: "ready_for_pickup",
          label: "جاهز للاستلام",
          endpoint: `/api/kitchen/subscriptions/${subscriptionId}/days/${date}/ready-for-pickup`,
          enabled: canPrepare && badges.pickupRequested,
          variant: "primary",
        }),
        buildAction({
          key: "cancel_at_branch",
          label: "إلغاء من الفرع",
          endpoint: `/api/kitchen/subscriptions/${subscriptionId}/days/${date}/cancel-at-branch`,
          variant: "danger",
          requiresConfirmation: true,
          confirmationMessage: "هل أنت متأكد من إلغاء هذا الطلب من الفرع؟",
        }),
      ];
      }
      return [
        buildAction({
          key: "out_for_delivery",
          label: "خرج للتوصيل",
          endpoint: `/api/kitchen/subscriptions/${subscriptionId}/days/${date}/out-for-delivery`,
          variant: "primary",
        }),
      ];
    case "ready_for_pickup":
      return [
        buildAction({
          key: "verify_pickup",
          label: "تحقق الاستلام",
          endpoint: `/api/kitchen/pickups/${dayId}/verify`,
          enabled: operationFlags.pickupCodeIssued && !operationFlags.pickupVerified,
          variant: "primary",
        }),
        buildAction({
          key: "fulfill_pickup",
          label: "تأكيد الاستلام",
          endpoint: `/api/kitchen/subscriptions/${subscriptionId}/days/${date}/fulfill-pickup`,
          enabled: !operationFlags.pickupCodeIssued || operationFlags.pickupVerified,
          variant: "primary",
          requiresConfirmation: true,
          confirmationMessage: "هل أنت متأكد من تأكيد استلام الطلب؟",
        }),
        buildAction({
          key: "pickup_no_show",
          label: "لم يحضر",
          endpoint: `/api/kitchen/pickups/${dayId}/no-show`,
          variant: "danger",
          requiresConfirmation: true,
          confirmationMessage: "هل تريد تسجيل العميل كعدم حضور؟",
        }),
        buildAction({
          key: "cancel_at_branch",
          label: "إلغاء من الفرع",
          endpoint: `/api/kitchen/subscriptions/${subscriptionId}/days/${date}/cancel-at-branch`,
          variant: "danger",
          requiresConfirmation: true,
          confirmationMessage: "هل أنت متأكد من إلغاء هذا الطلب من الفرع؟",
        }),
      ];
    default:
      return [];
  }
}

function resolveOrderActions(row) {
  const { rawStatus, mode, meta } = row;
  const orderId = meta.orderId;

  switch (rawStatus) {
    case "confirmed":
      return [
        buildAction({
          key: "start_preparation",
          label: "بدء التحضير",
          endpoint: `/api/kitchen/orders/${orderId}/preparing`,
          enabled: row.items.length > 0,
          variant: "primary",
        }),
      ];
    case "preparing":
      if (mode === "pickup") {
        return [
          buildAction({
            key: "ready_for_pickup",
            label: "جاهز للاستلام",
            endpoint: `/api/kitchen/orders/${orderId}/ready-for-pickup`,
            variant: "primary",
          }),
          buildAction({
            key: "fulfilled",
            label: "تم التسليم",
            endpoint: `/api/kitchen/orders/${orderId}/fulfilled`,
            variant: "primary",
            requiresConfirmation: true,
            confirmationMessage: "هل أنت متأكد من تسليم الطلب؟",
          }),
        ];
      }
      return [
        buildAction({
          key: "out_for_delivery",
          label: "خرج للتوصيل",
          endpoint: `/api/kitchen/orders/${orderId}/out-for-delivery`,
          variant: "primary",
        }),
      ];
    case "ready_for_pickup":
      return [
        buildAction({
          key: "fulfilled",
          label: "تم التسليم",
          endpoint: `/api/kitchen/orders/${orderId}/fulfilled`,
          variant: "primary",
          requiresConfirmation: true,
          confirmationMessage: "هل أنت متأكد من تسليم الطلب؟",
        }),
      ];
    default:
      return [];
  }
}

function resolveActions(row) {
  if (!row || !row.meta) return [];
  if (row.entityType === "order") {
    return resolveOrderActions(row);
  }
  return resolveSubscriptionActions(row);
}

module.exports = {
  resolveActions,
};
