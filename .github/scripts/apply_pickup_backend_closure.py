from pathlib import Path
import json


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"missing patch target in {path}: {old[:180]!r}")
    p.write_text(text.replace(old, new, 1))


def replace_between(path, start_marker, end_marker, replacement):
    p = Path(path)
    text = p.read_text()
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"missing start marker in {path}: {start_marker!r}")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"missing end marker in {path}: {end_marker!r}")
    p.write_text(text[:start] + replacement + text[end:])


# 1) Replace the fragile linked-day claiming and cancellation semantics.
path = "src/services/subscription/subscriptionPickupRequestBalanceService.js"
replace_once(
    path,
    '''const {
  reservePickupEntitlements,
  transitionPickupEntitlements,
} = require("./subscriptionMealEntitlementService");''',
    '''const {
  reservePickupEntitlements,
  transitionPickupEntitlements,
} = require("./subscriptionMealEntitlementService");
const {
  claimLinkedDayAllocations: claimLinkedDayAllocationsReconciled,
  releasePickupAllocationsForRequest,
} = require("./pickupEntitlementLinkService");'''
)
replace_between(
    path,
    "async function claimLinkedDayAllocations({",
    "async function cleanupReservationAttempt({",
    '''async function claimLinkedDayAllocations(args = {}) {
  return claimLinkedDayAllocationsReconciled(args);
}

'''
)
replace_once(
    path,
    '''          baseAllocationKeys: reservation.allocationKeys,
        },''',
    '''          baseAllocationKeys: reservation.allocationKeys,
          baseAllocationMode: linkedDayClaim.hasLinkedDayAllocations ? "linked_day" : "standalone",
        },'''
)
replace_between(
    path,
    "async function releaseReservedPickupMeals({",
    "module.exports = {",
    '''async function releaseReservedPickupMeals({
  subscriptionId,
  pickupRequestId,
  session = null,
} = {}) {
  if (!subscriptionId) {
    throw createServiceError("INVALID_ARGUMENTS", "subscriptionId is required", 400);
  }

  const now = new Date();
  const existing = await findPickupRequestOrThrow(pickupRequestId, session);
  if (String(existing.subscriptionId) !== String(subscriptionId)) {
    throw createServiceError("SUBSCRIPTION_MISMATCH", "Pickup request does not belong to subscription", 400);
  }
  if (existing.creditsReleasedAt) {
    return {
      released: false,
      alreadyReleased: true,
      pickupRequest: existing,
      mealCount: Number(existing.mealCount || 0),
    };
  }
  if (existing.creditsConsumedAt) {
    throw createServiceError("CREDITS_CONSUMED", "Reserved pickup meals were already consumed", 409);
  }
  if (!existing.creditsReserved) {
    throw createServiceError("CREDITS_NOT_RESERVED", "Pickup request meals are not reserved", 409);
  }

  if (Number(existing.mealCount || 0) === 0) {
    existing.creditsReleasedAt = now;
    existing.baseAllocationMode = "none";
    await existing.save(withOptionalSession({}, session));
    return buildZeroMealResult("released", existing);
  }

  const allocationKeys = Array.isArray(existing.baseAllocationKeys)
    ? existing.baseAllocationKeys
    : [];
  const allocationRelease = allocationKeys.length
    ? await releasePickupAllocationsForRequest({
      subscriptionId,
      pickupRequest: existing,
      session,
    })
    : { mode: existing.baseAllocationMode || "none", changedCount: 0 };

  const releasedPickupRequest = await SubscriptionPickupRequest.findOneAndUpdate(
    {
      _id: pickupRequestId,
      subscriptionId,
      creditsReserved: true,
      creditsConsumedAt: null,
      creditsReleasedAt: null,
    },
    {
      $set: {
        creditsReleasedAt: now,
        baseAllocationMode: allocationRelease.mode,
      },
    },
    withOptionalSession({ new: true }, session)
  );

  if (!releasedPickupRequest) {
    const current = await findPickupRequestOrThrow(pickupRequestId, session);
    if (current.creditsReleasedAt) {
      return {
        released: false,
        alreadyReleased: true,
        pickupRequest: current,
        mealCount: Number(current.mealCount || 0),
      };
    }
    if (current.creditsConsumedAt) {
      throw createServiceError("CREDITS_CONSUMED", "Reserved pickup meals were already consumed", 409);
    }
    throw createServiceError("INVALID_PICKUP_REQUEST_STATE", "Pickup request cannot be released", 409);
  }

  const mealCount = Number(releasedPickupRequest.mealCount || 0);
  assertPositiveMealCount(mealCount);

  // Historical pickup requests created before allocation keys existed directly
  // decremented remainingMeals. Preserve that one legacy refund path only.
  if (allocationKeys.length === 0) {
    await Subscription.updateOne(
      { _id: subscriptionId },
      { $inc: { remainingMeals: mealCount } },
      withOptionalSession({}, session)
    );
  }

  return {
    released: true,
    alreadyReleased: false,
    pickupRequest: releasedPickupRequest,
    mealCount,
    allocationMode: allocationRelease.mode,
  };
}

'''
)

# 2) Make availability use the same entitlement state as creation.
path = "src/services/subscription/subscriptionPickupRequestClientService.js"
replace_once(
    path,
    '''} = require("./subscriptionPickupSlotService");''',
    '''} = require("./subscriptionPickupSlotService");
const {
  applyEntitlementAvailability,
} = require("./pickupEntitlementLinkService");'''
)
replace_once(
    path,
    '''  const fullAvailability = buildAvailabilityFromDay({
    day,
    pickupRequests,
    subscription,
    catalogMaps,
    addonChoiceGroups,
  });
  const availability = filterAvailabilityForVisibility(fullAvailability, { includeUnavailable, includeHistory });''',
    '''  let fullAvailability = buildAvailabilityFromDay({
    day,
    pickupRequests,
    subscription,
    catalogMaps,
    addonChoiceGroups,
  });
  fullAvailability = applyEntitlementAvailability({
    availability: fullAvailability,
    subscription,
    day,
    pickupRequests,
  });
  const availability = filterAvailabilityForVisibility(fullAvailability, { includeUnavailable, includeHistory });'''
)

# 3) Close direct slot-service gaps even when the canonical installer is absent.
path = "src/services/subscription/subscriptionPickupSlotService.js"
replace_once(
    path,
    '''  if (type === "standard_meal" || type === "basic_meal") return "meal";''',
    '''  if (["standard_meal", "basic_meal", "full_meal_product"].includes(type)) return "meal";'''
)
replace_once(
    path,
    '''    mealCreditCount: normalizedIds.filter((id) => {
      const item = byId.get(id);
      return item && ["meal", "premium_meal"].includes(item.itemType);
    }).length,''',
    '''    mealCreditCount: normalizedIds.filter((id) => {
      const item = byId.get(id);
      return item
        && item.slotId
        && ["meal", "premium_meal", "large_salad", "sandwich"].includes(item.itemType);
    }).length,'''
)
replace_once(
    path,
    '''  buildAvailabilityFromDay,
  buildPickupRequestPayloadHash,''',
    '''  buildAvailabilityFromDay,
  buildPickupItemFromSlot,
  buildPickupRequestPayloadHash,'''
)
replace_once(
    path,
    '''  filterAvailabilityForVisibility,
  normalizeSelectedMealSlotIds,''',
    '''  filterAvailabilityForVisibility,
  itemTypeForSelectionType,
  normalizeSelectedMealSlotIds,'''
)

# 4) Return stable bilingual pickup errors instead of raw internal English.
path = "src/controllers/subscriptionController.js"
insert = '''const PICKUP_REQUEST_ERROR_COPY = Object.freeze({
  MEAL_SLOT_UNAVAILABLE: {
    ar: "تعذر حجز الوجبة المحددة للاستلام. حدّث اختيارات اليوم ثم حاول مرة أخرى.",
    en: "The selected meal could not be reserved for pickup. Refresh today's choices and try again.",
  },
  PICKUP_ITEM_UNAVAILABLE: {
    ar: "العنصر المحدد غير متاح للاستلام الآن.",
    en: "The selected item is not currently available for pickup.",
  },
  INSUFFICIENT_CREDITS: {
    ar: "رصيد الوجبات غير كافٍ لإتمام طلب الاستلام.",
    en: "There are not enough meal credits to create this pickup request.",
  },
  PREMIUM_PAYMENT_REQUIRED: {
    ar: "يجب إتمام دفع ترقية الوجبة أولاً.",
    en: "The premium meal upgrade must be paid first.",
  },
  ADDON_PAYMENT_REQUIRED: {
    ar: "يجب إتمام دفع الإضافات أولاً.",
    en: "The add-ons must be paid first.",
  },
  INVALID_DATE: {
    ar: "تاريخ طلب الاستلام غير صالح.",
    en: "The pickup request date is invalid.",
  },
  INVALID_DELIVERY_MODE: {
    ar: "هذا الاشتراك غير مضبوط على الاستلام من الفرع.",
    en: "This subscription is not configured for branch pickup.",
  },
  INTERNAL: {
    ar: "تعذر إتمام طلب الاستلام بسبب خطأ داخلي. حاول مرة أخرى.",
    en: "The pickup request could not be completed because of an internal error. Try again.",
  },
});

function resolvePickupRequestErrorPayload(err, req) {
  const code = err && err.code ? String(err.code) : "INTERNAL";
  const fromDetails = err && err.details && err.details.messageI18n;
  const fallback = PICKUP_REQUEST_ERROR_COPY[code]
    || (code === "INTERNAL"
      ? PICKUP_REQUEST_ERROR_COPY.INTERNAL
      : { ar: err && err.message || "تعذر إتمام طلب الاستلام", en: err && err.message || "Failed to create pickup request" });
  const messageI18n = fromDetails && typeof fromDetails === "object" ? fromDetails : fallback;
  return {
    message: pickLang(messageI18n, getRequestLang(req)) || fallback.en,
    details: {
      ...(err && err.details && typeof err.details === "object" ? err.details : {}),
      messageI18n,
      messageAr: messageI18n.ar || messageI18n.en || "",
      messageEn: messageI18n.en || messageI18n.ar || "",
    },
  };
}

'''
replace_once(path, "function resolvePickupRequestErrorStatus(err) {", insert + "function resolvePickupRequestErrorStatus(err) {")
replace_once(
    path,
    '''  } catch (err) {
    return errorResponse(
      res,
      resolvePickupRequestErrorStatus(err),
      err.code || "INTERNAL",
      err.message || "Failed to create pickup request",
      err.details
    );
  }
}

async function getPickupAvailability''',
    '''  } catch (err) {
    const localized = resolvePickupRequestErrorPayload(err, req);
    return errorResponse(
      res,
      resolvePickupRequestErrorStatus(err),
      err.code || "INTERNAL",
      localized.message,
      localized.details
    );
  }
}

async function getPickupAvailability'''
)
replace_once(
    path,
    '''  } catch (err) {
    return errorResponse(
      res,
      resolvePickupRequestErrorStatus(err),
      err.code || "INTERNAL",
      err.message || "Failed to get pickup availability",
      err.details
    );
  }
}

async function listPickupRequests''',
    '''  } catch (err) {
    const localized = resolvePickupRequestErrorPayload(err, req);
    return errorResponse(
      res,
      resolvePickupRequestErrorStatus(err),
      err.code || "INTERNAL",
      localized.message,
      localized.details
    );
  }
}

async function listPickupRequests'''
)

# 5) Fix recursion at the source and remove the runtime monkey-patch guard.
path = "src/services/subscription/pickupCanonicalPresentationService.js"
replace_once(
    path,
    '''function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function asId(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value && typeof value === "object" && value._id) return asId(value._id);
  const text = clean(value);
  return text || null;
}

function pair(value, fallback = null) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const nested = value.nameI18n || value.titleI18n || value.name || value.title || value.labelI18n || value.label;
    if (nested && nested !== value) return pair(nested, fallback);
    const ar = clean(value.ar || value.nameAr || value.titleAr || value.arabic);
    const en = clean(value.en || value.nameEn || value.titleEn || value.english);
    if (ar || en) return { ar: ar || en, en: en || ar };
  }
  const text = clean(value || fallback);
  return { ar: text, en: text };
}''',
    '''function clean(value) {
  if (value === undefined || value === null) return "";
  try {
    return String(value).trim();
  } catch (_err) {
    return "";
  }
}

function asId(value, seen = new WeakSet()) {
  if (value === undefined || value === null || value === "") return null;
  if (value && typeof value === "object") {
    if (typeof value.toHexString === "function") {
      try {
        const hex = clean(value.toHexString());
        if (hex) return hex;
      } catch (_err) {
        // Continue through guarded fallback handling.
      }
    }
    if (seen.has(value)) return null;
    seen.add(value);
    let nestedId;
    try {
      nestedId = value._id;
    } catch (_err) {
      nestedId = null;
    }
    if (nestedId !== undefined && nestedId !== null && nestedId !== value) {
      return asId(nestedId, seen);
    }
  }
  const text = clean(value);
  return text || null;
}

function pair(value, fallback = null, seen = new WeakSet()) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (seen.has(value)) {
      const fallbackText = clean(fallback);
      return { ar: fallbackText, en: fallbackText };
    }
    seen.add(value);
    const nested = value.nameI18n || value.titleI18n || value.name || value.title || value.labelI18n || value.label;
    if (nested && nested !== value) return pair(nested, fallback, seen);
    const ar = clean(value.ar || value.nameAr || value.titleAr || value.arabic);
    const en = clean(value.en || value.nameEn || value.titleEn || value.english);
    if (ar || en) return { ar: ar || en, en: en || ar };
  }
  const text = clean(value || fallback);
  return { ar: text, en: text };
}'''
)

path = "src/utils/subscriptionBilingualResponse.js"
replace_once(
    path,
    '''function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}''',
    '''function cleanText(value) {
  if (value === undefined || value === null) return "";
  try {
    return String(value).trim();
  } catch (_err) {
    return "";
  }
}'''
)
replace_once(
    path,
    '''function walk(value, lang, parentKey = "") {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, lang, parentKey));
    return value;
  }
  if (!value || typeof value !== "object") return value;
  normalizeNamedObject(value, lang);
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object") {
      if (!Array.isArray(child) && Array.isArray(child.choices)) normalizeCategoryGroup(child, key, lang);
      walk(child, lang, key);
    }
  }
  return value;
}''',
    '''function isTraversableObject(value) {
  if (!value || typeof value !== "object") return false;
  if (value instanceof Date || Buffer.isBuffer(value)) return false;
  if (typeof value.toHexString === "function") return false;
  return true;
}

function walk(value, lang, parentKey = "", visited = new WeakSet()) {
  if (Array.isArray(value)) {
    if (visited.has(value)) return value;
    visited.add(value);
    value.forEach((item) => walk(item, lang, parentKey, visited));
    return value;
  }
  if (!isTraversableObject(value) || visited.has(value)) return value;
  visited.add(value);
  normalizeNamedObject(value, lang);
  for (const [key, child] of Object.entries(value)) {
    if (isTraversableObject(child) || Array.isArray(child)) {
      if (!Array.isArray(child) && Array.isArray(child.choices)) normalizeCategoryGroup(child, key, lang);
      walk(child, lang, key, visited);
    }
  }
  return value;
}'''
)

path = "src/services/installPickupCanonicalContract.js"
replace_once(
    path,
    '''function pair(value, fallback = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const nested = value.nameI18n || value.titleI18n || value.name || value.title || value.labelI18n || value.label;
    if (nested && nested !== value) return pair(nested, fallback);
    const ar = clean(value.ar || value.nameAr || value.titleAr || value.arabic);
    const en = clean(value.en || value.nameEn || value.titleEn || value.english);
    if (ar || en) return { ar: ar || en, en: en || ar };
  }
  const text = clean(value || fallback);
  return { ar: text, en: text };
}''',
    '''function pair(value, fallback = "", seen = new WeakSet()) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (seen.has(value)) {
      const fallbackText = clean(fallback);
      return { ar: fallbackText, en: fallbackText };
    }
    seen.add(value);
    const nested = value.nameI18n || value.titleI18n || value.name || value.title || value.labelI18n || value.label;
    if (nested && nested !== value) return pair(nested, fallback, seen);
    const ar = clean(value.ar || value.nameAr || value.titleAr || value.arabic);
    const en = clean(value.en || value.nameEn || value.titleEn || value.english);
    if (ar || en) return { ar: ar || en, en: en || ar };
  }
  const text = clean(value || fallback);
  return { ar: text, en: text };
}'''
)

path = "src/services/installSubscriptionDayFullMealCompatibility.js"
replace_once(path, 'require("./installPickupCanonicalRuntimeGuard");\n', '')
for obsolete in [
    Path("src/services/installPickupCanonicalRuntimeGuard.js"),
    Path("tests/pickupCanonicalRuntimeGuard.test.js"),
]:
    if obsolete.exists():
        obsolete.unlink()

# 6) Add local commands and make the closure suite a release gate.
p = Path("package.json")
package = json.loads(p.read_text())
scripts = package["scripts"]
scripts["diagnose:pickup-entitlements"] = "node scripts/diagnose-pickup-entitlements.js"
scripts["test:pickup-backend-closure"] = "NODE_ENV=test node tests/pickupEntitlementLinkPolicy.test.js && NODE_ENV=test node tests/pickupAvailabilityEntitlementParity.test.js && NODE_ENV=test node tests/pickupEntitlementLifecycle.integration.test.js && NODE_ENV=test node tests/pickupCanonicalObjectId.test.js && npm run test:subscription-bilingual"
if "npm run test:pickup-backend-closure" not in scripts["test:release-gates"]:
    scripts["test:release-gates"] = scripts["test:release-gates"].replace(
        "npm run test:subscription-bilingual &&",
        "npm run test:subscription-bilingual && npm run test:pickup-backend-closure &&",
        1,
    )
p.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n")

print("pickup backend closure patch applied")
