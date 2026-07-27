"use strict";

function ignoreDashboardCustomerEmail(req, _res, next) {
  const body = req && req.body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const bodyWithoutEmail = { ...body };
    delete bodyWithoutEmail.email;
    delete bodyWithoutEmail.emailAddress;
    req.body = bodyWithoutEmail;
  }

  return next();
}

module.exports = ignoreDashboardCustomerEmail;
