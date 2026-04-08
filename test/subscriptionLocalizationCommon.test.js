const test = require("node:test");
const assert = require("node:assert/strict");

const {
  localizeAddonRows,
  localizeCustomItemRows,
  localizeStatusObject,
  mapRawDayStatusToClientStatus,
  resolveCatalogOrStoredName,
  resolveLocalizedText,
} = require("../src/utils/subscriptionLocalizationCommon");
const { localizeSubscriptionDayReadPayload } = require("../src/utils/subscriptionReadLocalization");
const { localizeWriteDayPayload } = require("../src/utils/subscriptionWriteLocalization");

test("resolveLocalizedText supports bilingual objects, legacy name fields, nested name values, and plain strings", () => {
  assert.equal(resolveLocalizedText("Legacy Name", "en"), "Legacy Name");
  assert.equal(resolveLocalizedText({ ar: "شوربة", en: "Soup" }, "en"), "Soup");
  assert.equal(resolveLocalizedText({ name: { ar: "كوكي", en: "Cookie" } }, "ar"), "كوكي");
  assert.equal(resolveLocalizedText({ name: "Stored Legacy Name" }, "ar"), "Stored Legacy Name");
  assert.equal(resolveLocalizedText({ name_ar: "خيار", name_en: "Cucumber" }, "en"), "Cucumber");
  assert.equal(resolveLocalizedText(null, "ar"), "");
});

test("resolveCatalogOrStoredName keeps catalog and historical fallback ordering stable", () => {
  assert.equal(
    resolveCatalogOrStoredName({
      liveName: { ar: "شوربة", en: "Soup" },
      storedName: "اسم تاريخي",
      lang: "en",
    }),
    "Soup"
  );

  assert.equal(
    resolveCatalogOrStoredName({
      liveName: "",
      storedName: { ar: "كوكي" },
      lang: "en",
    }),
    "كوكي"
  );

  assert.equal(
    resolveCatalogOrStoredName({
      liveName: { ar: "شوربة", en: "Soup" },
      storedName: { ar: "كوكي", en: "Cookie" },
      lang: "en",
      preferStoredName: true,
    }),
    "Cookie"
  );
});

test("localizeAddonRows preserves backward-compatible name shape controls for read and write paths", () => {
  const addonNames = new Map([["addon-1", "Soup"]]);
  const rows = [
    { addonId: "addon-1", qty: 1, name: "اسم قديم" },
    { addonId: "addon-2", qty: 2 },
  ];

  const readRows = localizeAddonRows(rows, {
    lang: "en",
    addonNames,
  });
  const writeRows = localizeAddonRows(rows, {
    lang: "en",
    addonNames,
    alwaysSetName: false,
  });

  assert.equal(readRows[0].name, "Soup");
  assert.equal(readRows[1].name, "");
  assert.equal(writeRows[0].name, "Soup");
  assert.ok(!Object.prototype.hasOwnProperty.call(writeRows[1], "name"));
});

test("localizeCustomItemRows normalizes custom meal and salad item names across historical shapes", () => {
  const rows = [{
    items: [
      { name_ar: "دجاج", name_en: "Chicken", quantity: 1 },
      { name: { ar: "خيار", en: "Cucumber" }, quantity: 1 },
      { name: "Legacy Salad Item", quantity: 1 },
    ],
  }];

  const localized = localizeCustomItemRows(rows, "en");

  assert.equal(localized[0].items[0].name, "Chicken");
  assert.equal(localized[0].items[1].name, "Cucumber");
  assert.equal(localized[0].items[2].name, "Legacy Salad Item");
});

test("localizeStatusObject and mapRawDayStatusToClientStatus keep machine fields unchanged while adding labels", () => {
  const payload = { status: "paid", provider: "moyasar" };
  const localized = localizeStatusObject(payload, { lang: "ar" });

  assert.equal(localized.status, "paid");
  assert.equal(localized.statusLabel, "مدفوع");
  assert.equal(mapRawDayStatusToClientStatus("locked"), "preparing");
  assert.equal(mapRawDayStatusToClientStatus("ready_for_pickup"), "ready_for_pickup");
  assert.equal(mapRawDayStatusToClientStatus("no_show"), "no_show");
});

test("read and write day localizers stay aligned for addon names, labels, and historical custom item fallback", () => {
  const addonNames = new Map([
    ["addon-1", "Soup"],
    ["addon-2", "Cookie"],
  ]);
  const rawDay = {
    status: "locked",
    recurringAddons: [{ addonId: "addon-1", name: "اسم قديم" }],
    oneTimeAddonSelections: [{ addonId: "addon-2", name: "اسم تاريخي" }],
    oneTimeAddonPaymentStatus: "pending",
    planning: {
      state: "draft",
      premiumOverageStatus: "pending",
    },
    customMeals: [{
      items: [{ name: "Legacy Chicken", quantity: 1 }],
    }],
    customSalads: [{
      items: [{ name: { ar: "خيار", en: "Cucumber" }, quantity: 1 }],
    }],
  };

  const readLocalized = localizeSubscriptionDayReadPayload(
    {
      ...rawDay,
      status: "preparing",
    },
    { lang: "en", addonNames }
  );
  const writeLocalized = localizeWriteDayPayload(rawDay, { lang: "en", addonNames });

  assert.equal(readLocalized.status, "preparing");
  assert.equal(writeLocalized.status, "locked");
  assert.equal(readLocalized.statusLabel, "Preparing");
  assert.equal(writeLocalized.statusLabel, "Preparing");
  assert.equal(readLocalized.recurringAddons[0].name, "Soup");
  assert.equal(writeLocalized.recurringAddons[0].name, "Soup");
  assert.equal(readLocalized.oneTimeAddonSelections[0].name, "Cookie");
  assert.equal(writeLocalized.oneTimeAddonSelections[0].name, "Cookie");
  assert.equal(readLocalized.customMeals[0].items[0].name, "Legacy Chicken");
  assert.equal(writeLocalized.customMeals[0].items[0].name, "Legacy Chicken");
  assert.equal(readLocalized.customSalads[0].items[0].name, "Cucumber");
  assert.equal(writeLocalized.customSalads[0].items[0].name, "Cucumber");
});
