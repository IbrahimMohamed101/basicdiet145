"use strict";

const LIFECYCLE_FIELDS = Object.freeze({
  isArchived: { type: Boolean, default: false, index: true },
  archivedAt: { type: Date, default: null, index: true },
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date, default: null, index: true },
});

function lifecycleRequested(source = {}) {
  return source.isArchived === true
    || source.isDeleted === true
    || Boolean(source.archivedAt)
    || Boolean(source.deletedAt);
}

function addMissingLifecycleFields(schema) {
  for (const [path, definition] of Object.entries(LIFECYCLE_FIELDS)) {
    if (!schema.path(path)) schema.add({ [path]: definition });
  }
}

function applyDisabledState(target, deactivatePaths) {
  for (const path of deactivatePaths) target[path] = false;
}

function syncLifecycleUpdate(query, deactivatePaths) {
  const update = query.getUpdate() || {};
  const usesOperators = Object.keys(update).some((key) => key.startsWith("$"));
  const lifecycleSource = usesOperators ? (update.$set || {}) : update;
  if (!lifecycleRequested(lifecycleSource)) return;

  if (usesOperators) {
    if (!update.$set) update.$set = {};
    applyDisabledState(update.$set, deactivatePaths);
  } else {
    applyDisabledState(update, deactivatePaths);
  }
  query.setUpdate(update);
}

function applyArchivableLifecycle(schema, { deactivatePaths = ["isActive"] } = {}) {
  addMissingLifecycleFields(schema);

  schema.pre("validate", function enforceArchivedState(next) {
    if (lifecycleRequested(this)) applyDisabledState(this, deactivatePaths);
    next();
  });

  for (const operation of ["updateOne", "updateMany", "findOneAndUpdate"]) {
    schema.pre(operation, function enforceArchivedUpdate(next) {
      syncLifecycleUpdate(this, deactivatePaths);
      next();
    });
  }
}

module.exports = {
  LIFECYCLE_FIELDS,
  applyArchivableLifecycle,
  lifecycleRequested,
  syncLifecycleUpdate,
};
