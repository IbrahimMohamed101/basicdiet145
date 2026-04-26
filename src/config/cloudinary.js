const { v2: cloudinary } = require("cloudinary");

let configuredSignature = null;

function getCloudinaryEnvConfig() {
  return {
    cloudName: String(process.env.CLOUDINARY_CLOUD_NAME || "").trim(),
    apiKey: String(process.env.CLOUDINARY_API_KEY || "").trim(),
    apiSecret: String(process.env.CLOUDINARY_API_SECRET || "").trim(),
  };
}

function getMissingCloudinaryKeys(config = getCloudinaryEnvConfig()) {
  const missing = [];
  if (!config.cloudName) missing.push("CLOUDINARY_CLOUD_NAME");
  if (!config.apiKey) missing.push("CLOUDINARY_API_KEY");
  if (!config.apiSecret) missing.push("CLOUDINARY_API_SECRET");
  return missing;
}

function isCloudinaryConfigured() {
  return getMissingCloudinaryKeys().length === 0;
}

function createCloudinaryConfigurationError() {
  const missing = getMissingCloudinaryKeys();
  const err = new Error(`Missing Cloudinary environment variables: ${missing.join(", ")}`);
  err.status = 500;
  err.code = "UPLOAD_NOT_CONFIGURED";
  err.details = { missing };
  return err;
}

function getCloudinaryClient() {
  const config = getCloudinaryEnvConfig();
  const missing = getMissingCloudinaryKeys(config);
  if (missing.length) {
    throw createCloudinaryConfigurationError();
  }

  const signature = `${config.cloudName}:${config.apiKey}:${config.apiSecret}`;
  if (configuredSignature !== signature) {
    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      secure: true,
    });
    configuredSignature = signature;
  }

  return cloudinary;
}

module.exports = {
  createCloudinaryConfigurationError,
  getCloudinaryClient,
  getCloudinaryEnvConfig,
  getMissingCloudinaryKeys,
  isCloudinaryConfigured,
};
