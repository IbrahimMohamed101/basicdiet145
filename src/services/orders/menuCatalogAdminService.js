function createMenuCatalogAdminService(deps) {
  const {
    MenuCategory,
    MenuProduct,
    MenuOptionGroup,
    MenuOption,
    ProductOptionGroup,
    ProductGroupOption,
    MenuAuditLog,
    BuilderProtein,
    Sandwich,
    Setting,
    SYSTEM_CURRENCY,
    VAT_PERCENTAGE,
    assertCatalogItemLinkable,
    filterGloballyAvailable,
    loadCatalogItemsByIdForDocs,
    generateUniqueKey,
    isAllowedCategoryCardVariant,
    isAllowedCardVariant,
    isAllowedProductCardSize,
    isAllowedGroupDisplayStyle,
    normalizeCategoryUiMetadata,
    normalizeGroupUiMetadata,
    normalizeProductUiMetadata,
    normalizeUiMetadata,
    localizeName,
    localizedPair,
    truthyByDefault,
    serializePublicCategory,
    serializePublicProduct,
    serializePublicGroup,
    serializePublicOption,
    serializeDashboardPreviewCategory,
    serializeDashboardPreviewProduct,
    serializeDashboardPreviewGroup,
    serializeDashboardPreviewOption,
    isCustomerVisibleProduct,
    isCustomerVisibleGroup,
    isCustomerVisibleOption,
    resolvePublicProductCategory,
    sortPublicProducts,
    validateMenuCatalog,
    MenuValidationError,
    MenuNotFoundError,
    assertObjectId,
    normalizeOptionalObjectId,
    mirrorCompatibilityImage,
    isPlainObject,
    normalizeKey,
    normalizeOptionalKey,
    assertImmutableKey,
    assertImmutableCatalogItemLink,
    localizedString,
    optionalLocalizedString,
    normalizeBoolean,
    normalizeNonNegativeInteger,
    normalizeNullableNonNegativeInteger,
    normalizeStringArray,
    normalizeAvailableFor,
    normalizeOptionalString,
    serializeDoc,
    parsePaginationOptions,
    inferProductCustomizable,
    refreshProductCustomizableFromRelations,
    customerCatalogQuery,
    availableForChannelQuery,
    customerRelationQuery,
    assertCustomerAvailable,
    assertRelationAvailable,
    getSettingValue,
    writeMenuAudit,
  } = deps;

  function serializeDashboardOption(option) {
    const payload = serializeDoc(option);
    if (!payload) return null;

    const extraPrice = payload.extraPriceHalala || 0;
    const extraFee = (payload.extraFeeHalala !== undefined && payload.extraFeeHalala !== null && payload.extraFeeHalala !== 0)
      ? payload.extraFeeHalala
      : extraPrice;

    return {
      id: payload.id || String(payload._id),
      _id: payload._id,
      groupId: payload.groupId,
      catalogItemId: payload.catalogItemId !== undefined ? payload.catalogItemId : null,
      key: payload.key || "",
      name: payload.name || { ar: "", en: "" },
      description: payload.description || { ar: "", en: "" },
      imageUrl: payload.imageUrl || "",
      extraPriceHalala: extraPrice,
      extraWeightUnitGrams: payload.extraWeightUnitGrams || 0,
      extraWeightPriceHalala: payload.extraWeightPriceHalala || 0,
      currency: payload.currency || SYSTEM_CURRENCY,
      availableFor: payload.availableFor || ["one_time", "subscription"],
      availableForSubscription: payload.availableForSubscription !== undefined ? payload.availableForSubscription : true,
      nutrition: payload.nutrition || { calories: 0, proteinGrams: 0, carbGrams: 0, fatGrams: 0 },
      proteinFamilyKey: payload.proteinFamilyKey || "",
      displayCategoryKey: payload.displayCategoryKey || "",
      premiumKey: payload.premiumKey || "",
      ruleTags: payload.ruleTags || [],
      selectionType: payload.selectionType || "",
      extraFeeHalala: extraFee,
      isVisible: payload.isVisible !== undefined ? payload.isVisible : true,
      isAvailable: payload.isAvailable !== undefined ? payload.isAvailable : true,
      isActive: payload.isActive !== undefined ? payload.isActive : true,
      sortOrder: payload.sortOrder || 0,
      publishedAt: payload.publishedAt || null,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
    };
  }

  async function getDashboardMenuPreview({ lang = "en", includeInactive = false, branchId = "" } = {}) {
    const showInactive = normalizeBoolean(includeInactive, "includeInactive", false);
    const statusQuery = showInactive ? {} : {
      isActive: true,
      isVisible: { $ne: false },
      isAvailable: { $ne: false },
    };
    const productQuery = {
      ...statusQuery,
      ...availableForChannelQuery("one_time"),
    };
    const optionQuery = {
      ...statusQuery,
      ...availableForChannelQuery("one_time"),
    };
    const categoryQuery = { ...statusQuery };
    const relationQuery = { ...statusQuery };
    if (branchId) {
      const channelOr = productQuery.$or;
      delete productQuery.$or;
      productQuery.$and = [
        { $or: channelOr },
        { $or: [{ branchAvailability: { $size: 0 } }, { branchAvailability: branchId }] },
      ];
      categoryQuery.$or = [{ "availability.branchIds": { $size: 0 } }, { "availability.branchIds": branchId }];
    }

    const [categories, products, groupRelations, optionRelations, groups, options, validation] = await Promise.all([
      MenuCategory.find(categoryQuery).sort({ sortOrder: 1, createdAt: -1 }).lean(),
      MenuProduct.find(productQuery).sort({ sortOrder: 1, createdAt: -1 }).lean(),
      ProductOptionGroup.find(relationQuery).sort({ sortOrder: 1, createdAt: -1 }).lean(),
      ProductGroupOption.find(relationQuery).sort({ sortOrder: 1, createdAt: -1 }).lean(),
      MenuOptionGroup.find(statusQuery).lean(),
      MenuOption.find(optionQuery).lean(),
      validateMenuCatalog().catch((err) => ({
        ok: false,
        warnings: [`Preview validation failed: ${err.message || "unknown error"}`],
        errors: [],
      })),
    ]);

    const categoryIds = new Set(categories.map((category) => String(category._id)));
    const categoriesById = new Map(categories.map((category) => [String(category._id), category]));
    const categoriesByKey = new Map(categories.map((category) => [category.key, category]));
    const productsById = new Map(
      products
        .filter((product) => categoryIds.has(String(product.categoryId)))
        .map((product) => [String(product._id), product])
    );
    const groupsById = new Map(groups.map((group) => [String(group._id), group]));
    const optionsById = new Map(options.map((option) => [String(option._id), option]));
    const optionRelationsByProductGroup = new Map();
    const productsByCategory = new Map();

    optionRelations.forEach((relation) => {
      const key = `${relation.productId}:${relation.groupId}`;
      if (!optionRelationsByProductGroup.has(key)) optionRelationsByProductGroup.set(key, []);
      optionRelationsByProductGroup.get(key).push(relation);
    });

    groupRelations.forEach((relation) => {
      const product = productsById.get(String(relation.productId));
      const group = groupsById.get(String(relation.groupId));
      if (!product || !group) return;
      const optionRows = (optionRelationsByProductGroup.get(`${relation.productId}:${relation.groupId}`) || [])
        .map((optionRelation) => {
          const option = optionsById.get(String(optionRelation.optionId));
          if (!option) return null;
          return serializeDashboardPreviewOption(optionRelation, option, lang);
        })
        .filter(Boolean)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const serializedGroup = serializeDashboardPreviewGroup(relation, group, optionRows, lang);
      if (!product._publicGroups) product._publicGroups = [];
      product._publicGroups.push(serializedGroup);
    });

    productsById.forEach((product) => {
      const category = resolvePublicProductCategory(product, categoriesById, categoriesByKey);
      if (!category || String(product.categoryId) !== String(category._id)) return;
      product._publicCategoryKey = category.key;
      const categoryId = String(category._id);
      if (!productsByCategory.has(categoryId)) productsByCategory.set(categoryId, []);
      const groupsForProduct = Array.isArray(product._publicGroups)
        ? product._publicGroups.sort((a, b) => a.sortOrder - b.sortOrder)
        : [];
      productsByCategory.get(categoryId).push(serializeDashboardPreviewProduct(product, lang, groupsForProduct, category._id));
    });

    const serializedCategories = categories
      .map((category) => {
        const rows = (productsByCategory.get(String(category._id)) || [])
          .sort(sortPublicProducts);
        return serializeDashboardPreviewCategory(category, lang, rows);
      })
      .filter((category) => showInactive || category.products.length > 0);

    return {
      contractVersion: "dashboard_menu_preview.v1",
      source: "one_time_order",
      fulfillmentMethod: "pickup",
      currency: SYSTEM_CURRENCY,
      vatIncluded: true,
      vatPercentage: VAT_PERCENTAGE,
      includeInactive: showInactive,
      warnings: [...(validation.warnings || []), ...(validation.errors || [])],
      categories: serializedCategories,
    };
  }

  return {
    serializeDashboardOption,
    getDashboardMenuPreview,
  };
}

module.exports = {
  createMenuCatalogAdminService,
};
