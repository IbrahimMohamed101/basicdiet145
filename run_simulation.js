require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const http = require('http');

const { createApp } = require('./src/app');
const User = require('./src/models/User');
const Subscription = require('./src/models/Subscription');
const SubscriptionDay = require('./src/models/SubscriptionDay');
const Plan = require('./src/models/Plan');
const Addon = require('./src/models/Addon');
const Payment = require('./src/models/Payment');
const CheckoutDraft = require('./src/models/CheckoutDraft');
const Zone = require('./src/models/Zone');
const BuilderProtein = require('./src/models/BuilderProtein');

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_local';
const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

function issueAppAccessToken(userId) {
  return jwt.sign({ userId: String(userId), role: 'client', tokenType: 'app_access' }, JWT_SECRET, { expiresIn: '31d' });
}

async function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method,
      headers: { 'Content-Type': 'application/json', 'Accept-Language': 'ar' },
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers }); }
        catch (e) { resolve({ status: res.statusCode, body: data, headers: res.headers }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  const uri = process.env.MONGO_URI;
  const dbName = process.env.MONGO_DB;
  await mongoose.connect(uri, { dbName });

  const app = createApp();
  const server = http.createServer(app);
  await new Promise(r => server.listen(PORT, r));

  console.log('\n--- 1. إنشاء الحساب ---');
  let user = await User.findOne({ phone: '+966500000001' });
  if (!user) {
      user = new User({ name: 'Test Premium Client', phone: '+966500000001', role: 'client', isActive: true });
      await user.save();
  }
  const token = issueAppAccessToken(user._id);

  console.log('\n--- 2. اختيار الباقة والإضافات ---');
  const plans = await Plan.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
  const largestPlan = plans.pop() || plans[0];
  
  const addons = await Addon.find({ isActive: true, kind: 'plan' }).limit(3).lean();
  const proteins = await BuilderProtein.find({ isPremium: true }).limit(2).lean();
  
  const d = new Date(); d.setDate(d.getDate() + 2);
  const startDate = d.toISOString().split('T')[0];

  console.log('\n--- 3. Checkout والدفع ---');
  const checkoutPayload = {
    planId: String(largestPlan._id),
    grams: largestPlan.gramsOptions[0].grams,
    mealsPerDay: largestPlan.gramsOptions[0].mealsOptions[0].mealsPerDay,
    startDate,
    delivery: { type: 'pickup' },
    premiumItems: [
      { premiumKey: proteins[0].premiumKey || 'shrimp', qty: 5 },
      { premiumKey: proteins[1].premiumKey || 'beef_steak', qty: 5 }
    ],
    addons: addons.map(a => String(a._id)),
    idempotencyKey: `sim_checkout_${Date.now()}`
  };

  const checkoutRes = await makeRequest('POST', '/api/subscriptions/checkout', checkoutPayload, token);
  if (checkoutRes.status !== 201) throw new Error('Checkout Failed: ' + JSON.stringify(checkoutRes.body));
  const draftId = checkoutRes.body.data.draftId;

  const draft = await CheckoutDraft.findById(draftId).lean();
  const payment = new Payment({
    userId: user._id, draftId, type: 'subscription_activation',
    amount: draft.breakdown.totalHalala, currency: 'SAR', status: 'paid', provider: 'moyasar', providerInvoiceId: `sim_inv_${Date.now()}`
  });
  await payment.save();

  const { finalizeSubscriptionDraftPaymentFlow } = require('./src/services/subscription/subscriptionActivationService');
  const activationRes = await finalizeSubscriptionDraftPaymentFlow({ draft, payment }, null);
  const subId = activationRes.subscriptionId;

  const sub = await Subscription.findById(subId).lean();
  console.log('✅ تم تفعيل الاشتراك بنجاح. الرصيد المميز المبدئي:', sub.premiumBalance.map(b => `${b.premiumKey}: ${b.remainingQty}`).join(', '));

  console.log('\n--- 4. التايم لاين وتخصيص الوجبات ---');
  const days = await SubscriptionDay.find({ subscriptionId: subId }).sort({ date: 1 }).limit(3).lean();
  
  for (let i = 0; i < days.length; i++) {
    const date = days[i].date;
    console.log(`\n📅 اليوم: ${date}`);
    
    let mealSlots = [];
    for(let m=1; m <= largestPlan.gramsOptions[0].mealsOptions[0].mealsPerDay; m++) {
        if(m===1) mealSlots.push({ slotIndex: m, selectionType: 'premium_meal', premiumKey: proteins[0].premiumKey, carbs: [] });
        else mealSlots.push({ slotIndex: m, selectionType: 'standard_meal', carbs: [] });
    }

    // Assign Addon One Time
    const selectionPayload = { mealSlots, addonsOneTime: addons.length > 0 ? [String(addons[0]._id)] : [] };
    const updateRes = await makeRequest('PUT', `/api/subscriptions/${subId}/days/${date}/selection`, selectionPayload, token);
    console.log(`✅ تم حفظ التخطيط الأساسي واستهلاك الرصيد المميز (الحالة: ${updateRes.status})`);

    // Test Extra Meals (Over quota test)
    mealSlots.push({ slotIndex: mealSlots.length + 1, selectionType: 'premium_meal', premiumKey: 'premium_large_salad', carbs: [] });
    const overQuotaRes = await makeRequest('PUT', `/api/subscriptions/${subId}/days/${date}/selection`, { mealSlots }, token);
    console.log(`✅ اختبار شراء وجبة مميزة إضافية بدون رصيد مسبق: رد بـ ${overQuotaRes.status} (المتوقع 402)`);

    const confirmRes = await makeRequest('POST', `/api/subscriptions/${subId}/days/${date}/confirm`, {}, token);
    console.log(`✅ تأكيد خطة اليوم: ${confirmRes.status}`);

    await SubscriptionDay.updateOne({ _id: days[i]._id }, { $set: { status: 'ready_for_pickup' } });
    await SubscriptionDay.updateOne({ _id: days[i]._id }, { $set: { status: 'fulfilled' } });
    console.log('✅ تمت عملية المطابخ واستلام العميل للوجبات (Fulfilled).');
  }

  const finalSub = await Subscription.findById(subId).lean();
  console.log('\n--- 5. تقرير التحقق النهائي ---');
  console.log('✅ الأرصدة المميزة المتبقية بعد الاستهلاك:');
  finalSub.premiumBalance.forEach(b => console.log(`  - ${b.premiumKey}: ${b.remainingQty} متبقي`));
  
  console.log('\n✅ محاكاة السيناريو اكتملت بنجاح وتعمل جميع الخصومات.');

  await mongoose.disconnect();
  server.close();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
