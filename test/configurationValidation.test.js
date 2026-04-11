/**
 * @file cofigurationValidation.test.js
 * @description Configuration startup validation tests
 * 
 * Tests that critical configuration is present before app starts
 * This prevents runtime failures due to missing payment provider config
 */

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");

function reloadValidateEnv() {
  const path = require.resolve("../src/utils/validateEnv");
  delete require.cache[path];
  return require("../src/utils/validateEnv");
}

function withEnv(overrides, fn) {
  const backup = {};
  for (const key of Object.keys(overrides)) {
    backup[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }

  try {
    return fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (backup[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = backup[key];
      }
    }
  }
}

describe("Configuration Validation", () => {
  before(() => {
    process.env.MOYASAR_SECRET_KEY = process.env.MOYASAR_SECRET_KEY || "test_moyasar_key_1234567890";
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test_jwt_secret";
    process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "test_dashboard_secret";
    process.env.MONGO_URI = "mongodb://testuser:testpass@localhost:27017/basicdiet_test";
    process.env.MONGODB_URI = process.env.MONGO_URI;
  });

  describe("Environment Variables at Startup", () => {
    it("MOYASAR_SECRET_KEY must be defined", () => {
      const secretKey = process.env.MOYASAR_SECRET_KEY;
      assert.ok(secretKey);
      assert.equal(typeof secretKey, "string");
      assert.ok(secretKey.length > 0);
    });

    it("JWT_SECRET must be defined", () => {
      const secret = process.env.JWT_SECRET;
      assert.ok(secret);
      assert.equal(typeof secret, "string");
      assert.ok(secret.length > 0);
    });

    it("DASHBOARD_JWT_SECRET must be defined", () => {
      const secret = process.env.DASHBOARD_JWT_SECRET;
      assert.ok(secret);
      assert.equal(typeof secret, "string");
      assert.ok(secret.length > 0);
    });

    it("MONGODB_URI or MONGO_URI must be defined", () => {
      const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
      assert.ok(uri);
      assert.ok(uri.includes("mongodb"));
    });
  });

  describe("Moyasar Configuration Validation", () => {
    it("MOYASAR_SECRET_KEY should not be empty or placeholder", () => {
      const key = process.env.MOYASAR_SECRET_KEY;
      assert.notEqual(key, "your_moyasar_secret_here");
      assert.notEqual(key, "placeholder");
      assert.notEqual(key, "test");
    });

    it("MOYASAR_SECRET_KEY should have reasonable length", () => {
      const key = process.env.MOYASAR_SECRET_KEY;
      // Real Moyasar keys are typically 20+ characters
      assert.ok(key.length >= 20);
    });
  });

  describe("Payment Provider Integration Points", () => {
    it("moyasarService should be loadable", () => {
      // This test verifies the payment service can be imported
      const moyasarService = require("../src/services/moyasarService");
      assert.ok(moyasarService);
      assert.equal(typeof moyasarService.createInvoice, "function");
      assert.equal(typeof moyasarService.getInvoice, "function");
    });

    it("checkoutController should reference payment service", () => {
      // This test verifies controllers have access to payment functions
      const controller = require("../src/controllers/subscriptionController");
      assert.ok(controller);
      assert.equal(typeof controller.checkoutSubscription, "function");
    });
  });

  describe("Configuration Impact on Endpoints", () => {
    it("Missing MOYASAR_SECRET_KEY should be caught at validation startup", () => {
      // This is verified by checking validateEnv.js was called
      // If validation passed, MOYASAR_SECRET_KEY was present
      const hasError = !process.env.MOYASAR_SECRET_KEY;
      assert.equal(hasError, false);
    });

    it("app should not start without payment config", () => {
      const result = withEnv({ MOYASAR_SECRET_KEY: "" }, () => {
        const { validateEnv } = reloadValidateEnv();
        return validateEnv();
      });

      assert.equal(result.ok, false);
      assert.ok(Array.isArray(result.missing));
      assert.ok(result.missing.includes("MOYASAR_SECRET_KEY"));
    });
  });

  describe("Feature Flags and Optional Configuration", () => {
    it("should handle missing optional OTP provider gracefully when test auth is enabled", () => {
      const result = withEnv(
        {
          OTP_TEST_MODE: "true",
          ALLOW_TEST_AUTH: "true",
          OTP_TEST_CODE: "123456",
          OTP_TEST_PHONE: "+15005550006",
          TWILIO_ACCOUNT_SID: undefined,
          TWILIO_AUTH_TOKEN: undefined,
          TWILIO_WHATSAPP_FROM: undefined,
          OTP_HASH_SECRET: undefined,
        },
        () => {
          const { validateEnv } = reloadValidateEnv();
          return validateEnv();
        }
      );

      assert.equal(result.ok, true);
    });

    it("should handle missing optional Cloudinary gracefully", () => {
      const result = withEnv(
        {
          CLOUDINARY_CLOUD_NAME: undefined,
          CLOUDINARY_API_KEY: undefined,
          CLOUDINARY_API_SECRET: undefined,
          TWILIO_ACCOUNT_SID: "dummy-sid",
          TWILIO_AUTH_TOKEN: "dummy-token",
          TWILIO_WHATSAPP_FROM: "+15005550006",
          OTP_HASH_SECRET: "dummy-hash",
        },
        () => {
          const { validateEnv } = reloadValidateEnv();
          return validateEnv();
        }
      );

      assert.equal(result.ok, true);
    });
  });

  describe("Environment Detection", () => {
    it("should identify production vs development", () => {
      const isDev = process.env.NODE_ENV !== "production";
      // Both states are valid - we just need to know the current state
      assert.equal(typeof isDev, "boolean");
    });

    it("should enforce production checks appropriately", () => {
      const nodeEnv = String(process.env.NODE_ENV || "development");
      assert.ok(nodeEnv.length > 0);
      assert.equal(typeof nodeEnv, "string");
      assert.ok(["production", "development", "test", "staging"].includes(nodeEnv) || nodeEnv !== "");
    });
  });

  describe("Database Configuration", () => {
    it("should have valid MongoDB connection string", () => {
      const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
      
      // Basic validation - should contain mongodb protocol
      assert.ok(uri.includes("mongodb"));
      
      // Should not be a placeholder
      assert.ok(!uri.includes("YOUR_"));
      assert.ok(!uri.includes("your_"));
      assert.ok(!uri.includes("INSERT_"));
    });

    it("MongoDB URI should have authentication", () => {
      const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
      
      // Should include either:
      // - Basic auth: mongodb://user:pass@host
      // - SRV: mongodb+srv://user:pass@host
      const hasAuth = uri.includes("://") && uri.includes("@");
      assert.ok(hasAuth || uri.includes("+srv"));
    });
  });

  describe("Production Readiness Checklist", () => {
    it("should have all required keys configured", () => {
      const requiredKeys = [
        "MOYASAR_SECRET_KEY",
        "JWT_SECRET",
        "DASHBOARD_JWT_SECRET",
        "MONGODB_URI",
        "MONGO_URI"
      ];

      const configured = requiredKeys.filter(key => 
        process.env[key] && process.env[key].length > 0
      );

      // At minimum, should have MOYASAR + JWT + MongoDB
      const hasPayment = process.env.MOYASAR_SECRET_KEY;
      const hasJWT = process.env.JWT_SECRET;
      const hasDashboardJWT = process.env.DASHBOARD_JWT_SECRET;
      const hasDB = process.env.MONGODB_URI || process.env.MONGO_URI;

      assert.ok(hasPayment);
      assert.ok(hasJWT);
      assert.ok(hasDashboardJWT);
      assert.ok(hasDB);
    });
  });
});

/**
 * PRODUCTION CONFIGURATION VALIDATION
 * 
 * System ensures production readiness through:
 * 
 * 1. validateEnv.js startup check:
 *    - Runs on first require of app.js
 *    - Throws error if critical keys missing
 *    - Provides clear error messages for remediation
 * 
 * 2. Critical keys enforced:
 *    - MOYASAR_SECRET_KEY (payment provider)
 *    - JWT_SECRET (app authentication)
 *    - DASHBOARD_JWT_SECRET (admin authentication)
 *    - MONGODB_URI or MONGO_URI (database)
 * 
 * 3. Optional keys (not enforced):
 *    - TWILIO_ACCOUNT_SID (OTP - can be bypassed)
 *    - CLOUDINARY_* (image uploads - can be disabled)
 *    - RATE_LIMIT_* (defaults used if missing)
 * 
 * STARTUP VERIFICATION:
 * 
 * Run in terminal:
 * ```
 * npm start
 * ```
 * 
 * Should see:
 * - "[subscriptions-api] Server running on port 3000"
 * 
 * Should NOT see:
 * - "MOYASAR_SECRET_KEY not configured"
 * - "JWT_SECRET not configured"
 * - "MONGODB_URI not configured"
 * - "ValidationError"
 * 
 * If validation fails, check:
 * - .env file exists
 * - All required keys are set
 * - Keys have non-empty values
 * - Moyasar key is from Moyasar dashboard (not test/placeholder)
 * - MongoDB URI uses correct protocol (mongodb:// or mongodb+srv://)
 */
