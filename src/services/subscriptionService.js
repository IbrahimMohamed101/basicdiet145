const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const { toKSADateString } = require("../utils/date");
const { addDays } = require("date-fns");

async function applySkipForDate({ sub, date, session, allowLocked = false }) {
    const existingDay = await SubscriptionDay.findOne({ subscriptionId: sub._id, date }).session(session);

    if (existingDay && existingDay.status === "skipped") {
        return { status: "already_skipped", day: existingDay };
    }

    if (existingDay && existingDay.status === "fulfilled") {
        return { status: "fulfilled", day: existingDay };
    }

    // Regular users can't skip locked days. Couriers can "skip" (cancel) them.
    if (existingDay && !allowLocked && !["open", "skipped"].includes(existingDay.status)) {
        return { status: "locked", day: existingDay };
    }

    const mealsToDeduct = sub.planId.mealsPerDay;

    // CR-01 FIX: Use atomic conditional update to prevent race condition
    // Only deduct if day was successfully marked as skipped
    let dayUpdateResult;
    if (!existingDay) {
        // Create new skipped day
        const created = await SubscriptionDay.create(
            [{ subscriptionId: sub._id, date, status: "skipped", creditsDeducted: true }],
            { session }
        );
        dayUpdateResult = created[0];
    } else {
        const query = { _id: existingDay._id };
        if (!allowLocked) {
            query.status = "open";
        } else {
            query.status = { $ne: "fulfilled" };
        }

        dayUpdateResult = await SubscriptionDay.findOneAndUpdate(
            query,
            { $set: { status: "skipped", creditsDeducted: true } },
            { new: true, session }
        );
        if (!dayUpdateResult) {
            return { status: allowLocked ? "fulfilled" : "locked" };
        }
    }

    // CR-01 FIX: Atomic credit deduction with conditional update
    const subUpdate = await Subscription.updateOne(
        { _id: sub._id, remainingMeals: { $gte: mealsToDeduct } },
        { $inc: { remainingMeals: -mealsToDeduct, skippedCount: 1 } },
        { session }
    );

    if (!subUpdate.modifiedCount) {
        // Rollback day update since credits couldn't be deducted
        await SubscriptionDay.updateOne(
            { _id: dayUpdateResult._id },
            { $set: { status: existingDay?.status || "open", creditsDeducted: false } },
            { session }
        ).session(session);
        await session.abortTransaction();
        return { status: "insufficient_credits" };
    }

    let compensatedDateAdded = null;
    const allowance = sub.planId.skipAllowance || 0;

    // Use the updated skippedCount from the atomic update
    const newSkippedCount = (sub.skippedCount || 0) + 1;

    if (newSkippedCount <= allowance) {
        const currentEnd = sub.validityEndDate || sub.endDate || new Date();
        const newEnd = addDays(new Date(currentEnd), 1);

        sub.validityEndDate = newEnd;
        sub.endDate = newEnd;

        const newDateStr = toKSADateString(newEnd);
        const existingCompDay = await SubscriptionDay.findOne({ subscriptionId: sub._id, date: newDateStr }).session(session);

        if (!existingCompDay) {
            await SubscriptionDay.create([{
                subscriptionId: sub._id,
                date: newDateStr,
                status: "open"
            }], { session });
        }
        compensatedDateAdded = newDateStr;
    }

    await sub.save({ session });

    return { status: "skipped", day: dayUpdateResult, compensatedDateAdded };
}

module.exports = { applySkipForDate };
