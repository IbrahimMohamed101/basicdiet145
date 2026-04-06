"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { addDaysToKSADateString } = require("../src/utils/date");

test("addDaysToKSADateString advances correctly across late April regression dates", () => {
  assert.equal(addDaysToKSADateString("2026-04-24", 1), "2026-04-25");
  assert.equal(addDaysToKSADateString("2026-04-24", 2), "2026-04-26");

  const walked = [];
  let current = "2026-04-20";
  for (let i = 0; i < 8; i += 1) {
    walked.push(current);
    current = addDaysToKSADateString(current, 1);
  }

  assert.deepEqual(walked, [
    "2026-04-20",
    "2026-04-21",
    "2026-04-22",
    "2026-04-23",
    "2026-04-24",
    "2026-04-25",
    "2026-04-26",
    "2026-04-27",
  ]);
});
