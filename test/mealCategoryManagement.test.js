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

test("updateMealCategory renames assigned meals when the category key changes", async (t) => {
  const originalFindById = MealCategory.findById;
  const originalFindOne = MealCategory.findOne;
  const originalUpdateMany = Meal.updateMany;
  t.after(() => {
    MealCategory.findById = originalFindById;
    MealCategory.findOne = originalFindOne;
    Meal.updateMany = originalUpdateMany;
  });

  const categoryDoc = {
    _id: objectId(),
    key: "hot_food",
    async save() {
      return this;
    },
  };
  let updateManyArgs = null;

  MealCategory.findById = async () => categoryDoc;
  MealCategory.findOne = () => createQueryStub(null);
  Meal.updateMany = async (query, update) => {
    updateManyArgs = { query, update };
    return { acknowledged: true };
  };

  const { req, res } = createReqRes({
    params: { id: String(categoryDoc._id) },
    body: { key: "Mushrooms" },
  });

  await mealCategoryController.updateMealCategory(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(categoryDoc.key, "mushrooms");
  assert.deepEqual(updateManyArgs, {
    query: { category: "hot_food" },
    update: { $set: { category: "mushrooms" } },
  });
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

test("createMeal validates and stores a normalized category key", async (t) => {
  const originalFindOne = MealCategory.findOne;
  const originalCreate = Meal.create;
  t.after(() => {
    MealCategory.findOne = originalFindOne;
    Meal.create = originalCreate;
  });

  let createdPayload = null;
  MealCategory.findOne = ({ key }) => createQueryStub(
    key === "hot_food" ? { _id: objectId(), key: "hot_food" } : null
  );
  Meal.create = async (payload) => {
    createdPayload = payload;
    return { id: String(objectId()) };
  };

  const { req, res } = createReqRes({
    body: {
      name: { ar: "لازانيا", en: "Lasagna" },
      categoryKey: "Hot Food",
      availableForOrder: true,
      availableForSubscription: true,
    },
  });

  await mealController.createMeal(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(createdPayload.category, "hot_food");
  assert.equal(createdPayload.proteinGrams, 33);
  assert.equal(createdPayload.carbGrams, 37);
  assert.equal(createdPayload.fatGrams, 19);
});

test("createMeal rejects unknown category keys to keep meal assignments valid", async (t) => {
  const originalFindOne = MealCategory.findOne;
  t.after(() => {
    MealCategory.findOne = originalFindOne;
  });

  MealCategory.findOne = () => createQueryStub(null);

  const { req, res } = createReqRes({
    body: {
      name: { en: "Soup" },
      categoryKey: "Unknown Category",
    },
  });

  await mealController.createMeal(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error.code, "INVALID_CATEGORY");
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
