const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("http");
const yaml = require("js-yaml");

const { createApp } = require("../src/app");

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

test("GET /subscriptions-api-docs/swagger.yaml serves a valid subscriptions OpenAPI document", async (t) => {
  const { server, baseUrl } = await startServer(createApp());
  t.after(async () => {
    await stopServer(server);
  });

  const response = await fetch(`${baseUrl}/subscriptions-api-docs/swagger.yaml`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /yaml|text\/plain/i);

  const source = await response.text();
  const doc = yaml.load(source);

  assert.equal(doc.openapi, "3.0.3");
  assert.ok(doc.paths["/subscriptions/menu"]);
  assert.ok(doc.paths["/subscriptions/checkout"]);
  assert.ok(doc.paths["/subscriptions/{id}/renew"]);
  assert.ok(doc.paths["/admin/uploads/image"]);
  assert.ok(doc.paths["/admin/subscriptions/{id}/extend"]);
  assert.ok(doc.components.securitySchemes.AppBearerAuth);
  assert.ok(doc.components.securitySchemes.DashboardBearerAuth);
  assert.equal(doc.components.schemas.QuoteRequestBody.properties.addons.items.type, "string");
  assert.deepEqual(
    doc.components.schemas.QuoteRequestBody.properties.premiumItems.items.required,
    ["premiumMealId", "qty"]
  );
  assert.equal(doc.components.schemas.RenewRequestBody.properties.addons.items.type, "string");
});

test("GET /subscriptions-api-docs/ serves the dedicated Swagger UI", async (t) => {
  const { server, baseUrl } = await startServer(createApp());
  t.after(async () => {
    await stopServer(server);
  });

  const response = await fetch(`${baseUrl}/subscriptions-api-docs/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /text\/html/i);

  const html = await response.text();
  assert.match(html, /Swagger UI/i);
  assert.match(html, /swagger-ui-init\.js/i);

  const initResponse = await fetch(`${baseUrl}/subscriptions-api-docs/swagger-ui-init.js`);
  assert.equal(initResponse.status, 200);
  assert.match(initResponse.headers.get("content-type") || "", /javascript|text\/plain/i);

  const initSource = await initResponse.text();
  assert.match(initSource, /\/subscriptions-api-docs\/swagger\.yaml/i);
});
