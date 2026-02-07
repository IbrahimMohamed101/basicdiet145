const mongoose = require("mongoose");

function connectDb() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("Missing MONGO_URI");
  }

  return mongoose.connect(uri);
}

module.exports = { connectDb };
