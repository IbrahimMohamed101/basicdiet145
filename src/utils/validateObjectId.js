const { Types } = require("mongoose");

module.exports = (id, fieldName = "id") => {
  if (!Types.ObjectId.isValid(id)) {
    throw {
      status: 400,
      code: "INVALID_ID",
      message: `${fieldName} is not a valid id`,
    };
  }
};
