const cloudinaryUploadService = require("./cloudinaryUploadService");
const { normalizeOptionalString, parseBooleanField } = require("../utils/requestFields");

function createInvalidImageRequestError(message, details) {
  const err = new Error(message);
  err.status = 400;
  err.code = "INVALID";
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

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

async function uploadImageFile(file, { folder, uploadImage } = {}) {
  if (!file) {
    return null;
  }

  const upload = await (uploadImage || cloudinaryUploadService.uploadImageBuffer)({
    buffer: file.buffer,
    mimetype: file.mimetype,
    originalFilename: file.originalname,
    folder,
  });

  return normalizeUploadResponse(upload);
}

async function resolveManagedImageFromRequest({
  body,
  file,
  folder,
  currentImageUrl = "",
  uploadImage,
} = {}) {
  const directImageUrl = normalizeOptionalString(body && body.imageUrl);
  if (directImageUrl) {
    throw createInvalidImageRequestError(
      "imageUrl is managed by the server. Upload an image file using multipart/form-data instead."
    );
  }

  const removeImage = parseBooleanField(body && body.removeImage, "removeImage", { defaultValue: false });
  if (file && removeImage) {
    throw createInvalidImageRequestError("removeImage cannot be true when an image file is provided");
  }

  if (file) {
    const upload = await uploadImageFile(file, { folder, uploadImage });
    return {
      imageUrl: upload.secureUrl,
      changed: true,
      upload,
    };
  }

  if (removeImage) {
    return {
      imageUrl: "",
      changed: true,
      upload: null,
    };
  }

  return {
    imageUrl: normalizeOptionalString(currentImageUrl),
    changed: false,
    upload: null,
  };
}

module.exports = {
  normalizeUploadResponse,
  resolveManagedImageFromRequest,
  resolvePrimarySecureUrl,
  uploadImageFile,
};
