const mongoose = require('mongoose');
const CheckoutDraft = require('./src/models/CheckoutDraft');
require('dotenv').config();
async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/basicdiet145_test');
  const drafts = await CheckoutDraft.find().sort({ createdAt: -1 }).limit(5).lean();
  for (const draft of drafts) {
    if (draft.delivery?.type === 'delivery') {
      console.log('ID:', draft._id);
      console.log('firstDayFulfillmentOverride draft:', draft.delivery?.firstDayFulfillmentOverride);
      console.log('firstDayFulfillmentOverride contract:', draft.contractSnapshot?.delivery?.firstDayFulfillmentOverride);
    }
  }
  process.exit(0);
}
run();
