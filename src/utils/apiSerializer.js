function serializeForApi(value) {
  if (value == null) return value;

  if (value instanceof Date || (value.constructor && value.constructor.name === 'Date')) {
    return value.toISOString();
  }

  if (
    value._bsontype === "ObjectId" ||
    value.constructor?.name === "ObjectId" ||
    (typeof value.toHexString === 'function')
  ) {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeForApi);
  }

  if (typeof value === "object") {
    // Handle Mongoose documents
    const plain = (typeof value.toObject === 'function')
      ? value.toObject({ virtuals: true })
      : value;

    const out = {};
    for (const [key, val] of Object.entries(plain)) {
      out[key] = serializeForApi(val);
    }
    return out;
  }

  return value;
}

module.exports = {
  serializeForApi,
};