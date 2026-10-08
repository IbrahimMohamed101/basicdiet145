"use strict";
/** GitHub Actions OIDC, read-only Marketing OS identity. Default OFF. */
const crypto = require("crypto");
const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_URL = ISSUER + "/.well-known/jwks";
const AUDIENCE = "basicdiet-marketing-analytics-v1";
const REPOSITORY = "IbrahimMohamed101/basicdiet-marketing-os";
const REPOSITORY_ID = "1410360280";
const OWNER_ID = "108367693";
const WORKFLOW_REF = REPOSITORY + "/.github/workflows/sync-commerce.yml@refs/heads/main";
let jwksCache = { keys: [], until: 0 };

function part(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]{1,16000}$/.test(s)) throw new Error("Invalid JWT");
  const data = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  if (!data || Array.isArray(data) || typeof data !== "object") throw new Error("Invalid JWT body");
  return data;
}

async function githubKeys(fetchImpl = fetch, nowMs = Date.now()) {
  if (jwksCache.until > nowMs && jwksCache.keys.length) return jwksCache.keys;
  const response = await fetchImpl(JWKS_URL, { redirect: "error", signal: AbortSignal.timeout(3000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("GitHub OIDC key lookup failed");
  const data = await response.text();
  if (Buffer.byteLength(data) > 64000) throw new Error("OIDC JWKS exceeds limit");
  const document = JSON.parse(data);
  if (!Array.isArray(document.keys) || document.keys.length > 20) throw new Error("Malformed OIDC JWKS");
  const keys = document.keys.filter(k => k.kty === "RSA" && k.use === "sig" && k.alg === "RS256" && typeof k.kid === "string");
  if (!keys.length) throw new Error("OIDC keys unavailable");
  jwksCache = { keys, until: nowMs + 15 * 60 * 1000 };
  return keys;
}

async function verifyMarketingOidc(token, options = {}) {
  const { fetchImpl = fetch, nowMs = Date.now(), keysOverride = null } = options;
  if (typeof token !== "string" || token.length > 12000) throw new Error("Invalid OIDC token");
  const segments = token.split(".");
  if (segments.length !== 3) throw new Error("Invalid JWT structure");
  const [encodedHeader, encodedClaims, encodedSignature] = segments;
  const header = part(encodedHeader);
  const claims = part(encodedClaims);
  if (header.alg !== "RS256" || header.typ !== "JWT" || typeof header.kid !== "string" || header.kid.length > 150) {
    throw new Error("Invalid JWT header");
  }
  const now = Math.floor(nowMs / 1000);
  if (claims.iss !== ISSUER || claims.aud !== AUDIENCE
    || claims.repository !== REPOSITORY
    || String(claims.repository_id) !== REPOSITORY_ID
    || String(claims.repository_owner_id) !== OWNER_ID
    || claims.repository_visibility !== "private"
    || claims.ref !== "refs/heads/main" || claims.ref_type !== "branch"
    || claims.workflow_ref !== WORKFLOW_REF
    || !["workflow_dispatch", "schedule"].includes(claims.event_name)
    || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || !Number.isInteger(claims.nbf)
    || claims.nbf > now + 30 || claims.exp <= now || claims.iat > now + 30
    || now - claims.iat > 600 || claims.exp - claims.iat > 900
    || typeof claims.sub !== "string" || !claims.sub.endsWith(":ref:refs/heads/main")) {
    throw new Error("OIDC claim rejected");
  }

  const keys = keysOverride || await githubKeys(fetchImpl, nowMs);
  const jwk = keys.find(k => k.kid === header.kid && k.kty === "RSA" && k.alg === "RS256");
  if (!jwk) throw new Error("OIDC key missing");
  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const signed = Buffer.from(encodedHeader + "." + encodedClaims);
  const sig = Buffer.from(encodedSignature, "base64url");
  if (!crypto.verify("RSA-SHA256", signed, { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, sig)) {
    throw new Error("Invalid OIDC signature");
  }
  return { repository_id: REPOSITORY_ID, run_id: String(claims.run_id || "") };
}

async function marketingAgentAuth(req, res, next) {
  res.set("Cache-Control", "no-store");
  if (process.env.MARKETING_AGENT_OIDC_ENABLED !== "true") {
    return res.status(404).json({ status: false, error: { code: "NOT_FOUND" } });
  }
  const header = req.headers.authorization || "";
  if (!/^Bearer [A-Za-z0-9._-]+$/.test(header)) {
    return res.status(401).json({ status: false, error: { code: "UNAUTHORIZED" } });
  }
  try {
    req.marketingAgentIdentity = await verifyMarketingOidc(header.slice(7));
    return next();
  } catch (_) {
    return res.status(401).json({ status: false, error: { code: "UNAUTHORIZED" } });
  }
}
module.exports = { marketingAgentAuth, verifyMarketingOidc, AUDIENCE, WORKFLOW_REF };
