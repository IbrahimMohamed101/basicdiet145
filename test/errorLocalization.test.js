const test = require("node:test");
const assert = require("node:assert/strict");

const { authMiddleware } = require("../src/middleware/auth");
const { dashboardAuthMiddleware } = require("../src/middleware/dashboardAuth");
const { buildRateLimitPayload } = require("../src/middleware/rateLimit");
const subscriptionController = require("../src/controllers/subscriptionController");
const errorResponse = require("../src/utils/errorResponse");
const { createLocalizedError } = require("../src/utils/errorLocalization");

function createReqRes({ query = {}, headers = {}, params = {}, body = {}, userId = "user-1" } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
  );

  const req = {
    query,
    headers: normalizedHeaders,
    params,
    body,
    userId,
    get(name) {
      return normalizedHeaders[String(name || "").toLowerCase()];
    },
  };

  const res = {
    req,
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

test("authMiddleware localizes message using query lang over Accept-Language", () => {
  const { req, res } = createReqRes({
    query: { lang: "en" },
    headers: { "accept-language": "ar-SA,ar;q=0.9" },
  });

  authMiddleware(req, res, () => {
    throw new Error("next should not be called");
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.status, false);
  assert.equal(res.payload.message, "Missing token");
});

test("authMiddleware localizes message from Accept-Language when query is absent", () => {
  const { req, res } = createReqRes({
    headers: { "accept-language": "ar-SA,ar;q=0.9" },
  });

  authMiddleware(req, res, () => {
    throw new Error("next should not be called");
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.status, false);
  assert.equal(res.payload.message, "الرمز مفقود");
});

test("dashboardAuthMiddleware localizes message using query lang over Accept-Language and preserves error code", () => {
  const { req, res } = createReqRes({
    query: { lang: "en" },
    headers: {
      authorization: "Bearer not-a-real-token",
      "accept-language": "ar-SA,ar;q=0.9",
    },
  });

  dashboardAuthMiddleware(req, res, () => {
    throw new Error("next should not be called");
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.error.code, "UNAUTHORIZED");
  assert.equal(res.payload.error.message, "Invalid dashboard token");
});

test("errorResponse localizes service-created errors and preserves stable error codes", () => {
  const { res } = createReqRes({
    headers: { "accept-language": "ar-SA" },
  });
  const err = createLocalizedError({
    code: "PLANNING_INCOMPLETE",
    key: "errors.planning.incomplete",
    fallbackMessage: "Day must contain exactly mealsPerDay total meal selections before confirmation",
  });

  errorResponse(res, 400, err.code, err);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error.code, "PLANNING_INCOMPLETE");
  assert.equal(
    res.payload.error.message,
    "يجب أن يحتوي اليوم على عدد اختيارات يساوي mealsPerDay تمامًا قبل التأكيد"
  );
});

test("getSubscription localizes validation errors and falls back to default language for unsupported lang", async () => {
  const { req, res } = createReqRes({
    query: { lang: "fr" },
    params: { id: "not-an-object-id" },
  });

  await subscriptionController.getSubscription(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error.code, "INVALID_ID");
  assert.equal(res.payload.error.message, "subscriptionId ليس معرفًا صالحًا");
});

test("checkoutSubscription localizes validation errors for query lang and keeps code unchanged", async () => {
  const { req, res } = createReqRes({
    query: { lang: "ar" },
    headers: { "accept-language": "en-US,en;q=0.9" },
    body: {},
  });

  await subscriptionController.checkoutSubscription(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error.code, "VALIDATION_ERROR");
  assert.equal(
    res.payload.error.message,
    "idempotencyKey مطلوب (من خلال ترويسة Idempotency-Key أو X-Idempotency-Key أو body.idempotencyKey)"
  );
});

test("buildRateLimitPayload localizes based on Accept-Language and preserves RATE_LIMIT code", () => {
  const { req } = createReqRes({
    headers: { "accept-language": "en-US,en;q=0.9,ar;q=0.8" },
  });

  const payload = buildRateLimitPayload(req, "errors.rateLimit.checkout");

  assert.deepEqual(payload, {
    ok: false,
    error: {
      code: "RATE_LIMIT",
      message: "Too many checkout attempts",
    },
  });
});

test("buildRateLimitPayload gives query.lang priority over header and falls back safely for unsupported values", () => {
  const prioritized = buildRateLimitPayload(
    createReqRes({
      query: { lang: "en" },
      headers: { "accept-language": "ar-SA,ar;q=0.9" },
    }).req,
    "errors.rateLimit.dashboardLogin"
  );
  assert.deepEqual(prioritized, {
    ok: false,
    error: {
      code: "RATE_LIMIT",
      message: "Too many dashboard login attempts",
    },
  });

  const fallback = buildRateLimitPayload(
    createReqRes({
      query: { lang: "fr" },
      headers: { "accept-language": "de-DE,de;q=0.9" },
    }).req,
    "errors.rateLimit.default"
  );
  assert.deepEqual(fallback, {
    ok: false,
    error: {
      code: "RATE_LIMIT",
      message: "عدد الطلبات كبير جدًا",
    },
  });
});
