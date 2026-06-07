const assert = require("assert");
const { getDbNameFromUri, resolveMongoUri } = require("../src/utils/mongoUriResolver");
const { validateEnv } = require("../src/utils/validateEnv");

async function runTests() {
  console.log("Running DB Isolation Logic Tests...\n");

  // Mock environment
  const originalEnv = { ...process.env };

  function setEnv(env) {
    for (const key in process.env) delete process.env[key];
    Object.entries(env).forEach(([key, value]) => {
      if (value !== undefined) process.env[key] = value;
    });
  }

  function restoreEnv() {
    for (const key in process.env) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }

  function validBaseEnv(overrides = {}) {
    return {
      NODE_ENV: "test",
      MONGO_URI_TEST: "mongodb://localhost/basicdiet_test",
      JWT_SECRET: "test-jwt-secret",
      DASHBOARD_JWT_SECRET: "test-dashboard-jwt-secret",
      MOYASAR_SECRET_KEY: "test-moyasar-secret",
      OTP_TEST_MODE: "true",
      ALLOW_TEST_AUTH: "true",
      OTP_TEST_CODE: "123456",
      OTP_TEST_PHONE: "+966500000000",
      ...overrides,
    };
  }

  try {
    // Test getDbNameFromUri
    console.log("Testing getDbNameFromUri...");
    assert.strictEqual(getDbNameFromUri("mongodb://localhost:27017/my_db"), "my_db");
    assert.strictEqual(getDbNameFromUri("mongodb+srv://user:pass@cluster.mongodb.net/prod_db?retryWrites=true"), "prod_db");
    assert.strictEqual(getDbNameFromUri("mongodb://localhost:27017/"), "");
    assert.strictEqual(getDbNameFromUri("not-a-uri"), "");
    console.log("✅ getDbNameFromUri passed\n");

    // Test resolveMongoUri in Test mode
    console.log("Testing resolveMongoUri (NODE_ENV=test)...");
    
    setEnv({ NODE_ENV: "test", MONGO_URI_TEST: "mongodb://localhost/test_db" });
    assert.strictEqual(resolveMongoUri(), "mongodb://localhost/test_db");

    setEnv({ NODE_ENV: "test", MONGO_URI_TEST: "mongodb://localhost/bd145_ci_run" });
    assert.strictEqual(resolveMongoUri(), "mongodb://localhost/bd145_ci_run");

    setEnv({ NODE_ENV: "test", MONGO_URI_TEST: "mongodb://localhost/local_dev_test" });
    assert.strictEqual(resolveMongoUri(), "mongodb://localhost/local_dev_test");

    // Fails if missing
    setEnv({ NODE_ENV: "test" });
    assert.throws(() => resolveMongoUri(), /MONGO_URI_TEST is required/);

    // Fails if unsafe (primary DB)
    setEnv({ NODE_ENV: "test", MONGO_URI_TEST: "mongodb://localhost/basicdiet145" });
    assert.throws(() => resolveMongoUri(), /is not allowed in test mode/);

    // Fails if unsafe (no keywords)
    setEnv({ NODE_ENV: "test", MONGO_URI_TEST: "mongodb://localhost/my_production_copy" });
    assert.throws(() => resolveMongoUri(), /must include "test", "local", or "ci"/);

    console.log("✅ resolveMongoUri (test) passed\n");

    console.log("Testing validateEnv MongoDB isolation...");

    setEnv(validBaseEnv({ MONGO_URI_TEST: undefined }));
    assert.deepStrictEqual(validateEnv().missing, ["MONGO_URI_TEST"]);

    setEnv(validBaseEnv({ MONGO_URI_TEST: "mongodb://localhost/basicdiet145" }));
    const unsafePrimary = validateEnv();
    assert.strictEqual(unsafePrimary.ok, false);
    assert.deepStrictEqual(unsafePrimary.invalid, ["MONGO_URI_TEST"]);
    assert.match(unsafePrimary.message, /not allowed in test mode/);

    setEnv(validBaseEnv({ MONGO_URI_TEST: "mongodb://localhost/my_production_copy" }));
    const unsafeName = validateEnv();
    assert.strictEqual(unsafeName.ok, false);
    assert.deepStrictEqual(unsafeName.invalid, ["MONGO_URI_TEST"]);
    assert.match(unsafeName.message, /must include "test", "local", or "ci"/);

    setEnv(validBaseEnv({ MONGO_URI_TEST: "mongodb://localhost/basicdiet_ci_run" }));
    assert.strictEqual(validateEnv().ok, true);

    console.log("✅ validateEnv MongoDB isolation passed\n");

    // Test resolveMongoUri in Dev/Prod mode
    console.log("Testing resolveMongoUri (NODE_ENV=development)...");
    
    setEnv({ NODE_ENV: "development", MONGO_URI: "mongodb://localhost/basicdiet145" });
    assert.strictEqual(resolveMongoUri(), "mongodb://localhost/basicdiet145");

    setEnv({ NODE_ENV: "development", MONGODB_URI: "mongodb://localhost/other_db" });
    assert.strictEqual(resolveMongoUri(), "mongodb://localhost/other_db");

    setEnv({ NODE_ENV: "development" });
    assert.throws(() => resolveMongoUri(), /Missing MongoDB connection string/);

    console.log("✅ resolveMongoUri (dev/prod) passed\n");

    console.log("ALL TESTS PASSED! 🚀");
  } catch (err) {
    console.error("❌ TEST FAILED");
    console.error(err);
    process.exit(1);
  } finally {
    restoreEnv();
  }
}

runTests();
