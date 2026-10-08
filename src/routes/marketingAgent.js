"use strict";
const { Router } = require("express");
const { marketingAgentAuth } = require("../middleware/marketingAgentOidc");
const { buildMarketingAnalyticsReport } = require("../services/dashboard/marketingAnalyticsService");
const router = Router();

const COUNTS = ["registrations","loggedInUsers","checkoutStarted","checkoutUsers",
  "pendingCheckouts","abandonedCheckouts","failedPayments","paidTransactions",
  "paidCustomers","firstTimeSubscribers","repeatSubscribers","newRegistrationsPaid","cancellations"];
const MONEY = ["appRevenueHalala","totalSubscriptionRevenueHalala","aovHalala"];
const RATES = ["registerToPaidRate","checkoutToPaidRate","repeatCustomerRate"];
function dateValid(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(date + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10) === date;
}
function dayCount(a,b) {
  return Math.floor((Date.parse(b + "T00:00:00Z")-Date.parse(a + "T00:00:00Z"))/86400000)+1;
}
function safeCount(v) { return Number.isSafeInteger(v) && v>=0 ? v : 0; }
function safeRate(v) { return Number.isFinite(v) && v>=0 && v<=100 ? v : 0; }
function safeKey(v) { return typeof v === "string" && /^[A-Za-z0-9_-]{1,45}$/.test(v) ? v : "unknown"; }
function rows(value, f) { return Array.isArray(value) ? value.slice(0,100).map(f) : []; }

function aggregateOnly(report, from, to) {
  const kpis = {};
  for (const k of COUNTS.concat(MONEY)) kpis[k] = safeCount(report.kpis?.[k]);
  for (const k of RATES) kpis[k] = safeRate(report.kpis?.[k]);
  return {
    reportType:"marketing_analytics", schemaVersion:1, timezone:"Asia/Riyadh",
    currency:"SAR", moneyUnit:"halala", range:{from,to,days:dayCount(from,to)},
    filters:{promoCode:"",fulfillmentMethod:"all",paymentProvider:"all",daysCount:null,grams:null,mealsPerDay:null},
    kpis,
    promoPerformance: rows(report.promoPerformance,r=>({
      code:safeKey(r.code),attempts:safeCount(r.attempts),consumed:safeCount(r.consumed),
      reserved:safeCount(r.reserved),cancelled:safeCount(r.cancelled),paidCount:safeCount(r.paidCount),
      discountHalala:safeCount(r.discountHalala),revenueHalala:safeCount(r.revenueHalala),
      conversionRate:safeRate(r.conversionRate)
    })),
    planPerformance: rows(report.planPerformance,r=>({
      daysCount:safeCount(r.daysCount),grams:safeCount(r.grams),mealsPerDay:safeCount(r.mealsPerDay),
      paidTransactions:safeCount(r.paidTransactions),customersCount:safeCount(r.customersCount),
      revenueHalala:safeCount(r.revenueHalala),discountHalala:safeCount(r.discountHalala)
    })),
    sourceChannels: rows(report.sourceChannels,r=>({
      key:safeKey(r.key),count:safeCount(r.count),customersCount:safeCount(r.customersCount),
      amountHalala:safeCount(r.amountHalala)
    })),
    fulfillmentPerformance: rows(report.fulfillmentPerformance,r=>({
      key:safeKey(r.key),paidTransactions:safeCount(r.paidTransactions),
      customersCount:safeCount(r.customersCount),revenueHalala:safeCount(r.revenueHalala)
    })),
    paymentProviders: rows(report.paymentProviders,r=>({
      key:safeKey(r.key),paidTransactions:safeCount(r.paidTransactions),
      customersCount:safeCount(r.customersCount),revenueHalala:safeCount(r.revenueHalala)
    })),
    daily: rows(report.daily,r=>({
      date:dateValid(r.date)?r.date:(dateValid(r.key)?r.key:""),
      registrations:safeCount(r.registrations),checkouts:safeCount(r.checkouts),
      paidTransactions:safeCount(r.paidTransactions),revenueHalala:safeCount(r.revenueHalala)
    })),
    generatedAt:report.generatedAt || new Date().toISOString(),
    notes:["Server aggregates only; no installs/first_open.","No campaign/creative attribution or CAC/ROAS.",
           "App checkout KPIs and all-source revenues have different coverage."]
  };
}

router.get("/commercial-report", marketingAgentAuth, async (req,res,next)=>{
  const {from,to}=req.query;
  if (!dateValid(from) || !dateValid(to) || from>to || ![30,60,90].includes(dayCount(from,to))) {
    return res.status(400).json({status:false,error:{code:"INVALID_RANGE"}});
  }
  try {
    const result = await buildMarketingAnalyticsReport({from,to,comparePrevious:false});
    res.set("Cache-Control","no-store");
    return res.status(200).json({status:true,data:aggregateOnly(result,from,to)});
  } catch (err) { return next(err); }
});
// The agent sees the same de-identified aggregates as the admin report.
router.get("/landing-report", marketingAgentAuth, async (req,res,next)=>{
  const {from,to}=req.query;
  if (!dateValid(from) || !dateValid(to) || from>to || dayCount(from,to)>90) {
    return res.status(400).json({status:false,error:{code:"INVALID_RANGE"}});
  }
  try {
    const {buildLandingAnalyticsReport}=require("../services/landingAnalyticsService");
    const data=await buildLandingAnalyticsReport({from,to});
    res.set("Cache-Control","no-store");
    return res.json({status:true,data});
  } catch(err) {return next(err);}
});
module.exports={router,aggregateOnly,dateValid,dayCount};
