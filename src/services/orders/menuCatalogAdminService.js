function createMenuCatalogAdminService(deps) {
  const {
    mongoose,
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
    buildWeightPricingDescriptor,
  } = deps;

  const hasOwn = (source, fieldName) => Object.prototype.hasOwnProperty.call(source || {}, fieldName);
  const isProvided = (source, fieldName) => hasOwn(source, fieldName) && source[fieldName] !== undefined;

  function assertNonNullablePatchFields(body, existing, fieldNames) {
    if (!existing) return;
    const fieldName = fieldNames.find((field) => hasOwn(body, field) && body[field] === null);
    if (fieldName) {
      throw new MenuValidationError(`${fieldName} cannot be null`, "NULL_NOT_ALLOWED", 400, { fieldName });
    }
  }

  function serializeDashboardCategory(category) {
    return serializeDoc(category);
  }

  function serializeDashboardProduct(product, { isCustomizable } = {}) {
    const payload = serializeDoc(product);
    if (!payload) return null;
    payload.isCustomizable = isCustomizable === undefined
      ? inferProductCustomizable(payload)
      : Boolean(isCustomizable);
    payload.weightStepPriceHalala = payload.weightStepPriceHalala === undefined
      ? null
      : payload.weightStepPriceHalala;
    try {
      payload.weightPricing = buildWeightPricingDescriptor(payload);
    } catch {
      payload.weightPricing = null;
    }
    return payload;
  }

  function serializeDashboardOptionGroup(group) {
    return serializeDoc(group);
  }

  function serializeDashboardProductGroupRelation(relation) {
    return serializeDoc(relation);
  }

  function serializeDashboardProductOptionRelation(relation) {
    return serializeDoc(relation);
  }

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

  function buildListQuery({ includeInactive = false, isActive, isVisible, isAvailable, q, published } = {}) {
    const query = {};
    if (isActive !== undefined && isActive !== null && String(isActive).trim() !== "") {
      query.isActive = normalizeBoolean(isActive, "isActive");
    } else if (!includeInactive) {
      query.isActive = true;
    }
    if (isVisible !== undefined && isVisible !== null && String(isVisible).trim() !== "") {
      query.isVisible = normalizeBoolean(isVisible, "isVisible");
    }
    if (isAvailable !== undefined && isAvailable !== null && String(isAvailable).trim() !== "") {
      query.isAvailable = normalizeBoolean(isAvailable, "isAvailable");
    }
    if (published !== undefined && published !== null && String(published).trim() !== "") {
      const showPublished = normalizeBoolean(published, "published");
      query.publishedAt = showPublished ? { $ne: null } : null;
    }
    if (q !== undefined && q !== null && String(q).trim()) {
      const escaped = String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      query.$or = [{ key: regex }, { "name.ar": regex }, { "name.en": regex }];
    }
    return query;
  }

  function buildProductFilter(options = {}) {
    const {
      categoryId,
      availableFor,
      itemType,
      search,
    } = options;
    const query = buildListQuery({
      ...options,
      q: options.q || search,
    });

    if (categoryId !== undefined && categoryId !== null && String(categoryId).trim() !== "") {
      if (!mongoose.Types.ObjectId.isValid(String(categoryId))) {
        throw new MenuValidationError("Invalid categoryId", "INVALID_CATEGORY_ID", 400);
      }
      query.categoryId = new mongoose.Types.ObjectId(String(categoryId));
    }

    const isAddonPlanPicker = (
      String(options.context || options.linkableFor || "").trim() === "addon_plan"
      || String(options.view || "").trim() === "addon_plan_picker"
    );

    if (!isAddonPlanPicker && availableFor !== undefined && availableFor !== null && String(availableFor).trim() !== "") {
      const channel = String(availableFor).trim();
      if (!["one_time", "subscription"].includes(channel)) {
        throw new MenuValidationError("availableFor contains an unsupported channel");
      }
      query.availableFor = { $in: [channel] };
    }

    if (isAddonPlanPicker && !options.includeInactive) {
      if (options.isVisible === undefined || options.isVisible === null || String(options.isVisible).trim() === "") {
        query.isVisible = true;
      }
      if (options.isAvailable === undefined || options.isAvailable === null || String(options.isAvailable).trim() === "") {
        query.isAvailable = true;
      }
    }

    if (itemType !== undefined && itemType !== null && String(itemType).trim() !== "") {
      query.itemType = String(itemType).trim();
    }

    return query;
  }

  async function listModel(Model, options = {}, extraQuery = {}, serializer = serializeDoc) {
    const query = { ...buildListQuery(options), ...extraQuery };
    const pagination = parsePaginationOptions(options);
    const find = Model.find(query)
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    if (!pagination) {
      const rows = await find;
      return rows.map(serializer);
    }

    const [rows, total] = await Promise.all([
      find.skip(pagination.skip).limit(pagination.limit),
      Model.countDocuments(query),
    ]);

    return {
      items: rows.map(serializer),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        pages: Math.ceil(total / pagination.limit),
      },
    };
  }

  function serializeDashboardPickerProduct(row) {
    const category = row.categoryId && typeof row.categoryId === "object" ? row.categoryId : null;
    return {
      id: String(row._id),
      key: row.key,
      name: row.name,
      category: category ? category.key : (row.category || ""),
      categoryName: category && category.name ? category.name : { ar: "", en: "" },
      image: row.imageUrl || "",
      isActive: row.isActive !== false,
      isVisible: row.isVisible !== false,
      isAvailable: row.isAvailable !== false,
    };
  }

  async function listProducts(options = {}) {
    const query = buildProductFilter(options);
    const isPickerView = options.view === "picker" || options.view === "addon_plan_picker";
    if (isPickerView && !options.includeInactive) {
      query.isActive = true;
    }
    
    const pagination = parsePaginationOptions(options);
    let find = MenuProduct.find(query).sort({ sortOrder: 1, createdAt: -1 });
    
    if (isPickerView) {
      find = find.populate("categoryId");
    }
    
    find = find.lean();
    const serializeFn = isPickerView ? serializeDashboardPickerProduct : serializeDashboardProduct;

    if (!pagination) {
      const rows = await find;
      return rows.map(serializeFn);
    }

    const [rows, total] = await Promise.all([
      find.skip(pagination.skip).limit(pagination.limit),
      MenuProduct.countDocuments(query),
    ]);

    return {
      items: rows.map(serializeFn),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        pages: Math.ceil(total / pagination.limit),
      },
    };
  }

  async function listOptions(options = {}) {
    return listModel(
      MenuOption,
      options,
      options && options.groupId ? { groupId: assertObjectId(options.groupId, "groupId") } : {},
      serializeDashboardOption
    );
  }

  async function listCategories(options = {}) {
    if (options.view === "picker" || options.view === "addon_plan_picker") {
      const categoryQuery = buildListQuery(options);

      // Keep category counts on the exact same product filter used by the picker.
      // categoryId is intentionally omitted so every category receives its own count.
      const productQuery = buildProductFilter(options);
      delete productQuery.categoryId;
      if (!options.includeInactive) {
        productQuery.isActive = true;
      }
      
      const products = await MenuProduct.find(productQuery).select("categoryId").lean();
      const countMap = new Map();
      for (const p of products) {
        if (!p.categoryId) continue;
        const cid = String(p.categoryId);
        countMap.set(cid, (countMap.get(cid) || 0) + 1);
      }
      
      const pagination = parsePaginationOptions(options);
      const find = MenuCategory.find(categoryQuery)
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean();
        
      let categoryDocs = [];
      let total = 0;
      if (!pagination) {
        categoryDocs = await find;
        total = categoryDocs.length;
      } else {
        [categoryDocs, total] = await Promise.all([
          find.skip(pagination.skip).limit(pagination.limit),
          MenuCategory.countDocuments(categoryQuery),
        ]);
      }
      
      const items = categoryDocs.map((c) => ({
        id: String(c._id),
        key: c.key,
        name: c.name || { ar: "", en: "" },
        isActive: c.isActive !== false,
        isVisible: c.isVisible !== false,
        isAvailable: c.isAvailable !== false,
        productsCount: countMap.get(String(c._id)) || 0,
      }));
      
      if (!pagination) {
        return items;
      }
      
      return {
        items,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total,
          pages: Math.ceil(total / pagination.limit),
        },
      };
    }

    return listModel(MenuCategory, options, {}, serializeDashboardCategory);
  }

  async function listOptionGroups(options = {}) {
    return listModel(MenuOptionGroup, options, {}, serializeDashboardOptionGroup);
  }

  async function getModel(Model, id, extraQuery = {}) {
    assertObjectId(id);
    const row = await Model.findOne({ _id: id, ...extraQuery }).lean();
    if (!row) throw new MenuNotFoundError();
    return serializeDoc(row);
  }

  function serializeAdminProductSummary(product) {
    return serializeDashboardProduct(product);
  }

  function serializeCategoryDetailV3(category, products) {
    const categoryPayload = serializeDashboardCategory(category);
    const categoryProducts = (products || []).filter((product) => (
      String(product.categoryId) === String(category._id)
    ));
    return {
      contractVersion: "dashboard_category_detail.v3",
      category: categoryPayload,
      products: categoryProducts.map(serializeAdminProductSummary),
      assignment: {
        relationOwner: "product.categoryId",
        bulkAssignmentEndpoint: `/api/dashboard/menu/categories/${categoryPayload.id}/products`,
      },
      actions: {
        canBulkAssignProducts: true,
        canReorderProducts: true,
      },
    };
  }

  function assertDashboardContractVersion(options = {}) {
    const requested = String(options.contractVersion || "").trim().toLowerCase();
    if (!requested || requested === "v3" || requested === "v4") return;
    throw new MenuValidationError(
      "Dashboard menu contract versions v1 and v2 are no longer supported. Use dashboard v3 or v4.",
      "DASHBOARD_CONTRACT_VERSION_UNSUPPORTED",
      410,
      { supportedContractVersions: ["v3", "v4"] }
    );
  }

  async function getCategoryDetail(id, options = {}) {
    assertDashboardContractVersion(options);
    assertObjectId(id);
    const category = await MenuCategory.findById(id).lean();
    if (!category) throw new MenuNotFoundError();

    const productQuery = {
      categoryId: id,
      ...buildListQuery(options),
    };
    const products = await MenuProduct.find(productQuery)
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    return serializeCategoryDetailV3(category, products);
  }

  async function getProductDetail(id) {
    assertObjectId(id);
    const product = await MenuProduct.findById(id).lean();
    if (!product) throw new MenuNotFoundError("Product not found");

    const [category, activeGroupCount] = await Promise.all([
      product.categoryId ? MenuCategory.findById(product.categoryId).lean() : null,
      ProductOptionGroup.countDocuments({ productId: id, isActive: true }),
    ]);

    const payload = serializeDashboardProduct(product, {
      isCustomizable: inferProductCustomizable(product, activeGroupCount > 0 ? [{}] : []),
    });

    return {
      contractVersion: "dashboard_product_detail.v3",
      product: payload,
      category: category ? serializeDashboardCategory(category) : null,
      groupSummary: {
        linkedGroupCount: activeGroupCount,
        composerEndpoint: `/api/dashboard/menu/products/${id}/composer`,
        linkEndpoint: `/api/dashboard/menu/products/${id}/option-groups`,
      },
    };
  }

  async function getOptionGroupDetail(id, options = {}) {
    assertDashboardContractVersion(options);
    assertObjectId(id);
    const group = await MenuOptionGroup.findById(id).lean();
    if (!group) throw new MenuNotFoundError();
    const [optionsRows, linkedProductIds] = await Promise.all([
      MenuOption.find({
        groupId: id,
        ...buildListQuery(options),
      }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
      ProductOptionGroup.distinct("productId", { groupId: id, isActive: true }),
    ]);

    return {
      contractVersion: "dashboard_option_group_detail.v3",
      optionGroup: serializeDashboardOptionGroup(group),
      options: optionsRows.map(serializeDashboardOption),
      usage: {
        linkedProductsCount: linkedProductIds.length,
      },
      actions: {
        canAddOptions: true,
        canReorderOptions: true,
      },
    };
  }

  async function getOptionDetail(id, options = {}) {
    assertDashboardContractVersion(options);
    assertObjectId(id);
    const option = await MenuOption.findById(id).lean();
    if (!option) throw new MenuNotFoundError();
    const [group, linkedProductIds] = await Promise.all([
      option.groupId ? MenuOptionGroup.findById(option.groupId).lean() : null,
      ProductGroupOption.distinct("productId", { optionId: id, isActive: true }),
    ]);

    return {
      contractVersion: "dashboard_option_detail.v3",
      option: serializeDashboardOption(option),
      optionGroup: group ? serializeDashboardOptionGroup(group) : null,
      usage: {
        linkedProductsCount: linkedProductIds.length,
      },
    };
  }

  function normalizeCategoryPayload(body = {}, existing = null) {
    if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
    assertImmutableKey(body, existing, "key");
    assertNonNullablePatchFields(body, existing, [
      "name",
      "description",
      "imageUrl",
      "isActive",
      "isVisible",
      "isAvailable",
      "sortOrder",
      "ui",
      "branchIds",
      "availability",
    ]);
    const hasUi = body.ui !== undefined && body.ui !== null;
    if (
      hasUi
      && (
        !isPlainObject(body.ui)
        || (body.ui.cardVariant !== undefined && !isAllowedCategoryCardVariant(body.ui.cardVariant))
      )
    ) {
      throw new MenuValidationError("ui.cardVariant must be one of the supported public category card variants", "INVALID_CARD_VARIANT");
    }
    if (existing && body.availability && hasOwn(body.availability, "branchIds") && body.availability.branchIds === null) {
      throw new MenuValidationError("branchIds cannot be null", "NULL_NOT_ALLOWED", 400, { fieldName: "branchIds" });
    }

    const payload = {};
    if (!existing || hasOwn(body, "key")) payload.key = normalizeOptionalKey(body.key);
    if (!existing || hasOwn(body, "name")) payload.name = localizedString(body.name, "name", { required: true });
    if (!existing || hasOwn(body, "description")) {
      payload.description = optionalLocalizedString(body.description, "description") || { ar: "", en: "" };
    }
    if (!existing || hasOwn(body, "imageUrl")) payload.imageUrl = String(body.imageUrl || "").trim();
    if (!existing || hasOwn(body, "isActive")) payload.isActive = normalizeBoolean(body.isActive, "isActive", true);
    if (!existing || hasOwn(body, "isVisible")) payload.isVisible = normalizeBoolean(body.isVisible, "isVisible", true);
    if (!existing || hasOwn(body, "isAvailable")) payload.isAvailable = normalizeBoolean(body.isAvailable, "isAvailable", true);
    if (!existing || hasOwn(body, "sortOrder")) payload.sortOrder = normalizeNonNegativeInteger(body.sortOrder, "sortOrder", 0);
    if (!existing || hasOwn(body, "ui")) {
      payload.ui = normalizeCategoryUiMetadata(
        existing ? { ...((existing && existing.ui) || {}), ...body.ui } : body.ui
      );
    }

    const hasBranchIds = hasOwn(body, "branchIds")
      || (isPlainObject(body.availability) && hasOwn(body.availability, "branchIds"));
    if (!existing || hasBranchIds) {
      payload.availability = {
        branchIds: normalizeStringArray(
          hasOwn(body, "branchIds") ? body.branchIds : body.availability && body.availability.branchIds,
          "branchIds"
        ),
      };
    }
    return payload;
  }

  function normalizeProductPayload(body = {}, existing = null) {
    if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
    assertImmutableKey(body, existing, "key");
    assertImmutableCatalogItemLink(body, existing);
    assertNonNullablePatchFields(body, existing, [
      "categoryId",
      "name",
      "description",
      "imageUrl",
      "itemType",
      "pricingModel",
      "priceHalala",
      "baseUnitGrams",
      "defaultWeightGrams",
      "minWeightGrams",
      "maxWeightGrams",
      "weightStepGrams",
      "availableFor",
      "isCustomizable",
      "isActive",
      "isVisible",
      "isAvailable",
      "sortOrder",
      "ui",
      "branchAvailability",
      "branchIds",
    ]);
    const hasUi = body.ui !== undefined && body.ui !== null;
    if (hasUi && !isPlainObject(body.ui)) {
      throw new MenuValidationError("ui must be an object", "INVALID_PRODUCT_UI");
    }
    if (hasUi && body.ui.cardVariant !== undefined && !isAllowedCardVariant(body.ui.cardVariant)) {
      throw new MenuValidationError("ui.cardVariant must be one of the supported public product card variants", "INVALID_CARD_VARIANT");
    }
    if (hasUi && body.ui.cardSize !== undefined && !isAllowedProductCardSize(body.ui.cardSize)) {
      throw new MenuValidationError("ui.cardSize must be one of: large, medium, small", "INVALID_CARD_SIZE");
    }
    const uiSource = hasUi && existing
      ? { ...((existing && existing.ui) || {}), ...body.ui }
      : (hasUi ? body.ui : existing && existing.ui);
    const pricingModel = String(
      hasOwn(body, "pricingModel") ? body.pricingModel : ((existing && existing.pricingModel) || "fixed")
    ).trim();
    if (!["fixed", "per_100g"].includes(pricingModel)) {
      throw new MenuValidationError("pricingModel must be fixed or per_100g");
    }
    const itemType = String(
      hasOwn(body, "itemType") ? body.itemType : ((existing && existing.itemType) || "product")
    ).trim();
    if (!itemType) throw new MenuValidationError("itemType cannot be empty");
    const payload = {};
    if (!existing || hasOwn(body, "categoryId")) payload.categoryId = assertObjectId(body.categoryId, "categoryId");
    if (!existing || hasOwn(body, "catalogItemId")) {
      payload.catalogItemId = normalizeOptionalObjectId(body.catalogItemId, "catalogItemId", null);
    }
    if (!existing || hasOwn(body, "key")) payload.key = normalizeOptionalKey(body.key);
    if (!existing || hasOwn(body, "name")) payload.name = localizedString(body.name, "name", { required: true });
    if (!existing || hasOwn(body, "description")) {
      payload.description = optionalLocalizedString(body.description, "description") || { ar: "", en: "" };
    }
    if (!existing || hasOwn(body, "imageUrl")) payload.imageUrl = String(body.imageUrl || "").trim();
    if (!existing || hasOwn(body, "itemType")) payload.itemType = itemType;
    if (!existing || hasOwn(body, "pricingModel")) payload.pricingModel = pricingModel;
    if (!existing || hasOwn(body, "priceHalala")) payload.priceHalala = normalizeNonNegativeInteger(body.priceHalala, "priceHalala", 0);
    if (!existing || hasOwn(body, "baseUnitGrams")) payload.baseUnitGrams = normalizeNonNegativeInteger(body.baseUnitGrams, "baseUnitGrams", 100) || 100;
    if (!existing || hasOwn(body, "defaultWeightGrams")) payload.defaultWeightGrams = normalizeNonNegativeInteger(body.defaultWeightGrams, "defaultWeightGrams", 0);
    if (!existing || hasOwn(body, "minWeightGrams")) payload.minWeightGrams = normalizeNonNegativeInteger(body.minWeightGrams, "minWeightGrams", 0);
    if (!existing || hasOwn(body, "maxWeightGrams")) payload.maxWeightGrams = normalizeNonNegativeInteger(body.maxWeightGrams, "maxWeightGrams", 0);
    if (!existing || hasOwn(body, "weightStepGrams")) payload.weightStepGrams = normalizeNonNegativeInteger(body.weightStepGrams, "weightStepGrams", 50) || 50;
    if (!existing) payload.currency = SYSTEM_CURRENCY;
    if (!existing || hasOwn(body, "availableFor")) {
      payload.availableFor = normalizeAvailableFor(body.availableFor, "availableFor", ["one_time", "subscription"]);
    }
    if (!existing || hasOwn(body, "isCustomizable")) {
      payload.isCustomizable = normalizeBoolean(body.isCustomizable, "isCustomizable", pricingModel === "per_100g");
    }
    if (!existing || hasOwn(body, "isActive")) payload.isActive = normalizeBoolean(body.isActive, "isActive", true);
    if (!existing || hasOwn(body, "isVisible")) payload.isVisible = normalizeBoolean(body.isVisible, "isVisible", true);
    if (!existing || hasOwn(body, "isAvailable")) payload.isAvailable = normalizeBoolean(body.isAvailable, "isAvailable", true);
    if (!existing || hasOwn(body, "sortOrder")) payload.sortOrder = normalizeNonNegativeInteger(body.sortOrder, "sortOrder", 0);
    if (!existing || hasOwn(body, "ui")) payload.ui = normalizeProductUiMetadata(uiSource);
    if (!existing || hasOwn(body, "branchAvailability") || hasOwn(body, "branchIds")) {
      payload.branchAvailability = normalizeStringArray(
        hasOwn(body, "branchAvailability") ? body.branchAvailability : body.branchIds,
        "branchAvailability"
      );
    }
    return payload;
  }

  function normalizeGroupPayload(body = {}, existing = null) {
    if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
    assertImmutableKey(body, existing, "key");
    assertNonNullablePatchFields(body, existing, [
      "name",
      "description",
      "isActive",
      "isVisible",
      "isAvailable",
      "sortOrder",
      "ui",
    ]);
    const hasUi = body.ui !== undefined;
    if (
      hasUi
      && (
        !isPlainObject(body.ui)
        || (body.ui.displayStyle !== undefined && !isAllowedGroupDisplayStyle(body.ui.displayStyle))
      )
    ) {
      throw new MenuValidationError("ui.displayStyle must be one of: chips, radio_cards, checkbox_grid, dropdown, stepper", "INVALID_DISPLAY_STYLE");
    }
    const payload = {};
    if (!existing || hasOwn(body, "key")) payload.key = normalizeOptionalKey(body.key);
    if (!existing || hasOwn(body, "name")) payload.name = localizedString(body.name, "name", { required: true });
    if (!existing || hasOwn(body, "description")) {
      payload.description = optionalLocalizedString(body.description, "description") || { ar: "", en: "" };
    }
    if (!existing || hasOwn(body, "isActive")) payload.isActive = normalizeBoolean(body.isActive, "isActive", true);
    if (!existing || hasOwn(body, "isVisible")) payload.isVisible = normalizeBoolean(body.isVisible, "isVisible", true);
    if (!existing || hasOwn(body, "isAvailable")) payload.isAvailable = normalizeBoolean(body.isAvailable, "isAvailable", true);
    if (!existing || hasOwn(body, "sortOrder")) payload.sortOrder = normalizeNonNegativeInteger(body.sortOrder, "sortOrder", 0);
    if (!existing || hasOwn(body, "ui")) {
      payload.ui = normalizeGroupUiMetadata(
        existing ? { ...((existing && existing.ui) || {}), ...body.ui } : body.ui
      );
    }
    return payload;
  }

  function normalizeOptionPayload(body = {}, existing = null) {
    if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
    assertImmutableKey(body, existing, "key");
    assertImmutableCatalogItemLink(body, existing);
    assertNonNullablePatchFields(body, existing, [
      "groupId",
      "name",
      "description",
      "imageUrl",
      "extraPriceHalala",
      "extraFeeHalala",
      "extraWeightUnitGrams",
      "extraWeightPriceHalala",
      "availableFor",
      "isActive",
      "isVisible",
      "isAvailable",
      "sortOrder",
    ]);

    const payload = {};
    if (!existing || hasOwn(body, "groupId")) payload.groupId = assertObjectId(body.groupId, "groupId");
    if (!existing || hasOwn(body, "catalogItemId")) {
      payload.catalogItemId = normalizeOptionalObjectId(body.catalogItemId, "catalogItemId", null);
    }
    if (!existing || hasOwn(body, "key")) payload.key = normalizeOptionalKey(body.key);
    if (!existing || hasOwn(body, "name")) payload.name = localizedString(body.name, "name", { required: true });
    if (!existing || hasOwn(body, "description")) {
      payload.description = optionalLocalizedString(body.description, "description") || { ar: "", en: "" };
    }
    if (!existing || hasOwn(body, "imageUrl")) payload.imageUrl = String(body.imageUrl || "").trim();

    const hasExtraPrice = hasOwn(body, "extraPriceHalala");
    const hasExtraFee = hasOwn(body, "extraFeeHalala");
    if (!existing || hasExtraPrice || hasExtraFee) {
      let extraPriceHalala = normalizeNonNegativeInteger(body.extraPriceHalala, "extraPriceHalala", 0);
      let extraFeeHalala = normalizeNonNegativeInteger(body.extraFeeHalala, "extraFeeHalala", 0);
      if (hasExtraPrice && !hasExtraFee) extraFeeHalala = extraPriceHalala;
      if (hasExtraFee && !hasExtraPrice) extraPriceHalala = extraFeeHalala;
      payload.extraPriceHalala = extraPriceHalala;
      payload.extraFeeHalala = extraFeeHalala;
    }

    if (!existing || hasOwn(body, "extraWeightUnitGrams")) {
      payload.extraWeightUnitGrams = normalizeNonNegativeInteger(body.extraWeightUnitGrams, "extraWeightUnitGrams", 0);
    }
    if (!existing || hasOwn(body, "extraWeightPriceHalala")) {
      payload.extraWeightPriceHalala = normalizeNonNegativeInteger(body.extraWeightPriceHalala, "extraWeightPriceHalala", 0);
    }
    if (!existing) payload.currency = SYSTEM_CURRENCY;
    if (!existing || hasOwn(body, "availableFor")) {
      payload.availableFor = normalizeAvailableFor(body.availableFor, "availableFor", ["one_time", "subscription"]);
    }
    if (!existing || hasOwn(body, "isActive")) payload.isActive = normalizeBoolean(body.isActive, "isActive", true);
    if (!existing || hasOwn(body, "isVisible")) payload.isVisible = normalizeBoolean(body.isVisible, "isVisible", true);
    if (!existing || hasOwn(body, "isAvailable")) payload.isAvailable = normalizeBoolean(body.isAvailable, "isAvailable", true);
    if (!existing || hasOwn(body, "sortOrder")) payload.sortOrder = normalizeNonNegativeInteger(body.sortOrder, "sortOrder", 0);
    return payload;
  }

  function normalizeSelectionRulePayload(body = {}, existing = null, prefix = "") {
    assertNonNullablePatchFields(body, existing, ["minSelections", "isRequired"]);
    const min = isProvided(body, "minSelections")
      ? normalizeNonNegativeInteger(body.minSelections, `${prefix}minSelections`, 0)
      : (existing ? existing.minSelections : 0);
    const max = isProvided(body, "maxSelections")
      ? normalizeNullableNonNegativeInteger(body.maxSelections, `${prefix}maxSelections`, null)
      : (existing ? existing.maxSelections : null);
    if (max !== null && max < min) {
      throw new MenuValidationError(`${prefix}maxSelections must be null or >= minSelections`, "INVALID_SELECTION_RULES");
    }
    const requiredFallback = existing ? Boolean(existing.isRequired) : min > 0;
    const isRequired = isProvided(body, "isRequired")
      ? normalizeBoolean(body.isRequired, `${prefix}isRequired`, requiredFallback)
      : requiredFallback;
    if (isRequired && min <= 0) {
      throw new MenuValidationError(`${prefix}minSelections must be > 0 when isRequired=true`, "INVALID_SELECTION_RULES");
    }
    const payload = {};
    if (!existing || isProvided(body, "minSelections")) payload.minSelections = min;
    if (!existing || isProvided(body, "maxSelections")) payload.maxSelections = max;
    if (!existing || isProvided(body, "isRequired")) payload.isRequired = isRequired;
    return payload;
  }

  function normalizeProductGroupRelationPayload(body = {}, existing = null) {
    if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
    assertNonNullablePatchFields(body, existing, ["isActive", "isVisible", "isAvailable", "sortOrder"]);
    const payload = { ...normalizeSelectionRulePayload(body, existing) };
    if (!existing || hasOwn(body, "productId")) payload.productId = assertObjectId(body.productId, "productId");
    if (!existing || hasOwn(body, "groupId") || hasOwn(body, "id")) {
      payload.groupId = assertObjectId(body.groupId || body.id, "groupId");
    }
    if (!existing || isProvided(body, "isActive")) payload.isActive = normalizeBoolean(body.isActive, "isActive", true);
    if (!existing || isProvided(body, "isVisible")) payload.isVisible = normalizeBoolean(body.isVisible, "isVisible", true);
    if (!existing || isProvided(body, "isAvailable")) payload.isAvailable = normalizeBoolean(body.isAvailable, "isAvailable", true);
    if (!existing || isProvided(body, "sortOrder")) payload.sortOrder = normalizeNonNegativeInteger(body.sortOrder, "sortOrder", 0);
    return payload;
  }

  function normalizeProductGroupOptionRelationPayload(body = {}, existing = null) {
    if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
    assertNonNullablePatchFields(body, existing, ["isActive", "isVisible", "isAvailable", "sortOrder"]);
    const payload = {};
    if (!existing || hasOwn(body, "productId")) payload.productId = assertObjectId(body.productId, "productId");
    if (!existing || hasOwn(body, "groupId")) payload.groupId = assertObjectId(body.groupId, "groupId");
    if (!existing || hasOwn(body, "optionId") || hasOwn(body, "id")) {
      payload.optionId = assertObjectId(body.optionId || body.id, "optionId");
    }
    for (const fieldName of ["extraPriceHalala", "extraWeightUnitGrams", "extraWeightPriceHalala"]) {
      if (!existing || isProvided(body, fieldName)) {
        payload[fieldName] = normalizeNullableNonNegativeInteger(body[fieldName], fieldName, null);
      }
    }
    if (!existing || isProvided(body, "isActive")) payload.isActive = normalizeBoolean(body.isActive, "isActive", true);
    if (!existing || isProvided(body, "isVisible")) payload.isVisible = normalizeBoolean(body.isVisible, "isVisible", true);
    if (!existing || isProvided(body, "isAvailable")) payload.isAvailable = normalizeBoolean(body.isAvailable, "isAvailable", true);
    if (!existing || isProvided(body, "sortOrder")) payload.sortOrder = normalizeNonNegativeInteger(body.sortOrder, "sortOrder", 0);
    return payload;
  }

  function changeAction(payload, fallback = "update") {
    if (Object.prototype.hasOwnProperty.call(payload, "isVisible")) return "visibility_changed";
    if (Object.prototype.hasOwnProperty.call(payload, "isAvailable")) return "availability_changed";
    if (
      Object.prototype.hasOwnProperty.call(payload, "priceHalala")
      || Object.prototype.hasOwnProperty.call(payload, "extraPriceHalala")
      || Object.prototype.hasOwnProperty.call(payload, "extraWeightUnitGrams")
      || Object.prototype.hasOwnProperty.call(payload, "extraWeightPriceHalala")
    ) return "price_changed";
    return fallback;
  }

  async function createEntity(Model, payload, { entityType, actor }) {
    const row = await Model.create(payload);
    await writeMenuAudit({ entityType, entityId: row._id, action: "create", after: row.toObject(), actor });
    return serializeDoc(row);
  }

  async function updateEntity(Model, id, payload, { entityType, actor, action = "update", meta = {} }) {
    assertObjectId(id);
    const row = await Model.findById(id);
    if (!row) throw new MenuNotFoundError();
    const before = row.toObject();
    row.set(payload);
    await row.save();
    await writeMenuAudit({ entityType, entityId: row._id, action, before, after: row.toObject(), actor, meta });
    return serializeDoc(row);
  }

  async function softDeleteEntity(Model, id, { entityType, actor }) {
    assertObjectId(id);
    const row = await Model.findById(id);
    if (!row) throw new MenuNotFoundError();

    if (Model === MenuCategory) {
      const productCount = await MenuProduct.countDocuments({ categoryId: id, isActive: true });
      if (productCount > 0) {
        throw new MenuValidationError(`Cannot delete category with ${productCount} active products`, "CATEGORY_IN_USE", 400, { productCount });
      }
    }

    if (Model === MenuOptionGroup) {
      const relationCount = await ProductOptionGroup.countDocuments({ groupId: id, isActive: true });
      if (relationCount > 0) {
        throw new MenuValidationError(`Cannot delete option group currently linked to ${relationCount} products`, "GROUP_IN_USE", 400, { relationCount });
      }
    }

    const before = row.toObject();
    row.isActive = false;
    await row.save();
    await writeMenuAudit({ entityType, entityId: row._id, action: "soft_delete", before, after: row.toObject(), actor });

    if (Model === MenuProduct) {
      await Promise.all([
        ProductOptionGroup.updateMany({ productId: id }, { $set: { isActive: false } }),
        ProductGroupOption.updateMany({ productId: id }, { $set: { isActive: false } }),
      ]);
    }

    if (Model === MenuOption) {
      await ProductGroupOption.updateMany({ optionId: id }, { $set: { isActive: false } });
    }

    return serializeDoc(row);
  }

  async function reorder(Model, items = [], { entityType, actor }) {
    if (!Array.isArray(items)) throw new MenuValidationError("items must be an array");
    const ids = items.map((item) => assertObjectId(item.id || item._id, "items[].id"));
    await Promise.all(items.map((item) => Model.updateOne(
      { _id: item.id || item._id },
      { $set: { sortOrder: normalizeNonNegativeInteger(item.sortOrder, "items[].sortOrder", 0) } }
    )));
    await MenuAuditLog.create({
      entityType,
      entityId: ids[0],
      action: "reorder",
      actorId: actor.userId && mongoose.Types.ObjectId.isValid(actor.userId) ? actor.userId : null,
      actorRole: actor.role || "",
      meta: { ids },
    });
    return { updated: ids.length };
  }

  async function duplicateProduct(productId, actor = {}) {
    assertObjectId(productId);
    const product = await MenuProduct.findById(productId).lean();
    if (!product) throw new MenuNotFoundError("Product not found");

    const [groupRelations, optionRelations] = await Promise.all([
      ProductOptionGroup.find({ productId }).lean(),
      ProductGroupOption.find({ productId }).lean(),
    ]);

    const newKey = await generateUniqueKey({
      name: `${product.key || localizeName(product.name, "en") || "item"}_copy`,
      fallbackPrefix: "item",
      exists: (key) => MenuProduct.exists({ key }),
    });

    try {
      const newProductDoc = await MenuProduct.create({
        ...product,
        _id: new mongoose.Types.ObjectId(),
        key: newKey,
        isActive: false,
        publishedAt: null,
        createdAt: undefined,
        updatedAt: undefined,
      });

      const newProductId = newProductDoc._id;

      const newGroupRelations = groupRelations.map((r) => ({
        ...r,
        _id: new mongoose.Types.ObjectId(),
        productId: newProductId,
      }));

      const newOptionRelations = optionRelations.map((r) => ({
        ...r,
        _id: new mongoose.Types.ObjectId(),
        productId: newProductId,
      }));

      await Promise.all([
        ProductOptionGroup.insertMany(newGroupRelations),
        ProductGroupOption.insertMany(newOptionRelations),
      ]);

      await writeMenuAudit({ 
        entityType: "menu_product", 
        entityId: newProductId, 
        action: "duplicate", 
        actor, 
        meta: { originalProductId: productId } 
      });

      return serializeDoc(newProductDoc);
    } catch (err) {
      if (err.code === 11000) {
        throw new MenuValidationError("Conflict: A product with this key already exists", "DUPLICATE_KEY", 409);
      }
      throw err;
    }
  }

  function normalizeBulkProductIds(productIds, fieldName = "productIds") {
    if (!Array.isArray(productIds)) throw new MenuValidationError(`${fieldName} must be an array`);
    const ids = [...new Set(productIds.map((item) => assertObjectId(item, `${fieldName}[]`)))];
    if (ids.length === 0) throw new MenuValidationError(`${fieldName} must include at least one product`);
    return ids;
  }

  async function bulkAssignProductsToCategory(categoryId, body = {}, actor = {}) {
    assertObjectId(categoryId, "categoryId");
    if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
    if (String(body.mode || "assign") !== "assign") {
      throw new MenuValidationError("mode must be assign", "UNSUPPORTED_BULK_ASSIGNMENT_MODE");
    }

    const productIds = normalizeBulkProductIds(body.productIds);
    const category = await MenuCategory.findOne({ _id: categoryId, isActive: true }).lean();
    if (!category) throw new MenuValidationError("categoryId does not reference an active category", "CATEGORY_NOT_FOUND", 404);

    const foundProducts = await MenuProduct.find({ _id: { $in: productIds }, isActive: true }).lean();
    if (foundProducts.length !== productIds.length) {
      throw new MenuValidationError("One or more products do not exist or are inactive", "PRODUCT_NOT_FOUND", 404);
    }

    await MenuProduct.updateMany(
      { _id: { $in: productIds } },
      { $set: { categoryId } }
    );

    await writeMenuAudit({
      entityType: "menu_category",
      entityId: categoryId,
      action: "products_bulk_assigned",
      actor,
      meta: { productIds },
    });

    const assignedProducts = await MenuProduct.find({ _id: { $in: productIds } })
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    return {
      contractVersion: "dashboard_category_product_assignment.v3",
      category: serializeDoc(category),
      assignedCount: assignedProducts.length,
      products: assignedProducts.map(serializeAdminProductSummary),
      relationOwner: "product.categoryId",
    };
  }

  async function bulkUpdateProducts(body = {}, actor = {}) {
    if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
    const productIds = normalizeBulkProductIds(body.productIds);
    const action = String(body.action || "").trim();
    if (action !== "move_to_category") {
      throw new MenuValidationError("action must be move_to_category", "UNSUPPORTED_PRODUCT_BULK_ACTION");
    }

    const categoryId = assertObjectId(body.categoryId, "categoryId");
    const [category, foundProducts] = await Promise.all([
      MenuCategory.findOne({ _id: categoryId, isActive: true }).lean(),
      MenuProduct.find({ _id: { $in: productIds }, isActive: true }).lean(),
    ]);
    if (!category) throw new MenuValidationError("categoryId does not reference an active category", "CATEGORY_NOT_FOUND", 404);
    if (foundProducts.length !== productIds.length) {
      throw new MenuValidationError("One or more products do not exist or are inactive", "PRODUCT_NOT_FOUND", 404);
    }

    await MenuProduct.updateMany(
      { _id: { $in: productIds } },
      { $set: { categoryId } }
    );

    await writeMenuAudit({
      entityType: "menu_product",
      entityId: categoryId,
      action: "bulk_move_to_category",
      actor,
      meta: { productIds, categoryId },
    });

    const products = await MenuProduct.find({ _id: { $in: productIds } })
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    return {
      action,
      category: serializeDoc(category),
      count: products.length,
      products: products.map(serializeAdminProductSummary),
      relationOwner: "product.categoryId",
    };
  }

  async function updateEntityField(Model, id, fieldName, value, { entityType, actor, action }) {
    assertObjectId(id);
    if (!["isVisible", "isAvailable"].includes(fieldName)) {
      throw new MenuValidationError("Unsupported field update");
    }
    const existing = await Model.findById(id).lean();
    if (!existing) throw new MenuNotFoundError();
    const updated = await updateEntity(Model, id, {
      [fieldName]: normalizeBoolean(value, fieldName, truthyByDefault(existing[fieldName])),
    }, { entityType, actor, action });
    if (Model === MenuCategory) return serializeDashboardCategory(updated);
    if (Model === MenuProduct) return serializeDashboardProduct(updated);
    if (Model === MenuOptionGroup) return serializeDashboardOptionGroup(updated);
    if (Model === MenuOption) return serializeDashboardOption(updated);
    return serializeDoc(updated);
  }

  async function createCategory(body, actor) {
    const payload = normalizeCategoryPayload(body);
    if (!payload.key) {
      payload.key = await generateUniqueKey({
        name: payload.name,
        fallbackPrefix: "category",
        exists: (key) => MenuCategory.exists({ key }),
      });
    }
    // Domain rule: publishedAt is the customer-visibility gate (see truthy() and activeIssue()).
    // isActive=true on dashboard creation means the admin intends this to be immediately
    // customer-visible. Setting publishedAt here is intentional and domain-correct.
    if (payload.isActive) {
      payload.publishedAt = new Date();
    }
    return serializeDashboardCategory(
      await createEntity(MenuCategory, payload, { entityType: "menu_category", actor })
    );
  }

  async function createProduct(body, actor) {
    const payload = normalizeProductPayload(body);
    if (!payload.key) {
      payload.key = await generateUniqueKey({
        name: payload.name,
        fallbackPrefix: "item",
        exists: (key) => MenuProduct.exists({ key }),
      });
    }
    // Domain rule: publishedAt is the customer-visibility gate (see truthy() and activeIssue()).
    // isActive=true on dashboard creation means the admin intends this to be immediately
    // customer-visible. Setting publishedAt here is intentional and domain-correct.
    if (payload.isActive) {
      payload.publishedAt = new Date();
    }
    const category = await MenuCategory.findOne({ _id: payload.categoryId, isActive: true }).lean();
    if (!category) throw new MenuValidationError("categoryId does not reference an active category", "CATEGORY_NOT_FOUND", 404);
    if (payload.catalogItemId) await assertCatalogItemLinkable(payload.catalogItemId);
    return serializeDashboardProduct(
      await createEntity(MenuProduct, payload, { entityType: "menu_product", actor })
    );
  }

  async function createOptionGroup(body, actor) {
    const payload = normalizeGroupPayload(body);
    if (!payload.key) {
      payload.key = await generateUniqueKey({
        name: payload.name,
        fallbackPrefix: "group",
        exists: (key) => MenuOptionGroup.exists({ key }),
      });
    }
    // Domain rule: publishedAt is the customer-visibility gate (see truthy() and activeIssue()).
    // isActive=true on dashboard creation means the admin intends this to be immediately
    // customer-visible. Setting publishedAt here is intentional and domain-correct.
    if (payload.isActive) {
      payload.publishedAt = new Date();
    }
    return serializeDashboardOptionGroup(
      await createEntity(MenuOptionGroup, payload, { entityType: "menu_option_group", actor })
    );
  }

  async function createOption(body, actor) {
    const payload = normalizeOptionPayload(body);
    if (!payload.key) {
      payload.key = await generateUniqueKey({
        name: payload.name,
        fallbackPrefix: "option",
        exists: (key) => MenuOption.exists({ groupId: payload.groupId, key }),
      });
    }
    // Domain rule: publishedAt is the customer-visibility gate (see truthy() and activeIssue()).
    // isActive=true on dashboard creation means the admin intends this to be immediately
    // customer-visible. Setting publishedAt here is intentional and domain-correct.
    if (payload.isActive) {
      payload.publishedAt = new Date();
    }
    if (payload.catalogItemId) await assertCatalogItemLinkable(payload.catalogItemId);
    const option = await createEntity(MenuOption, payload, { entityType: "menu_option", actor });
    return serializeDashboardOption(option);
  }

  async function updateCategory(id, body, actor) {
    const existing = await MenuCategory.findById(assertObjectId(id)).lean();
    if (!existing) throw new MenuNotFoundError();
    const payload = normalizeCategoryPayload(body, existing);
    return serializeDashboardCategory(
      await updateEntity(MenuCategory, id, payload, { entityType: "menu_category", actor, action: changeAction(payload) })
    );
  }

  async function updateProduct(id, body, actor) {
    const existing = await MenuProduct.findById(assertObjectId(id)).lean();
    if (!existing) throw new MenuNotFoundError();
    let existingForPayload = existing;
    if (body?.isCustomizable === undefined && existing.isCustomizable !== true) {
      const activeGroupCount = await ProductOptionGroup.countDocuments({
        productId: id,
        isActive: true,
        isVisible: { $ne: false },
        isAvailable: { $ne: false },
      });
      if (activeGroupCount > 0) existingForPayload = { ...existing, isCustomizable: true };
    }
    const payload = normalizeProductPayload(body, existingForPayload);
    const effectiveCategoryId = hasOwn(payload, "categoryId") ? payload.categoryId : existing.categoryId;
    const category = await MenuCategory.findOne({ _id: effectiveCategoryId, isActive: true }).lean();
    if (!category) throw new MenuValidationError("categoryId does not reference an active category", "CATEGORY_NOT_FOUND", 404);
    if (hasOwn(payload, "catalogItemId") && payload.catalogItemId && String(payload.catalogItemId) !== String(existing.catalogItemId || "")) {
      await assertCatalogItemLinkable(payload.catalogItemId);
    }
    const product = await updateEntity(MenuProduct, id, payload, { entityType: "menu_product", actor, action: changeAction(payload) });
    if (payload.isCustomizable === false) {
      await Promise.all([
        ProductOptionGroup.updateMany({ productId: id }, { $set: { isActive: false, isVisible: false, isAvailable: false } }),
        ProductGroupOption.updateMany({ productId: id }, { $set: { isActive: false, isVisible: false, isAvailable: false } }),
      ]);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "imageUrl")) {
      await mirrorCompatibilityImage(Sandwich, id, payload.imageUrl);
    }
    return serializeDashboardProduct(product);
  }

  async function updateOptionGroup(id, body, actor) {
    const existing = await MenuOptionGroup.findById(assertObjectId(id)).lean();
    if (!existing) throw new MenuNotFoundError();
    const payload = normalizeGroupPayload(body, existing);
    return serializeDashboardOptionGroup(
      await updateEntity(MenuOptionGroup, id, payload, { entityType: "menu_option_group", actor, action: changeAction(payload) })
    );
  }

  async function updateOption(id, body, actor) {
    const existing = await MenuOption.findById(assertObjectId(id)).lean();
    if (!existing) throw new MenuNotFoundError();
    const payload = normalizeOptionPayload(body, existing);
    if (hasOwn(payload, "catalogItemId") && payload.catalogItemId && String(payload.catalogItemId) !== String(existing.catalogItemId || "")) {
      await assertCatalogItemLinkable(payload.catalogItemId);
    }
    const option = await updateEntity(MenuOption, id, payload, { entityType: "menu_option", actor, action: changeAction(payload) });
    if (Object.prototype.hasOwnProperty.call(payload, "imageUrl")) {
      await mirrorCompatibilityImage(BuilderProtein, id, payload.imageUrl);
    }
    return serializeDashboardOption(option);
  }

  function updateCategoryVisibility(id, body, actor) {
    return updateEntityField(MenuCategory, id, "isVisible", body.isVisible, { entityType: "menu_category", actor, action: "visibility_changed" });
  }

  function updateCategoryAvailability(id, body, actor) {
    return updateEntityField(MenuCategory, id, "isAvailable", body.isAvailable, { entityType: "menu_category", actor, action: "availability_changed" });
  }

  function updateProductVisibility(id, body, actor) {
    return updateEntityField(MenuProduct, id, "isVisible", body.isVisible, { entityType: "menu_product", actor, action: "visibility_changed" });
  }

  function updateProductAvailabilityState(id, body, actor) {
    return updateEntityField(MenuProduct, id, "isAvailable", body.isAvailable, { entityType: "menu_product", actor, action: "availability_changed" });
  }

  function updateOptionGroupVisibility(id, body, actor) {
    return updateEntityField(MenuOptionGroup, id, "isVisible", body.isVisible, { entityType: "menu_option_group", actor, action: "visibility_changed" });
  }

  function updateOptionGroupAvailability(id, body, actor) {
    return updateEntityField(MenuOptionGroup, id, "isAvailable", body.isAvailable, { entityType: "menu_option_group", actor, action: "availability_changed" });
  }

  function updateOptionVisibility(id, body, actor) {
    return updateEntityField(MenuOption, id, "isVisible", body.isVisible, { entityType: "menu_option", actor, action: "visibility_changed" });
  }

  function updateOptionAvailability(id, body, actor) {
    return updateEntityField(MenuOption, id, "isAvailable", body.isAvailable, { entityType: "menu_option", actor, action: "availability_changed" });
  }

  function deleteCategory(id, actor) {
    return softDeleteEntity(MenuCategory, id, { entityType: "menu_category", actor });
  }

  function deleteProduct(id, actor) {
    return softDeleteEntity(MenuProduct, id, { entityType: "menu_product", actor });
  }

  function deleteOptionGroup(id, actor) {
    return softDeleteEntity(MenuOptionGroup, id, { entityType: "menu_option_group", actor });
  }

  function deleteOption(id, actor) {
    return softDeleteEntity(MenuOption, id, { entityType: "menu_option", actor });
  }

  function reorderCategories(items, actor) {
    return reorder(MenuCategory, items, { entityType: "menu_category", actor });
  }

  function reorderProducts(items, actor) {
    return reorder(MenuProduct, items, { entityType: "menu_product", actor });
  }

  function reorderOptionGroups(items, actor) {
    return reorder(MenuOptionGroup, items, { entityType: "menu_option_group", actor });
  }

  function reorderOptions(items, actor) {
    return reorder(MenuOption, items, { entityType: "menu_option", actor });
  }

  async function listProductGroups(productId, options = {}) {
    assertObjectId(productId, "productId");
    const query = { productId, ...buildListQuery(options) };
    const pagination = parsePaginationOptions(options);
    const find = ProductOptionGroup.find(query)
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    if (!pagination) {
      const rows = await find;
      return rows.map(serializeDashboardProductGroupRelation);
    }

    const [rows, total] = await Promise.all([
      find.skip(pagination.skip).limit(pagination.limit),
      ProductOptionGroup.countDocuments(query),
    ]);

    return {
      items: rows.map(serializeDashboardProductGroupRelation),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        pages: Math.ceil(total / pagination.limit),
      },
    };
  }

  function buildDashboardProductComposerValidation({ product, category, linkedOptionGroups }) {
    const errors = [];
    const warnings = [];
    const pushIssue = (target, code, message, extra = {}) => {
      target.push({ code, message, ...extra });
    };

    if (!category) {
      pushIssue(errors, "missing_category", "Product category is missing");
    } else {
      if (category.isActive === false) pushIssue(warnings, "inactive_category", "Product category is inactive");
      if (category.isVisible === false) pushIssue(warnings, "hidden_category", "Product category is hidden");
      if (category.isAvailable === false) pushIssue(warnings, "unavailable_category", "Product category is unavailable");
    }

    if (product.isActive === false) pushIssue(warnings, "inactive_product", "Product is inactive");
    if (product.isVisible === false) pushIssue(warnings, "hidden_product", "Product is hidden");
    if (product.isAvailable === false) pushIssue(warnings, "unavailable_product", "Product is unavailable");
    if (!product.publishedAt) pushIssue(warnings, "unpublished_product", "Product has unpublished changes or has not been published");
    const explicitlyCustomizable = Boolean(product.isCustomizable);
    if (explicitlyCustomizable && linkedOptionGroups.length === 0) {
      pushIssue(warnings, "customizable_without_groups", "Product is marked customizable but has no linked option groups");
    }
    if (!explicitlyCustomizable && linkedOptionGroups.length > 0) {
      pushIssue(warnings, "non_customizable_with_groups", "Product is not customizable but still has linked option groups");
    }

    for (const linkedGroup of linkedOptionGroups) {
      const groupKey = linkedGroup.group?.key || linkedGroup.groupId;
      if (!linkedGroup.group) {
        pushIssue(errors, "missing_linked_group", `Linked option group is missing: ${linkedGroup.groupId}`, {
          groupId: linkedGroup.groupId,
        });
        continue;
      }
      if (linkedGroup.group.isActive === false) pushIssue(warnings, "inactive_linked_group", `Linked option group is inactive: ${groupKey}`, { groupId: linkedGroup.groupId });
      if (linkedGroup.group.isVisible === false) pushIssue(warnings, "hidden_linked_group", `Linked option group is hidden: ${groupKey}`, { groupId: linkedGroup.groupId });
      if (linkedGroup.group.isAvailable === false) pushIssue(warnings, "unavailable_linked_group", `Linked option group is unavailable: ${groupKey}`, { groupId: linkedGroup.groupId });
      if (linkedGroup.group.isActive === false || linkedGroup.group.isVisible === false || linkedGroup.group.isAvailable === false) {
        pushIssue(warnings, "global_group_disabled", "Global option group is disabled and cannot be shown for this product", {
          severity: "warning",
          action: "detach_or_reactivate_global_group",
          groupId: linkedGroup.groupId,
        });
      }
      const activeLinkedOptionsCount = linkedGroup.options.filter((row) => (
        row.isActive !== false
        && row.isVisible !== false
        && row.isAvailable !== false
        && row.option
        && row.option.isActive !== false
        && row.option.isVisible !== false
        && row.option.isAvailable !== false
      )).length;
      if (linkedGroup.isRequired && activeLinkedOptionsCount < linkedGroup.minSelections) {
        pushIssue(errors, "required_group_insufficient_options", `Required option group ${groupKey} has fewer active linked options than minSelections`, {
          severity: "error",
          action: "open_option_pool",
          groupId: linkedGroup.groupId,
          requiredMinSelections: linkedGroup.minSelections,
          activeLinkedOptionsCount,
        });
      }

      for (const linkedOption of linkedGroup.options) {
        const optionKey = linkedOption.option?.key || linkedOption.optionId;
        if (!linkedOption.option) {
          pushIssue(errors, "missing_linked_option", `Linked option is missing: ${linkedOption.optionId}`, {
            groupId: linkedGroup.groupId,
            optionId: linkedOption.optionId,
          });
          continue;
        }
        if (linkedOption.option.isActive === false) pushIssue(warnings, "inactive_linked_option", `Linked option is inactive: ${optionKey}`, { groupId: linkedGroup.groupId, optionId: linkedOption.optionId });
        if (linkedOption.option.isVisible === false) pushIssue(warnings, "hidden_linked_option", `Linked option is hidden: ${optionKey}`, { groupId: linkedGroup.groupId, optionId: linkedOption.optionId });
        if (linkedOption.option.isAvailable === false) pushIssue(warnings, "unavailable_linked_option", `Linked option is unavailable: ${optionKey}`, { groupId: linkedGroup.groupId, optionId: linkedOption.optionId });
        if (linkedOption.option.isActive === false || linkedOption.option.isVisible === false || linkedOption.option.isAvailable === false) {
          pushIssue(warnings, "global_option_disabled", "Global option is disabled and cannot be shown for this product", {
            severity: "warning",
            action: "remove_or_replace_option",
            groupId: linkedGroup.groupId,
            optionId: linkedOption.optionId,
          });
        }
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
    };
  }

  function serializeDashboardLinkedOption(relation, option) {
    const optionPayload = option ? serializeDoc(option) : null;
    const fallbackExtraPriceHalala = optionPayload ? optionPayload.extraPriceHalala : null;
    const fallbackExtraWeightUnitGrams = optionPayload ? optionPayload.extraWeightUnitGrams : null;
    const fallbackExtraWeightPriceHalala = optionPayload ? optionPayload.extraWeightPriceHalala : null;
    const override = {
      extraPriceHalala: relation.extraPriceHalala,
      extraWeightUnitGrams: relation.extraWeightUnitGrams,
      extraWeightPriceHalala: relation.extraWeightPriceHalala,
      effectiveExtraPriceHalala: relation.extraPriceHalala !== null && relation.extraPriceHalala !== undefined
        ? relation.extraPriceHalala
        : fallbackExtraPriceHalala,
      effectiveExtraWeightUnitGrams: relation.extraWeightUnitGrams !== null && relation.extraWeightUnitGrams !== undefined
        ? relation.extraWeightUnitGrams
        : fallbackExtraWeightUnitGrams,
      effectiveExtraWeightPriceHalala: relation.extraWeightPriceHalala !== null && relation.extraWeightPriceHalala !== undefined
        ? relation.extraWeightPriceHalala
        : fallbackExtraWeightPriceHalala,
    };

    return {
      id: String(relation._id),
      productId: String(relation.productId),
      groupId: String(relation.groupId),
      optionId: String(relation.optionId),
      extraPriceHalala: relation.extraPriceHalala,
      extraWeightUnitGrams: relation.extraWeightUnitGrams,
      extraWeightPriceHalala: relation.extraWeightPriceHalala,
      isActive: truthyByDefault(relation.isActive),
      isVisible: truthyByDefault(relation.isVisible),
      isAvailable: truthyByDefault(relation.isAvailable),
      sortOrder: Number(relation.sortOrder || 0),
      relation: serializeDoc(relation),
      override,
      option: optionPayload,
    };
  }

  function serializeDashboardLinkedGroup(relation, group, options) {
    const payload = {
      id: String(relation._id),
      productId: String(relation.productId),
      groupId: String(relation.groupId),
      minSelections: Number(relation.minSelections || 0),
      maxSelections: relation.maxSelections === null || relation.maxSelections === undefined ? null : Number(relation.maxSelections),
      isRequired: Boolean(relation.isRequired),
      isActive: truthyByDefault(relation.isActive),
      isVisible: truthyByDefault(relation.isVisible),
      isAvailable: truthyByDefault(relation.isAvailable),
      sortOrder: Number(relation.sortOrder || 0),
      relation: serializeDoc(relation),
      group: group ? serializeDoc(group) : null,
      options,
    };

    return payload;
  }

  function serializePricingFields(source = {}) {
    return {
      extraPriceHalala: source.extraPriceHalala === undefined ? null : source.extraPriceHalala,
      extraWeightUnitGrams: source.extraWeightUnitGrams === undefined ? null : source.extraWeightUnitGrams,
      extraWeightPriceHalala: source.extraWeightPriceHalala === undefined ? null : source.extraWeightPriceHalala,
      currency: source.currency || SYSTEM_CURRENCY,
    };
  }

  function serializeProductComposerLinkedOptionV3(linkedOption) {
    const option = linkedOption.option || {};
    return {
      relationId: linkedOption.id,
      optionId: linkedOption.optionId,
      key: option.key || "",
      name: option.name || { ar: "", en: "" },
      defaultPricing: serializePricingFields(option),
      overridePricing: serializePricingFields({
        extraPriceHalala: linkedOption.extraPriceHalala,
        extraWeightUnitGrams: linkedOption.extraWeightUnitGrams,
        extraWeightPriceHalala: linkedOption.extraWeightPriceHalala,
        currency: option.currency,
      }),
      effectivePricing: serializePricingFields({
        extraPriceHalala: linkedOption.override.effectiveExtraPriceHalala,
        extraWeightUnitGrams: linkedOption.override.effectiveExtraWeightUnitGrams,
        extraWeightPriceHalala: linkedOption.override.effectiveExtraWeightPriceHalala,
        currency: option.currency,
      }),
      nutrition: option.nutrition || {},
      status: {
        isActive: linkedOption.isActive && option.isActive !== false,
        isVisible: linkedOption.isVisible && option.isVisible !== false,
        isAvailable: linkedOption.isAvailable && option.isAvailable !== false,
      },
      sortOrder: linkedOption.sortOrder,
    };
  }

  function serializeProductComposerLinkedGroupV3(linkedGroup) {
    const group = linkedGroup.group || {};
    const options = linkedGroup.options.map(serializeProductComposerLinkedOptionV3);
    return {
      relationId: linkedGroup.id,
      groupId: linkedGroup.groupId,
      key: group.key || "",
      name: group.name || { ar: "", en: "" },
      rules: {
        minSelections: linkedGroup.minSelections,
        maxSelections: linkedGroup.maxSelections,
        isRequired: linkedGroup.isRequired,
      },
      status: {
        isActive: linkedGroup.isActive && group.isActive !== false,
        isVisible: linkedGroup.isVisible && group.isVisible !== false,
        isAvailable: linkedGroup.isAvailable && group.isAvailable !== false,
      },
      sortOrder: linkedGroup.sortOrder,
      ui: normalizeGroupUiMetadata(group.ui),
      optionsCount: options.length,
      options,
    };
  }

  function serializeProductComposerV3({ productPayload, category, linkedOptionGroups, validation }) {
    const product = { ...productPayload };
    delete product.groups;
    delete product.optionGroups;

    return {
      contractVersion: "dashboard_product_composer.v3",
      product,
      category: category ? serializeDoc(category) : null,
      customization: {
        isCustomizable: product.isCustomizable,
        linkedGroups: linkedOptionGroups.map(serializeProductComposerLinkedGroupV3),
      },
      availableActions: {
        canAttachGroups: true,
        canDetachGroups: true,
        canEditRules: true,
        canEditOptionOverrides: true,
      },
      validation,
    };
  }

  function statusTriple(globalDoc = {}, relationDoc = {}) {
    const global = {
      isActive: truthyByDefault(globalDoc && globalDoc.isActive),
      isVisible: truthyByDefault(globalDoc && globalDoc.isVisible),
      isAvailable: truthyByDefault(globalDoc && globalDoc.isAvailable),
    };
    const product = {
      isActive: truthyByDefault(relationDoc && relationDoc.isActive),
      isVisible: truthyByDefault(relationDoc && relationDoc.isVisible),
      isAvailable: truthyByDefault(relationDoc && relationDoc.isAvailable),
    };
    return {
      global,
      product,
      effective: {
        isActive: global.isActive && product.isActive,
        isVisible: global.isVisible && product.isVisible,
        isAvailable: global.isAvailable && product.isAvailable,
      },
    };
  }

  function serializeDefaultPricing(source = {}) {
    return {
      extraPriceHalala: Number(source.extraPriceHalala || 0),
      extraWeightUnitGrams: Number(source.extraWeightUnitGrams || 0),
      extraWeightPriceHalala: Number(source.extraWeightPriceHalala || 0),
      currency: source.currency || SYSTEM_CURRENCY,
    };
  }

  function serializeOverridePricing(source = {}, currency = SYSTEM_CURRENCY) {
    return {
      extraPriceHalala: source.extraPriceHalala === undefined ? null : source.extraPriceHalala,
      extraWeightUnitGrams: source.extraWeightUnitGrams === undefined ? null : source.extraWeightUnitGrams,
      extraWeightPriceHalala: source.extraWeightPriceHalala === undefined ? null : source.extraWeightPriceHalala,
      currency,
    };
  }

  function serializeEffectivePricing(relation = {}, option = {}) {
    return {
      extraPriceHalala: relation.extraPriceHalala === null || relation.extraPriceHalala === undefined
        ? Number(option.extraPriceHalala || 0)
        : Number(relation.extraPriceHalala || 0),
      extraWeightUnitGrams: relation.extraWeightUnitGrams === null || relation.extraWeightUnitGrams === undefined
        ? Number(option.extraWeightUnitGrams || 0)
        : Number(relation.extraWeightUnitGrams || 0),
      extraWeightPriceHalala: relation.extraWeightPriceHalala === null || relation.extraWeightPriceHalala === undefined
        ? Number(option.extraWeightPriceHalala || 0)
        : Number(relation.extraWeightPriceHalala || 0),
      currency: option.currency || SYSTEM_CURRENCY,
    };
  }

  function serializeProductComposerLinkedOptionV4(linkedOption) {
    const option = linkedOption.option || {};
    return {
      productOptionId: linkedOption.id,
      optionId: linkedOption.optionId,
      key: option.key || "",
      name: option.name || { ar: "", en: "" },
      imageUrl: option.imageUrl || "",
      defaultPricing: serializeDefaultPricing(option),
      overridePricing: serializeOverridePricing({
        extraPriceHalala: linkedOption.extraPriceHalala,
        extraWeightUnitGrams: linkedOption.extraWeightUnitGrams,
        extraWeightPriceHalala: linkedOption.extraWeightPriceHalala,
      }, option.currency),
      effectivePricing: serializeEffectivePricing(linkedOption, option),
      nutrition: option.nutrition || {},
      status: statusTriple(option, linkedOption),
      sortOrder: linkedOption.sortOrder,
    };
  }

  function serializeProductComposerLinkedGroupV4(linkedGroup, optionPoolAvailableCount = 0) {
    const group = linkedGroup.group || {};
    const options = linkedGroup.options.map(serializeProductComposerLinkedOptionV4);
    return {
      productGroupId: linkedGroup.id,
      groupId: linkedGroup.groupId,
      key: group.key || "",
      name: group.name || { ar: "", en: "" },
      displayStyle: normalizeGroupUiMetadata(group.ui).displayStyle,
      rules: {
        minSelections: linkedGroup.minSelections,
        maxSelections: linkedGroup.maxSelections,
        isRequired: linkedGroup.isRequired,
      },
      status: statusTriple(group, linkedGroup),
      sortOrder: linkedGroup.sortOrder,
      options,
      optionPool: {
        linkedCount: options.length,
        availableCount: optionPoolAvailableCount,
        endpoint: `/api/dashboard/menu/products/${linkedGroup.productId}/option-groups/${linkedGroup.groupId}/option-pool`,
      },
    };
  }

  function serializeProductComposerV4({ productPayload, category, linkedOptionGroups, validation, optionPoolAvailableCount = 0 }) {
    const groups = linkedOptionGroups.map((group) => serializeProductComposerLinkedGroupV4(group, optionPoolAvailableCount));
    const linkedOptionCount = groups.reduce((sum, group) => sum + group.options.length, 0);
    return {
      contractVersion: "dashboard_product_composer.v4",
      product: productPayload,
      category: category ? {
        id: String(category._id),
        key: category.key || "",
        name: category.name || { ar: "", en: "" },
      } : null,
      customization: {
        enabled: Boolean(productPayload.isCustomizable),
        summary: {
          linkedGroupCount: groups.length,
          linkedOptionCount,
          requiredGroupCount: groups.filter((group) => group.rules.isRequired).length,
        },
        groups,
      },
      availableActions: {
        canEnableCustomization: true,
        canDisableCustomization: true,
        canAttachGroup: true,
        canDetachGroup: true,
        canReplaceGroupOptions: true,
        canPatchOptionOverride: true,
      },
      validation,
    };
  }

  async function getProductComposer(productId, composerOptions = {}) {
    assertDashboardContractVersion(composerOptions);
    assertObjectId(productId, "productId");
    const product = await MenuProduct.findById(productId).lean();
    if (!product) throw new MenuNotFoundError("Product not found");

    const [category, groupRelations, optionRelations] = await Promise.all([
      product.categoryId ? MenuCategory.findById(product.categoryId).lean() : null,
      ProductOptionGroup.find({ productId }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
      ProductGroupOption.find({ productId }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    ]);

    const groupIds = [...new Set(groupRelations.map((relation) => String(relation.groupId)))];
    const optionIds = [...new Set(optionRelations.map((relation) => String(relation.optionId)))];
    const [groups, options] = await Promise.all([
      groupIds.length ? MenuOptionGroup.find({ _id: { $in: groupIds } }).lean() : [],
      optionIds.length ? MenuOption.find({ _id: { $in: optionIds } }).lean() : [],
    ]);

    const groupsById = new Map(groups.map((group) => [String(group._id), group]));
    const optionsById = new Map(options.map((option) => [String(option._id), option]));
    const optionRelationsByGroup = new Map();
    for (const relation of optionRelations) {
      const groupId = String(relation.groupId);
      if (!optionRelationsByGroup.has(groupId)) optionRelationsByGroup.set(groupId, []);
      optionRelationsByGroup.get(groupId).push(relation);
    }

    const linkedOptionGroups = groupRelations.map((relation) => {
      const groupId = String(relation.groupId);
      const linkedOptions = (optionRelationsByGroup.get(groupId) || [])
        .map((optionRelation) => serializeDashboardLinkedOption(
          optionRelation,
          optionsById.get(String(optionRelation.optionId)) || null
        ))
        .sort((left, right) => left.sortOrder - right.sortOrder);

      return serializeDashboardLinkedGroup(
        relation,
        groupsById.get(groupId) || null,
        linkedOptions
      );
    }).sort((left, right) => left.sortOrder - right.sortOrder);

    const requestedContractVersion = String(composerOptions.contractVersion || "").trim().toLowerCase();
    const productPayload = serializeDashboardProduct(product, {
      isCustomizable: requestedContractVersion === "v4"
        ? Boolean(product.isCustomizable)
        : inferProductCustomizable(product, linkedOptionGroups),
    });

    const validation = buildDashboardProductComposerValidation({
      product,
      category,
      linkedOptionGroups,
    });

    if (requestedContractVersion === "v4") {
      const optionPoolAvailableCount = await MenuOption.countDocuments({
        isActive: true,
        isVisible: { $ne: false },
        isAvailable: { $ne: false },
      });
      return serializeProductComposerV4({
        productPayload,
        category,
        linkedOptionGroups,
        validation,
        optionPoolAvailableCount,
      });
    }

    return serializeProductComposerV3({
      productPayload,
      category,
      linkedOptionGroups,
      validation,
    });
  }

  function serializeLibraryGroup(group = {}) {
    return {
      id: String(group._id),
      key: group.key || "",
      name: group.name || { ar: "", en: "" },
      description: group.description || { ar: "", en: "" },
      displayStyle: normalizeGroupUiMetadata(group.ui).displayStyle,
      enabled: truthyByDefault(group.isActive) && truthyByDefault(group.isVisible) && truthyByDefault(group.isAvailable),
      sortOrder: Number(group.sortOrder || 0),
    };
  }

  function serializeLibraryOption(option = {}, group = null) {
    return {
      id: String(option._id),
      key: option.key || "",
      name: option.name || { ar: "", en: "" },
      description: option.description || { ar: "", en: "" },
      imageUrl: option.imageUrl || "",
      suggestedGroupId: option.groupId ? String(option.groupId) : null,
      suggestedGroupKey: group ? group.key : null,
      defaultPricing: serializeDefaultPricing(option),
      nutrition: option.nutrition || {},
      enabled: truthyByDefault(option.isActive) && truthyByDefault(option.isVisible) && truthyByDefault(option.isAvailable),
      sortOrder: Number(option.sortOrder || 0),
    };
  }

  async function getCustomizationLibrary(options = {}) {
    const [groups, optionRows] = await Promise.all([
      MenuOptionGroup.find({ ...buildListQuery({ ...options, includeInactive: true }) }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
      MenuOption.find({ ...buildListQuery({ ...options, includeInactive: true }) }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    ]);
    const groupsById = new Map(groups.map((group) => [String(group._id), group]));
    return {
      contractVersion: "dashboard_customization_library.v1",
      groups: groups.map(serializeLibraryGroup),
      options: optionRows.map((option) => serializeLibraryOption(option, groupsById.get(String(option.groupId)) || null)),
    };
  }

  async function updateProductCustomization(productId, body = {}, actor = {}) {
    assertObjectId(productId, "productId");
    if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
    const product = await MenuProduct.findById(productId);
    if (!product) throw new MenuNotFoundError("Product not found");
    const before = product.toObject();
    const isCustomizable = normalizeBoolean(body.isCustomizable, "isCustomizable", product.isCustomizable);
    product.isCustomizable = isCustomizable;
    await product.save();
    if (!isCustomizable && normalizeBoolean(body.clearRelations, "clearRelations", false)) {
      await Promise.all([
        ProductOptionGroup.deleteMany({ productId }),
        ProductGroupOption.deleteMany({ productId }),
      ]);
    }
    await writeMenuAudit({
      entityType: "menu_product",
      entityId: product._id,
      action: isCustomizable ? "product_customization_enabled" : "product_customization_disabled",
      before,
      after: product.toObject(),
      actor,
      meta: { productId, clearRelations: Boolean(body.clearRelations) },
    });
    return getProductComposer(productId, { contractVersion: "v4" });
  }

  async function createProductGroup(productId, body, actor = {}) {
    assertObjectId(productId, "productId");
    const payload = normalizeProductGroupRelationPayload({ ...body, productId });
    const [product, group] = await Promise.all([
      MenuProduct.findById(productId).lean(),
      MenuOptionGroup.findById(payload.groupId).lean(),
    ]);
    if (!product) throw new MenuNotFoundError("Product not found");
    if (!group) throw new MenuNotFoundError("Option group not found");

    const existing = await ProductOptionGroup.findOne({ productId, groupId: payload.groupId }).lean();
    const relation = existing
      ? await updateEntity(ProductOptionGroup, existing._id, { ...payload, isActive: true }, {
        entityType: "menu_product_group",
        actor,
        action: "product_group_attached",
        meta: { productId, groupId: payload.groupId },
      })
      : await createEntity(ProductOptionGroup, payload, { entityType: "menu_product_group", actor });

    await MenuProduct.updateOne({ _id: productId }, { $set: { isCustomizable: true } });

    const initialOptionIds = Array.isArray(body.initialOptionIds)
      ? [...new Set(body.initialOptionIds.map((item) => assertObjectId(item, "initialOptionIds[]")))]
      : [];
    const linkAllOptions = normalizeBoolean(body.linkAllOptions, "linkAllOptions", false);
    const optionRows = linkAllOptions
      ? await MenuOption.find({ groupId: payload.groupId, isActive: true }).lean()
      : (initialOptionIds.length ? await MenuOption.find({ _id: { $in: initialOptionIds }, isActive: true }).lean() : []);
    const catalogItemsById = optionRows.length ? await loadCatalogItemsByIdForDocs(optionRows) : new Map();
    const options = filterGloballyAvailable(optionRows, catalogItemsById);
    if (options.length > 0) {
      const optionRelations = options.map((opt) => ({
        productId,
        groupId: payload.groupId,
        optionId: opt._id,
        isActive: true,
        isVisible: true,
        isAvailable: true,
        sortOrder: opt.sortOrder || 0,
      }));
      for (const optionRelation of optionRelations) {
        await ProductGroupOption.updateOne(
          { productId, groupId: payload.groupId, optionId: optionRelation.optionId },
          { $set: optionRelation },
          { upsert: true }
        );
      }
    }
    await writeMenuAudit({
      entityType: "menu_product_group",
      entityId: productId,
      action: "product_group_attached",
      actor,
      meta: { productId, groupId: payload.groupId, optionIds: options.map((item) => String(item._id)), linkAllOptions },
    });

    return relation;
  }

  async function deleteProductGroup(productId, groupId, actor = {}) {
    assertObjectId(productId);
    assertObjectId(groupId);
    const result = await ProductOptionGroup.deleteOne({ productId, groupId });
    if (result.deletedCount > 0) {
      await ProductGroupOption.deleteMany({ productId, groupId });
      await writeMenuAudit({ entityType: "menu_product_group", entityId: productId, action: "product_group_detached", actor, meta: { productId, groupId } });
    }
    return { deleted: result.deletedCount };
  }

  async function updateProductGroup(productId, groupId, body, actor = {}, action = null) {
    assertObjectId(productId, "productId");
    assertObjectId(groupId, "groupId");
    const existing = await ProductOptionGroup.findOne({ productId, groupId }).lean();
    if (!existing) throw new MenuNotFoundError("Product group relation not found");
    const payload = normalizeProductGroupRelationPayload({ ...body, productId, groupId }, existing);
    const updated = await updateEntity(ProductOptionGroup, existing._id, payload, {
      entityType: "menu_product_group",
      actor,
      action: action || changeAction(payload, "product_group_rules_changed"),
      meta: { productId, groupId },
    });
    return updated;
  }

  async function updateProductGroupSelectionRules(productId, groupId, body, actor = {}) {
    assertObjectId(productId, "productId");
    assertObjectId(groupId, "groupId");
    const existing = await ProductOptionGroup.findOne({ productId, groupId }).lean();
    if (!existing) throw new MenuNotFoundError("Product group relation not found");
    const payload = normalizeSelectionRulePayload(body, existing);
    return updateEntity(ProductOptionGroup, existing._id, payload, {
      entityType: "menu_product_group",
      actor,
      action: "product_group_rules_changed",
      meta: { productId, groupId },
    });
  }

  async function listProductGroupOptions(productId, groupId, options = {}) {
    assertObjectId(productId, "productId");
    assertObjectId(groupId, "groupId");
    const query = { productId, groupId, ...buildListQuery(options) };
    const pagination = parsePaginationOptions(options);
    const find = ProductGroupOption.find(query)
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    if (!pagination) {
      const rows = await find;
      return rows.map(serializeDashboardProductOptionRelation);
    }

    const [rows, total] = await Promise.all([
      find.skip(pagination.skip).limit(pagination.limit),
      ProductGroupOption.countDocuments(query),
    ]);

    return {
      items: rows.map(serializeDashboardProductOptionRelation),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        pages: Math.ceil(total / pagination.limit),
      },
    };
  }

  function normalizeOptionIds(value = [], fieldName = "optionIds") {
    if (!Array.isArray(value)) throw new MenuValidationError(`${fieldName} must be an array`);
    return [...new Set(value.map((item) => assertObjectId(item, `${fieldName}[]`)))];
  }

  async function replaceProductGroupOptions(productId, groupId, body = {}, actor = {}) {
    assertObjectId(productId, "productId");
    assertObjectId(groupId, "groupId");
    if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
    const optionIds = normalizeOptionIds(body.optionIds || []);
    const preserveOverrides = normalizeBoolean(body.preserveOverrides, "preserveOverrides", true);
    const [product, groupRelation, options] = await Promise.all([
      MenuProduct.findById(productId).lean(),
      ProductOptionGroup.findOne({ productId, groupId }).lean(),
      optionIds.length ? MenuOption.find({ _id: { $in: optionIds }, isActive: true }).lean() : [],
    ]);
    if (!product) throw new MenuNotFoundError("Product not found");
    if (!groupRelation) throw new MenuValidationError("Product group relation does not exist", "RELATION_NOT_FOUND", 404);
    if (options.length !== optionIds.length) {
      throw new MenuValidationError("One or more options do not exist or are globally disabled", "OPTION_NOT_ALLOWED", 400);
    }
    const catalogItemsById = await loadCatalogItemsByIdForDocs(options);
    const globallyAvailableOptions = filterGloballyAvailable(options, catalogItemsById);
    if (globallyAvailableOptions.length !== options.length) {
      throw new MenuValidationError("One or more options are linked to unavailable catalog items", "OPTION_NOT_AVAILABLE", 409);
    }
    const existingRelations = await ProductGroupOption.find({ productId, groupId }).lean();
    const existingByOptionId = new Map(existingRelations.map((row) => [String(row.optionId), row]));
    const optionIdSet = new Set(optionIds);

    await ProductGroupOption.deleteMany({ productId, groupId, optionId: { $nin: optionIds } });
    for (const option of options) {
      const optionId = String(option._id);
      const existing = existingByOptionId.get(optionId);
      const overrideFields = preserveOverrides && existing
        ? {
          extraPriceHalala: existing.extraPriceHalala,
          extraWeightUnitGrams: existing.extraWeightUnitGrams,
          extraWeightPriceHalala: existing.extraWeightPriceHalala,
        }
        : {
          extraPriceHalala: null,
          extraWeightUnitGrams: null,
          extraWeightPriceHalala: null,
        };
      await ProductGroupOption.updateOne(
        { productId, groupId, optionId },
        {
          $set: {
            productId,
            groupId,
            optionId,
            ...overrideFields,
            isActive: existing ? truthyByDefault(existing.isActive) : true,
            isVisible: existing ? truthyByDefault(existing.isVisible) : true,
            isAvailable: existing ? truthyByDefault(existing.isAvailable) : true,
            sortOrder: existing ? Number(existing.sortOrder || 0) : Number(option.sortOrder || 0),
          },
        },
        { upsert: true }
      );
    }

    await writeMenuAudit({
      entityType: "menu_product_group_option",
      entityId: productId,
      action: "product_group_options_replaced",
      actor,
      meta: {
        productId,
        groupId,
        optionIds,
        preserveOverrides,
        removedOptionIds: existingRelations.map((row) => String(row.optionId)).filter((id) => !optionIdSet.has(id)),
      },
    });

    return getProductComposer(productId, { contractVersion: "v4" });
  }

  async function getProductGroupOptionPool(productId, groupId, queryOptions = {}) {
    assertObjectId(productId, "productId");
    assertObjectId(groupId, "groupId");
    const includeDisabled = normalizeBoolean(queryOptions.includeDisabled, "includeDisabled", false);
    const onlySuggested = normalizeBoolean(queryOptions.onlySuggested, "onlySuggested", false);
    const suggestedGroupId = queryOptions.suggestedGroupId
      ? assertObjectId(queryOptions.suggestedGroupId, "suggestedGroupId")
      : groupId;
    const optionQuery = includeDisabled ? {} : { isActive: true };
    const search = queryOptions.search || queryOptions.q;
    if (search !== undefined && search !== null && String(search).trim()) {
      const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      optionQuery.$or = [{ key: regex }, { "name.ar": regex }, { "name.en": regex }];
    }
    if (onlySuggested) optionQuery.groupId = suggestedGroupId;

    const [product, group, relation, optionRows, linkedRelations] = await Promise.all([
      MenuProduct.findById(productId).lean(),
      MenuOptionGroup.findById(groupId).lean(),
      ProductOptionGroup.findOne({ productId, groupId }).lean(),
      MenuOption.find(optionQuery).sort({ sortOrder: 1, createdAt: -1 }).lean(),
      ProductGroupOption.find({ productId, groupId }).lean(),
    ]);
    if (!product) throw new MenuNotFoundError("Product not found");
    if (!group) throw new MenuNotFoundError("Option group not found");
    if (!relation) throw new MenuValidationError("Product group relation does not exist", "RELATION_NOT_FOUND", 404);

    const groupsById = new Map([[String(group._id), group]]);
    if (!groupsById.has(String(suggestedGroupId))) {
      const suggestedGroup = await MenuOptionGroup.findById(suggestedGroupId).lean();
      if (suggestedGroup) groupsById.set(String(suggestedGroup._id), suggestedGroup);
    }
    const linkedByOptionId = new Map(linkedRelations.map((row) => [String(row.optionId), row]));
    return {
      contractVersion: "dashboard_product_group_option_pool.v4",
      productId,
      groupId,
      group: {
        id: String(group._id),
        key: group.key || "",
        name: group.name || { ar: "", en: "" },
      },
      options: optionRows.map((option) => {
        const optionId = String(option._id);
        const linked = linkedByOptionId.get(optionId) || null;
        const suggestedGroup = groupsById.get(String(option.groupId)) || null;
        return {
          optionId,
          key: option.key || "",
          name: option.name || { ar: "", en: "" },
          isLinked: Boolean(linked),
          productOptionId: linked ? String(linked._id) : null,
          suggestedGroupId: option.groupId ? String(option.groupId) : null,
          suggestedGroupKey: suggestedGroup ? suggestedGroup.key : null,
          defaultPricing: serializeDefaultPricing(option),
          overridePricing: linked ? serializeOverridePricing(linked, option.currency) : serializeOverridePricing({}, option.currency),
          effectivePricing: linked ? serializeEffectivePricing(linked, option) : serializeDefaultPricing(option),
          nutrition: option.nutrition || {},
          status: statusTriple(option, linked || {}),
        };
      }),
    };
  }

  async function createProductGroupOption(productId, groupId, body, actor = {}) {
    assertObjectId(productId, "productId");
    assertObjectId(groupId, "groupId");
    const relation = await ProductOptionGroup.findOne({ productId, groupId }).lean();
    if (!relation) throw new MenuValidationError("Product group relation does not exist", "RELATION_NOT_FOUND", 404);
    const payload = normalizeProductGroupOptionRelationPayload({ ...body, productId, groupId });
    const option = await MenuOption.findOne({ _id: payload.optionId, isActive: true }).lean();
    if (!option) throw new MenuValidationError("Option does not exist or is globally disabled", "OPTION_NOT_ALLOWED", 400);
    const existing = await ProductGroupOption.findOne({ productId, groupId, optionId: payload.optionId }).lean();
    if (existing) {
      return updateEntity(ProductGroupOption, existing._id, { ...payload, isActive: true }, {
        entityType: "menu_product_group_option",
        actor,
        action: "product_group_option_attached",
        meta: { productId, groupId, optionId: payload.optionId },
      });
    }
    const row = await createEntity(ProductGroupOption, payload, { entityType: "menu_product_group_option", actor });
    await writeMenuAudit({
      entityType: "menu_product_group_option",
      entityId: row.id,
      action: "product_group_option_attached",
      actor,
      meta: { productId, groupId, optionId: payload.optionId },
    });
    return row;
  }

  async function deleteProductGroupOption(productId, groupId, optionId, actor = {}) {
    assertObjectId(productId);
    assertObjectId(groupId);
    assertObjectId(optionId);
    const result = await ProductGroupOption.deleteOne({ productId, groupId, optionId });
    if (result.deletedCount > 0) {
      await writeMenuAudit({ entityType: "menu_product_group_option", entityId: productId, action: "product_group_option_detached", actor, meta: { productId, groupId, optionId } });
    }
    return { deleted: result.deletedCount };
  }

  async function updateProductGroupOption(productId, groupId, optionId, body, actor = {}, action = null) {
    assertObjectId(productId, "productId");
    assertObjectId(groupId, "groupId");
    assertObjectId(optionId, "optionId");
    
    const existing = await ProductGroupOption.findOne({ productId, groupId, optionId }).lean();
    if (!existing) throw new MenuNotFoundError("Product group option relation not found");

    const payload = normalizeProductGroupOptionRelationPayload({ ...body, productId, groupId, optionId }, existing);
    
    // Use findOneAndUpdate as requested for atomic update and explicit query
    const updated = await ProductGroupOption.findOneAndUpdate(
      { productId, groupId, optionId },
      { $set: payload },
      { new: true }
    ).lean();

    if (!updated) throw new MenuNotFoundError("Product group option relation not found during update");

    await writeMenuAudit({
      entityType: "menu_product_group_option",
      entityId: updated._id,
      action: action || changeAction(payload, "product_group_option_override_changed"),
      before: existing,
      after: updated,
      actor,
      meta: { productId, groupId, optionId },
    });

    return serializeDoc(updated);
  }

  async function listAuditLogs(options = {}) {
    const pagination = parsePaginationOptions(options);
    const find = MenuAuditLog.find({})
      .sort({ createdAt: -1 })
      .lean();

    if (!pagination) {
      const rows = await find.limit(Math.min(200, Math.max(1, Number(options.limit || 50))));
      return rows.map(serializeDoc);
    }

    const [rows, total] = await Promise.all([
      find.skip(pagination.skip).limit(pagination.limit),
      MenuAuditLog.countDocuments({}),
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

  return {
    serializeDashboardCategory,
    serializeDashboardProduct,
    serializeDashboardOptionGroup,
    serializeDashboardOption,
    serializeDashboardProductGroupRelation,
    serializeDashboardProductOptionRelation,
    getDashboardMenuPreview,
    buildListQuery,
    buildProductFilter,
    listModel,
    serializeDashboardPickerProduct,
    listProducts,
    listOptions,
    listCategories,
    listOptionGroups,
    getModel,
    serializeAdminProductSummary,
    serializeCategoryDetailV3,
    assertDashboardContractVersion,
    getCategoryDetail,
    getProductDetail,
    getOptionGroupDetail,
    getOptionDetail,
    normalizeCategoryPayload,
    normalizeProductPayload,
    normalizeGroupPayload,
    normalizeOptionPayload,
    normalizeSelectionRulePayload,
    normalizeProductGroupRelationPayload,
    normalizeProductGroupOptionRelationPayload,
    changeAction,
    createEntity,
    updateEntity,
    softDeleteEntity,
    reorder,
    duplicateProduct,
    normalizeBulkProductIds,
    bulkAssignProductsToCategory,
    bulkUpdateProducts,
    updateEntityField,
    createCategory,
    createProduct,
    createOptionGroup,
    createOption,
    updateCategory,
    updateProduct,
    updateOptionGroup,
    updateOption,
    updateCategoryVisibility,
    updateCategoryAvailability,
    updateProductVisibility,
    updateProductAvailabilityState,
    updateOptionGroupVisibility,
    updateOptionGroupAvailability,
    updateOptionVisibility,
    updateOptionAvailability,
    deleteCategory,
    deleteProduct,
    deleteOptionGroup,
    deleteOption,
    reorderCategories,
    reorderProducts,
    reorderOptionGroups,
    reorderOptions,
    listProductGroups,
    buildDashboardProductComposerValidation,
    serializeDashboardLinkedOption,
    serializeDashboardLinkedGroup,
    serializePricingFields,
    serializeProductComposerLinkedOptionV3,
    serializeProductComposerLinkedGroupV3,
    serializeProductComposerV3,
    statusTriple,
    serializeDefaultPricing,
    serializeOverridePricing,
    serializeEffectivePricing,
    serializeProductComposerLinkedOptionV4,
    serializeProductComposerLinkedGroupV4,
    serializeProductComposerV4,
    getProductComposer,
    serializeLibraryGroup,
    serializeLibraryOption,
    getCustomizationLibrary,
    updateProductCustomization,
    createProductGroup,
    deleteProductGroup,
    updateProductGroup,
    updateProductGroupSelectionRules,
    listProductGroupOptions,
    normalizeOptionIds,
    replaceProductGroupOptions,
    getProductGroupOptionPool,
    createProductGroupOption,
    deleteProductGroupOption,
    updateProductGroupOption,
    listAuditLogs,
  };
}

module.exports = {
  createMenuCatalogAdminService,
};
