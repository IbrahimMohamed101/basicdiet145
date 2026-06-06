#!/usr/bin/env node
const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const healthCheckService = require("../src/services/catalogHealthService");

async function runHealthCheck() {
  const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/basicdiet";
  
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(mongoUri);
    console.log("Connected successfully.\n");

    console.log("--- Plan Catalog Health Check ---");
    const planReport = await healthCheckService.checkPlanCatalogHealth();
    console.log(`Total Active Plans: ${planReport.totalActivePlans}`);
    if (planReport.anomalies.length > 0) {
      console.error(`Found ${planReport.anomalies.length} plans with anomalies:`);
      planReport.anomalies.forEach(a => {
        console.error(`- Plan [${a.planId}] (${JSON.stringify(a.name)}): ${a.issues.join(", ")}`);
      });
    } else {
      console.log("Plan catalog is healthy.\n");
    }

    console.log("--- Subscription Integrity Audit ---");
    const subReport = await healthCheckService.auditSubscriptionIntegrity();
    if (subReport.ghostPayments.length > 0) {
      console.error(`CRITICAL: Found ${subReport.ghostPayments.length} ghost payments (paid but no subscription):`);
      subReport.ghostPayments.forEach(p => {
        console.error(`- Payment [${p.paymentId}] for User [${p.userId}] Amount [${p.amount}] PaidAt [${p.paidAt}]`);
      });
    } else {
      console.log("No ghost payments found.\n");
    }

    if (subReport.orphanedSubscriptions.length > 0) {
      console.warn(`Found ${subReport.orphanedSubscriptions.length} orphaned subscriptions:`);
      subReport.orphanedSubscriptions.forEach(s => {
        console.warn(`- Subscription [${s.subscriptionId}] User [${s.userId}]: ${s.issue}`);
      });
    } else {
      console.log("No orphaned subscriptions found.\n");
    }

    const hasCriticalIssues = planReport.anomalies.length > 0 || subReport.ghostPayments.length > 0;
    
    await mongoose.disconnect();
    
    if (hasCriticalIssues) {
      console.error("\nHEALTH CHECK FAILED: Critical issues detected.");
      process.exit(1);
    } else {
      console.log("\nHEALTH CHECK PASSED.");
      process.exit(0);
    }
  } catch (err) {
    console.error("FATAL ERROR during health check:", err);
    process.exit(1);
  }
}

runHealthCheck();
