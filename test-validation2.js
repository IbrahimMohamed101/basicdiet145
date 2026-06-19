const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { createAddon } = require('./src/controllers/addonController');
const mockRes = () => {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.data = data; return res; };
  return res;
};

async function run() {
  const mongoServer = await MongoMemoryReplSet.create({ replSet: { storageEngine: "wiredTiger" } });
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  let req = { body: { kind: 'plan', category: 'juice', name: { en: 'test' } } };
  let res = mockRes();
  try { await createAddon(req, res); console.log("missing planPrices response:", res.statusCode, res.data); } catch(e) {}

  req = { body: { kind: 'plan', category: 'juice', name: { en: 'test' }, planPrices: [] } };
  res = mockRes();
  try { await createAddon(req, res); console.log("missing menuProductIds response:", res.statusCode, res.data); } catch(e) {}

  req = { body: { kind: 'plan', category: 'juice', name: { en: 'test' }, planPrices: [{ basePlanId: 'bad_id', priceHalala: 10 }] } };
  res = mockRes();
  try { await createAddon(req, res); console.log("invalid basePlanId response:", res.statusCode, res.data); } catch(e) {}

  req = { body: { kind: 'plan', category: 'juice', name: { en: 'test' }, menuProductIds: ['bad_id'] } };
  res = mockRes();
  try { await createAddon(req, res); console.log("invalid menuProductId response:", res.statusCode, res.data); } catch(e) {}

  process.exit(0);
}
run();
