const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const mealCategoryController = require("../src/controllers/mealCategoryController");
const mealController = require("../src/controllers/mealController");
const premiumMealController = require("../src/controllers/premiumMealController");
const MealCategory = require("../src/models/MealCategory");
const Meal = require("../src/models/Meal");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createReqRes({ body = {}, params = {}, query = {}, headers = {} } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
  );

  const req = {
    body,
    params,
    query,
    headers: normalizedHeaders,
    get(name) {
      return normalizedHeaders[String(name || "").toLowerCase()];
    },
  };

  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };

  return { req, res };
}

function createQueryStub(result) {
  return {
    sort() {
      return this;
    },
    select() {
      return this;
    },
    populate() {
      return this;
    },
    skip() {
      return this;
    },
    limit() {
      return this;
    },
    session() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
}

test("createMealCategory normalizes the category key and persists localized data", async (t) => {
  const originalFindOne = MealCategory.findOne;
  const originalCreate = MealCategory.create;
  t.after(() => {
    MealCategory.findOne = originalFindOne;
    MealCategory.create = originalCreate;
  });

  let createdPayload = null;
  MealCategory.findOne = () => createQueryStub(null);
  MealCategory.create = async (payload) => {
    createdPayload = payload;
    return { id: String(objectId()), key: payload.key };
  };

  const { req, res } = createReqRes({
    body: {
      key: "Hot Food",
      name: { ar: "الأكل الساخن", en: "Hot Food" },
      description: { ar: "وجبات تقدم ساخنة", en: "Served warm" },
      sortOrder: 2,
    },
  });

  await mealCategoryController.createMealCategory(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.ok, true);
  assert.equal(createdPayload.key, "hot_food");
  assert.equal(createdPayload.name.ar, "الأكل الساخن");
  assert.equal(createdPayload.sortOrder, 2);
});

test("updateMealCategory updates only category metadata when key changes", async (t) => {
  const originalFindById = MealCategory.findById;
  const originalFindOne = MealCategory.findOne;
  t.after(() => {
    MealCategory.findById = originalFindById;
    MealCategory.findOne = originalFindOne;
  });

  const categoryDoc = {
    _id: objectId(),
    key: "hot_food",
    async save() {
      return this;
    },
  };
  MealCategory.findById = async () => categoryDoc;
  MealCategory.findOne = () => createQueryStub(null);

  const { req, res } = createReqRes({
    params: { id: String(categoryDoc._id) },
    body: { key: "Mushrooms" },
  });

  await mealCategoryController.updateMealCategory(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(categoryDoc.key, "mushrooms");
});

test("deleteMealCategory refuses to delete a category that is still assigned to meals", async (t) => {
  const originalFindById = MealCategory.findById;
  const originalCountDocuments = Meal.countDocuments;
  t.after(() => {
    MealCategory.findById = originalFindById;
    Meal.countDocuments = originalCountDocuments;
  });

  const categoryId = objectId();
  MealCategory.findById = () => createQueryStub({ _id: categoryId, key: "hot_food" });
  Meal.countDocuments = async () => 2;

  const { req, res } = createReqRes({
    params: { id: String(categoryId) },
  });

  await mealCategoryController.deleteMealCategory(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.error.code, "CATEGORY_IN_USE");
});

test("createMeal requires categoryId and stores relation via categoryId", async (t) => {
  const originalFindById = MealCategory.findById;
  const originalCreate = Meal.create;
  t.after(() => {
    MealCategory.findById = originalFindById;
    Meal.create = originalCreate;
  });

  let createdPayload = null;
  const categoryId = objectId();
  MealCategory.findById = () => createQueryStub({ _id: categoryId, key: "hot_food" });
  Meal.create = async (payload) => {
    createdPayload = payload;
    return { id: String(objectId()) };
  };

  const { req, res } = createReqRes({
    body: {
      name: { ar: "لازانيا", en: "Lasagna" },
      categoryId: String(categoryId),
      availableForOrder: true,
      availableForSubscription: true,
    },
  });

  await mealController.createMeal(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(String(createdPayload.categoryId), String(categoryId));
  assert.equal(createdPayload.proteinGrams, 33);
  assert.equal(createdPayload.carbGrams, 37);
  assert.equal(createdPayload.fatGrams, 19);
});

test("createMeal rejects deprecated categoryKey/category write fields", async () => {
  const { req, res } = createReqRes({
    body: {
      name: { en: "Soup" },
      categoryKey: "legacy",
    },
  });

  await mealController.createMeal(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error.code, "INVALID");
});

test("updateMeal rejects deprecated categoryKey/category write fields", async () => {
  const { req, res } = createReqRes({
    params: { id: String(objectId()) },
    body: {
      category: "legacy",
    },
  });

  await mealController.updateMeal(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error.code, "INVALID");
});

test("createMeal rejects unknown categoryId values", async (t) => {
  const originalFindById = MealCategory.findById;
  t.after(() => {
    MealCategory.findById = originalFindById;
  });

  MealCategory.findById = () => createQueryStub(null);

  const { req, res } = createReqRes({
    body: {
      name: { en: "Soup" },
      categoryId: String(objectId()),
    },
  });

  await mealController.createMeal(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error.code, "INVALID_CATEGORY");
});

test("listCategoriesWithMeals returns grouped payload with slug and categoryId only", async (t) => {
  const originalCategoryFind = MealCategory.find;
  const originalMealFind = Meal.find;
  t.after(() => {
    MealCategory.find = originalCategoryFind;
    Meal.find = originalMealFind;
  });

  const categoryId = objectId();
  MealCategory.find = () => createQueryStub([
    {
      _id: categoryId,
      key: "breakfast",
      name: { en: "Breakfast", ar: "فطور" },
      sortOrder: 1,
      isActive: true,
    },
  ]);
  Meal.find = () => createQueryStub([
    {
      _id: objectId(),
      name: { en: "Omelette", ar: "عجة" },
      categoryId,
      sortOrder: 1,
      isActive: true,
    },
  ]);

  const { req, res } = createReqRes({ headers: { "accept-language": "en" } });
  await mealController.listCategoriesWithMeals(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(Array.isArray(res.payload.data), true);
  assert.equal(res.payload.data[0].slug, "breakfast");
  assert.equal(res.payload.data[0].meals[0].categoryId, String(categoryId));
  assert.equal("key" in res.payload.data[0], false);
});

test("validatePremiumMealPayloadOrThrow assigns default nutrition values when omitted", () => {
  const payload = premiumMealController.validatePremiumMealPayloadOrThrow({
    name: { en: "Premium Bowl" },
    description: { en: "Extra meal" },
    extraFeeHalala: 1500,
  });

  assert.equal(payload.proteinGrams, 33);
  assert.equal(payload.carbGrams, 37);
  assert.equal(payload.fatGrams, 19);
});
