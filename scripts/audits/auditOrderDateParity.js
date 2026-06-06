"use strict";

/**
 * Phase 2.2A: Read-Only Order Date Parity Audit
 * 
 * This script identifies discrepancies between fulfillmentDate and deliveryDate.
 * It is purely read-only and will not modify any data.
 */

const mongoose = require("mongoose");
const Order = require("../../src/models/Order");

async function runAudit() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("ERROR: MONGO_URI environment variable is missing.");
    process.exit(1);
  }

  console.log("Connecting to database...");
  await mongoose.connect(mongoUri);
  console.log(`Connected to database: ${mongoose.connection.name}`);

  try {
    const opsStatuses = ["confirmed", "in_preparation", "preparing", "ready_for_pickup", "out_for_delivery"];
    const emptyValues = [null, ""];

    // 1. Missing fulfillmentDate
    const missingFulfillmentQuery = {
      $or: [
        { fulfillmentDate: { $exists: false } },
        { fulfillmentDate: { $in: emptyValues } }
      ],
      deliveryDate: { $exists: true, $nin: emptyValues }
    };
    const missingFulfillmentCount = await Order.countDocuments(missingFulfillmentQuery);
    const missingFulfillmentSamples = await Order.find(missingFulfillmentQuery).limit(20).select("_id").lean();

    // 2. Missing deliveryDate
    const missingDeliveryQuery = {
      $or: [
        { deliveryDate: { $exists: false } },
        { deliveryDate: { $in: emptyValues } }
      ],
      fulfillmentDate: { $exists: true, $nin: emptyValues }
    };
    const missingDeliveryCount = await Order.countDocuments(missingDeliveryQuery);
    const missingDeliverySamples = await Order.find(missingDeliveryQuery).limit(20).select("_id").lean();

    // 3. Differing Dates
    const differingDatesQuery = {
      fulfillmentDate: { $exists: true, $nin: emptyValues },
      deliveryDate: { $exists: true, $nin: emptyValues },
      $expr: { $ne: ["$fulfillmentDate", "$deliveryDate"] }
    };
    const differingDatesCount = await Order.countDocuments(differingDatesQuery);
    const differingDatesSamples = await Order.find(differingDatesQuery).limit(20).select("_id").lean();

    // 4. Paid operational orders at risk (visible in $or but missing in fulfillmentDate)
    const riskQuery = {
      paymentStatus: "paid",
      status: { $in: opsStatuses },
      $or: [
        { fulfillmentDate: { $exists: false } },
        { fulfillmentDate: { $in: emptyValues } }
      ],
      deliveryDate: { $exists: true, $nin: emptyValues }
    };
    const riskCount = await Order.countDocuments(riskQuery);
    const riskSamples = await Order.find(riskQuery).limit(20).select("_id").lean();

    const totalOrders = await Order.countDocuments({});

    console.log("\n--- Order Date Parity Audit Results ---");
    console.log(`Total Orders in Collection: ${totalOrders}`);
    
    console.log(`\n1. Missing fulfillmentDate (exists in deliveryDate): ${missingFulfillmentCount}`);
    if (missingFulfillmentSamples.length > 0) {
      console.log("   Samples:", missingFulfillmentSamples.map(s => String(s._id)));
    }

    console.log(`\n2. Missing deliveryDate (exists in fulfillmentDate): ${missingDeliveryCount}`);
    if (missingDeliverySamples.length > 0) {
      console.log("   Samples:", missingDeliverySamples.map(s => String(s._id)));
    }

    console.log(`\n3. Both exist but differ: ${differingDatesCount}`);
    if (differingDatesSamples.length > 0) {
      console.log("   Samples:", differingDatesSamples.map(s => String(s._id)));
    }

    console.log(`\n4. Operational Risk Orders (Paid/Visible but would disappear): ${riskCount}`);
    if (riskSamples.length > 0) {
      console.log("   Samples:", riskSamples.map(s => String(s._id)));
    }

    console.log("\n--- Conclusion ---");
    const isSafe = missingFulfillmentCount === 0 && differingDatesCount === 0 && riskCount === 0;
    console.log(`SAFE_TO_SWITCH_TO_FULFILLMENT_DATE_ONLY: ${isSafe ? "YES" : "NO"}`);
    
    if (!isSafe) {
      console.log("\nWARNING: Discrepancies detected. Perform the backfill sync from ORDER_DATE_QUERY_STRATEGY.md before standardizing queries.");
    }

  } catch (err) {
    console.error("Audit failed:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("\nDisconnected.");
  }
}

runAudit();
