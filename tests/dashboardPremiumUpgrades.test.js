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
const MealBuilderConfig = require("../src/models/MealBuilderConfig");
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
    const { headers: kitchenHeaders } = await dashboardAuth("kitchen", "premium-upgrades");

    const [basicMeal, premiumSalad, proteinsGroup, beef, shrimp, salmon] = await Promise.all([
      MenuProduct.findOne({ key: "basic_meal" }).lean(),
      MenuProduct.findOne({ key: "premium_large_salad" }).lean(),
      MenuOptionGroup.findOne({ key: "proteins" }).lean(),
      MenuOption.findOne({ $or: [{ premiumKey: "beef_steak" }, { key: "beef_steak" }] }).lean(),
      MenuOption.findOne({ $or: [{ premiumKey: "shrimp" }, { key: "shrimp" }] }).lean(),
      MenuOption.findOne({ $or: [{ premiumKey: "salmon" }, { key: "salmon" }] }).lean(),
    ]);
    assert(basicMeal && premiumSalad && proteinsGroup && beef && shrimp && salmon, "seeded premium fixtures exist");
    await PremiumUpgradeConfig.deleteMany({});

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
    assert(knownPremiumCandidates.length >= 3, "all known non-salad premium option relations appear as candidates");
    for (const premiumKey of ["beef_steak", "shrimp", "salmon"]) {
      assert(knownPremiumCandidates.some((candidate) => candidate.premiumKey === premiumKey), `${premiumKey} appears as an option relation`);
    }
    for (const candidate of knownPremiumCandidates) {
      for (const field of [
        "id", "sourceId", "sourceType", "type", "sourceProductId", "sourceGroupId",
        "sourceProductKey", "sourceGroupKey", "key", "premiumKey", "name", "selectionType",
        "upgradeDeltaHalala", "currency", "isLinked", "eligibilityDiagnostics",
      ]) assert(Object.prototype.hasOwnProperty.call(candidate, field), `candidate includes ${field}`);
      assert.strictEqual(candidate.sourceType, "menu_option");
      assert.strictEqual(candidate.sourceGroupKey, "proteins");
      assert(candidate.relationId.startsWith(`menu_option:${candidate.sourceId}:${candidate.sourceProductId}:${candidate.sourceGroupId}`));
      if (candidate.sourceProductKey === "basic_meal") {
        assert.strictEqual(candidate.upgradeDeltaHalala, 2000);
      } else {
        assert(Number.isSafeInteger(candidate.upgradeDeltaHalala), "relation exposes a numeric premium delta");
      }
      assert.strictEqual(candidate.eligibilityDiagnostics.eligible, true);
    }

    const existingCatalogCandidate = res.body.data.find((candidate) => candidate.premiumKey === "chicken" && candidate.sourceProductKey === "basic_meal");
    assert(existingCatalogCandidate, "real seeded chicken option resolves to its subscription context");
    let createFromExisting = await api.post("/api/dashboard/premium-upgrades").set(headers).send(existingCatalogCandidate);
    expectStatus(createFromExisting, 201, "real catalog candidate can create config");
    await PremiumUpgradeConfig.deleteOne({ premiumKey: "chicken" });

    res = await api.get("/api/dashboard/premium-upgrades/sources?kind=option&limit=100").set(headers);
    expectStatus(res, 200, "option source picker");
    const beefSource = res.body.data.find((source) => source.key === "beef_steak");
    assert(beefSource, "source picker includes beef option");
    assert.strictEqual(beefSource.kind, "option");
    assert.strictEqual(beefSource.sourceId, String(beef._id));
    assert.strictEqual(beefSource.sourceProductId, String(basicMeal._id));
    assert.strictEqual(beefSource.sourceGroupId, String(proteinsGroup._id));
    assert.strictEqual(beefSource.sourceProductKey, "basic_meal");
    assert.strictEqual(beefSource.sourceGroupKey, "proteins");
    assert.strictEqual(beefSource.relationId, `menu_option:${beef._id}:${basicMeal._id}:${proteinsGroup._id}`);
    assert.deepStrictEqual(beefSource.compatibilityKeys, ["beef_steak"]);
    assert.strictEqual(beefSource.group.key, "proteins");
    assert.strictEqual(beefSource.selectable, true);
    assert.strictEqual(beefSource.linked, false);
    assert.strictEqual(beefSource.linkedConfigId, null);
    assert(!Object.prototype.hasOwnProperty.call(beefSource, "sourceType"), "source picker hides sourceType");

    res = await api.get("/api/dashboard/premium-upgrades/sources?kind=product&limit=100").set(headers);
    expectStatus(res, 200, "product source picker");
    const saladSource = res.body.data.find((source) => source.key === "premium_large_salad");
    assert(saladSource, "source picker includes premium salad product");
    assert.strictEqual(saladSource.kind, "product");
    assert.strictEqual(saladSource.sourceId, String(premiumSalad._id));
    assert.strictEqual(saladSource.supportedSelectionType, "premium_large_salad");
    assert.deepStrictEqual(saladSource.premiumCompatibilityKeys, ["premium_large_salad", "custom_premium_salad"]);
    assert.strictEqual(saladSource.group.key, "premium");
    assert.strictEqual(saladSource.selectable, true);

    res = await api.get("/api/dashboard/premium-upgrades/candidates?selectionType=premium_large_salad&includeLinked=true&limit=100").set(headers);
    expectStatus(res, 200, "product-backed premium candidates");
    const premiumSaladCandidate = res.body.data.find((candidate) => candidate.premiumKey === "premium_large_salad");
    assert(premiumSaladCandidate, "premium salad remains product-backed");
    assert.strictEqual(premiumSaladCandidate.sourceType, "menu_product");
    assert.strictEqual(premiumSaladCandidate.upgradeDeltaHalala, 2900);
    assert(!res.body.data.some((candidate) => candidate.sourceType === "menu_product" && candidate.premiumKey !== "premium_large_salad"), "normal products are not premium product sources");

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

    const alternateMealForAmbiguousOption = await MenuProduct.create({
      categoryId: basicMeal.categoryId,
      key: "alternate_basic_meal_for_premium_relation",
      name: { en: "Alternate Basic Meal", ar: "وجبة أساسية بديلة" },
      priceHalala: 2100,
      availableFor: ["subscription"],
      availableForSubscription: true,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    });
    await ProductOptionGroup.create({
      productId: alternateMealForAmbiguousOption._id,
      groupId: proteinsGroup._id,
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      isActive: true,
      isVisible: true,
      isAvailable: true,
    });
    const multiContextOption = await MenuOption.create({
      groupId: proteinsGroup._id,
      key: "multi_context_premium",
      premiumKey: "multi_context_premium",
      name: { en: "Multi Context Premium", ar: "خيار مميز متعدد السياق" },
      selectionType: "premium_meal",
      isActive: true,
      isVisible: true,
      isAvailable: true,
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: new Date(),
    });
    await ProductGroupOption.create([
      {
        productId: basicMeal._id,
        groupId: proteinsGroup._id,
        optionId: multiContextOption._id,
        extraPriceHalala: 2400,
      },
      {
        productId: alternateMealForAmbiguousOption._id,
        groupId: proteinsGroup._id,
        optionId: multiContextOption._id,
        extraPriceHalala: 2600,
      },
    ]);
    res = await api.get("/api/dashboard/premium-upgrades/sources?kind=option&q=multi_context_premium&limit=100").set(headers);
    expectStatus(res, 200, "ambiguous option source picker rows");
    const multiContextSources = res.body.data.filter((source) => source.sourceId === String(multiContextOption._id));
    assert.strictEqual(multiContextSources.length, 2, "source picker exposes one row per option relation");
    assert(multiContextSources.every((source) => source.relationId), "ambiguous source rows include relationId");
    res = await api.post("/api/dashboard/premium-upgrades").set(headers).send({
      kind: "option",
      sourceId: String(multiContextOption._id),
      upgradeDeltaHalala: 2500,
      currency: "SAR",
      isActive: true,
      isVisible: true,
      sortOrder: 10,
    });
    expectStatus(res, 400, "ambiguous simplified option create requires relation");
    assert.strictEqual(res.body.error.code, "PREMIUM_SOURCE_RELATION_AMBIGUOUS");
    assert.strictEqual(res.body.error.details.candidateRelations.length, 2);
    const selectedAmbiguousSource = multiContextSources.find((source) => source.sourceProductKey === "alternate_basic_meal_for_premium_relation");
    assert(selectedAmbiguousSource, "alternate relation is selectable by relationId");
    res = await api.post("/api/dashboard/premium-upgrades").set(headers).send({
      kind: "option",
      sourceId: String(multiContextOption._id),
      relationId: selectedAmbiguousSource.relationId,
      upgradeDeltaHalala: 2500,
      currency: "SAR",
      isActive: true,
      isVisible: true,
      sortOrder: 10,
    });
    expectStatus(res, 201, "ambiguous option create accepts selected relationId");
    assert.strictEqual(res.body.data.source.productId, String(alternateMealForAmbiguousOption._id));
    assert.strictEqual(res.body.data.source.groupId, String(proteinsGroup._id));
    await PremiumUpgradeConfig.deleteOne({ premiumKey: "multi_context_premium" });
    await ProductGroupOption.deleteMany({ optionId: multiContextOption._id });
    await ProductOptionGroup.deleteOne({ productId: alternateMealForAmbiguousOption._id, groupId: proteinsGroup._id });
    await MenuOption.deleteOne({ _id: multiContextOption._id });
    await MenuProduct.deleteOne({ _id: alternateMealForAmbiguousOption._id });

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

    const normalSubscriptionProduct = await MenuProduct.create({
      categoryId: basicMeal.categoryId,
      key: "normal_subscription_product",
      name: { en: "Normal Subscription Product", ar: "منتج اشتراك عادي" },
      priceHalala: 1700,
      availableFor: ["subscription"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    });
    res = await api.get("/api/dashboard/premium-upgrades/sources?kind=product&limit=100").set(headers);
    expectStatus(res, 200, "normal products excluded from product sources");
    assert(!res.body.data.some((source) => source.sourceId === String(normalSubscriptionProduct._id)));
    res = await api.get("/api/dashboard/premium-upgrades/candidates?sourceType=menu_product&includeLinked=true&limit=100").set(headers);
    expectStatus(res, 200, "normal products excluded from product candidates");
    assert(!res.body.data.some((candidate) => candidate.sourceId === String(normalSubscriptionProduct._id)));

    res = await api.get("/api/dashboard/premium-upgrades/readiness").set(headers);
    expectStatus(res, 200, "legacy fallback readiness");
    assert.strictEqual(res.body.isReady, true);
    assert.strictEqual(res.body.diagnostics.configState.isEmpty, true);
    assert.strictEqual(res.body.diagnostics.configState.legacyFallbackActive, false);
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
    ]), sourceCounts, "seedCatalog correctly skips existing premium items");
    await PremiumUpgradeConfig.deleteMany({});

    res = await api.post("/api/dashboard/premium-upgrades").set(headers).send({
      kind: "option",
      sourceId: String(beef._id),
      sourceProductId: String(basicMeal._id),
      sourceGroupId: String(proteinsGroup._id),
      upgradeDeltaHalala: 1500,
      currency: "SAR",
      isActive: true,
      isVisible: true,
      sortOrder: 10,
    });
    expectStatus(res, 201, "create option-backed config");
    const beefConfig = res.body.data;
    assert.strictEqual(beefConfig.key, "beef_steak");
    assert.strictEqual(beefConfig.kind, "option");
    assert.strictEqual(beefConfig.source.type, "menu_option");
    assert.strictEqual(beefConfig.pricing.upgradeDeltaHalala, 1500);
    assert.strictEqual(beefConfig.health.status, "ready");

    res = await api.get("/api/dashboard/premium-upgrades/candidates").set(headers);
    expectStatus(res, 200, "linked candidates excluded by default");
    assert(!res.body.data.some((candidate) => candidate.premiumKey === "beef_steak"));
    res = await api.get("/api/dashboard/premium-upgrades/candidates?includeLinked=true").set(headers);
    expectStatus(res, 200, "linked candidates included on request");
    assert(res.body.data.some((candidate) => candidate.premiumKey === "beef_steak" && candidate.isLinked));

    res = await api.get("/api/dashboard/premium-upgrades/readiness").set(headers);
    expectStatus(res, 200, "single dynamic config readiness");
    assert.strictEqual(res.body.isReady, true);
    assert.strictEqual(res.body.diagnostics.configState.legacyFallbackActive, false);
    assert.strictEqual(res.body.diagnostics.configState.partialConfigRisk, false);
    assert.strictEqual(res.body.diagnostics.configState.backfillStatus, "complete");

    res = await api.post("/api/dashboard/premium-upgrades").set(headers).send({
      kind: "product",
      sourceId: String(premiumSalad._id),
      upgradeDeltaHalala: 3100,
    });
    expectStatus(res, 201, "create product-backed premium salad config");
    const saladConfig = res.body.data;
    assert.strictEqual(saladConfig.key, "premium_large_salad");
    assert.strictEqual(saladConfig.kind, "product");

    const alternatePremiumSalad = await MenuProduct.create({
      categoryId: basicMeal.categoryId,
      key: "premium_large_salad_v2_source",
      itemType: "premium_large_salad",
      name: { en: "Premium Large Salad V2", ar: "سلطة كبيرة مميزة ٢" },
      priceHalala: 3200,
      availableFor: ["subscription"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    });
    res = await api.patch(`/api/dashboard/premium-upgrades/${saladConfig.id}`).set(headers).send({
      expectedRevision: saladConfig.revision,
      kind: "product",
      sourceId: String(alternatePremiumSalad._id),
    });
    expectStatus(res, 200, "premium salad relink preserves premiumKey when product key differs");
    const relinkedSaladConfig = res.body.data;
    assert.strictEqual(relinkedSaladConfig.key, "premium_large_salad");
    assert.strictEqual(relinkedSaladConfig.source.id, String(alternatePremiumSalad._id));

    res = await api.patch(`/api/dashboard/premium-upgrades/${saladConfig.id}`).set(headers).send({
      expectedRevision: relinkedSaladConfig.revision,
      kind: "product",
      sourceId: String(normalSubscriptionProduct._id),
    });
    expectStatus(res, 400, "incompatible normal product relink rejected");
    assert.strictEqual(res.body.code || res.body.error?.code, "PREMIUM_RELINK_KEY_MISMATCH");

    const createKnownOptionConfig = async (option, price) => {
      const candidateRes = await api.get(`/api/dashboard/premium-upgrades/candidates?includeLinked=true&q=${option.key}`).set(headers);
      expectStatus(candidateRes, 200, `candidate for ${option.key}`);
      const candidate = candidateRes.body.data.find((row) => row.premiumKey === option.key);
      assert(candidate, `eligible candidate exists for ${option.key}`);
      const createRes = await api.post("/api/dashboard/premium-upgrades").set(headers).send({
        kind: "option",
        sourceId: candidate.sourceId,
        sourceProductId: candidate.sourceProductId,
        sourceGroupId: candidate.sourceGroupId,
        upgradeDeltaHalala: price,
      });
      expectStatus(createRes, 201, `create ${option.key} config`);
      return createRes.body.data;
    };
    await createKnownOptionConfig(shrimp, 2000);
    await createKnownOptionConfig(salmon, 2000);

    res = await api.get("/api/dashboard/premium-upgrades/candidates?includeLinked=true&limit=100").set(headers);
    expectStatus(res, 200, "all linked candidates included");
    const allCandidates = res.body.data;
    for (const premiumKey of ["beef_steak", "shrimp", "salmon", "premium_large_salad"]) {
      assert(allCandidates.some((candidate) => candidate.premiumKey === premiumKey), `candidate generated for ${premiumKey}`);
    }

    res = await api.get("/api/dashboard/premium-upgrades/sources?kind=option&limit=100").set(headers);
    expectStatus(res, 200, "source conflict metadata");
    const linkedBeefSource = res.body.data.find((source) => source.sourceId === String(beef._id) && source.sourceProductId === String(basicMeal._id));
    assert(linkedBeefSource, "linked beef source row exists");
    assert.strictEqual(linkedBeefSource.linked, true);
    assert.strictEqual(linkedBeefSource.linkedConfigId, beefConfig.id);
    assert.strictEqual(linkedBeefSource.conflictReason, "SOURCE_ALREADY_LINKED");
    res = await api.get(`/api/dashboard/premium-upgrades/sources?kind=option&excludeConfigId=${beefConfig.id}&limit=100`).set(headers);
    expectStatus(res, 200, "source conflict excludes current config");
    const selfBeefSource = res.body.data.find((source) => source.sourceId === String(beef._id) && source.sourceProductId === String(basicMeal._id));
    assert(selfBeefSource, "self linked beef source row exists");
    assert.strictEqual(selfBeefSource.linked, false);
    assert.strictEqual(selfBeefSource.linkedConfigId, beefConfig.id);
    assert.strictEqual(selfBeefSource.conflictReason, null);
    res = await api.get("/api/dashboard/meal-builder").set(headers);
    expectStatus(res, 200, "dashboard meal builder exposes automatic premium section");
    assert.strictEqual(res.body.data.premiumSection.automatic, true);
    assert.strictEqual(res.body.data.premiumSection.source, "premium_upgrade_configs");
    for (const premiumKey of ["beef_steak", "shrimp", "salmon", "premium_large_salad"]) {
      const item = res.body.data.premiumSection.items.find((row) => row.premiumKey === premiumKey);
      assert(item, `automatic premium section includes ${premiumKey}`);
      assert.strictEqual(item.health, "ready");
    }

    await MealBuilderConfig.deleteMany({ status: "draft" });
    res = await api.get("/api/dashboard/meal-builder/published").set(headers);
    expectStatus(res, 200, "latest published meal builder");
    const publishedVersionId = res.body.data.config.versionId;
    const publishedSectionCount = res.body.data.config.sections.length;
    assert(publishedSectionCount > 0, "published menu has sections");
    res = await api.get("/api/dashboard/meal-builder/draft").set(headers);
    expectStatus(res, 200, "open working draft clones published");
    assert.strictEqual(res.body.data.mode, "draft");
    assert.strictEqual(res.body.data.basedOnPublishedVersionId, publishedVersionId);
    assert.strictEqual(res.body.data.sections.length, publishedSectionCount, "draft clone starts from latest published sections");
    res = await api.put("/api/dashboard/meal-builder/draft").set(headers).send({ sections: [] });
    expectStatus(res, 200, "invalid empty draft can be saved as working draft");
    res = await api.post("/api/dashboard/meal-builder/publish").set(headers).send({});
    expectStatus(res, 422, "failed publish rejects invalid draft");
    res = await api.get("/api/dashboard/meal-builder/published").set(headers);
    expectStatus(res, 200, "published unchanged after failed publish");
    assert.strictEqual(res.body.data.config.versionId, publishedVersionId);
    res = await api.post("/api/dashboard/meal-builder/draft/reset").set(headers).send({});
    expectStatus(res, 200, "reset draft to latest published");
    assert.strictEqual(res.body.data.reset, true);
    assert.strictEqual(res.body.data.basedOnPublishedVersionId, publishedVersionId);
    assert.strictEqual(res.body.data.draft.sections.length, publishedSectionCount, "reset draft restores published sections");

    res = await api.get("/api/dashboard/premium-upgrades/candidates").set(headers);
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
    assert.strictEqual(updatedBeefConfig.pricing.upgradeDeltaHalala, 2000);
    assert.strictEqual(updatedBeefConfig.revision, authoritativeBeefConfig.revision + 1);

    for (const immutableField of ["sourceProductId", "sourceGroupId", "selectionType", "premiumKey"]) {
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
    assert.strictEqual(hiddenBeefConfig.display.visible, false);

    res = await api.post("/api/dashboard/menu/publish").set(headers);
    expectStatus(res, 200, "publish after hiding beef config");

    res = await api.get("/api/subscriptions/meal-planner-menu?lang=en");
    expectStatus(res, 200, "planner after hidden config");
    
    assert(!findPremiumOption(res.body.data, "beef_steak"), "hidden beef config is removed from client planner");

    await assert.rejects(
      () => validateCanonicalMealSlots({
        mealSlots: [premiumMealSlot({ productId: basicMeal._id, groupId: proteinsGroup._id, optionId: beef._id })],
        mealsPerDayLimit: 1,
        subscription: { premiumBalance: [] },
      }),
      (err) => err && err.code === "PREMIUM_UPGRADE_UNAVAILABLE",
      "hidden config rejects new canonical submissions"
    );

    res = await api.post(`/api/dashboard/premium-upgrades/${saladConfig.id}/archive`).set(headers).send({
      expectedRevision: relinkedSaladConfig.revision,
      reason: "test archive",
    });
    expectStatus(res, 200, "archive soft archives");
    assert.strictEqual(res.body.data.compatibility.status, "archived");
    assert.strictEqual(res.body.data.display.enabled, false);
    assert.strictEqual(res.body.data.display.visible, false);

    res = await api.get("/api/dashboard/premium-upgrades").set(headers);
    expectStatus(res, 200, "dashboard list includes archived");
    assert(res.body.data.some((row) => row.id === saladConfig.id && row.status === "archived"), "archived config remains visible in dashboard list");
    const compactBeef = res.body.data.find((row) => row.id === beefConfig.id);
    assert(compactBeef, "compact list includes beef row");
    for (const hiddenField of ["revision", "sourceProductId", "sourceGroupId", "sourceGroupKey", "displayGroup", "sourceStatus", "validation", "businessRule", "createdAt", "updatedAt", "archivedAt"]) {
      assert(!Object.prototype.hasOwnProperty.call(compactBeef, hiddenField), `compact list hides ${hiddenField}`);
    }
    assert.strictEqual(compactBeef.key, "beef_steak");
    assert.strictEqual(compactBeef.kind, "option");
    assert.strictEqual(compactBeef.priceHalala, 2000);
    assert.strictEqual(compactBeef.health, "ready");

    res = await api.get("/api/subscriptions/meal-planner-menu?lang=en");
    expectStatus(res, 200, "planner after archived salad");
    const saladSection = res.body.data.plannerCatalog.sections.find((section) => section.key === "premium_large_salad");
    assert(!saladSection || saladSection.products.length === 0, "archived premium salad is hidden from client planner");
    res = await api.get("/api/dashboard/meal-builder").set(headers);
    expectStatus(res, 200, "dashboard automatic section after archived salad");
    assert(!res.body.data.premiumSection.items.some((row) => row.premiumKey === "premium_large_salad"), "archived premium salad excluded from automatic section");

    assert(await MenuProduct.exists({ _id: premiumSalad._id }), "archive does not delete MenuProduct");
    assert(await MenuOption.exists({ _id: beef._id }), "state changes do not delete MenuOption");
    assert(await ProductOptionGroup.exists({ productId: premiumSalad._id }), "archive does not delete product group relations");
    assert(await ProductGroupOption.exists({ productId: basicMeal._id, optionId: beef._id }), "archive does not delete option relations");

    const archivedDoc = await PremiumUpgradeConfig.findById(saladConfig.id).lean();
    assert(archivedDoc && archivedDoc.status === "archived", "archived config was soft archived");

    const brokenSourceOption = await MenuOption.create({
      groupId: proteinsGroup._id,
      key: "broken_relink_source",
      name: { en: "Broken Relink Source", ar: "مصدر ربط محذوف" },
      availableFor: ["subscription"],
      availableForSubscription: true,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    });
    await ProductGroupOption.create({
      productId: basicMeal._id,
      groupId: proteinsGroup._id,
      optionId: brokenSourceOption._id,
      extraPriceHalala: 2100,
    });
    res = await api.post("/api/dashboard/premium-upgrades").set(headers).send({
      kind: "option",
      sourceId: String(brokenSourceOption._id),
      sourceProductId: String(basicMeal._id),
      sourceGroupId: String(proteinsGroup._id),
      upgradeDeltaHalala: 2100,
    });
    expectStatus(res, 201, "create relink source config");
    const relinkConfig = res.body.data;
    await MenuOption.deleteOne({ _id: brokenSourceOption._id });

    res = await api.get("/api/dashboard/premium-upgrades").set(headers);
    expectStatus(res, 200, "compact list with broken source");
    const brokenRow = res.body.data.find((row) => row.id === relinkConfig.id);
    assert(brokenRow, "broken config remains listed");
    assert.strictEqual(brokenRow.status, "active");
    assert.strictEqual(brokenRow.health, "broken");
    assert.strictEqual(brokenRow.issueCode, "SOURCE_NOT_FOUND");

    res = await api.get(`/api/dashboard/premium-upgrades/${relinkConfig.id}`).set(headers);
    expectStatus(res, 200, "detail with broken source diagnostics");
    assert.strictEqual(res.body.data.health.status, "broken");
    assert.strictEqual(res.body.data.health.code, "SOURCE_NOT_FOUND");
    assert.strictEqual(res.body.data.repair.currentPremiumKey, "broken_relink_source");
    assert.strictEqual(res.body.data.repair.missingSourceId, String(brokenSourceOption._id));
    assert.strictEqual(res.body.data.repair.expectedKind, "option");
    assert.strictEqual(res.body.data.repair.canRelink, false);

    res = await api.get("/api/dashboard/premium-upgrades?health=broken&limit=1").set(headers);
    expectStatus(res, 200, "health broken filter");
    assert(res.body.data.every((row) => row.health === "broken"), "health=broken only returns broken rows");
    assert.strictEqual(res.body.meta.total, 1, "pagination total reflects health=broken filter");
    res = await api.get("/api/dashboard/premium-upgrades?health=ready&limit=1").set(headers);
    expectStatus(res, 200, "health ready filter");
    assert(res.body.data.every((row) => row.health === "ready"), "health=ready only returns ready rows");
    assert(res.body.meta.total > res.body.data.length, "pagination total reflects full ready set");

    res = await api.get("/api/dashboard/premium-upgrades").set(kitchenHeaders);
    expectStatus(res, 200, "kitchen can read premium upgrades");
    res = await api.patch(`/api/dashboard/premium-upgrades/${relinkConfig.id}`).set(kitchenHeaders).send({
      expectedRevision: relinkConfig.revision,
      upgradeDeltaHalala: 2200,
    });
    expectStatus(res, 403, "kitchen cannot mutate premium upgrades");

    const relinkTargetOption = await MenuOption.create({
      groupId: proteinsGroup._id,
      key: "broken_relink_target",
      premiumKey: "broken_relink_source",
      name: { en: "Broken Relink Target", ar: "مصدر ربط بديل" },
      availableFor: ["subscription"],
      availableForSubscription: true,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    });
    const alternateRelinkProduct = await MenuProduct.create({
      categoryId: basicMeal.categoryId,
      key: "alternate_relink_meal",
      name: { en: "Alternate Relink Meal", ar: "وجبة ربط بديلة" },
      priceHalala: 4500,
      availableFor: ["subscription"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    });
    await ProductOptionGroup.create({
      productId: alternateRelinkProduct._id,
      groupId: proteinsGroup._id,
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      isActive: true,
      isVisible: true,
      isAvailable: true,
    });
    await ProductGroupOption.create({
      productId: alternateRelinkProduct._id,
      groupId: proteinsGroup._id,
      optionId: relinkTargetOption._id,
      extraPriceHalala: 2100,
    });
    res = await api.patch(`/api/dashboard/premium-upgrades/${relinkConfig.id}`).set(headers).send({
      expectedRevision: relinkConfig.revision,
      kind: "option",
      sourceId: String(relinkTargetOption._id),
    });
    expectStatus(res, 200, "broken source can be relinked with simplified option payload");
    assert.strictEqual(res.body.data.key, "broken_relink_source");
    assert.strictEqual(res.body.data.health.status, "ready");
    const relinkedDoc = await PremiumUpgradeConfig.findById(relinkConfig.id).lean();
    assert.strictEqual(relinkedDoc.premiumKey, "broken_relink_source");
    assert.strictEqual(String(relinkedDoc.sourceProductId), String(alternateRelinkProduct._id));
    assert.strictEqual(String(relinkedDoc.sourceGroupId), String(proteinsGroup._id));
    assert.strictEqual(relinkedDoc.revision, relinkConfig.revision + 1);
    assert.strictEqual(relinkedDoc.metadata.previousSources[0].premiumKey, "broken_relink_source");

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
