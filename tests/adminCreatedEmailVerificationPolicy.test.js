const assert = require("assert");
const User = require("../src/models/User");
const {
  getAdminCreatedEmailVerificationState,
} = require("../src/services/adminCreatedEmailVerificationPolicy");

const existingCustomer = new User({ phone: "+201110039901" });
assert.strictEqual(existingCustomer.emailVerified, false);
assert.strictEqual(existingCustomer.emailVerifiedAt, null);
assert.strictEqual(
  existingCustomer.emailVerificationRequired,
  false,
  "legacy and non-dashboard customers must remain non-blocking by default"
);

const withEmail = new User({
  phone: "+201110039902",
  email: "Staff.Entered@Example.com",
  ...getAdminCreatedEmailVerificationState(),
});
assert.strictEqual(withEmail.email, "staff.entered@example.com");
assert.strictEqual(withEmail.emailVerified, false);
assert.strictEqual(withEmail.emailVerifiedAt, null);
assert.strictEqual(withEmail.emailVerificationRequired, true);

const withoutEmail = new User({
  phone: "+201110039903",
  ...getAdminCreatedEmailVerificationState(),
});
assert.strictEqual(withoutEmail.email, undefined);
assert.strictEqual(withoutEmail.emailVerified, false);
assert.strictEqual(withoutEmail.emailVerifiedAt, null);
assert.strictEqual(withoutEmail.emailVerificationRequired, true);

const firstState = getAdminCreatedEmailVerificationState();
firstState.emailVerificationRequired = false;
assert.strictEqual(
  getAdminCreatedEmailVerificationState().emailVerificationRequired,
  true,
  "callers must receive an independent policy object"
);

console.log("Admin-created customer email verification policy tests passed");
