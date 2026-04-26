const env = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || "development",
  timezone: process.env.APP_TIMEZONE || "Asia/Riyadh",
};

module.exports = { env };
