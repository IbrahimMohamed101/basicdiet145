"use strict";

// Read-only transaction call-site inventory of the entire in-repo application
// source tree. Writes no database, uses no credentials and never connects to
// Production or Staging. Review the generated call sites manually before rs0.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../src");
const pattern = /\b(startSafeSession|startSession|startTransaction|withTransaction|commitTransaction|abortTransaction|runMongoTransactionWithRetry)\s*\(/g;
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.isFile() && /\.(?:js|cjs|mjs|ts|tsx)$/.test(e.name)) files.push(full);
  }
}
walk(root);
const callers = [];
for (const full of files) {
  const relative = path.relative(path.resolve(root, ".."), full).replaceAll(path.sep, "/");
  const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\/\/.*$/, "");
    const hits = [...line.matchAll(pattern)].map(x => x[1]);
    if (!hits.length) continue;
    callers.push({ file: relative, line: i + 1, APIs: [...new Set(hits)] });
  }
}
const byFile = [...new Set(callers.map(x => x.file))];
const output = { scannedFiles: files.length, touchedFiles: byFile.length,
  callsites: callers.length, callers };
process.stdout.write(JSON.stringify(output, null, 2) + "\n");
