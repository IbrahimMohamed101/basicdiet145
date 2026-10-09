import { expect, test } from "@playwright/test";
import { isAllowedSameOrigin } from "../lib/same-origin";

const host = "basicdiet-landing-production.up.railway.app";
const origin = "https://" + host;

test("Railway public Origin passes even if Next.js sees an internal upstream URL", () => {
  const internalNextOrigin = new URL("http://127.0.0.1:3000/api/leads").origin;
  expect(origin).not.toBe(internalNextOrigin);
  expect(isAllowedSameOrigin(origin, host)).toBe(true);
  expect(isAllowedSameOrigin("https://basicdietksa.com", "basicdietksa.com")).toBe(true);
});

test("cross-site, malformed, insecure public, and missing Host origins are rejected", () => {
  expect(isAllowedSameOrigin("https://attacker.example", host)).toBe(false);
  expect(isAllowedSameOrigin("https://attacker.example@" + host, host)).toBe(false);
  expect(isAllowedSameOrigin(origin + "/path", host)).toBe(false);
  expect(isAllowedSameOrigin("null", host)).toBe(false);
  expect(isAllowedSameOrigin("http://" + host, host)).toBe(false);
  expect(isAllowedSameOrigin(origin, null)).toBe(false);
});

test("local HTTP and previous no-Origin server requests still work", () => {
  expect(isAllowedSameOrigin("http://localhost:3000", "localhost:3000")).toBe(true);
  expect(isAllowedSameOrigin("http://127.0.0.1:3000", "127.0.0.1:3000")).toBe(true);
  expect(isAllowedSameOrigin(null, host)).toBe(true);
});
