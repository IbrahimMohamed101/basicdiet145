const assert = require("node:assert");
const mongoose = require("mongoose");
const dateUtils = require("../src/utils/date");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Setting = require("../src/models/Setting");
const controller = require("../src/controllers/subscriptionController");

// Manual Mocking
const originalStartSession = mongoose.startSession;
const originalFindById = Subscription.findById;
const originalDayFindOne = SubscriptionDay.findOne;
const originalDayFindOneAndUpdate = SubscriptionDay.findOneAndUpdate;
const originalDayUpdateOne = SubscriptionDay.updateOne;
const originalSubUpdateOne = Subscription.updateOne;
const originalSettingFindOne = Setting.findOne;

async function runTests() {
    console.log("Starting pickup/prepare window verification tests (No Sinon, Updated Mocks)...");
    
    let res, session;
    let callHistory = [];

    const setup = () => {
        callHistory = [];
        res = {
            status: function(s) { 
                callHistory.push({ type: "status", value: s });
                return { json: function(j) { callHistory.push({ type: "json", value: j }); } };
            },
            json: function(j) { callHistory.push({ type: "json", value: j }); }
        };
        session = {
            startTransaction: () => {},
            commitTransaction: () => {},
            abortTransaction: () => {},
            endSession: () => {}
        };
        mongoose.startSession = async () => session;
        Setting.findOne = () => ({ lean: () => Promise.resolve({ value: "00:00" }) });
        SubscriptionDay.findOne = () => ({
            session: () => Promise.resolve({
                _id: new mongoose.Types.ObjectId().toString(),
                date: dateUtils.getTodayKSADate(),
                pickupRequested: false,
                creditsDeducted: false,
                status: "open",
                selections: [
                    new mongoose.Types.ObjectId().toString(),
                    new mongoose.Types.ObjectId().toString(),
                    new mongoose.Types.ObjectId().toString()
                ],
                premiumSelections: []
            })
        });
        SubscriptionDay.findOneAndUpdate = () => Promise.resolve({
            _id: new mongoose.Types.ObjectId().toString(),
            date: dateUtils.getTodayKSADate(),
            pickupRequested: true,
            creditsDeducted: true,
            status: "locked",
            selections: [
                new mongoose.Types.ObjectId().toString(),
                new mongoose.Types.ObjectId().toString(),
                new mongoose.Types.ObjectId().toString()
            ],
            premiumSelections: [],
            save: async function() { return this; }
        });
        SubscriptionDay.updateOne = () => Promise.resolve({ modifiedCount: 1 });
        Subscription.updateOne = () => Promise.resolve({ modifiedCount: 1 });
    };

    const teardown = () => {
        mongoose.startSession = originalStartSession;
        Subscription.findById = originalFindById;
        SubscriptionDay.findOne = originalDayFindOne;
        SubscriptionDay.findOneAndUpdate = originalDayFindOneAndUpdate;
        SubscriptionDay.updateOne = originalDayUpdateOne;
        Subscription.updateOne = originalSubUpdateOne;
        Setting.findOne = originalSettingFindOne;
    };

    // Test 1: Reject tomorrow
    setup();
    try {
        const req = {
            params: { id: new mongoose.Types.ObjectId().toString(), date: "" },
            userId: new mongoose.Types.ObjectId().toString(),
            headers: {}
        };
        const tomorrow = dateUtils.getTomorrowKSADate();
        req.params.date = tomorrow;

        const mockSub = {
            _id: req.params.id,
            userId: { toString: () => req.userId },
            status: "active",
            deliveryMode: "pickup",
            remainingMeals: 3,
            selectedMealsPerDay: 3,
            validityEndDate: dateUtils.addDaysToKSADateString(tomorrow, 10),
            populate: function() { return this; },
            session: function() { return this; }
        };
        Subscription.findById = () => mockSub;

        await controller.preparePickup(req, res);

        const statusCall = callHistory.find(c => c.type === "status");
        assert.strictEqual(statusCall && statusCall.value, 400, "Should return 400 for tomorrow");
        
        const jsonCall = callHistory.find(c => c.type === "json");
        assert.strictEqual(jsonCall && jsonCall.value.error.code, "INVALID_DATE", "Error code should be INVALID_DATE");
        console.log("✓ Test 1 Passed: Tomorrow rejected correctly.");
    } finally {
        teardown();
    }

    // Test 2: Allow today
    setup();
    try {
        const req = {
            params: { id: new mongoose.Types.ObjectId().toString(), date: "" },
            userId: new mongoose.Types.ObjectId().toString(),
            headers: {}
        };
        const today = dateUtils.getTodayKSADate();
        req.params.date = today;

        const mockSub = {
            _id: req.params.id,
            userId: { toString: () => req.userId },
            status: "active",
            deliveryMode: "pickup",
            remainingMeals: 3,
            selectedMealsPerDay: 3,
            validityEndDate: dateUtils.addDaysToKSADateString(today, 10),
            populate: function() { return this; },
            session: function() { return this; }
        };
        Subscription.findById = () => mockSub;

        await controller.preparePickup(req, res);

        const statusCall = callHistory.find(c => c.type === "status");
        const jsonCall = callHistory.find(c => c.type === "json");
        assert.strictEqual(statusCall, undefined, "Should not set an error status for today");
        assert.strictEqual(jsonCall && jsonCall.value.status, true, "Today should return success");
        console.log("✓ Test 2 Passed: Today's date allowed.");
    } finally {
        teardown();
    }

    // Test 3: Reject yesterday
    setup();
    try {
        const req = {
            params: { id: new mongoose.Types.ObjectId().toString(), date: "" },
            userId: new mongoose.Types.ObjectId().toString(),
            headers: {}
        };
        const today = dateUtils.getTodayKSADate();
        const yesterday = dateUtils.addDaysToKSADateString(today, -1);
        req.params.date = yesterday;

        const mockSub = {
            _id: req.params.id,
            userId: { toString: () => req.userId },
            status: "active",
            deliveryMode: "pickup",
            remainingMeals: 3,
            selectedMealsPerDay: 3,
            validityEndDate: dateUtils.addDaysToKSADateString(today, 10),
            populate: function() { return this; },
            session: function() { return this; }
        };
        Subscription.findById = () => mockSub;

        await controller.preparePickup(req, res);

        const statusCall = callHistory.find(c => c.type === "status");
        const jsonCall = callHistory.find(c => c.type === "json");
        assert.strictEqual(statusCall && statusCall.value, 400, "Should return 400 for yesterday");
        assert.strictEqual(jsonCall && jsonCall.value.error.code, "INVALID_DATE", "Error code should be INVALID_DATE");
        console.log("✓ Test 3 Passed: Yesterday rejected correctly.");
    } finally {
        teardown();
    }

    console.log("All tests passed!");
    process.exit(0);
}

runTests().catch(err => {
    console.error("Tests failed:", err);
    process.exit(1);
});
