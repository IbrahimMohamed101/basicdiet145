"use strict";
const models = [
  require("./PosShift"),
  require("./PosOrder"),
  require("./PosCounter"),
  require("./PosTerminal"),
  require("./PosAuditEvent"),
];
module.exports = { models };
