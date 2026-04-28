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
          selectionType: { type: "string", enum: ["standard_meal", "premium_meal", "premium_large_salad", "sandwich"] },
          proteinId: { type: "string", nullable: true },
          sandwichId: { type: "string", nullable: true },
          carbs: { 
            type: "array", 
            description: "Canonical carb split for standard_meal or premium_meal selections.",
            items: {
              type: "object",
              properties: {
                carbId: { type: "string" },
                grams: { type: "integer" }
              }
            }
          },
          salad: { 
            type: "object", 
            nullable: true,
            description: "Canonical premium_large_salad payload. Legacy customSalad input may still be accepted on write, but canonical reads use this field.",
            properties: {
              presetKey: { type: "string", nullable: true },
              groups: {
                type: "object",
                description: "Canonical grouped premium_large_salad selections keyed by leafy_greens, vegetables, fruits, protein, cheese_nuts, or sauce",
              }
            }
          },
          proteinFamilyKey: { type: "string", nullable: true },
          isPremium: { type: "boolean" },
          premiumKey: { type: "string", nullable: true },
          premiumSource: { type: "string", enum: ["none", "balance", "pending_payment", "paid_extra", "paid"] },
        },
      },
      AddonSelection: {
        type: "object",
        properties: {
          addonId: { type: "string" },
          name: { type: "string" },
          category: { type: "string" },
          source: { type: "string", enum: ["subscription", "wallet", "pending_payment", "paid"] },
          priceHalala: { type: "integer" },
          currency: { type: "string" },
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
          status: { type: "string", enum: ["satisfied", "priced", "pending", "failed"] },
          requiresPayment: { type: "boolean" },
          pricingStatus: { type: "string", enum: ["not_required", "priced", "pending", "failed"] },
          blockingReason: {
            type: "string",
            nullable: true,
            enum: [
              "locked",
              "planning_incomplete",
              "payment_revision_mismatch",
              "pricing_failed",
              "pricing_pending",
              "premium_pending_payment",
              "addons_pending_payment",
              "planner_unconfirmed",
            ],
          },
          canCreatePayment: { type: "boolean" },
          premiumSelectedCount: { type: "integer" },
          premiumPendingPaymentCount: { type: "integer" },
          addonSelectedCount: { type: "integer" },
          addonPendingPaymentCount: { type: "integer" },
          pendingAmountHalala: { type: "integer" },
          amountHalala: { type: "integer" },
          currency: { type: "string" },
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
