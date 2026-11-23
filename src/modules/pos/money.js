"use strict";
const integer = { validator: Number.isSafeInteger, message: "Expected integer halala" };
const nonnegativeHalala = { type: Number, default: 0, min: 0, validate: integer };
const signedHalala = { type: Number, default: 0, validate: integer };
module.exports = { nonnegativeHalala, signedHalala };
