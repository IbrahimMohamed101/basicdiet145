"use strict";

const entrypoint = String(process.argv[1] || "").replace(/\\/g, "/");
if (entrypoint.endsWith("/tests/subscriptionBalancePolicy.test.js")) {
  // This test starts a fresh MongoMemory replica set and immediately exercises
  // multi-document transactions. Await every registered collection/index before
  // mongoose.connect resolves so catalog creation cannot race the freeze flow.
  require("./mongoCatalogStability");
}

function captureEnvironment(variableNames) {
  return new Map(variableNames.map((name) => [
    name,
    {
      existed: Object.prototype.hasOwnProperty.call(process.env, name),
      value: process.env[name],
    },
  ]));
}

function restoreEnvironment(snapshot) {
  for (const [name, original] of snapshot) {
    if (original.existed) process.env[name] = original.value;
    else delete process.env[name];
  }
}

function setTemporaryEnvironment(overrides) {
  const snapshot = captureEnvironment(Object.keys(overrides));
  let restored = false;

  const restore = () => {
    if (restored) return;
    restored = true;
    process.removeListener("exit", restore);
    restoreEnvironment(snapshot);
  };

  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = String(value);
  }

  process.once("exit", restore);
  return restore;
}

async function withTemporaryEnvironment(overrides, work) {
  const restore = setTemporaryEnvironment(overrides);
  try {
    return await work();
  } finally {
    restore();
  }
}

module.exports = {
  captureEnvironment,
  restoreEnvironment,
  setTemporaryEnvironment,
  withTemporaryEnvironment,
};
