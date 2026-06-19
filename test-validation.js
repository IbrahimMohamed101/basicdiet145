const { createAddon } = require('./src/controllers/addonController');
const mockRes = () => {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.data = data; return res; };
  return res;
};

async function run() {
  // unknown plan category
  let req = { body: { kind: 'plan', category: 'proteins', name: { en: 'test' } } };
  let res = mockRes();
  try { await createAddon(req, res); console.log("Cat error:", res.data); } catch(e) { console.log("Cat error thrown:", e); }

  // missing planPrices
  req = { body: { kind: 'plan', category: 'juice', name: { en: 'test' }, menuProductIds: ['5f8a0a1f9d6c2a0017c6d8c0'] } };
  res = mockRes();
  try { await createAddon(req, res); console.log("Missing planPrices error:", res.data); } catch(e) { console.log("Missing planPrices error thrown:", e); }

  // missing priceHalala for item
  req = { body: { kind: 'item', category: 'juice', name: { en: 'test' } } };
  res = mockRes();
  try { await createAddon(req, res); console.log("Missing priceHalala error:", res.data); } catch(e) { console.log("Missing priceHalala error thrown:", e); }

  // invalid basePlanId
  req = { body: { kind: 'plan', category: 'juice', name: { en: 'test' }, planPrices: [{ basePlanId: 'bad_id', priceHalala: 10 }] } };
  res = mockRes();
  try { await createAddon(req, res); console.log("Invalid basePlanId error:", res.data); } catch(e) { console.log("Invalid basePlanId error thrown:", e); }

  // invalid menuProductId
  req = { body: { kind: 'plan', category: 'juice', name: { en: 'test' }, menuProductIds: ['bad_id'] } };
  res = mockRes();
  try { await createAddon(req, res); console.log("Invalid menuProductId error:", res.data); } catch(e) { console.log("Invalid menuProductId error thrown:", e); }
}
run();
