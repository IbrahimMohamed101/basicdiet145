const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");

function withEnv(overrides, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("createApp auto-enables trust proxy on Render", () => {
  withEnv(
    {
      TRUST_PROXY: undefined,
      RENDER: "true",
      RENDER_EXTERNAL_URL: "https://basicdiet145.onrender.com",
    },
    () => {
      const app = createApp();
      assert.equal(app.get("trust proxy"), 1);
    }
  );
});

test("explicit TRUST_PROXY value overrides Render defaults", () => {
  withEnv(
    {
      TRUST_PROXY: "2",
      RENDER: "true",
      RENDER_EXTERNAL_URL: "https://basicdiet145.onrender.com",
    },
    () => {
      const app = createApp();
      assert.equal(app.get("trust proxy"), 2);
    }
  );
});
