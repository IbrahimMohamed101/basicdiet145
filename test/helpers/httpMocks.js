const mongoose = require("mongoose");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function normalizeHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
  );
}

function createMockRequest({ params = {}, body = {}, query = {}, userId = objectId(), headers = {} } = {}) {
  const normalizedHeaders = normalizeHeaders(headers);
  return {
    params,
    body,
    query,
    userId,
    headers: normalizedHeaders,
    get(name) {
      return normalizedHeaders[String(name || "").toLowerCase()];
    },
  };
}

function createMockResponse() {
  const res = {
    statusCode: 200,
    payload: undefined,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    set(name, value) {
      this.headers[String(name || "").toLowerCase()] = value;
      return this;
    },
    append(name, value) {
      const key = String(name || "").toLowerCase();
      const existing = this.headers[key];
      this.headers[key] = existing ? [].concat(existing, value) : value;
      return this;
    },
  };
  return res;
}

function createReqRes(opts = {}) {
  return {
    req: createMockRequest(opts),
    res: createMockResponse(),
  };
}

function createQueryStub(result) {
  return {
    sort() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
    },
    populate() {
      return Promise.resolve(result);
    },
  };
}

module.exports = {
  objectId,
  createMockRequest,
  createMockResponse,
  createReqRes,
  createQueryStub,
};
