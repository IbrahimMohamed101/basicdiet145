const swaggerJSDoc = require("swagger-jsdoc");

const definition = {
  openapi: "3.0.0",
  info: {
    title: "BasicDiet API",
    version: "1.0.0",
    description: "Diet meal subscription backend API",
  },
  servers: [
    { url: "/api", description: "Local API base" },
    { url: "/", description: "Root (non-API endpoints)" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
      dashboardBearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    schemas: {
      MealSlot: {
        type: "object",
        properties: {
          slotIndex: { type: "integer" },
          slotKey: { type: "string" },
          status: { type: "string", enum: ["empty", "partial", "complete"] },
          proteinId: { type: "string", nullable: true },
          carbId: { type: "string", nullable: true },
          proteinFamilyKey: { type: "string", nullable: true },
          isPremium: { type: "boolean" },
          premiumSource: { type: "string", enum: ["none", "balance", "pending_payment", "paid_extra"] },
        },
      },
      PlannerMeta: {
        type: "object",
        properties: {
          requiredSlotCount: { type: "integer" },
          completeSlotCount: { type: "integer" },
          partialSlotCount: { type: "integer" },
          emptySlotCount: { type: "integer" },
          premiumCoveredByBalanceCount: { type: "integer" },
          premiumPendingPaymentCount: { type: "integer" },
          beefSlotCount: { type: "integer" },
          isDraftValid: { type: "boolean" },
          isConfirmable: { type: "boolean" },
        },
      },
      PaymentRequirement: {
        type: "object",
        properties: {
          requiresPayment: { type: "boolean" },
          extraPremiumCount: { type: "integer" },
          amountHalala: { type: "integer" },
          currency: { type: "string" },
          status: { type: "string", enum: ["none", "pending", "paid"] },
        },
      },
    },
  },
};

const options = {
  definition,
  apis: ["./src/routes/*.js", "./src/app.js"],
};

module.exports = swaggerJSDoc(options);
