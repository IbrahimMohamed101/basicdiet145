const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("http");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "test-dashboard-secret";

const { createApp } = require("../src/app");
const uploadService = require("../src/services/cloudinaryUploadService");
const { createAdminImageUploadMiddleware } = require("../src/middleware/imageUpload");

function createAdminToken(role = "admin") {
  return jwt.sign(
    {
      userId: "dashboard-user-1",
      role,
      tokenType: "dashboard_access",
    },
    process.env.DASHBOARD_JWT_SECRET,
    { expiresIn: "1h" }
  );
}

function createImageForm({
  filename = "sample.png",
  mimeType = "image/png",
  contents = Buffer.from("fake-image-binary"),
  folder,
} = {}) {
  const form = new FormData();
  form.set("image", new Blob([contents], { type: mimeType }), filename);
  if (folder !== undefined) {
    form.set("folder", folder);
  }
  return form;
}

async function startServer(app) {
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(server) {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

test("POST /api/admin/uploads/image accepts an admin image upload and returns hosted metadata", async (t) => {
  const originalUploadImageBuffer = uploadService.uploadImageBuffer;
  let receivedInput = null;

  uploadService.uploadImageBuffer = async (input) => {
    receivedInput = input;
    return {
      url: "http://res.cloudinary.com/demo/image/upload/v1/basicdiet/plans/sample.png",
      secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/basicdiet/plans/sample.png",
      publicId: "basicdiet/plans/sample",
      resourceType: "image",
    };
  };

  t.after(() => {
    uploadService.uploadImageBuffer = originalUploadImageBuffer;
  });

  const { server, baseUrl } = await startServer(createApp());
  t.after(async () => {
    await stopServer(server);
  });

  const response = await fetch(`${baseUrl}/api/admin/uploads/image`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${createAdminToken("admin")}`,
    },
    body: createImageForm({ folder: "plans" }),
  });

  assert.equal(response.status, 201);

  const payload = await response.json();
  assert.equal(payload.status, true);
  assert.deepEqual(payload.data, {
    url: "https://res.cloudinary.com/demo/image/upload/v1/basicdiet/plans/sample.png",
    secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/basicdiet/plans/sample.png",
    publicId: "basicdiet/plans/sample",
    resourceType: "image",
  });

  assert.ok(receivedInput);
  assert.equal(receivedInput.folder, "plans");
  assert.equal(receivedInput.mimetype, "image/png");
  assert.equal(receivedInput.originalFilename, "sample.png");
  assert.ok(Buffer.isBuffer(receivedInput.buffer));
  assert.ok(receivedInput.buffer.length > 0);
});

test("POST /api/admin/uploads/image rejects folders outside the safe whitelist", async (t) => {
  const originalUploadImageBuffer = uploadService.uploadImageBuffer;

  uploadService.uploadImageBuffer = async (input) => {
    uploadService.normalizeRequestedFolder(input.folder);
    return {
      secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/basicdiet/plans/sample.png",
      publicId: "basicdiet/plans/sample",
      resourceType: "image",
    };
  };

  t.after(() => {
    uploadService.uploadImageBuffer = originalUploadImageBuffer;
  });

  const { server, baseUrl } = await startServer(createApp());
  t.after(async () => {
    await stopServer(server);
  });

  const response = await fetch(`${baseUrl}/api/admin/uploads/image`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${createAdminToken("admin")}`,
    },
    body: createImageForm({ folder: "unsafe/nested/path" }),
  });

  assert.equal(response.status, 400);

  const payload = await response.json();
  assert.equal(payload.status, false);
  assert.equal(payload.error.code, "INVALID");
  assert.equal(
    payload.error.message,
    "folder must be one of: plans, meals, addons, custom-meals, custom-salads"
  );
});

test("POST /api/admin/uploads/image rejects non-image mime types before upload", async (t) => {
  const originalUploadImageBuffer = uploadService.uploadImageBuffer;
  let uploadCalled = false;

  uploadService.uploadImageBuffer = async () => {
    uploadCalled = true;
    throw new Error("upload service should not be called");
  };

  t.after(() => {
    uploadService.uploadImageBuffer = originalUploadImageBuffer;
  });

  const { server, baseUrl } = await startServer(createApp());
  t.after(async () => {
    await stopServer(server);
  });

  const response = await fetch(`${baseUrl}/api/admin/uploads/image`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${createAdminToken("admin")}`,
    },
    body: createImageForm({
      filename: "notes.txt",
      mimeType: "text/plain",
      contents: Buffer.from("plain-text"),
    }),
  });

  assert.equal(response.status, 400);

  const payload = await response.json();
  assert.equal(payload.status, false);
  assert.equal(payload.error.code, "INVALID");
  assert.equal(payload.error.message, "Only image mime types are allowed");
  assert.equal(uploadCalled, false);
});

test("createAdminImageUploadMiddleware rejects files above the configured size limit", async (t) => {
  const app = express();
  app.post(
    "/upload",
    createAdminImageUploadMiddleware({ maxFileSize: 8 }),
    (req, res) => res.status(200).json({ ok: true, size: req.file.size })
  );

  const { server, baseUrl } = await startServer(app);
  t.after(async () => {
    await stopServer(server);
  });

  const response = await fetch(`${baseUrl}/upload`, {
    method: "POST",
    body: createImageForm({
      contents: Buffer.from("0123456789"),
    }),
  });

  assert.equal(response.status, 400);

  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "INVALID");
  assert.equal(payload.error.message, "Image file size exceeds the 8 byte limit");
});

test("normalizeRequestedFolder allows only the fixed safe folder list", () => {
  assert.equal(uploadService.normalizeRequestedFolder("plans"), "basicdiet/plans");
  assert.equal(uploadService.normalizeRequestedFolder("basicdiet/custom-salads"), "basicdiet/custom-salads");
  assert.equal(uploadService.normalizeRequestedFolder(undefined), "basicdiet/uploads");
  assert.throws(
    () => uploadService.normalizeRequestedFolder("marketing-assets"),
    /folder must be one of: plans, meals, addons, custom-meals, custom-salads/
  );
});
