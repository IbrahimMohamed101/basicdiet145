const errorResponse = require("../utils/errorResponse");
const cloudinaryUploadService = require("../services/cloudinaryUploadService");

function pickFirstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function resolvePrimarySecureUrl(upload) {
  const directSecureUrl = pickFirstNonEmptyString(upload && upload.secureUrl, upload && upload.secure_url);
  if (directSecureUrl) {
    return directSecureUrl;
  }

  const fallbackUrl = pickFirstNonEmptyString(upload && upload.url);
  if (!fallbackUrl) {
    return "";
  }

  if (/^http:\/\//i.test(fallbackUrl)) {
    return fallbackUrl.replace(/^http:\/\//i, "https://");
  }

  return fallbackUrl;
}

function normalizeUploadResponse(upload) {
  const secureUrl = resolvePrimarySecureUrl(upload);
  if (!secureUrl) {
    const err = new Error("Cloudinary image upload did not return a secure URL");
    err.status = 502;
    err.code = "UPLOAD_FAILED";
    throw err;
  }

  return {
    url: secureUrl,
    secureUrl,
    publicId: pickFirstNonEmptyString(upload && upload.publicId, upload && upload.public_id),
    resourceType: pickFirstNonEmptyString(upload && upload.resourceType, upload && upload.resource_type),
  };
}

async function uploadAdminImage(req, res, deps = {}) {
  if (!req.file) {
    return errorResponse(res, 400, "INVALID", "Image file is required under the image field");
  }

  const uploadImage = deps.uploadImage || cloudinaryUploadService.uploadImageBuffer;

  try {
    const upload = await uploadImage({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalFilename: req.file.originalname,
      folder: req.body && req.body.folder,
    });
    const responseData = normalizeUploadResponse(upload);

    return res.status(201).json({
      ok: true,
      data: responseData,
    });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code || "UPLOAD_FAILED", err.message, err.details);
    }
    throw err;
  }
}

module.exports = {
  normalizeUploadResponse,
  resolvePrimarySecureUrl,
  uploadAdminImage,
};
