import { expect, test } from "@playwright/test";

const payload = {
  event: "lp_view",
  eventId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  path: "/",
  device: "android",
  source: "",
  medium: "",
  campaign: "",
  content: "",
  term: "",
  referrerHost: "",
};

test("analytics route accepts a public Railway origin rather than rejecting it as FORBIDDEN", async ({ request }) => {
  const host = "basicdiet-landing-production.up.railway.app";
  const response = await request.post("/api/analytics", {
    headers: { origin: "https://" + host, host },
    data: payload,
  });
  // No ingest secret is configured in CI. With production config, a valid
  // origin proceeds to upstream processing; neither case should return 403.
  expect(response.status()).not.toBe(403);
});

test("analytics route blocks origins on another host", async ({ request }) => {
  const host = "basicdiet-landing-production.up.railway.app";
  const response = await request.post("/api/analytics", {
    headers: { origin: "https://untrusted.example", host },
    data: payload,
  });
  expect(response.status()).toBe(403);
});

test("analytics local development POST does not fail same-origin validation", async ({ request }) => {
  const response = await request.post("/api/analytics", {
    headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
    data: payload,
  });
  expect(response.status()).not.toBe(403);
});
