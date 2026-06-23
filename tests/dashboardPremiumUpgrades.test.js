process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";
process.env.ALLOW_CATALOG_RESET = "true";
process.env.BOOTSTRAP_SYNC = "true";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const { seedCatalog } = require("../scripts/bootstrap/seed-catalog");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");
const { validateCanonicalMealSlots } = require("../src/services/subscription/canonicalMealSlotPlannerService");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`dashboard_premium_upgrades_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

function findPremiumOption(menu, premiumKey) {
  const section = menu.plannerCatalog.sections.find((s) => s.key === "premium_meal");
  const product = section.products.find((p) => p.key === "basic_meal");
  const group = product.optionGroups.find((g) => g.key === "proteins");
  return group.options.find((option) => option.key === premiumKey)
    || group.options.find((option) => option.premiumKey === premiumKey);
}

function premiumMealSlot({ productId, groupId, optionId }) {
  return {
    slotIndex: 1,
    selectionType: "premium_meal",
    productId: String(productId),
    selectedOptions: [
      {
        groupId: String(groupId),
        groupKey: "proteins",
        optionId: String(optionId),
        optionKey: "beef_steak",
        quantity: 1,
      },
    ],
  };
}

async function main() {
  await connect();
  try {
    await seedCatalog({ reset: true, sync: true });
    const app = createApp();
    const api = request(app);
    const { headers } = await dashboardAuth("admin", "premium-upgrades");

    const [basicMeal, premiumSalad, proteinsGroup, beef, shrimp, salmon] = await Promise.all([
      MenuProduct.findOne({ key: "basic_meal" }).lean(),
      MenuProduct.findOne({ key: "premium_large_salad" }).lean(),
      MenuOptionGroup.findOne({ key: "proteins" }).lean(),
      MenuOption.findOne({ $or: [{ premiumKey: "beef_steak" }, { key: "beef_steak" }] }).lean(),
      MenuOption.findOne({ $or: [{ premiumKey: "shrimp" }, { key: "shrimp" }] }).lean(),
      MenuOption.findOne({ $or: [{ premiumKey: "salmon" }, { key: "salmon" }] }).lean(),
    ]);
    assert(basicMeal && premiumSalad && proteinsGroup && beef && shrimp && salmon, "seeded premium fixtures exist");

    const beefRelation = await ProductGroupOption.findOne({
      productId: basicMeal._id,
      groupId: proteinsGroup._id,
      optionId: beef._id,
    }).lean();
    assert(beefRelation, "beef relation exists");

    let res = await api.get("/api/dashboard/premium-upgrades").set(headers);
    expectStatus(res, 200, "empty config list");
    assert.strictEqual(res.body.data.length, 0, "bootstrap does not auto-backfill configs");

    res = await api.get("/api/dashboard/premium-upgrades/candidates?limit=100").set(headers);
    expectStatus(res, 200, "all unlinked candidates");
    for (const premiumKey of ["beef_steak", "shrimp", "salmon", "premium_large_salad"]) {
      assert(res.body.data.some((candidate) => candidate.premiumKey === premiumKey), `${premiumKey} is eligible`);
    }
    assert(res.body.data.some((candidate) => candidate.premiumKey === "chicken"), "existing non-legacy catalog option is eligible");
    assert(res.body.meta.diagnostics.totalMenuProductsScanned > 0);
    assert(res.body.meta.diagnostics.totalMenuOptionsScanned > 4);
    assert(res.body.meta.diagnostics.finalEligibleUnlinkedCount > 4);
    assert(res.body.meta.diagnostics.excludedAddons > 0);

    res = await api.get("/api/dashboard/premium-upgrades/candidates?selectionType=premium_meal&includeLinked=true&limit=100").set(headers);
    expectStatus(res, 200, "premium meal candidates");
    const knownPremiumCandidates = res.body.data.filter((candidate) => ["beef_steak", "shrimp", "salmon"].includes(candidate.premiumKey));
    assert.strictEqual(knownPremiumCandidates.length, 3);
    for (const candidate of knownPremiumCandidates) {
      for (const field of [
        "id", "sourceId", "sourceType", "type", "sourceProductId", "sourceGroupId",
        "sourceProductKey", "sourceGroupKey", "key", "premiumKey", "name", "selectionType",
        "upgradeDeltaHalala", "currency", "isLinked", "eligibilityDiagnostics",
      ]) assert(Object.prototype.hasOwnProperty.call(candidate, field), `candidate includes ${field}`);
      assert.strictEqual(candidate.sourceType, "menu_option");
      assert.strictEqual(candidate.sourceProductKey, "basic_meal");
      assert.strictEqual(candidate.sourceGroupKey, "proteins");
      assert.strictEqual(candidate.upgradeDeltaHalala, 2000);
      assert.strictEqual(candidate.eligibilityDiagnostics.eligible, true);
    }

    const existingCatalogCandidate = res.body.data.find((candidate) => candidate.premiumKey === "chicken" && candidate.sourceProductKey === "basic_meal");
    assert(existingCatalogCandidate, "real seeded chicken option resolves to its subscription context");
    let createFromExisting = await api.post("/api/dashboard/premium-upgrades").set(headers).send(existingCatalogCandidate);
    expectStatus(createFromExisting, 201, "real catalog candidate can create config");
    await PremiumUpgradeConfig.deleteOne({ premiumKey: "chicken" });

    res = await api.get("/api/dashboard/premium-upgrades/candidates?selectionType=premium_large_salad&includeLinked=true").set(headers);
    expectStatus(res, 200, "premium salad candidate");
    assert.strictEqual(res.body.data.length, 1);
    assert.strictEqual(res.body.data[0].premiumKey, "premium_large_salad");
    assert.strictEqual(res.body.data[0].sourceType, "menu_product");
    assert.strictEqual(res.body.data[0].upgradeDeltaHalala, 2900);

    const dynamicOption = await MenuOption.create({
      groupId: proteinsGroup._id,
      key: "dynamic_premium_protein",
      premiumKey: "dynamic_premium_protein",
      name: { en: "Dynamic Premium Protein", ar: "بروتين مميز ديناميكي" },
      selectionType: "premium_meal",
      isActive: true,
      isVisible: true,
      isAvailable: true,
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: new Date(),
    });
    await ProductGroupOption.create({
      productId: basicMeal._id,
      groupId: proteinsGroup._id,
      optionId: dynamicOption._id,
      extraPriceHalala: 2300,
    });
    res = await api.get(`/api/dashboard/premium-upgrades/candidates?sourceProductId=${basicMeal._id}&q=dynamic`).set(headers);
    expectStatus(res, 200, "dynamic option candidate");
    assert.strictEqual(res.body.data.length, 1);
    const dynamicCandidate = res.body.data[0];
    assert.strictEqual(dynamicCandidate.premiumKey, "dynamic_premium_protein");
    assert.strictEqual(dynamicCandidate.sourceProductKey, "basic_meal");
    assert.strictEqual(dynamicCandidate.sourceGroupKey, "proteins");
    assert.strictEqual(dynamicCandidate.upgradeDeltaHalala, 2300);
    res = await api.post("/api/dashboard/premium-upgrades").set(headers).send(dynamicCandidate);
    expectStatus(res, 201, "candidate DTO can create config without invented fields");
    await PremiumUpgradeConfig.deleteOne({ premiumKey: "dynamic_premium_protein" });
    await ProductGroupOption.deleteOne({ optionId: dynamicOption._id });
    await MenuOption.deleteOne({ _id: dynamicOption._id });

    const oneTimeOnlyOption = await MenuOption.create({
      groupId: proteinsGroup._id,
      key: "one_time_only_premium",
      name: { en: "One-time Only Premium", ar: "خيار للطلبات الفردية فقط" },
      availableFor: ["one_time"],
      availableForSubscription: false,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    });
    await ProductGroupOption.create({
      productId: basicMeal._id,
      groupId: proteinsGroup._id,
      optionId: oneTimeOnlyOption._id,
      extraPriceHalala: 1900,
    });
    res = await api.get("/api/dashboard/premium-upgrades/candidates?includeLinked=true&q=one_time_only_premium").set(headers);
    expectStatus(res, 200, "one-time-only option excluded");
    assert.strictEqual(res.body.data.length, 0);
    res = await api.post("/api/dashboard/premium-upgrades").set(headers).send({
      sourceType: "menu_option",
      sourceId: String(oneTimeOnlyOption._id),
      sourceProductId: String(basicMeal._id),
      sourceGroupId: String(proteinsGroup._id),
      selectionType: "premium_meal",
      upgradeDeltaHalala: 1900,
    });
    expectStatus(res, 400, "one-time-only option rejected by create validation");
    await ProductGroupOption.deleteOne({ optionId: oneTimeOnlyOption._id });
    await MenuOption.deleteOne({ _id: oneTimeOnlyOption._id });

    const unsupportedProduct = await MenuProduct.create({
      categoryId: basicMeal.categoryId,
      key: "unsupported_premium_product",
      name: { en: "Unsupported Premium Product", ar: "منتج مميز غير مدعوم" },
      priceHalala: 1700,
      availableFor: ["subscription"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
      ui: { cardVariant: "addon" },
    });
    const addonContextOption = await MenuOption.create({
      groupId: proteinsGroup._id,
      key: "addon_context_premium",
      premiumKey: "addon_context_premium",
      name: { en: "Add-on Context Premium", ar: "خيار إضافة مميز" },
      selectionType: "premium_meal",
      availableFor: ["subscription"],
      availableForSubscription: true,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    });
    await ProductOptionGroup.create({ productId: unsupportedProduct._id, groupId: proteinsGroup._id });
    await ProductGroupOption.create({
      productId: unsupportedProduct._id,
      groupId: proteinsGroup._id,
      optionId: addonContextOption._id,
      extraPriceHalala: 1800,
    });
    res = await api.get("/api/dashboard/premium-upgrades/candidates?sourceType=menu_product&includeLinked=true").set(headers);
    expectStatus(res, 200, "unsupported and add-on products excluded");
    assert(!res.body.data.some((candidate) => candidate.sourceId === String(unsupportedProduct._id)));
    res = await api.post("/api/dashboard/premium-upgrades").set(headers).send({
      sourceType: "menu_product",
      sourceId: String(unsupportedProduct._id),
      selectionType: "premium_large_salad",
      upgradeDeltaHalala: 1700,
    });
    expectStatus(res, 400, "unsupported add-on product rejected by create validation");
    res = await api.get(`/api/dashboard/premium-upgrades/candidates?sourceProductId=${unsupportedProduct._id}&includeLinked=true`).set(headers);
    expectStatus(res, 200, "add-on product option context excluded");
    assert.strictEqual(res.body.data.length, 0);
    res = await api.post("/api/dashboard/premium-upgrades").set(headers).send({
      sourceType: "menu_option",
      sourceId: String(addonContextOption._id),
      sourceProductId: String(unsupportedProduct._id),
      sourceGroupId: String(proteinsGroup._id),
      selectionType: "premium_meal",
      upgradeDeltaHalala: 1800,
    });
    expectStatus(res, 400, "add-on option context rejected by create validation");
    await ProductGroupOption.deleteOne({ optionId: addonContextOption._id });
    await ProductOptionGroup.deleteOne({ productId: unsupportedProduct._id, groupId: proteinsGroup._id });
    await MenuOption.deleteOne({ _id: addonContextOption._id });
    await MenuProduct.deleteOne({ _id: unsupportedProduct._id });

    res = await api.get("/api/dashboard/premium-upgrades/readiness").set(headers);
    expectStatus(res, 200, "legacy fallback readiness");
    assert.strictEqual(res.body.isReady, true);
    assert.strictEqual(res.body.diagnostics.configState.isEmpty, true);
    assert.strictEqual(res.body.diagnostics.configState.legacyFallbackActive, true);
    assert.strictEqual(res.body.diagnostics.configState.backfillStatus, "not_started");
    assert.deepStrictEqual(res.body.diagnostics.unresolvedSourceKeys, []);

    const sourceCounts = await Promise.all([
      MenuProduct.countDocuments({ key: { $in: ["basic_meal", "premium_large_salad"] } }),
      MenuOption.countDocuments({ groupId: proteinsGroup._id, key: { $in: ["beef_steak", "shrimp", "salmon"] } }),
      ProductGroupOption.countDocuments({
        productId: basicMeal._id,
        groupId: proteinsGroup._id,
        optionId: { $in: [beef._id, shrimp._id, salmon._id] },
      }),
    ]);
    await seedCatalog({ sync: true });
    assert.deepStrictEqual(await Promise.all([
      MenuProduct.countDocuments({ key: { $in: ["basic_meal", "premium_large_salad"] } }),
      MenuOption.countDocuments({ groupId: proteinsGroup._id, key: { $in: ["beef_steak", "shrimp", "salmon"] } }),
      ProductGroupOption.countDocuments({
        productId: basicMeal._id,
        groupId: proteinsGroup._id,
        optionId: { $in: [beef._id, shrimp._id, salmon._id] },
      }),
    ]), sourceCounts, "repeated bootstrap does not duplicate premium sources or relations");

    res = await api.post("/api/dashboard/premium-upgrades").set(headers).send({
      sourceType: "menu_option",
      sourceId: String(beef._id),
      sourceProductId: String(basicMeal._id),
      sourceGroupId: String(proteinsGroup._id),
      selectionType: "premium_meal",
      upgradeDeltaHalala: 1500,
    });
    expectStatus(res, 201, "create option-backed config");
    const beefConfig = res.body.data;
    assert.strictEqual(beefConfig.premiumKey, "beef_steak");
    assert.strictEqual(beefConfig.upgradeDeltaHalala, 1500);

    res = await api.get("/api/dashboard/premium-upgrades/candidates").set(headers);
    expectStatus(res, 200, "linked candidates excluded by default");
    assert(!res.body.data.some((candidate) => candidate.premiumKey === "beef_steak"));
    res = await api.get("/api/dashboard/premium-upgrades/candidates?includeLinked=true").set(headers);
    expectStatus(res, 200, "linked candidates included on request");
    assert(res.body.data.some((candidate) => candidate.premiumKey === "beef_steak" && candidate.isLinked));

    res = await api.get("/api/dashboard/premium-upgrades/readiness").set(headers);
    expectStatus(res, 200, "partial config readiness");
    assert.strictEqual(res.body.isReady, false);
    assert.strictEqual(res.body.diagnostics.configState.legacyFallbackActive, false);
    assert.strictEqual(res.body.diagnostics.configState.partialConfigRisk, true);
    assert.strictEqual(res.body.diagnostics.configState.backfillStatus, "incomplete");

    res = await api.post("/api/dashboard/premium-upgrades").set(headers).send({
      sourceType: "menu_product",
      sourceId: String(premiumSalad._id),
      selectionType: "premium_large_salad",
      upgradeDeltaHalala: 3100,
    });
    expectStatus(res, 201, "create product-backed premium salad config");
    const saladConfig = res.body.data;
    assert.strictEqual(saladConfig.premiumKey, "premium_large_salad");

    const createKnownOptionConfig = async (option, price) => {
      const candidateRes = await api.get(`/api/dashboard/premium-upgrades/candidates?includeLinked=true&q=${option.key}`).set(headers);
      expectStatus(candidateRes, 200, `candidate for ${option.key}`);
      const candidate = candidateRes.body.data.find((row) => row.premiumKey === option.key);
      assert(candidate, `eligible candidate exists for ${option.key}`);
      const createRes = await api.post("/api/dashboard/premium-upgrades").set(headers).send({ ...candidate, upgradeDeltaHalala: price });
      expectStatus(createRes, 201, `create ${option.key} config`);
      return createRes.body.data;
    };
    await createKnownOptionConfig(shrimp, 2000);
    await createKnownOptionConfig(salmon, 2000);

    res = await api.get("/api/dashboard/premium-upgrades/candidates?includeLinked=true&limit=100").set(headers);
    expectStatus(res, 200, "all four linked candidates included");
    for (const premiumKey of ["beef_steak", "shrimp", "salmon", "premium_large_salad"]) {
      assert(res.body.data.some((candidate) => candidate.premiumKey === premiumKey && candidate.isLinked), `${premiumKey} is linked`);
    }
    res = await api.get("/api/dashboard/premium-upgrades/candidates?includeLinked=false&limit=100").set(headers);
    expectStatus(res, 200, "linked candidates excluded");
    assert(!res.body.data.some((candidate) => ["beef_steak", "shrimp", "salmon", "premium_large_salad"].includes(candidate.premiumKey)));

    res = await api.patch(`/api/dashboard/premium-upgrades/${beefConfig.id}`).set(headers).send({
      expectedRevision: beefConfig.revision,
      upgradeDeltaHalala: 2500,
    });
    expectStatus(res, 200, "authoritative beef price diverges from legacy");
    const authoritativeBeefConfig = res.body.data;
    res = await api.get("/api/dashboard/premium-upgrades/readiness").set(headers);
    expectStatus(res, 200, "authoritative mismatch readiness");
    assert.strictEqual(res.body.isReady, true, JSON.stringify(res.body.diagnostics));
    assert.strictEqual(res.body.diagnostics.configState.configsAuthoritative, true);
    assert.strictEqual(res.body.diagnostics.configState.legacyFallbackActive, false);
    const beefMismatch = res.body.diagnostics.priceMismatches.find((row) => row.premiumKey === "beef_steak");
    assert(beefMismatch, "legacy/config mismatch remains diagnostic");
    assert.strictEqual(beefMismatch.blocking, false);
    assert.strictEqual(beefMismatch.severity, "warning");

    res = await api.post("/api/dashboard/premium-upgrades").set(headers).send({
      sourceType: "menu_option",
      sourceId: String(beef._id),
      sourceProductId: String(basicMeal._id),
      sourceGroupId: String(proteinsGroup._id),
      selectionType: "premium_meal",
      upgradeDeltaHalala: 1500,
    });
    expectStatus(res, 409, "duplicate source link rejected");

    const duplicateKeyOption = await MenuOption.create({
      groupId: proteinsGroup._id,
      key: "duplicate_beef_key",
      premiumKey: "beef_steak",
      name: { en: "Duplicate Beef", ar: "Duplicate Beef" },
      selectionType: "premium_meal",
      isActive: true,
      isVisible: true,
      isAvailable: true,
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: new Date(),
    });
    await ProductGroupOption.create({
      productId: basicMeal._id,
      groupId: proteinsGroup._id,
      optionId: duplicateKeyOption._id,
    });
    res = await api.post("/api/dashboard/premium-upgrades").set(headers).send({
      sourceType: "menu_option",
      sourceId: String(duplicateKeyOption._id),
      sourceProductId: String(basicMeal._id),
      sourceGroupId: String(proteinsGroup._id),
      selectionType: "premium_meal",
      upgradeDeltaHalala: 1700,
    });
    expectStatus(res, 409, "duplicate premiumKey rejected");
    await ProductGroupOption.deleteMany({ optionId: duplicateKeyOption._id });
    await MenuOption.deleteOne({ _id: duplicateKeyOption._id });

    res = await api.post("/api/dashboard/premium-upgrades").set(headers).send({
      sourceType: "bad_source",
      sourceId: String(shrimp._id),
      selectionType: "premium_meal",
      upgradeDeltaHalala: 1500,
    });
    expectStatus(res, 400, "invalid source rejected");

    res = await api.post("/api/dashboard/premium-upgrades").set(headers).send({
      sourceType: "menu_option",
      sourceId: String(shrimp._id),
      sourceProductId: String(new mongoose.Types.ObjectId()),
      sourceGroupId: String(proteinsGroup._id),
      selectionType: "premium_meal",
      upgradeDeltaHalala: 1500,
    });
    expectStatus(res, 400, "invalid relation rejected");

    res = await api.patch(`/api/dashboard/premium-upgrades/${beefConfig.id}`).set(headers).send({
      upgradeDeltaHalala: 2000,
    });
    expectStatus(res, 409, "patch requires expectedRevision");

    res = await api.patch(`/api/dashboard/premium-upgrades/${beefConfig.id}`).set(headers).send({
      expectedRevision: 999,
      upgradeDeltaHalala: 2000,
    });
    expectStatus(res, 409, "stale expectedRevision rejected");

    res = await api.patch(`/api/dashboard/premium-upgrades/${beefConfig.id}`).set(headers).send({
      expectedRevision: authoritativeBeefConfig.revision,
      upgradeDeltaHalala: 2000,
    });
    expectStatus(res, 200, "patch updates delta");
    const updatedBeefConfig = res.body.data;
    assert.strictEqual(updatedBeefConfig.upgradeDeltaHalala, 2000);
    assert.strictEqual(updatedBeefConfig.revision, authoritativeBeefConfig.revision + 1);

    for (const immutableField of ["sourceType", "sourceId", "sourceProductId", "sourceGroupId", "selectionType", "premiumKey", "currency"]) {
      res = await api.patch(`/api/dashboard/premium-upgrades/${beefConfig.id}`).set(headers).send({
        expectedRevision: updatedBeefConfig.revision,
        [immutableField]: immutableField === "premiumKey" ? "shrimp" : "mutated",
      });
      expectStatus(res, 400, `patch rejects immutable ${immutableField}`);
    }

    res = await api.get("/api/subscriptions/meal-planner-menu?lang=en");
    expectStatus(res, 200, "planner with active config");
    let beefOption = findPremiumOption(res.body.data, "beef_steak");
    assert(beefOption, "active beef config is visible in planner");
    assert.strictEqual(Number(beefOption.premiumPriceHalala || beefOption.extraFeeHalala || 0), 2000);

    res = await api.patch(`/api/dashboard/premium-upgrades/${beefConfig.id}/state`).set(headers).send({
      expectedRevision: updatedBeefConfig.revision,
      isVisible: false,
    });
    expectStatus(res, 200, "state toggles visibility");
    const hiddenBeefConfig = res.body.data;
    assert.strictEqual(hiddenBeefConfig.isVisible, false);

    res = await api.get("/api/subscriptions/meal-planner-menu?lang=en");
    expectStatus(res, 200, "planner after hidden config");
    assert(!findPremiumOption(res.body.data, "beef_steak"), "hidden beef config is removed from client planner");

    const validation = await validateCanonicalMealSlots({
      mealSlots: [premiumMealSlot({ productId: basicMeal._id, groupId: proteinsGroup._id, optionId: beef._id })],
      mealsPerDayLimit: 1,
      subscription: { premiumBalance: [] },
    });
    assert.strictEqual(validation.valid, false, "hidden config rejects new canonical submissions");
    assert(validation.slotErrors.some((err) => err.code === "PREMIUM_UPGRADE_CONFIG_UNAVAILABLE"), JSON.stringify(validation.slotErrors));

    res = await api.post(`/api/dashboard/premium-upgrades/${saladConfig.id}/archive`).set(headers).send({
      expectedRevision: saladConfig.revision,
      reason: "test archive",
    });
    expectStatus(res, 200, "archive soft archives");
    assert.strictEqual(res.body.data.status, "archived");
    assert.strictEqual(res.body.data.isEnabled, false);
    assert.strictEqual(res.body.data.isVisible, false);

    res = await api.get("/api/dashboard/premium-upgrades").set(headers);
    expectStatus(res, 200, "dashboard list includes archived");
    assert(res.body.data.some((row) => row.id === saladConfig.id && row.status === "archived"), "archived config remains visible in dashboard list");

    res = await api.get("/api/subscriptions/meal-planner-menu?lang=en");
    expectStatus(res, 200, "planner after archived salad");
    const saladSection = res.body.data.plannerCatalog.sections.find((section) => section.key === "premium_large_salad");
    assert(!saladSection || saladSection.products.length === 0, "archived premium salad is hidden from client planner");

    assert(await MenuProduct.exists({ _id: premiumSalad._id }), "archive does not delete MenuProduct");
    assert(await MenuOption.exists({ _id: beef._id }), "state changes do not delete MenuOption");
    assert(await ProductOptionGroup.exists({ productId: premiumSalad._id }), "archive does not delete product group relations");
    assert(await ProductGroupOption.exists({ productId: basicMeal._id, optionId: beef._id }), "archive does not delete option relations");

    const archivedDoc = await PremiumUpgradeConfig.findById(saladConfig.id).lean();
    assert(archivedDoc && archivedDoc.status === "archived", "archived config was soft archived");

    console.log("dashboard premium upgrade endpoint checks passed");
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await disconnect();
  }
}

main().catch(async (err) => {
  console.error(err && err.stack ? err.stack : err);
  try { await disconnect(); } catch (_err) {}
  process.exit(1);
});
