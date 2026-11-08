// G2 mongosh script. Never run against Railway/Production before explicit approval.
// Invoke: mongosh --quiet --nodb --file scripts/g2-mongo-init-rs0.js
(function() {
  const scope = process.env.G2_EXECUTION_SCOPE;
  if (scope !== "ci-disposable" && process.env.G2_OWNER_APPROVED !== "true")
    throw Error("G2_OWNER_APPROVAL_REQUIRED");
  const target = String(process.env.G2_RS0_MEMBER_HOST || "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,190}$/.test(target) ||
      (scope !== "ci-disposable" && (target === "localhost" || /^[0-9.]+$/.test(target))))
    throw Error("G2_STABLE_PRIVATE_DNS_REQUIRED");
  if (!process.env.G2_MONGO_URI) throw Error("G2_URI_VARIABLE_REQUIRED");
  const conn = new Mongo(process.env.G2_MONGO_URI);
  const admin = conn.getDB("admin");
  const h = admin.runCommand({ hello: 1 });
  if (h.setName === "rs0") {
    if (h.isWritablePrimary !== true) throw Error("G2_RS0_NOT_PRIMARY");
    print("G2_ALREADY_INITIALIZED");
    return;
  }
  if (h.setName) throw Error("G2_DIFFERENT_REPLICA_SET");
  const init = admin.runCommand({
    replSetInitiate: { _id: "rs0", members: [{ _id: 0, host: target + ":27017" }] }
  });
  if (init.ok !== 1 && init.codeName !== "AlreadyInitialized") throw Error("G2_INIT_FAILED");
  for (let attempt = 0; attempt < 90; attempt++) {
    const current = admin.runCommand({ hello: 1 });
    if (current.setName === "rs0" && current.isWritablePrimary) {
      print("G2_RS0_PRIMARY");
      return;
    }
    sleep(1000);
  }
  throw Error("G2_PRIMARY_TIMEOUT");
})();
