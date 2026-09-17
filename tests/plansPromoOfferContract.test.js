process.env.NODE_ENV = "test";

const assert = require("assert");
const Plan = require("../src/models/Plan");
const promoDisplayService = require("../src/services/subscriptionPromoDisplayService");

const originalFind = Plan.find;
const originalResolver = promoDisplayService.resolvePublicSubscriptionPromoOffer;

function createResponseCapture() {
  const capture = { statusCode: null, body: null };
  return {
    capture,
    response: {
      status(code) {
        capture.statusCode = code;
        return this;
      },
      json(body) {
        capture.body = body;
        return body;
      },
    },
  };
}

function stubPlans() {
  Plan.find = () => ({
    sort: () => ({
      lean: async () => [],
    }),
  });
}

function loadControllerWithResolver(resolver) {
  promoDisplayService.resolvePublicSubscriptionPromoOffer = resolver;
  delete require.cache[require.resolve("../src/controllers/planController")];
  return require("../src/controllers/planController");
}

async function main() {
  stubPlans();
  const offer = {
    id: "promo-1",
    code: "SAVE20",
    isVisible: true,
    showOnHome: true,
    showOnPlans: true,
    discountLabel: { ar: "خصم 20%", en: "20% OFF" },
    homeMessage: { ar: "اعرض الخطط", en: "View plans" },
    title: { ar: "وفّر", en: "Save" },
    description: { ar: "انسخ الكود", en: "Copy the code" },
    startsAt: null,
    expiresAt: null,
  };

  let controller = loadControllerWithResolver(async ({ userId }) => {
    assert.strictEqual(userId, "user-1");
    return offer;
  });
  let capture = createResponseCapture();
  await controller.listPlans(
    { userId: "user-1", headers: { "accept-language": "ar" }, query: {} },
    capture.response
  );
  assert.strictEqual(capture.capture.statusCode, 200);
  assert.deepStrictEqual(capture.capture.body, {
    status: true,
    data: [],
    promoOffer: offer,
  });

  controller = loadControllerWithResolver(async () => {
    throw new Error("promo display unavailable");
  });
  capture = createResponseCapture();
  await controller.listPlans(
    { headers: { "accept-language": "en" }, query: {} },
    capture.response
  );
  assert.strictEqual(capture.capture.statusCode, 200);
  assert.deepStrictEqual(capture.capture.body, {
    status: true,
    data: [],
    promoOffer: null,
  });

  console.log("plansPromoOfferContract.test.js: PASS");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    Plan.find = originalFind;
    promoDisplayService.resolvePublicSubscriptionPromoOffer = originalResolver;
    delete require.cache[require.resolve("../src/controllers/planController")];
  });
