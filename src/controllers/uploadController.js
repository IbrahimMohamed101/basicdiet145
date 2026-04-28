const errorResponse = require("../utils/errorResponse");
const adminImageService = require("../services/adminImageService");

async function uploadAdminImage(req, res, deps = {}) {
  if (!req.file) {
    return errorResponse(res, 400, "INVALID", "Image file is required under the image field");
  }

  try {
    const responseData = await adminImageService.uploadImageFile(req.file, {
      folder: req.body && req.body.folder,
      uploadImage: deps.uploadImage,
    });

    return res.status(201).json({
      status: true,
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
  normalizeUploadResponse: adminImageService.normalizeUploadResponse,
  resolvePrimarySecureUrl: adminImageService.resolvePrimarySecureUrl,
  uploadAdminImage,
};
