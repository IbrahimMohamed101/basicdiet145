const request = require('supertest');
const { createApp } = require('../src/app');
const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  const app = createApp();
  
  if (mongoose.connection.readyState === 0) {
    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI is not defined in .env');
        process.exit(1);
    }
    await mongoose.connect(process.env.MONGODB_URI);
  }

  console.log('--- Testing GET /api/subscriptions/meal-planner-menu (Default) ---');
  const resDefault = await request(app).get('/api/subscriptions/meal-planner-menu');
  
  if (resDefault.status !== 200) {
    console.error('Failed default request:', resDefault.status, resDefault.body);
    await mongoose.disconnect();
    process.exit(1);
  }

  const dataDefault = resDefault.body.data;
  const addonCatalog = dataDefault.addonCatalog;

  console.log('1. addonCatalog exists:', !!addonCatalog);
  if (addonCatalog) {
    console.log('2. addonCatalog.items is array:', Array.isArray(addonCatalog.items));
    console.log('3. addonCatalog.byCategory is object:', typeof addonCatalog.byCategory === 'object');
    console.log('4. addonCatalog.totalCount:', addonCatalog.totalCount);
    console.log('5. addonCatalog.items length matches totalCount:', addonCatalog.items.length === addonCatalog.totalCount);
    
    const categories = Object.keys(addonCatalog.byCategory);
    console.log('6. Categories found:', categories.join(', '));
  }

  console.log('7. Legacy field "regularMeals" absent:', !dataDefault.regularMeals);
  console.log('8. Legacy field "premiumMeals" absent:', !dataDefault.premiumMeals);
  console.log('9. Legacy field "addons" absent:', !dataDefault.addons);

  console.log('\n--- Testing GET /api/subscriptions/meal-planner-menu?includeLegacy=true ---');
  const resLegacy = await request(app).get('/api/subscriptions/meal-planner-menu?includeLegacy=true');
  const dataLegacy = resLegacy.body.data;
  
  console.log('10. Legacy field "regularMeals" present:', !!dataLegacy.regularMeals);
  console.log('11. Legacy field "premiumMeals" present:', !!dataLegacy.premiumMeals);
  console.log('12. Legacy field "addons" present:', !!dataLegacy.addons);
  console.log('13. addonCatalog still present in legacy response:', !!dataLegacy.addonCatalog);

  await mongoose.disconnect();
  console.log('\nVerification completed successfully!');
}

run().catch(err => {
  console.error('Test error:', err);
  if (mongoose.connection.readyState !== 0) {
    mongoose.disconnect();
  }
  process.exit(1);
});
