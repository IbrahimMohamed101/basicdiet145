const mongoose = require("mongoose");

const MenuCategory = require("../../models/MenuCategory");
const MenuOption = require("../../models/MenuOption");
const MenuOptionGroup = require("../../models/MenuOptionGroup");
const MenuProduct = require("../../models/MenuProduct");
const MenuVersion = require("../../models/MenuVersion");
const ProductGroupOption = require("../../models/ProductGroupOption");
const ProductOptionGroup = require("../../models/ProductOptionGroup");
const { getNutritionAudit } = require("../catalog/menuNutritionAuditService");

function createMenuReleaseService({
  getPublishedMenu,
  writeMenuAudit,
  serializeDoc,
  parsePaginationOptions,
  assertObjectId,
  MenuValidationError,
  MenuNotFoundError,
}) {
  async function buildDashboardCatalogSnapshot() {
    const [categories, products, optionGroups, options, productGroups, productGroupOptions] = await Promise.all([
      MenuCategory.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
      MenuProduct.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
      MenuOptionGroup.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
      MenuOption.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
      ProductOptionGroup.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
      ProductGroupOption.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    ]);
    return {
      version: 1,
      capturedAt: new Date(),
      categories: categories.map(serializeDoc),
      products: products.map(serializeDoc),
      optionGroups: optionGroups.map(serializeDoc),
      options: options.map(serializeDoc),
      productGroups: productGroups.map(serializeDoc),
      productGroupOptions: productGroupOptions.map(serializeDoc),
    };
  }

  async function publishMenu({ actor = {}, notes = "" } = {}) {
    // Opt-in strict rollout after baseline approval. Prevent partial writes by
    // running the entire read-only data-quality check before any publication.
    if (process.env.MENU_NUTRITION_APPROVAL_GATE === "true") {
      const audit = await getNutritionAudit({ includeDrafts: true });
      if (audit.totals.needingReview > 0) {
        throw new MenuValidationError(
          "Menu nutrition review is incomplete",
          "MENU_NUTRITION_APPROVAL_REQUIRED",
          409,
          {
            needingReview: audit.totals.needingReview,
            issueCounts: audit.issueCounts,
            sample: audit.items.filter((item) => item.issues.length).slice(0, 20),
          }
        );
      }
    }
    const publishedAt = new Date();
    await Promise.all([
      MenuCategory.updateMany({ isActive: true }, { $set: { publishedAt } }),
      MenuProduct.updateMany({ isActive: true }, { $set: { publishedAt } }),
      MenuOptionGroup.updateMany({ isActive: true }, { $set: { publishedAt } }),
      MenuOption.updateMany({ isActive: true }, { $set: { publishedAt } }),
    ]);
    const [publicSnapshot, dashboardCatalog] = await Promise.all([
      getPublishedMenu({ lang: "en" }).catch(() => ({})),
      buildDashboardCatalogSnapshot(),
    ]);
    const snapshot = { ...publicSnapshot, dashboardCatalog };
    await MenuVersion.updateMany({ status: "published" }, { $set: { status: "archived" } });
    const version = await MenuVersion.create({
      status: "published",
      publishedAt,
      publishedBy: actor.userId && mongoose.Types.ObjectId.isValid(actor.userId) ? actor.userId : null,
      notes: String(notes || ""),
      snapshot,
    });
    await MenuProduct.updateMany({ isActive: true }, { $set: { versionId: version._id } });
    await writeMenuAudit({ entityType: "menu_version", entityId: version._id, action: "publish", after: version.toObject(), actor });
    return serializeDoc(version);
  }

  async function listMenuVersions(options = {}) {
    const pagination = parsePaginationOptions(options);
    const find = MenuVersion.find({}).sort({ createdAt: -1 }).lean();
    if (!pagination) {
      const rows = await find.limit(Math.min(100, Math.max(1, Number(options.limit || 20))));
      return rows.map(serializeDoc);
    }
    const [rows, total] = await Promise.all([
      find.skip(pagination.skip).limit(pagination.limit),
      MenuVersion.countDocuments({}),
    ]);
    return {
      items: rows.map(serializeDoc),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        pages: Math.ceil(total / pagination.limit),
      },
    };
  }

  function snapshotId(row) {
    return String(row && (row.id || row._id) || "");
  }

  function stripSnapshotMetadata(row) {
    const next = { ...(row || {}) };
    delete next.id;
    delete next._id;
    delete next.__v;
    delete next.createdAt;
    delete next.updatedAt;
    return next;
  }

  async function restoreModelSnapshot(Model, rows, publishedAt, { publishable = true } = {}) {
    const ids = rows.map(snapshotId).filter(Boolean);
    if (publishable) {
      await Model.updateMany(
        { _id: { $nin: ids } },
        { $set: { isActive: false, isVisible: false, isAvailable: false, publishedAt: null } }
      );
    }
    for (const row of rows) {
      const id = snapshotId(row);
      if (!id) continue;
      const payload = stripSnapshotMetadata(row);
      if (publishable && payload.publishedAt) payload.publishedAt = publishedAt;
      await Model.updateOne(
        { _id: id },
        { $set: payload, $setOnInsert: { _id: new mongoose.Types.ObjectId(id) } },
        { upsert: true }
      );
    }
  }

  async function restoreRelationSnapshot(Model, rows) {
    await Model.deleteMany({});
    if (!rows.length) return;
    await Model.insertMany(rows.map((row) => ({
      _id: new mongoose.Types.ObjectId(snapshotId(row)),
      ...stripSnapshotMetadata(row),
    })));
  }

  async function restoreDashboardCatalogSnapshot(snapshot, { versionId, actor = {} } = {}) {
    const requiredArrays = ["categories", "products", "optionGroups", "options", "productGroups", "productGroupOptions"];
    const invalid = requiredArrays.filter((key) => !Array.isArray(snapshot[key]));
    if (invalid.length) {
      throw new MenuValidationError("Version dashboard snapshot is incomplete or invalid", "ROLLBACK_INVALID_SNAPSHOT", 400, { invalid });
    }
    const publishedAt = new Date();
    await restoreModelSnapshot(MenuCategory, snapshot.categories, publishedAt);
    await restoreModelSnapshot(MenuProduct, snapshot.products, publishedAt);
    await restoreModelSnapshot(MenuOptionGroup, snapshot.optionGroups, publishedAt);
    await restoreModelSnapshot(MenuOption, snapshot.options, publishedAt);
    await restoreRelationSnapshot(ProductOptionGroup, snapshot.productGroups);
    await restoreRelationSnapshot(ProductGroupOption, snapshot.productGroupOptions);
    const restored = {
      categories: snapshot.categories.length,
      products: snapshot.products.length,
      optionGroups: snapshot.optionGroups.length,
      options: snapshot.options.length,
      productGroups: snapshot.productGroups.length,
      productGroupOptions: snapshot.productGroupOptions.length,
    };
    await writeMenuAudit({
      entityType: "menu_version",
      entityId: versionId,
      action: "rollback_restore",
      actor,
      meta: { restored, snapshotVersion: snapshot.version || 0 },
    });
    return { ok: true, versionId: String(versionId), restoredFrom: "dashboard_catalog_snapshot", restored };
  }

  async function rollbackMenuVersion(versionId, { confirm = false, actor = {} } = {}) {
    if (!confirm) throw new MenuValidationError("أرسل confirm: true في الـ body", "ROLLBACK_CONFIRMATION_REQUIRED");
    assertObjectId(versionId);
    const version = await MenuVersion.findById(versionId).lean();
    if (!version) throw new MenuNotFoundError("Version not found");
    const snapshot = version.snapshot || {};
    if (snapshot.dashboardCatalog) {
      return restoreDashboardCatalogSnapshot(snapshot.dashboardCatalog, { versionId, actor });
    }
    if (!snapshot.categories) {
      throw new MenuValidationError("Version snapshot is incomplete or invalid", "ROLLBACK_INVALID_SNAPSHOT");
    }
    await Promise.all([
      MenuCategory.updateMany({}, { $set: { publishedAt: null } }),
      MenuProduct.updateMany({}, { $set: { publishedAt: null } }),
      MenuOptionGroup.updateMany({}, { $set: { publishedAt: null } }),
      MenuOption.updateMany({}, { $set: { publishedAt: null } }),
    ]);
    const publishedAt = new Date();
    for (const category of snapshot.categories || []) {
      await MenuCategory.updateOne({ _id: category.id }, {
        $set: {
          publishedAt,
          isActive: true,
          sortOrder: category.sortOrder,
          name: category.nameI18n,
          description: category.descriptionI18n || (typeof category.description === "string" ? { en: category.description, ar: "" } : category.description),
        },
      });
      for (const product of category.products || []) {
        await MenuProduct.updateOne({ _id: product.id }, {
          $set: {
            publishedAt,
            isActive: true,
            categoryId: category.id,
            priceHalala: product.priceHalala,
            sortOrder: product.sortOrder,
          },
        });
        for (const group of product.optionGroups || []) {
          await ProductOptionGroup.updateOne(
            { productId: product.id, groupId: group.id },
            { $set: {
              isActive: true,
              minSelections: group.minSelections,
              maxSelections: group.maxSelections,
              isRequired: group.isRequired,
              sortOrder: group.sortOrder,
            } },
            { upsert: true }
          );
          for (const option of group.options || []) {
            await MenuOption.updateOne({ _id: option.id }, {
              $set: { publishedAt, isActive: true, groupId: group.id },
            });
            await ProductGroupOption.updateOne(
              { productId: product.id, groupId: group.id, optionId: option.id },
              { $set: {
                isActive: true,
                extraPriceHalala: option.extraPriceHalala,
                extraWeightUnitGrams: option.extraWeightUnitGrams,
                extraWeightPriceHalala: option.extraWeightPriceHalala,
                sortOrder: option.sortOrder,
              } },
              { upsert: true }
            );
          }
        }
      }
    }
    return {
      ok: true,
      versionId: String(versionId),
      restoredFrom: "public_snapshot",
      restored: {
        categories: (snapshot.categories || []).length,
        products: (snapshot.categories || []).flatMap((category) => category.products || []).length,
      },
    };
  }

  async function getMenuDiff() {
    const lastVersion = await MenuVersion.findOne({ status: "published" }).sort({ createdAt: -1 }).lean();
    const currentSnapshot = await getPublishedMenu({ lang: "en" }).catch(() => ({}));
    const lastSnapshot = lastVersion ? lastVersion.snapshot : { categories: [] };
    const lastProducts = new Set((lastSnapshot.categories || []).flatMap((category) => category.products || []).map((product) => product.key));
    const currentProducts = new Set((currentSnapshot.categories || []).flatMap((category) => category.products || []).map((product) => product.key));
    const added = [...currentProducts].filter((key) => !lastProducts.has(key));
    const removed = [...lastProducts].filter((key) => !currentProducts.has(key));
    return {
      lastVersionId: lastVersion ? lastVersion._id : null,
      addedProducts: added,
      removedProducts: removed,
      changedCount: added.length + removed.length,
    };
  }

  return {
    publishMenu,
    listMenuVersions,
    rollbackMenuVersion,
    getMenuDiff,
  };
}

module.exports = { createMenuReleaseService };
