const path = require("path");
const { Readable } = require("stream");
const { getCloudinaryClient } = require("../config/cloudinary");
const { logger } = require("../utils/logger");

const BASE_UPLOAD_FOLDER = "basicdiet";
const DEFAULT_IMAGE_FOLDER = `${BASE_UPLOAD_FOLDER}/uploads`;
const ALLOWED_UPLOAD_FOLDER_KEYS = Object.freeze([
  "plans",
  "meals",
  "addons",
  "custom-meals",
  "custom-salads",
]);

function createUploadError(status, code, message, details) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

function normalizeRequestedFolder(folderInput) {
  if (folderInput === undefined || folderInput === null || String(folderInput).trim() === "") {
    return DEFAULT_IMAGE_FOLDER;
  }

  const rawSegments = String(folderInput)
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  const normalizedSegments =
    rawSegments[0] && rawSegments[0].toLowerCase() === BASE_UPLOAD_FOLDER
      ? rawSegments.slice(1)
      : rawSegments;

  if (normalizedSegments.length !== 1) {
    throw createUploadError(
      400,
      "INVALID",
      `folder must be one of: ${ALLOWED_UPLOAD_FOLDER_KEYS.join(", ")}`,
      { allowedFolders: ALLOWED_UPLOAD_FOLDER_KEYS }
    );
  }

  const folderKey = normalizedSegments[0].toLowerCase();
  if (!ALLOWED_UPLOAD_FOLDER_KEYS.includes(folderKey)) {
    throw createUploadError(
      400,
      "INVALID",
      `folder must be one of: ${ALLOWED_UPLOAD_FOLDER_KEYS.join(", ")}`,
      { allowedFolders: ALLOWED_UPLOAD_FOLDER_KEYS }
    );
  }

  return `${BASE_UPLOAD_FOLDER}/${folderKey}`;
}

function resolveFilenameOverride(originalFilename) {
  if (!originalFilename) {
    return undefined;
  }

  const extension = path.extname(originalFilename);
  const basename = path.basename(originalFilename, extension).trim();
  const sanitized = basename.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || undefined;
}

function normalizeCloudinaryFailure(err) {
  const message =
    err && typeof err.message === "string" && err.message.trim()
      ? err.message.trim()
      : "Cloudinary image upload failed";

  return createUploadError(502, "UPLOAD_FAILED", message);
}

async function uploadImageBuffer({ buffer, mimetype, originalFilename, folder } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw createUploadError(400, "INVALID", "Image file buffer is required");
  }

  const cloudinary = getCloudinaryClient();
  const targetFolder = normalizeRequestedFolder(folder);
  const filenameOverride = resolveFilenameOverride(originalFilename);

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "image",
        folder: targetFolder,
        use_filename: true,
        unique_filename: true,
        overwrite: false,
        filename_override: filenameOverride,
      },
      (err, result) => {
        if (err) {
          logger.error("Cloudinary image upload failed", {
            error: err.message,
            folder: targetFolder,
            mimetype: mimetype || "",
          });
          return reject(normalizeCloudinaryFailure(err));
        }

        if (!result) {
          return reject(createUploadError(502, "UPLOAD_FAILED", "Cloudinary image upload returned no result"));
        }

        return resolve({
          url: result.secure_url || result.url || "",
          secureUrl: result.secure_url || result.url || "",
          publicId: result.public_id,
          resourceType: result.resource_type,
          folder: result.folder || targetFolder,
        });
      }
    );

    Readable.from(buffer)
      .on("error", (streamErr) => reject(normalizeCloudinaryFailure(streamErr)))
      .pipe(uploadStream);
  });
}

module.exports = {
  ALLOWED_UPLOAD_FOLDER_KEYS,
  BASE_UPLOAD_FOLDER,
  DEFAULT_IMAGE_FOLDER,
  createUploadError,
  normalizeRequestedFolder,
  uploadImageBuffer,
};
