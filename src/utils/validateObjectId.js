const { Types } = require("mongoose");
const { createLocalizedError } = require("./errorLocalization");

module.exports = (id, fieldName = "id") => {
  if (!Types.ObjectId.isValid(id)) {
    throw createLocalizedError({
      status: 400,
      code: "INVALID_ID",
      key: "errors.validation.invalidObjectId",
      params: { fieldName },
      fallbackMessage: `${fieldName} is not a valid id`,
    });
  }
};
