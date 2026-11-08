"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { canPosStagingCashierCreateUser } =
  require("../src/utils/posG1CashierAccess");

const staging = {
  POS_STAGING_ISOLATED: "true",
  RAILWAY_ENVIRONMENT_ID: "90700265-e775-4075-a99c-8d04508a7d98",
  RAILWAY_SERVICE_ID: "9a6d629e-c9f4-4687-bf83-613011606018",
};
test("G1 cashier user creation is permitted only on exact isolated POS staging", () => {
  assert.equal(canPosStagingCashierCreateUser(staging, "basicdiet_pos_staging_test"), true);
  assert.equal(canPosStagingCashierCreateUser(staging, "test"), false);
  assert.equal(canPosStagingCashierCreateUser({ ...staging, POS_STAGING_ISOLATED: "false" },
    "basicdiet_pos_staging_test"), false);
  assert.equal(canPosStagingCashierCreateUser({ ...staging,
    RAILWAY_ENVIRONMENT_ID: "509cc4bf-c2bd-42be-9912-0619bbb94dfd" },
  "basicdiet_pos_staging_test"), false);
  assert.equal(canPosStagingCashierCreateUser({ ...staging,
    RAILWAY_SERVICE_ID: "3375e020-d685-4187-b34c-5db287879b3d" },
  "basicdiet_pos_staging_test"), false);
});
