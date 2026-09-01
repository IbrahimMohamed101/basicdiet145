#!/usr/bin/env node
"use strict";

const { MongoClient, ObjectId } = require("mongodb");
const { resolveMongoUri, getDbNameFromUri, getMongoHostFromUri } = require("../../src/utils/mongoUriResolver");

const FIXTURE_PREFIX = "pickup_slot_append_1785284024734_";
const FIXTURE_TAG = "pickup-slot-append-1785284024734";
const PRODUCTION_CONFIRMATION = "pickup-slot-append-1785284024734";
const HUMAN_OPTION_DISPOSITION = "preserve-in-quarantined-group";

const TARGETS = Object.freeze({
  groups: [
    ["6a6945c1080fae4ed07964e7", `${FIXTURE_PREFIX}mixed_standard_protein_group`],
    ["6a6945c2080fae4ed0796504", `${FIXTURE_PREFIX}mixed_premium_protein_group`],
    ["6a6945c3080fae4ed0796512", `${FIXTURE_PREFIX}mixed_salad_protein_group`],
    ["6a6945c3080fae4ed079651b", `${FIXTURE_PREFIX}mixed_sandwich_protein_group`],
  ],
  products: [
    ["6a6945c1080fae4ed07964f3", `${FIXTURE_PREFIX}mixed_standard_meal`],
    ["6a6945c2080fae4ed0796509", `${FIXTURE_PREFIX}mixed_premium_meal`],
    ["6a6945c3080fae4ed0796516", `${FIXTURE_PREFIX}mixed_salad_meal`],
    ["6a6945c4080fae4ed079651e", `${FIXTURE_PREFIX}mixed_sandwich_meal`],
  ],
  generatedOptions: [
    ["6a6945c1080fae4ed07964fd", `${FIXTURE_PREFIX}mixed_standard_option`],
    ["6a6945c2080fae4ed079650e", `${FIXTURE_PREFIX}mixed_premium_option`],
    ["6a6945c3080fae4ed0796519", `${FIXTURE_PREFIX}mixed_salad_option`],
    ["6a6945c4080fae4ed0796520", `${FIXTURE_PREFIX}mixed_sandwich_option`],
  ],
  builderProteins: [
    ["6a6945c4080fae4ed0796523", `${FIXTURE_PREFIX}mixed_protein_protein`],
  ],
  builderCarbs: [
    ["6a6945c5080fae4ed0796526", `${FIXTURE_PREFIX}mixed_protein_carb`],
  ],
  dashboardUsers: [
    ["6a6945c1080fae4ed07964d8", "admin"],
    ["6a6945c0080fae4ed07964c6", "kitchen"],
  ],
  clientUsers: [
    ["6a6945c5080fae4ed0796528", "client"],
  ],
});

const HUMAN_OPTION = Object.freeze({
  id: "6a7a0a293fe0240a4bf6cedd",
  key: "spicy_chicken",
  groupId: "6a6945c3080fae4ed079651b",
});

const ALLOWED_REFERENCE_COLLECTIONS = new Set([
  "buildercarbs",
  "builderproteins",
  "dashboardusers",
  "menuauditlogs",
  "menuoptiongroups",
  "menuoptions",
  "menuproducts",
  "subscriptiondays",
  "subscriptions",
  "users",
]);

function parseArgs(argv = process.argv.slice(2)) {
  const valueFor = (name) => {
    const prefix = `${name}=`;
    const item = argv.find((entry) => entry.startsWith(prefix));
    return item ? item.slice(prefix.length) : "";
  };
  return {
    execute: argv.includes("--execute"),
    productionConfirmation: valueFor("--confirm-production-quarantine"),
    humanOptionDisposition: valueFor("--spicy-chicken-disposition"),
  };
}

function assertExecutionGuards(args, env = process.env) {
  if (!args.execute) return;
  if (args.humanOptionDisposition !== HUMAN_OPTION_DISPOSITION) {
    throw new Error(
      `HUMAN DECISION REQUIRED: --spicy-chicken-disposition=${HUMAN_OPTION_DISPOSITION} must be explicit; the option will not be moved or modified.`
    );
  }
  if (env.NODE_ENV === "production" && args.productionConfirmation !== PRODUCTION_CONFIRMATION) {
    throw new Error(
      `Production execution requires --confirm-production-quarantine=${PRODUCTION_CONFIRMATION}`
    );
  }
}

function log(event, details = {}) {
  console.log(JSON.stringify({ event, ...details }));
}

function targetIdentitySets() {
  const keyedRows = [
    ...TARGETS.groups,
    ...TARGETS.products,
    ...TARGETS.generatedOptions,
    ...TARGETS.builderProteins,
    ...TARGETS.builderCarbs,
  ];
  const identityRows = [
    ...keyedRows,
    ...TARGETS.dashboardUsers,
    ...TARGETS.clientUsers,
  ];
  return {
    ids: new Set(identityRows.map(([id]) => id)),
    keys: new Set(keyedRows.map(([, key]) => key)),
  };
}

function collectFixtureReferences(value, path = "", hits = [], identities = targetIdentitySets()) {
  if (value === null || value === undefined) return hits;
  if (value instanceof ObjectId) {
    if (identities.ids.has(String(value))) hits.push({ path, kind: "id", value: String(value) });
    return hits;
  }
  if (value instanceof Date) return hits;
  if (typeof value === "string") {
    if (identities.ids.has(value)) hits.push({ path, kind: "id", value });
    if (identities.keys.has(value)) hits.push({ path, kind: "key", value });
    if (value.includes(FIXTURE_PREFIX) || value.includes(FIXTURE_TAG)) {
      hits.push({ path, kind: "prefix", value: "[VERIFIED_FIXTURE_PREFIX]" });
    }
    return hits;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectFixtureReferences(entry, `${path}[${index}]`, hits, identities));
    return hits;
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      collectFixtureReferences(entry, path ? `${path}.${key}` : key, hits, identities);
    }
  }
  return hits;
}

async function inspectEveryCollection(db) {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const references = [];
  const unknownReferences = [];
  for (const { name } of collections) {
    let scanned = 0;
    for await (const document of db.collection(name).find({})) {
      scanned += 1;
      const hits = collectFixtureReferences(document);
      if (!hits.length) continue;
      const reference = { collection: name, documentId: String(document._id), hits };
      references.push(reference);
      if (!ALLOWED_REFERENCE_COLLECTIONS.has(name)) unknownReferences.push(reference);
    }
    log("collection_scanned", { collection: name, documents: scanned });
  }
  return { references, unknownReferences };
}

async function assertExactDocuments(db, collectionName, entries) {
  const documents = await db.collection(collectionName).find({
    _id: { $in: entries.map(([id]) => new ObjectId(id)) },
  }).toArray();
  const byId = new Map(documents.map((document) => [String(document._id), document]));
  const errors = [];
  for (const [id, key] of entries) {
    const document = byId.get(id);
    if (!document) errors.push(`${collectionName}:${id} is missing`);
    else if (document.key !== key) errors.push(`${collectionName}:${id} expected key ${key}, found ${document.key}`);
  }
  if (errors.length) throw new Error(`Verified fixture identity mismatch: ${errors.join("; ")}`);
  return documents;
}

async function buildPlan(db) {
  const [groups, products, generatedOptions, builderProteins, builderCarbs] = await Promise.all([
    assertExactDocuments(db, "menuoptiongroups", TARGETS.groups),
    assertExactDocuments(db, "menuproducts", TARGETS.products),
    assertExactDocuments(db, "menuoptions", TARGETS.generatedOptions),
    assertExactDocuments(db, "builderproteins", TARGETS.builderProteins),
    assertExactDocuments(db, "buildercarbs", TARGETS.builderCarbs),
  ]);

  const dashboardUsers = await db.collection("dashboardusers").find({
    _id: { $in: TARGETS.dashboardUsers.map(([id]) => new ObjectId(id)) },
  }).toArray();
  for (const [id, role] of TARGETS.dashboardUsers) {
    const document = dashboardUsers.find((row) => String(row._id) === id);
    if (!document || document.role !== role || !String(document.email || "").startsWith(FIXTURE_TAG)) {
      throw new Error(`Verified fixture identity mismatch: dashboardusers:${id}`);
    }
  }

  const clientUsers = await db.collection("users").find({
    _id: { $in: TARGETS.clientUsers.map(([id]) => new ObjectId(id)) },
  }).toArray();
  for (const [id, role] of TARGETS.clientUsers) {
    const document = clientUsers.find((row) => String(row._id) === id);
    if (!document || document.role !== role || !String(document.phone || "").startsWith(FIXTURE_TAG)) {
      throw new Error(`Verified fixture identity mismatch: users:${id}`);
    }
  }

  const humanOption = await db.collection("menuoptions").findOne({
    _id: new ObjectId(HUMAN_OPTION.id),
    groupId: new ObjectId(HUMAN_OPTION.groupId),
    key: HUMAN_OPTION.key,
  });
  if (!humanOption) throw new Error("HUMAN DECISION REQUIRED: the verified spicy_chicken document is missing or changed");

  const groupIds = TARGETS.groups.map(([id]) => new ObjectId(id));
  const unexpectedOptions = await db.collection("menuoptions").find({
    groupId: { $in: groupIds },
    _id: {
      $nin: [
        ...TARGETS.generatedOptions.map(([id]) => new ObjectId(id)),
        new ObjectId(HUMAN_OPTION.id),
      ],
    },
  }).project({ _id: 1, groupId: 1, key: 1 }).toArray();
  if (unexpectedOptions.length) {
    throw new Error(`STOP: unexpected options exist in verified fixture groups: ${unexpectedOptions.map((row) => row._id).join(",")}`);
  }

  const scan = await inspectEveryCollection(db);
  if (scan.unknownReferences.length) {
    const summary = scan.unknownReferences.map((reference) => `${reference.collection}:${reference.documentId}`).join(",");
    throw new Error(`STOP: unknown fixture references found: ${summary}`);
  }

  return {
    groups,
    products,
    generatedOptions,
    builderProteins,
    builderCarbs,
    dashboardUsers,
    clientUsers,
    humanOption,
    references: scan.references,
    updates: {
      menuoptiongroups: TARGETS.groups.map(([id]) => id),
      menuproducts: TARGETS.products.map(([id]) => id),
      menuoptions: TARGETS.generatedOptions.map(([id]) => id),
      builderproteins: TARGETS.builderProteins.map(([id]) => id),
      buildercarbs: TARGETS.builderCarbs.map(([id]) => id),
      dashboardusers: TARGETS.dashboardUsers.map(([id]) => id),
      users: TARGETS.clientUsers.map(([id]) => id),
    },
  };
}

function archiveUpdate() {
  return { $set: { isActive: false, isVisible: false, isAvailable: false, publishedAt: null } };
}

async function executePlan(db, plan, client) {
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const operations = [
        ["menuoptiongroups", TARGETS.groups],
        ["menuproducts", TARGETS.products],
        ["menuoptions", TARGETS.generatedOptions],
      ];
      for (const [collectionName, entries] of operations) {
        const result = await db.collection(collectionName).updateMany(
          {
            _id: { $in: entries.map(([id]) => new ObjectId(id)) },
            key: { $in: entries.map(([, key]) => key) },
          },
          archiveUpdate(),
          { session }
        );
        log("archive_result", {
          collection: collectionName,
          matched: result.matchedCount,
          modified: result.modifiedCount,
        });
      }
      for (const [collectionName, entries] of [
        ["builderproteins", TARGETS.builderProteins],
        ["buildercarbs", TARGETS.builderCarbs],
      ]) {
        const result = await db.collection(collectionName).updateMany(
          {
            _id: { $in: entries.map(([id]) => new ObjectId(id)) },
            key: { $in: entries.map(([, key]) => key) },
          },
          { $set: { isActive: false } },
          { session }
        );
        log("builder_artifact_quarantine_result", {
          collection: collectionName,
          matched: result.matchedCount,
          modified: result.modifiedCount,
        });
      }
      for (const [collectionName, entries] of [
        ["dashboardusers", TARGETS.dashboardUsers],
        ["users", TARGETS.clientUsers],
      ]) {
        const result = await db.collection(collectionName).updateMany(
          { _id: { $in: entries.map(([id]) => new ObjectId(id)) } },
          { $set: { isActive: false } },
          { session }
        );
        log("account_quarantine_result", {
          collection: collectionName,
          matched: result.matchedCount,
          modified: result.modifiedCount,
        });
      }
    });
  } finally {
    await session.endSession();
  }
  return plan;
}

async function main() {
  const args = parseArgs();
  assertExecutionGuards(args);

  const uri = resolveMongoUri();
  const client = new MongoClient(uri, {
    retryWrites: false,
    readConcern: { level: "majority" },
    serverSelectionTimeoutMS: 10000,
  });
  await client.connect();
  try {
    // Production currently omits the path and therefore uses MongoDB's default
    // database "test". client.db() preserves that driver behavior for audit and
    // requires the independent production confirmation before any write.
    const configuredDbName = getDbNameFromUri(uri);
    const db = configuredDbName ? client.db(configuredDbName) : client.db();
    log("migration_identity", {
      mode: args.execute ? "execute" : "dry-run",
      environment: process.env.NODE_ENV || "unset",
      database: db.databaseName,
      host: getMongoHostFromUri(uri),
    });
    const plan = await buildPlan(db);
    log("preflight_complete", {
      groupCount: plan.groups.length,
      productCount: plan.products.length,
      generatedOptionCount: plan.generatedOptions.length,
      builderArtifactCount: plan.builderProteins.length + plan.builderCarbs.length,
      fixtureAccountCount: plan.dashboardUsers.length + plan.clientUsers.length,
      humanOption: HUMAN_OPTION,
      references: plan.references,
    });

    if (!args.execute) {
      log("dry_run_complete", {
        wouldArchive: plan.updates,
        historicalDocumentsRewritten: 0,
        humanOptionMoved: false,
      });
      return;
    }

    await executePlan(db, plan, client);
    log("execution_complete", {
      historicalDocumentsRewritten: 0,
      humanOptionMoved: false,
    });
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: "migration_stopped", error: error.message }));
    process.exitCode = 1;
  });
}

module.exports = {
  ALLOWED_REFERENCE_COLLECTIONS,
  FIXTURE_PREFIX,
  FIXTURE_TAG,
  HUMAN_OPTION,
  HUMAN_OPTION_DISPOSITION,
  PRODUCTION_CONFIRMATION,
  TARGETS,
  assertExecutionGuards,
  collectFixtureReferences,
  parseArgs,
};
