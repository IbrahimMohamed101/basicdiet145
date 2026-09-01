"use strict";

const assert = require("assert");
const { ObjectId } = require("mongodb");
const {
  FIXTURE_PREFIX,
  HUMAN_OPTION_DISPOSITION,
  PRODUCTION_CONFIRMATION,
  TARGETS,
  assertExecutionGuards,
  collectFixtureReferences,
  parseArgs,
} = require("../scripts/migrations/quarantine-pickup-slot-append-fixtures");

function main() {
  assert.deepStrictEqual(parseArgs([]), {
    execute: false,
    productionConfirmation: "",
    humanOptionDisposition: "",
  });
  assert.doesNotThrow(() => assertExecutionGuards(parseArgs([]), { NODE_ENV: "production" }));

  assert.throws(
    () => assertExecutionGuards(parseArgs(["--execute"]), { NODE_ENV: "production" }),
    /HUMAN DECISION REQUIRED/
  );
  assert.throws(
    () => assertExecutionGuards(parseArgs([
      "--execute",
      `--spicy-chicken-disposition=${HUMAN_OPTION_DISPOSITION}`,
    ]), { NODE_ENV: "production" }),
    /Production execution requires/
  );
  assert.doesNotThrow(() => assertExecutionGuards(parseArgs([
    "--execute",
    `--spicy-chicken-disposition=${HUMAN_OPTION_DISPOSITION}`,
    `--confirm-production-quarantine=${PRODUCTION_CONFIRMATION}`,
  ]), { NODE_ENV: "production" }));

  const groupId = TARGETS.groups[0][0];
  const groupKey = TARGETS.groups[0][1];
  const hits = collectFixtureReferences({
    groupId: new ObjectId(groupId),
    groupKey,
    unrelated: "protein sandwich salad",
  });
  assert(hits.some((hit) => hit.value === groupId));
  assert(hits.some((hit) => hit.value === groupKey));
  assert(!hits.some((hit) => hit.value === "protein sandwich salad"));
  assert(groupKey.startsWith(FIXTURE_PREFIX));

  console.log("Pickup-slot-append quarantine migration contract tests passed");
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
