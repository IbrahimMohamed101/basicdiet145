function getAdminCreatedEmailVerificationState() {
  return {
    emailVerified: false,
    emailVerifiedAt: null,
    emailVerificationRequired: true,
  };
}

module.exports = { getAdminCreatedEmailVerificationState };
