const mongoose = require("mongoose");

function connectDb() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Missing MongoDB connection string (set MONGO_URI or MONGODB_URI)");
  }

  return mongoose.connect(uri);
}

module.exports = { connectDb };
