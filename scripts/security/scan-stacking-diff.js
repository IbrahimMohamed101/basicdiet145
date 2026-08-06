"use strict";

const { execFileSync } = require("node:child_process");

const base = String(process.env.SECURITY_DIFF_BASE || "origin/main").trim();
const diff = execFileSync(
  "git",
  ["diff", "--unified=0", `${base}...HEAD`],
  { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
);

const sensitiveFilePattern = /(^|\/)(\.env(?:\.|$)|[^/]+\.(?:pem|key|p12|pfx|jks|keystore))$/i;
const scannedCodePath = /^(src|scripts|\.github)\//;
const patterns = [
  ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["bearer_jwt", /\bBearer\s+eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["raw_jwt", /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/],
  ["mongodb_credentials", /mongodb(?:\+srv)?:\/\/[^\s/:@]+:[^\s/@]+@/i],
  ["github_token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["slack_token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["google_api_key", /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ["live_payment_key", /\b(?:sk|pk)_(?:live|prod)_[A-Za-z0-9_-]{16,}\b/i],
  ["environment_dump", /(?:console|logger)\.(?:log|info|warn|error|debug)\s*\([^\n]*process\.env/],
];

const violations = [];
let currentFile = "";
for (const line of diff.split(/\r?\n/)) {
  if (line.startsWith("+++ b/")) {
    currentFile = line.slice(6).trim();
    if (sensitiveFilePattern.test(currentFile)) {
      violations.push({ file: currentFile, type: "sensitive_file_added" });
    }
    continue;
  }
  if (!line.startsWith("+") || line.startsWith("+++")) continue;
  if (!currentFile || !scannedCodePath.test(currentFile)) continue;

  const added = line.slice(1);
  for (const [type, pattern] of patterns) {
    if (pattern.test(added)) {
      violations.push({ file: currentFile, type });
    }
  }
}

if (violations.length) {
  console.error("Potential secrets or unsafe credential logging detected in changed code:");
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.type}`);
  }
  process.exit(1);
}

console.log("Changed-code secret scan passed");
