"use strict";

const premiumService = require("./subscription/premiumUpgradeConfigService");

const PAGE_SIZE = 100;
const INACTIVE_SOURCE_CODES = new Set([
  "SOURCE_NOT_FOUND",
  "SOURCE_NOT_ACTIVE_PUBLISHED_AVAILABLE",
]);

let installed = false;

function normalizeStatus(value) {
  return String(value || "all").trim().toLowerCase();
}

function sourceLifecycleActive(row) {
  const reasonCodes = Array.isArray(row && row.reasonCodes)
    ? row.reasonCodes.map((value) => String(value || ""))
    : [];

  return !reasonCodes.some((code) => INACTIVE_SOURCE_CODES.has(code));
}

async function readAllMatchingSources(original, query) {
  const first = await original({
    ...query,
    status: "all",
    page: 1,
    limit: PAGE_SIZE,
  });

  const rows = Array.isArray(first && first.data) ? [...first.data] : [];
  const pages = Math.max(1, Number(first && first.meta && first.meta.pages) || 1);

  for (let page = 2; page <= pages; page += 1) {
    const next = await original({
      ...query,
      status: "all",
      page,
      limit: PAGE_SIZE,
    });
    if (Array.isArray(next && next.data)) rows.push(...next.data);
  }

  return {
    envelope: first || { status: true, data: [], meta: {} },
    rows,
  };
}

function paginate(rows, page, limit) {
  const safePage = Math.max(1, Number.parseInt(page || "1", 10) || 1);
  const safeLimit = Math.min(
    100,
    Math.max(1, Number.parseInt(limit || "20", 10) || 20)
  );
  const total = rows.length;
  const pages = total === 0 ? 0 : Math.ceil(total / safeLimit);
  const start = (safePage - 1) * safeLimit;

  return {
    data: rows.slice(start, start + safeLimit),
    meta: {
      total,
      page: safePage,
      limit: safeLimit,
      pages,
    },
  };
}

function installPremiumSourceVisibilityPolicy() {
  if (installed) return;
  installed = true;

  const original = premiumService.getSources;
  if (typeof original !== "function") {
    throw new Error("premiumService.getSources is not available");
  }
  if (original.__premiumSourceVisibilityPolicy === true) return;

  const wrapped = async function getVisiblePremiumSources(query = {}) {
    if (normalizeStatus(query.status) !== "active") {
      return original(query);
    }

    const { envelope, rows } = await readAllMatchingSources(original, query);
    const activeRows = rows
      .filter(sourceLifecycleActive)
      .map((row) => ({
        ...row,
        sourceLifecycleStatus: "active",
      }));
    const paginated = paginate(activeRows, query.page, query.limit);

    return {
      ...envelope,
      status: true,
      data: paginated.data,
      meta: paginated.meta,
    };
  };

  wrapped.__premiumSourceVisibilityPolicy = true;
  wrapped.__original = original;
  premiumService.getSources = wrapped;
}

installPremiumSourceVisibilityPolicy();

module.exports = {
  INACTIVE_SOURCE_CODES,
  installPremiumSourceVisibilityPolicy,
  sourceLifecycleActive,
};
