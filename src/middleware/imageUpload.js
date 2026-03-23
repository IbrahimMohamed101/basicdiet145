const multer = require("multer");
const errorResponse = require("../utils/errorResponse");

const DEFAULT_MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;

function getMaxImageUploadBytes() {
  const parsed = Number(process.env.IMAGE_UPLOAD_MAX_BYTES || DEFAULT_MAX_IMAGE_UPLOAD_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_IMAGE_UPLOAD_BYTES;
}

function createInvalidMimeTypeError(file) {
  const err = new Error("Only image mime types are allowed");
  err.code = "INVALID_IMAGE_MIME_TYPE";
  err.details = {
    receivedMimeType: file && file.mimetype ? file.mimetype : "",
  };
  return err;
}

function createAdminImageUploadMiddleware({ fieldName = "image", maxFileSize = getMaxImageUploadBytes() } = {}) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxFileSize,
      files: 1,
    },
    fileFilter: (_req, file, cb) => {
      if (file && typeof file.mimetype === "string" && file.mimetype.startsWith("image/")) {
        return cb(null, true);
      }
      return cb(createInvalidMimeTypeError(file));
    },
  }).single(fieldName);

  return (req, res, next) => {
    upload(req, res, (err) => {
      if (!err) {
        return next();
      }

      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return errorResponse(
            res,
            400,
            "INVALID",
            `Image file size exceeds the ${maxFileSize} byte limit`
          );
        }
        if (err.code === "LIMIT_UNEXPECTED_FILE") {
          return errorResponse(res, 400, "INVALID", `Only a single ${fieldName} file is supported`);
        }
        return errorResponse(res, 400, "INVALID", err.message);
      }

      if (err && err.code === "INVALID_IMAGE_MIME_TYPE") {
        return errorResponse(res, 400, "INVALID", err.message, err.details);
      }

      return next(err);
    });
  };
}

const adminImageUploadMiddleware = createAdminImageUploadMiddleware();

module.exports = {
  adminImageUploadMiddleware,
  createAdminImageUploadMiddleware,
  DEFAULT_MAX_IMAGE_UPLOAD_BYTES,
  getMaxImageUploadBytes,
};
