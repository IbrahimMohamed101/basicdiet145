#!/usr/bin/env node

/**
 * Demo Data Seeding Script for BasicDiet145
 * 
 * This script generates comprehensive fake/demo data for development and testing.
 * 
 * Usage:
 *   node scripts/seed-demo-data.js [options]
 * 
 * Options:
 *   --clear           Clear all data before seeding
 *   --users=N         Number of users to create (default: 50)
 *   --subscriptions=N Number of subscriptions to create (default: 80)
 *   --orders=N        Number of orders to create (default: 50)
 * 
 * Example:
 *   npm run seed:full
 *   node scripts/seed-demo-data.js --clear --users=100
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { format, addDays, subDays } = require('date-fns');
const { formatInTimeZone } = require('date-fns-tz');

// Import Models
const User = require('../src/models/User');
const Plan = require('../src/models/Plan');
const Meal = require('../src/models/Meal');
const Addon = require('../src/models/Addon');
const SaladIngredient = require('../src/models/SaladIngredient');
const Subscription = require('../src/models/Subscription');
const SubscriptionDay = require('../src/models/SubscriptionDay');
const Order = require('../src/models/Order');
const Payment = require('../src/models/Payment');
const DashboardUser = require('../src/models/DashboardUser');
const ActivityLog = require('../src/models/ActivityLog');

const TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Riyadh';

// ============================================================================
// Utilities
// ============================================================================

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomElement(arr) {
    return arr[randomInt(0, arr.length - 1)];
}

function randomElements(arr, count) {
    const shuffled = [...arr].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

function getKSADate(daysOffset = 0) {
    const date = addDays(new Date(), daysOffset);
    return formatInTimeZone(date, TIMEZONE, 'yyyy-MM-dd');
}

// ============================================================================
// Data Generators
// ============================================================================

// Arabic Names
const arabicFirstNames = [
    'محمد', 'أحمد', 'علي', 'حسن', 'عمر', 'خالد', 'سعيد', 'عبدالله', 'فهد', 'سلطان',
    'فاطمة', 'عائشة', 'مريم', 'نورة', 'سارة', 'هند', 'لطيفة', 'منى', 'ريم', 'أمل',
    'عبدالرحمن', 'يوسف', 'إبراهيم', 'عبدالعزيز', 'ماجد', 'طارق', 'وليد', 'نواف',
    'جواهر', 'غادة', 'دانة', 'لمى', 'شهد', 'رنا', 'ليلى', 'سلمى'
];

const arabicLastNames = [
    'العتيبي', 'الغامدي', 'القحطاني', 'الدوسري', 'الشمري', 'المطيري', 'العنزي', 'الحربي',
    'الزهراني', 'الأحمدي', 'السهلي', 'العمري', 'المالكي', 'السبيعي', 'الجهني',
    'العصيمي', 'البقمي', 'الشهري', 'الرشيدي', 'اليامي'
];

// Saudi Cities
const saudiCities = ['الرياض', 'جدة', 'الدمام', 'مكة المكرمة', 'المدينة المنورة', 'الخبر', 'تبوك', 'بريدة', 'الطائف', 'أبها'];

const neighborhoods = ['حي النخيل', 'حي الملك فهد', 'حي الورود', 'حي السلام', 'حي العليا', 'حي الروضة', 'حي المرجان'];

function generateSaudiPhone() {
    const prefix = randomElement(['50', '53', '54', '55', '56', '58', '59']);
    const number = Math.floor(Math.random() * 10000000).toString().padStart(7, '0');
    return `+9665${prefix.slice(1)}${number}`;
}

function generateAddress() {
    return {
        line1: randomElement(neighborhoods),
        line2: randomElement(['شارع الأمير محمد', 'شارع التحلية', 'شارع العروبة', 'طريق الملك فهد']),
        city: randomElement(saudiCities),
        notes: randomElement(['بجانب المسجد', 'عمارة رقم 5', 'فيلا بيضاء', 'برج الأعمال'])
    };
}

// ============================================================================
// Seeding Functions
// ============================================================================

async function seedSaladIngredients() {
    console.log('🥗 Seeding Salad Ingredients...');

    const ingredients = [
        { name_en: 'Lettuce', name_ar: 'خس', price: 2, calories: 5, maxQuantity: 5 },
        { name_en: 'Tomato', name_ar: 'طماطم', price: 3, calories: 18, maxQuantity: 5 },
        { name_en: 'Cucumber', name_ar: 'خيار', price: 2, calories: 8, maxQuantity: 5 },
        { name_en: 'Carrot', name_ar: 'جزر', price: 2, calories: 25, maxQuantity: 5 },
        { name_en: 'Bell Pepper', name_ar: 'فلفل رومي', price: 4, calories: 20, maxQuantity: 4 },
        { name_en: 'Onion', name_ar: 'بصل', price: 2, calories: 40, maxQuantity: 3 },
        { name_en: 'Corn', name_ar: 'ذرة', price: 3, calories: 86, maxQuantity: 4 },
        { name_en: 'Olives', name_ar: 'زيتون', price: 5, calories: 115, maxQuantity: 3 },
        { name_en: 'Feta Cheese', name_ar: 'جبنة فيتا', price: 8, calories: 264, maxQuantity: 3 },
        { name_en: 'Avocado', name_ar: 'أفوكادو', price: 10, calories: 160, maxQuantity: 2 },
        { name_en: 'Chickpeas', name_ar: 'حمص', price: 4, calories: 164, maxQuantity: 4 },
        { name_en: 'Quinoa', name_ar: 'كينوا', price: 6, calories: 120, maxQuantity: 4 },
        { name_en: 'Spinach', name_ar: 'سبانخ', price: 3, calories: 7, maxQuantity: 5 },
        { name_en: 'Arugula', name_ar: 'جرجير', price: 4, calories: 5, maxQuantity: 5 },
        { name_en: 'Broccoli', name_ar: 'بروكلي', price: 5, calories: 31, maxQuantity: 4 },
        { name_en: 'Mushroom', name_ar: 'فطر', price: 6, calories: 22, maxQuantity: 4 },
        { name_en: 'Sunflower Seeds', name_ar: 'بذور عباد الشمس', price: 5, calories: 165, maxQuantity: 2 },
        { name_en: 'Walnuts', name_ar: 'جوز', price: 8, calories: 185, maxQuantity: 2 },
        { name_en: 'Grilled Chicken', name_ar: 'دجاج مشوي', price: 15, calories: 165, maxQuantity: 3 },
        { name_en: 'Tuna', name_ar: 'تونة', price: 12, calories: 132, maxQuantity: 3 }
    ];

    await SaladIngredient.insertMany(ingredients);
    console.log(`✅ Created ${ingredients.length} salad ingredients`);
    return await SaladIngredient.find();
}

async function seedMeals() {
    console.log('🍽️  Seeding Meals...');

    // Regular Meals
    const regularMeals = [
        'دجاج مشوي مع خضار',
        'كفتة لحم مع أرز',
        'صدور دجاج بالفرن',
        'مكرونة بالخضار',
        'برجر دجاج صحي',
        'فاهيتا دجاج',
        'دجاج تكا مسالا',
        'لحم مفروم مع بطاطس',
        'دجاج بالكاري',
        'صدور دجاج محشية',
        'كباب دجاج',
        'دجاج مع أرز بسمتي',
        'لحم بالخضار',
        'دجاج ترياكي',
        'ستير فراي دجاج',
        'معكرونة بالدجاج',
        'رز بالدجاج',
        'دجاج بالليمون',
        'كرات اللحم',
        'صينية دجاج بالفرن',
        'شاورما دجاج',
        'دجاج بالكريمة',
        'برياني دجاج',
        'دجاج مشوي بالأعشاب'
    ];

    // Premium Meals (سلمون، ستيك، جمبري)
    const premiumMeals = [
        'سلمون مشوي مع الليمون',
        'سلمون بالفرن مع الخضار',
        'سلمون ترياكي',
        'سلمون بالزبدة والثوم',
        'فيليه سلمون مع الأرز',
        'ستيك لحم مشوي',
        'ستيك بالفلفل',
        'ستيك مع البطاطس',
        'ستيك بالصوص',
        'تندرلوين ستيك',
        'جمبري مشوي',
        'جمبري بالثوم والزبدة',
        'جمبري مقلي',
        'جمبري بالكاري',
        'جمبري سكامبي'
    ];

    const meals = [
        ...regularMeals.map(name => ({ name, type: 'regular', isActive: true })),
        ...premiumMeals.map(name => ({ name, type: 'premium', isActive: true }))
    ];

    await Meal.insertMany(meals);
    console.log(`✅ Created ${regularMeals.length} regular meals and ${premiumMeals.length} premium meals`);

    return {
        regular: await Meal.find({ type: 'regular' }),
        premium: await Meal.find({ type: 'premium' })
    };
}

async function seedAddons() {
    console.log('➕ Seeding Addons...');

    const addons = [
        { name: 'عصير طازج يومي', price: 50, type: 'subscription', isActive: true },
        { name: 'قهوة سوداء يومية', price: 40, type: 'subscription', isActive: true },
        { name: 'سلطة إضافية', price: 15, type: 'one_time', isActive: true },
        { name: 'شوربة يومية', price: 60, type: 'subscription', isActive: true },
        { name: 'مكسرات صحية', price: 20, type: 'one_time', isActive: true },
        { name: 'بروتين بار', price: 25, type: 'one_time', isActive: true },
        { name: 'ماء ديتوكس', price: 30, type: 'subscription', isActive: true },
        { name: 'فواكه موسمية', price: 35, type: 'one_time', isActive: true },
        { name: 'زبادي يوناني', price: 18, type: 'one_time', isActive: true },
        { name: 'خبز صحي', price: 10, type: 'one_time', isActive: true }
    ];

    await Addon.insertMany(addons);
    console.log(`✅ Created ${addons.length} addons`);

    return {
        subscription: await Addon.find({ type: 'subscription' }),
        oneTime: await Addon.find({ type: 'one_time' })
    };
}

async function seedPlans() {
    console.log('📋 Seeding Plans...');

    const plans = [
        { name: 'خطة 5 أيام - وجبتين', daysCount: 5, mealsPerDay: 2, grams: 400, price: 25000, skipAllowance: 1, isActive: true },
        { name: 'خطة 5 أيام - 3 وجبات', daysCount: 5, mealsPerDay: 3, grams: 350, price: 35000, skipAllowance: 1, isActive: true },
        { name: 'خطة 10 أيام - وجبتين', daysCount: 10, mealsPerDay: 2, grams: 400, price: 45000, skipAllowance: 2, isActive: true },
        { name: 'خطة 10 أيام - 3 وجبات', daysCount: 10, mealsPerDay: 3, grams: 350, price: 65000, skipAllowance: 2, isActive: true },
        { name: 'خطة 20 يوم - وجبتين', daysCount: 20, mealsPerDay: 2, grams: 400, price: 85000, skipAllowance: 4, isActive: true },
        { name: 'خطة 20 يوم - 3 وجبات', daysCount: 20, mealsPerDay: 3, grams: 350, price: 120000, skipAllowance: 4, isActive: true },
        { name: 'خطة شهرية - وجبتين', daysCount: 30, mealsPerDay: 2, grams: 400, price: 120000, skipAllowance: 6, isActive: true }
    ];

    await Plan.insertMany(plans);
    console.log(`✅ Created ${plans.length} plans`);
    return await Plan.find();
}

async function seedUsers(count = 50) {
    console.log(`👥 Seeding ${count} Users...`);

    const users = [];
    for (let i = 0; i < count; i++) {
        users.push({
            phone: generateSaudiPhone(),
            name: `${randomElement(arabicFirstNames)} ${randomElement(arabicLastNames)}`,
            role: 'client',
            isActive: i < count - 5 ? true : false, // 5 inactive users
            fcmTokens: Math.random() > 0.3 ? [`fcm_token_${i}_${Date.now()}`] : []
        });
    }

    await User.insertMany(users);
    console.log(`✅ Created ${count} users`);
    return await User.find({ role: 'client' });
}

async function seedDashboardUsers() {
    console.log('👨‍💼 Seeding Dashboard Users...');

    const passwordHash = await bcrypt.hash('StrongPass123', Number(process.env.BCRYPT_ROUNDS || 10));
    const dashboardUsers = [
        { email: 'superadmin@basicdiet.sa', role: 'superadmin', isActive: true, passwordHash, passwordChangedAt: new Date() },
        { email: 'admin@basicdiet.sa', role: 'admin', isActive: true, passwordHash, passwordChangedAt: new Date() },
        { email: 'kitchen@basicdiet.sa', role: 'kitchen', isActive: true, passwordHash, passwordChangedAt: new Date() },
        { email: 'kitchen2@basicdiet.sa', role: 'kitchen', isActive: true, passwordHash, passwordChangedAt: new Date() },
        { email: 'courier@basicdiet.sa', role: 'courier', isActive: true, passwordHash, passwordChangedAt: new Date() },
        { email: 'courier2@basicdiet.sa', role: 'courier', isActive: true, passwordHash, passwordChangedAt: new Date() }
    ];

    await DashboardUser.insertMany(dashboardUsers);
    console.log(`✅ Created ${dashboardUsers.length} dashboard users`);
}

async function seedSubscriptions(users, plans, addons, count = 80) {
    console.log(`📝 Seeding ${count} Subscriptions...`);

    const subscriptions = [];
    const statuses = ['pending_payment', 'active', 'expired'];
    const deliveryModes = ['delivery', 'pickup'];
    const windows = ['صباحاً (8-11)', 'ظهراً (12-3)', 'مساءً (4-7)'];

    for (let i = 0; i < count; i++) {
        const user = randomElement(users);
        const plan = randomElement(plans);
        const status = i < 10 ? 'pending_payment' : i < count - 10 ? 'active' : 'expired';
        const deliveryMode = randomElement(deliveryModes);

        let startDate, endDate, validityEndDate;
        if (status === 'active') {
            startDate = new Date(Date.now() - randomInt(1, 15) * 24 * 60 * 60 * 1000);
            endDate = new Date(startDate.getTime() + plan.daysCount * 24 * 60 * 60 * 1000);
            validityEndDate = new Date(endDate.getTime() + 30 * 24 * 60 * 60 * 1000);
        } else if (status === 'expired') {
            startDate = new Date(Date.now() - randomInt(40, 80) * 24 * 60 * 60 * 1000);
            endDate = new Date(startDate.getTime() + plan.daysCount * 24 * 60 * 60 * 1000);
            validityEndDate = new Date(Date.now() - randomInt(5, 20) * 24 * 60 * 60 * 1000);
        }

        const totalMeals = plan.daysCount * plan.mealsPerDay;
        const remainingMeals = status === 'active' ? randomInt(totalMeals * 0.3, totalMeals * 0.9) : 0;

        const subscription = {
            userId: user._id,
            planId: plan._id,
            status,
            startDate,
            endDate,
            validityEndDate,
            totalMeals,
            remainingMeals,
            premiumRemaining: randomInt(0, 5),
            premiumPrice: 5000, // 50 SAR in halalas
            deliveryMode,
            skippedCount: randomInt(0, plan.skipAllowance)
        };

        if (deliveryMode === 'delivery') {
            subscription.deliveryAddress = generateAddress();
            subscription.deliveryWindow = randomElement(windows);
        }

        // Add some subscription addons
        if (Math.random() > 0.6) {
            subscription.addonSubscriptions = randomElements(addons.subscription, randomInt(1, 2)).map(addon => ({
                addonId: addon._id,
                name: addon.name,
                price: addon.price,
                type: addon.type
            }));
        }

        subscriptions.push(subscription);
    }

    await Subscription.insertMany(subscriptions);
    console.log(`✅ Created ${count} subscriptions`);
    return await Subscription.find();
}

async function seedSubscriptionDays(subscriptions, meals, addons) {
    console.log('📅 Seeding Subscription Days...');

    const activeSubscriptions = subscriptions.filter(s => s.status === 'active');
    const days = [];
    const statuses = ['open', 'locked', 'in_preparation', 'out_for_delivery', 'ready_for_pickup', 'fulfilled', 'skipped'];

    for (const subscription of activeSubscriptions) {
        const plan = await Plan.findById(subscription.planId);
        if (!plan) continue;

        // Generate days for the subscription
        for (let dayOffset = 0; dayOffset < plan.daysCount; dayOffset++) {
            const dayDate = format(addDays(subscription.startDate, dayOffset), 'yyyy-MM-dd');
            const isPast = new Date(dayDate) < new Date();
            const isFuture = new Date(dayDate) > addDays(new Date(), 2);

            let status;
            if (isFuture) {
                status = 'open';
            } else if (isPast) {
                status = randomElement(['fulfilled', 'skipped', 'skipped', 'fulfilled', 'fulfilled']); // More fulfilled than skipped
            } else {
                status = randomElement(['open', 'locked', 'in_preparation']);
            }

            const day = {
                subscriptionId: subscription._id,
                date: dayDate,
                status,
                selections: [],
                premiumSelections: [],
                addonsOneTime: [],
                assignedByKitchen: status === 'fulfilled' && Math.random() > 0.7,
                pickupRequested: subscription.deliveryMode === 'pickup',
                creditsDeducted: status === 'fulfilled'
            };

            // Add meal selections
            if (status !== 'skipped') {
                const regularMealsCount = plan.mealsPerDay - (Math.random() > 0.8 ? 1 : 0);
                day.selections = randomElements(meals.regular, regularMealsCount).map(m => m._id);

                // Add premium meals sometimes
                if (subscription.premiumRemaining > 0 && Math.random() > 0.7) {
                    day.premiumSelections = randomElements(meals.premium, 1).map(m => m._id);
                }

                // Add one-time addons sometimes
                if (Math.random() > 0.7) {
                    day.addonsOneTime = randomElements(addons.oneTime, randomInt(1, 2)).map(a => a._id);
                }
            }

            // Add locked snapshot for locked/fulfilled days
            if (['locked', 'in_preparation', 'out_for_delivery', 'ready_for_pickup', 'fulfilled'].includes(status)) {
                day.lockedSnapshot = {
                    selections: day.selections,
                    premiumSelections: day.premiumSelections,
                    lockedAt: new Date()
                };
                day.lockedAt = new Date(dayDate + 'T10:00:00');
            }

            // Add fulfilled snapshot for fulfilled days
            if (status === 'fulfilled') {
                day.fulfilledSnapshot = {
                    ...day.lockedSnapshot,
                    fulfilledAt: new Date()
                };
                day.fulfilledAt = new Date(dayDate + 'T16:00:00');
            }

            days.push(day);
        }
    }

    if (days.length > 0) {
        await SubscriptionDay.insertMany(days);
        console.log(`✅ Created ${days.length} subscription days`);
    }
}

async function seedOrders(users, meals, count = 50) {
    console.log(`🛒 Seeding ${count} Orders...`);

    const orders = [];
    const statuses = ['created', 'confirmed', 'preparing', 'out_for_delivery', 'ready_for_pickup', 'fulfilled', 'canceled'];
    const deliveryModes = ['delivery', 'pickup'];
    const windows = ['صباحاً (8-11)', 'ظهراً (12-3)', 'مساءً (4-7)'];

    for (let i = 0; i < count; i++) {
        const user = randomElement(users);
        const deliveryMode = randomElement(deliveryModes);
        const deliveryDate = getKSADate(randomInt(-5, 10));

        const isPast = new Date(deliveryDate) < new Date();
        let status;
        if (isPast) {
            status = randomElement(['fulfilled', 'fulfilled', 'fulfilled', 'canceled']);
        } else {
            status = randomElement(['confirmed', 'preparing', 'out_for_delivery', 'ready_for_pickup']);
        }

        // Create order items
        const itemCount = randomInt(1, 4);
        const selectedMeals = randomElements([...meals.regular, ...meals.premium], itemCount);
        const items = selectedMeals.map(meal => ({
            mealId: meal._id,
            name: meal.name,
            type: meal.type,
            quantity: 1,
            unitPrice: meal.type === 'premium' ? 5000 : 3500 // 50 or 35 SAR in halalas
        }));

        const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
        const deliveryFee = deliveryMode === 'delivery' ? 1000 : 0; // 10 SAR
        const total = subtotal + deliveryFee;

        const order = {
            userId: user._id,
            status,
            deliveryMode,
            deliveryDate,
            items,
            pricing: {
                unitPrice: 3500,
                premiumUnitPrice: 5000,
                quantity: itemCount,
                subtotal,
                deliveryFee,
                total,
                currency: 'SAR'
            },
            paymentStatus: status === 'fulfilled' ? 'paid' : status === 'canceled' ? 'canceled' : 'initiated',
            deliveryWindow: randomElement(windows)
        };

        if (deliveryMode === 'delivery') {
            order.deliveryAddress = generateAddress();
        }

        if (status === 'confirmed' || status === 'fulfilled') {
            order.confirmedAt = new Date(deliveryDate + 'T09:00:00');
        }

        if (status === 'fulfilled') {
            order.fulfilledAt = new Date(deliveryDate + 'T15:30:00');
        }

        if (status === 'canceled') {
            order.canceledAt = new Date();
        }

        orders.push(order);
    }

    await Order.insertMany(orders);
    console.log(`✅ Created ${count} orders`);
    return await Order.find();
}

async function seedPayments(subscriptions, orders) {
    console.log('💳 Seeding Payments...');

    const payments = [];
    const providers = ['moyasar'];
    const paymentStatuses = ['initiated', 'paid', 'failed', 'refunded'];

    // Payments for subscriptions
    for (const subscription of subscriptions) {
        if (subscription.status !== 'pending_payment') {
            const plan = await Plan.findById(subscription.planId);
            const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const paymentId = `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            payments.push({
                provider: randomElement(providers),
                type: 'subscription_activation',
                status: subscription.status === 'active' ? 'paid' : randomElement(['paid', 'refunded']),
                amount: plan.price,
                userId: subscription.userId,
                subscriptionId: subscription._id,
                applied: true,
                providerInvoiceId: invoiceId,
                providerPaymentId: paymentId
            });
        }

        // Premium topup payments
        if (subscription.premiumRemaining > 0 && Math.random() > 0.5) {
            const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const paymentId = `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            payments.push({
                provider: randomElement(providers),
                type: 'premium_topup',
                status: 'paid',
                amount: subscription.premiumRemaining * subscription.premiumPrice,
                userId: subscription.userId,
                subscriptionId: subscription._id,
                applied: true,
                providerInvoiceId: invoiceId,
                providerPaymentId: paymentId
            });
        }
    }

    // Payments for orders
    for (const order of orders) {
        if (order.paymentStatus === 'paid') {
            const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const paymentId = `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            payments.push({
                provider: randomElement(providers),
                type: 'one_time_order',
                status: 'paid',
                amount: order.pricing.total,
                userId: order.userId,
                orderId: order._id,
                applied: true,
                providerInvoiceId: invoiceId,
                providerPaymentId: paymentId
            });
        }
    }

    if (payments.length > 0) {
        await Payment.insertMany(payments);
        console.log(`✅ Created ${payments.length} payments`);
    }
}

async function seedActivityLogs() {
    console.log('📝 Seeding Activity Logs...');

    const logs = [];
    const actions = [
        'subscription_created', 'subscription_activated', 'day_locked', 'day_fulfilled',
        'order_created', 'order_confirmed', 'payment_completed', 'meal_selected',
        'day_skipped', 'premium_topup'
    ];
    const roles = ['client', 'admin', 'kitchen', 'courier'];

    for (let i = 0; i < 150; i++) {
        logs.push({
            entityType: randomElement(['Subscription', 'Order', 'SubscriptionDay', 'Payment']),
            entityId: new mongoose.Types.ObjectId(),
            action: randomElement(actions),
            byRole: randomElement(roles),
            meta: {
                timestamp: new Date(Date.now() - randomInt(1, 30) * 24 * 60 * 60 * 1000),
                note: 'Demo activity log entry'
            }
        });
    }

    await ActivityLog.insertMany(logs);
    console.log(`✅ Created ${logs.length} activity logs`);
}

// ============================================================================
// Main Execution
// ============================================================================

async function clearAllData() {
    console.log('🗑️  Clearing all existing data...');

    await Promise.all([
        User.deleteMany({ role: 'client' }),
        Plan.deleteMany({}),
        Meal.deleteMany({}),
        Addon.deleteMany({}),
        SaladIngredient.deleteMany({}),
        Subscription.deleteMany({}),
        SubscriptionDay.deleteMany({}),
        Order.deleteMany({}),
        Payment.deleteMany({}),
        DashboardUser.deleteMany({}),
        ActivityLog.deleteMany({})
    ]);

    console.log('✅ All data cleared');
}

async function main() {
    try {
        // Parse CLI arguments
        const args = process.argv.slice(2);
        const shouldClear = args.includes('--clear');
        const userCount = parseInt(args.find(arg => arg.startsWith('--users='))?.split('=')[1]) || 50;
        const subscriptionCount = parseInt(args.find(arg => arg.startsWith('--subscriptions='))?.split('=')[1]) || 80;
        const orderCount = parseInt(args.find(arg => arg.startsWith('--orders='))?.split('=')[1]) || 50;

        console.log('🚀 Starting Demo Data Seeding...\n');
        console.log(`Configuration:`);
        console.log(`  - Clear existing data: ${shouldClear}`);
        console.log(`  - Users: ${userCount}`);
        console.log(`  - Subscriptions: ${subscriptionCount}`);
        console.log(`  - Orders: ${orderCount}\n`);

        // Connect to MongoDB (Atlas-only)
        if (!process.env.MONGO_URI) {
            throw new Error('Missing MONGO_URI (MongoDB Atlas URI)');
        }
        if (!process.env.MONGO_URI.startsWith('mongodb+srv://')) {
            throw new Error('Invalid MONGO_URI: must be a MongoDB Atlas SRV connection string (mongodb+srv://...)');
        }
        const MONGO_URI = process.env.MONGO_URI;
        console.log(`Connecting to: ${MONGO_URI.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}\n`);
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB\n');

        // Clear data if requested
        if (shouldClear) {
            await clearAllData();
            console.log('');
        }

        // Seed data in order (respecting dependencies)
        const saladIngredients = await seedSaladIngredients();
        const meals = await seedMeals();
        const addons = await seedAddons();
        const plans = await seedPlans();
        const users = await seedUsers(userCount);
        await seedDashboardUsers();
        const subscriptions = await seedSubscriptions(users, plans, addons, subscriptionCount);
        await seedSubscriptionDays(subscriptions, meals, addons);
        const orders = await seedOrders(users, meals, orderCount);
        await seedPayments(subscriptions, orders);
        await seedActivityLogs();

        console.log('\n✅ Demo data seeding completed successfully! 🎉\n');

        // Print summary
        console.log('📊 Summary:');
        console.log(`  - Salad Ingredients: ${await SaladIngredient.countDocuments()}`);
        console.log(`  - Meals: ${await Meal.countDocuments()} (${meals.regular.length} regular + ${meals.premium.length} premium)`);
        console.log(`  - Addons: ${await Addon.countDocuments()}`);
        console.log(`  - Plans: ${await Plan.countDocuments()}`);
        console.log(`  - Users: ${await User.countDocuments({ role: 'client' })}`);
        console.log(`  - Dashboard Users: ${await DashboardUser.countDocuments()}`);
        console.log(`  - Subscriptions: ${await Subscription.countDocuments()}`);
        console.log(`  - Subscription Days: ${await SubscriptionDay.countDocuments()}`);
        console.log(`  - Orders: ${await Order.countDocuments()}`);
        console.log(`  - Payments: ${await Payment.countDocuments()}`);
        console.log(`  - Activity Logs: ${await ActivityLog.countDocuments()}`);

        console.log('\n🎯 Next steps:');
        console.log('  1. Test the APIs with: curl -H "Authorization: Bearer dev-client-token" http://localhost:3000/api/subscriptions');
        console.log('  2. Check MongoDB Atlas with mongosh using the same MONGO_URI in .env');
        console.log('  3. Start building your frontend! 🚀\n');

    } catch (error) {
        console.error('❌ Error seeding data:', error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('👋 Disconnected from MongoDB');
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { main, clearAllData };
