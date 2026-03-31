const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("http");
const jwt = require("jsonwebtoken");

process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "test-dashboard-secret";

const { createApp } = require("../src/app");
const Meal = require("../src/models/Meal");
const Addon = require("../src/models/Addon");
const PremiumMeal = require("../src/models/PremiumMeal");
const uploadService = require("../src/services/cloudinaryUploadService");

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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function setByPath(target, path, value) {
  const segments = path.split(".");
  let cursor = target;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!cursor[segment] || typeof cursor[segment] !== "object" || Array.isArray(cursor[segment])) {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }

  cursor[segments[segments.length - 1]] = value;
}

function createMutableDoc(seed, onSave) {
  return {
    ...clone(seed),
    id: seed.id || String(seed._id || ""),
    set(update) {
      Object.entries(update).forEach(([path, value]) => {
        if (path.includes(".")) {
          setByPath(this, path, value);
          return;
        }
        this[path] = value;
      });
    },
    async save() {
      if (onSave) {
        onSave(clone(this));
      }
      return this;
    },
  };
}

function createForm(fields = {}, imageConfig = null) {
  const form = new FormData();

  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      form.set(key, String(value));
    }
  });

  if (imageConfig) {
    const {
      fieldName = "image",
      filename = "sample.png",
      mimeType = "image/png",
      contents = Buffer.from("fake-image-binary"),
    } = imageConfig;
    form.set(fieldName, new Blob([contents], { type: mimeType }), filename);
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

test("POST /api/admin/premium-meals uploads the image file and stores the hosted URL", async (t) => {
  const originalCreate = PremiumMeal.create;
  const originalUploadImageBuffer = uploadService.uploadImageBuffer;
  let capturedPayload = null;
  let uploadInput = null;

  PremiumMeal.create = async (payload) => {
    capturedPayload = payload;
    return { id: "premium-1" };
  };
  uploadService.uploadImageBuffer = async (input) => {
    uploadInput = input;
    return {
      secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/basicdiet/premium-meals/salmon.png",
      publicId: "basicdiet/premium-meals/salmon",
      resourceType: "image",
    };
  };

  t.after(() => {
    PremiumMeal.create = originalCreate;
    uploadService.uploadImageBuffer = originalUploadImageBuffer;
  });

  const { server, baseUrl } = await startServer(createApp());
  t.after(async () => {
    await stopServer(server);
  });

  const response = await fetch(`${baseUrl}/api/admin/premium-meals`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${createAdminToken("admin")}`,
    },
    body: createForm(
      {
        name: JSON.stringify({ en: "Garlic Butter Salmon", ar: "سلمون بالزبدة والثوم" }),
        description: JSON.stringify({ en: "Premium salmon meal", ar: "وجبة سلمون بريميوم" }),
        currency: "SAR",
        extraFeeHalala: "2500",
        isActive: "false",
        sortOrder: "7",
      },
      { filename: "salmon.png" }
    ),
  });

  assert.equal(response.status, 201);

  const payload = await response.json();
  assert.equal(payload.status, true);
  assert.deepEqual(payload.data, { id: "premium-1" });
  assert.deepEqual(capturedPayload, {
    name: { en: "Garlic Butter Salmon", ar: "سلمون بالزبدة والثوم" },
    description: { en: "Premium salmon meal", ar: "وجبة سلمون بريميوم" },
    imageUrl: "https://res.cloudinary.com/demo/image/upload/v1/basicdiet/premium-meals/salmon.png",
    currency: "SAR",
    extraFeeHalala: 2500,
    isActive: false,
    sortOrder: 7,
  });
  assert.equal(uploadInput.folder, "premium-meals");
  assert.equal(uploadInput.originalFilename, "salmon.png");
});

test("POST /api/admin/premium-meals rejects direct imageUrl input and requires an uploaded file instead", async (t) => {
  const originalCreate = PremiumMeal.create;
  const originalUploadImageBuffer = uploadService.uploadImageBuffer;
  let createCalled = false;
  let uploadCalled = false;

  PremiumMeal.create = async () => {
    createCalled = true;
    return { id: "should-not-happen" };
  };
  uploadService.uploadImageBuffer = async () => {
    uploadCalled = true;
    return {
      secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/basicdiet/premium-meals/ignored.png",
    };
  };

  t.after(() => {
    PremiumMeal.create = originalCreate;
    uploadService.uploadImageBuffer = originalUploadImageBuffer;
  });

  const { server, baseUrl } = await startServer(createApp());
  t.after(async () => {
    await stopServer(server);
  });

  const response = await fetch(`${baseUrl}/api/admin/premium-meals`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${createAdminToken("admin")}`,
    },
    body: createForm({
      name: JSON.stringify({ en: "Garlic Butter Salmon" }),
      extraFeeHalala: "2500",
      currency: "SAR",
      imageUrl: "https://example.com/salmon.jpg",
    }),
  });

  assert.equal(response.status, 400);

  const payload = await response.json();
  assert.equal(payload.status, false);
  assert.equal(payload.error.code, "INVALID");
  assert.equal(
    payload.error.message,
    "imageUrl is managed by the server. Upload an image file using multipart/form-data instead."
  );
  assert.equal(createCalled, false);
  assert.equal(uploadCalled, false);
});

test("PUT /api/admin/addons/:id preserves the existing hosted image when no new file is uploaded", async (t) => {
  const addonId = "507f191e810c19729de860ea";
  const originalFindById = Addon.findById;
  const originalUploadImageBuffer = uploadService.uploadImageBuffer;
  let savedDoc = null;
  let uploadCalled = false;

  Addon.findById = async (id) => {
    assert.equal(id, addonId);
    return createMutableDoc(
      {
        _id: addonId,
        id: addonId,
        imageUrl: "https://res.cloudinary.com/demo/image/upload/v1/basicdiet/addons/existing.png",
      },
      (doc) => {
        savedDoc = doc;
      }
    );
  };
  uploadService.uploadImageBuffer = async () => {
    uploadCalled = true;
    throw new Error("upload should not be called");
  };

  t.after(() => {
    Addon.findById = originalFindById;
    uploadService.uploadImageBuffer = originalUploadImageBuffer;
  });

  const { server, baseUrl } = await startServer(createApp());
  t.after(async () => {
    await stopServer(server);
  });

  const response = await fetch(`${baseUrl}/api/admin/addons/${addonId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${createAdminToken("admin")}`,
    },
    body: createForm({
      name: JSON.stringify({ en: "Soup" }),
      description: JSON.stringify({ en: "Warm soup" }),
      priceHalala: "1200",
      currency: "SAR",
      type: "one_time",
      isActive: "false",
      sortOrder: "5",
    }),
  });

  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.status, true);
  assert.deepEqual(payload.data, { id: addonId });
  assert.equal(uploadCalled, false);
  assert.ok(savedDoc);
  assert.equal(savedDoc.imageUrl, "https://res.cloudinary.com/demo/image/upload/v1/basicdiet/addons/existing.png");
  assert.equal(savedDoc.isActive, false);
  assert.equal(savedDoc.sortOrder, 5);
  assert.equal(savedDoc.priceHalala, 1200);
  assert.equal(savedDoc.type, "one_time");
});

test("PUT /api/admin/meals/:id uploads image files and parses multipart boolean fields correctly", async (t) => {
  const mealId = "507f191e810c19729de860eb";
  const originalFindOne = Meal.findOne;
  const originalUploadImageBuffer = uploadService.uploadImageBuffer;
  let savedDoc = null;
  let uploadInput = null;

  Meal.findOne = async (query) => {
    assert.equal(String(query._id), mealId);
    assert.equal(query.type, "regular");
    return createMutableDoc(
      {
        _id: mealId,
        id: mealId,
        imageUrl: "https://res.cloudinary.com/demo/image/upload/v1/basicdiet/meals/old.png",
        name: { en: "Old Meal", ar: "" },
        availableForOrder: true,
      },
      (doc) => {
        savedDoc = doc;
      }
    );
  };
  uploadService.uploadImageBuffer = async (input) => {
    uploadInput = input;
    return {
      secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/basicdiet/meals/new-meal.png",
      publicId: "basicdiet/meals/new-meal",
      resourceType: "image",
    };
  };

  t.after(() => {
    Meal.findOne = originalFindOne;
    uploadService.uploadImageBuffer = originalUploadImageBuffer;
  });

  const { server, baseUrl } = await startServer(createApp());
  t.after(async () => {
    await stopServer(server);
  });

  const response = await fetch(`${baseUrl}/api/admin/meals/${mealId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${createAdminToken("admin")}`,
    },
    body: createForm(
      {
        name_en: "Updated Meal",
        availableForOrder: "false",
        availableForSubscription: "true",
      },
      { filename: "meal.png" }
    ),
  });

  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.status, true);
  assert.deepEqual(payload.data, { id: mealId });
  assert.equal(uploadInput.folder, "meals");
  assert.equal(uploadInput.originalFilename, "meal.png");
  assert.ok(savedDoc);
  assert.equal(savedDoc.imageUrl, "https://res.cloudinary.com/demo/image/upload/v1/basicdiet/meals/new-meal.png");
  assert.equal(savedDoc.availableForOrder, false);
  assert.equal(savedDoc.availableForSubscription, true);
  assert.equal(savedDoc.name.en, "Updated Meal");
});
