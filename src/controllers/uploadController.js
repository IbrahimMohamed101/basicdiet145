const errorResponse = require("../utils/errorResponse");
const adminImageService = require("../services/adminImageService");

async function uploadAdminImage(req, res, deps = {}) {
  // Enhanced logging for debugging upload issues
  console.log("Upload Request Headers:", {
    "content-type": req.headers["content-type"],
    "content-length": req.headers["content-length"]
  });
  console.log("Upload Request Body:", req.body);
  console.log("Upload Request File:", req.file ? {
    fieldname: req.file.fieldname,
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size
  } : "undefined");

  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Image file is required under the image field",
      expectedField: "image"
    });
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
