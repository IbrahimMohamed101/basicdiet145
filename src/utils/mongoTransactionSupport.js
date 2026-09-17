const mongoose = require("mongoose");
const { logger } = require("./logger");

let _supportsTransactions = null;

async function checkMongoTransactionSupport(connection = mongoose.connection) {
  if (_supportsTransactions !== null) return _supportsTransactions;
  
  try {
    const adminDb = connection.db.admin();
    const hello = await adminDb.command({ hello: 1 });
    _supportsTransactions = Boolean(hello.setName || hello.msg === "isdbgrid");
    if (!_supportsTransactions) {
      logger.info("MongoDB transactions are NOT supported by the current connection.");
    }
    return _supportsTransactions;
  } catch (error) {
    // If we fail to check, assume no support to be safe and avoid crashing
    logger.warn("Failed to check MongoDB transaction capability", { error: error.message });
    _supportsTransactions = false;
    return false;
  }
}

async function startSafeSession(connection = mongoose.connection) {
  const isSupported = await checkMongoTransactionSupport(connection);
  const session = await connection.startSession();
  // Callers use this explicit capability bit to choose a compare-and-set /
  // compensation workflow when Railway is connected to standalone MongoDB.
  // A session by itself does not imply transaction support.
  session.supportsTransactions = isSupported;

  if (!isSupported) {
    // Monkey-patch the session object to make transaction methods no-ops
    // so operations will execute normally but without rollback guarantees.
    const noop = async () => {};
    session.startTransaction = () => {};
    session.commitTransaction = noop;
    session.abortTransaction = noop;
    
    // For session.withTransaction(fn), just execute the function directly.
    session.withTransaction = async (work) => {
      return await work(session);
    };
  }

  return session;
}

module.exports = {
  checkMongoTransactionSupport,
  startSafeSession,
};
