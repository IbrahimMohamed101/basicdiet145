const errorResponse = require("../utils/errorResponse");
const adminImageService = require("../services/adminImageService");

function shouldLogUploadDebug() {
  return process.env.NODE_ENV === "test" || String(process.env.DEBUG_UPLOADS || "").toLowerCase() === "true";
}

async function uploadAdminImage(req, res, deps = {}) {
  if (shouldLogUploadDebug()) {
    console.log("Upload Request:", {
      headers: {
        "content-type": req.headers["content-type"],
        "content-length": req.headers["content-length"],
      },
      bodyFields: req.body ? Object.keys(req.body) : [],
      file: req.file ? {
        fieldname: req.file.fieldname,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      } : null,
    });
  }

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
  shouldLogUploadDebug,
};
