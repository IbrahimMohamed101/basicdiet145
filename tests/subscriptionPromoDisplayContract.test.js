process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  buildDiscountLabel,
  getAppPromoSelectionIssues,
  readSelectedPromoCodeId,
  resolvePublicSubscriptionPromoOffer,
  setSelectedAppPromoCode,
  serializePublicSubscriptionPromoOffer,
  selectPublicSubscriptionPromoOffer,
} = require("../src/services/subscriptionPromoDisplayService");
const PromoCode = require("../src/models/PromoCode");
const Setting = require("../src/models/Setting");
const {
  normalizePromoPayload,
  serializePromoCodeForAdmin,
} = require("../src/services/promoCodeService");

function promo(overrides = {}) {
  return {
    _id: "promo-1",
    code: "save20",
    isActive: true,
    appliesTo: "subscription",
    discountType: "percentage",
    discountValue: 20,
    currency: "SAR",
    startsAt: null,
    expiresAt: null,
    usageLimitTotal: null,
    usageLimitPerUser: null,
    currentUsageCount: 0,
    allowedUserIds: [],
    firstPurchaseOnly: false,
    deletedAt: null,
    metadata: {
      name: { ar: "عرض", en: "Offer" },
      description: { ar: "وصف", en: "Description" },
    },
    appDisplay: {
      isVisible: true,
      showOnHome: true,
      showOnPlans: true,
      priority: 0,
      title: { ar: "وفّر", en: "Save" },
      description: { ar: "انسخ الكود", en: "Copy the code" },
      homeMessage: { ar: "اعرض الخطط", en: "View plans" },
    },
    ...overrides,
  };
}

async function main() {
  const objectId = "507f1f77bcf86cd799439011";
  assert.strictEqual(readSelectedPromoCodeId({ value: { promoCodeId: objectId } }), objectId);
  assert.strictEqual(readSelectedPromoCodeId({ value: objectId }), objectId);
  assert.strictEqual(readSelectedPromoCodeId({ value: { promoCodeId: null } }), null);
  assert.strictEqual(readSelectedPromoCodeId({ value: "not-an-id" }), null);

  const normalized = normalizePromoPayload({
    code: "save20",
    discountType: "percentage",
    discountValue: 20,
    appliesTo: "subscription",
    appDisplay: {
      isVisible: true,
      showOnHome: true,
      showOnPlans: true,
      priority: 10,
      title: { ar: " وفّر ", en: " Save " },
      description: { ar: " انسخ الكود ", en: " Copy the code " },
      homeMessage: { ar: " اعرض الخطط ", en: " View plans " },
    },
  });
  assert.deepStrictEqual(normalized.appDisplay, {
    isVisible: true,
    showOnHome: true,
    showOnPlans: true,
    priority: 10,
    title: { ar: "وفّر", en: "Save" },
    description: { ar: "انسخ الكود", en: "Copy the code" },
    homeMessage: { ar: "اعرض الخطط", en: "View plans" },
  });
  const adminDto = serializePromoCodeForAdmin({
    _id: "promo-admin",
    ...normalized,
  });
  assert.deepStrictEqual(adminDto.appDisplay, normalized.appDisplay);
  assert.throws(
    () => normalizePromoPayload({
      code: "ADDON",
      discountType: "percentage",
      discountValue: 10,
      appliesTo: "addon_plans",
      appDisplay: { isVisible: true, showOnHome: true, showOnPlans: true },
    }),
    (error) => error && error.code === "PROMO_INVALID_CONFIGURATION"
  );

  assert.deepStrictEqual(buildDiscountLabel(promo()), {
    ar: "خصم 20%",
    en: "20% OFF",
  });
  assert.deepStrictEqual(
    buildDiscountLabel(promo({ discountType: "fixed", discountValue: 5050 })),
    { ar: "خصم 50.5 ريال", en: "50.5 SAR OFF" }
  );

  const serialized = serializePublicSubscriptionPromoOffer(promo());
  assert.strictEqual(serialized.code, "SAVE20");
  assert.deepStrictEqual(serialized.discountLabel, { ar: "خصم 20%", en: "20% OFF" });
  assert.deepStrictEqual(serialized.title, { ar: "وفّر", en: "Save" });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(serialized, "discountValue"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(serialized, "usageLimitTotal"), false);

  assert.deepStrictEqual(getAppPromoSelectionIssues(promo()), []);
  assert.deepStrictEqual(
    getAppPromoSelectionIssues(promo({ isActive: false })),
    ["PROMO_INACTIVE"]
  );

  assert.strictEqual(await selectPublicSubscriptionPromoOffer([]), null);
  assert.strictEqual(
    await selectPublicSubscriptionPromoOffer([promo({ appDisplay: { isVisible: false } })]),
    null
  );
  assert.strictEqual(
    await selectPublicSubscriptionPromoOffer([promo({ code: "" })]),
    null
  );
  assert.strictEqual(
    await selectPublicSubscriptionPromoOffer([
      promo({ expiresAt: new Date("2026-01-01T00:00:00.000Z") }),
    ], { now: new Date("2026-08-23T00:00:00.000Z") }),
    null
  );
  assert.strictEqual(
    await selectPublicSubscriptionPromoOffer([
      promo({ allowedUserIds: ["user-1"] }),
    ], { userId: "user-2" }),
    null
  );

  const firstEligible = await selectPublicSubscriptionPromoOffer([
    promo({ _id: "hidden", appDisplay: { isVisible: false } }),
    promo({ _id: "visible", code: "VISIBLE10" }),
  ]);
  assert.strictEqual(firstEligible.id, "visible");
  assert.strictEqual(firstEligible.code, "VISIBLE10");

  const exhaustedForUser = await selectPublicSubscriptionPromoOffer([
    promo({ usageLimitPerUser: 1 }),
  ], {
    userId: "user-1",
    eligibility: {
      countPromoUsages: async () => 1,
      countSubscriptions: async () => 0,
    },
  });
  assert.strictEqual(exhaustedForUser, null);

  const originalSettingFindOne = Setting.findOne;
  const originalPromoFindOne = PromoCode.findOne;
  try {
    Setting.findOne = () => ({
      lean: async () => ({ value: { promoCodeId: objectId } }),
    });
    PromoCode.findOne = (query) => ({
      lean: async () => {
        assert.strictEqual(String(query._id), objectId);
        assert.strictEqual(query.deletedAt, null);
        return promo({ _id: objectId, code: "SELECTED20" });
      },
    });
    const selectedOffer = await resolvePublicSubscriptionPromoOffer();
    assert.strictEqual(selectedOffer.id, objectId);
    assert.strictEqual(selectedOffer.code, "SELECTED20");

    Setting.findOne = () => ({ lean: async () => null });
    PromoCode.findOne = () => {
      throw new Error("Promo lookup must not run without an explicit selection");
    };
    assert.strictEqual(await resolvePublicSubscriptionPromoOffer(), null);
  } finally {
    Setting.findOne = originalSettingFindOne;
    PromoCode.findOne = originalPromoFindOne;
  }

  const originalSelectionSettingFindOne = Setting.findOne;
  const originalSelectionSettingFindOneAndUpdate = Setting.findOneAndUpdate;
  const originalSelectionPromoFindById = PromoCode.findById;
  try {
    const promoDocument = promo({
      _id: objectId,
      appDisplay: {
        isVisible: false,
        showOnHome: false,
        showOnPlans: false,
      },
    });
    promoDocument.save = async () => promoDocument;
    let storedPromoCodeId = null;
    let promoLookupCount = 0;
    PromoCode.findById = () => {
      promoLookupCount += 1;
      if (promoLookupCount === 1) return promoDocument;
      return { lean: async () => ({ ...promoDocument }) };
    };
    Setting.findOneAndUpdate = async (_query, update) => {
      storedPromoCodeId = update.$set.value.promoCodeId;
      return { value: update.$set.value };
    };
    Setting.findOne = () => ({
      lean: async () => ({ value: { promoCodeId: storedPromoCodeId } }),
    });

    const selection = await setSelectedAppPromoCode(objectId);
    assert.strictEqual(storedPromoCodeId, objectId);
    assert.strictEqual(promoDocument.appDisplay.isVisible, true);
    assert.strictEqual(promoDocument.appDisplay.showOnHome, true);
    assert.strictEqual(promoDocument.appDisplay.showOnPlans, true);
    assert.strictEqual(selection.promoCodeId, objectId);
    assert.strictEqual(selection.isPubliclyDisplayable, true);
  } finally {
    Setting.findOne = originalSelectionSettingFindOne;
    Setting.findOneAndUpdate = originalSelectionSettingFindOneAndUpdate;
    PromoCode.findById = originalSelectionPromoFindById;
  }

  console.log("subscriptionPromoDisplayContract.test.js: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
