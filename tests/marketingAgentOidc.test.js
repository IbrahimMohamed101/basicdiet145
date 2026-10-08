"use strict";
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const {verifyMarketingOidc,AUDIENCE,WORKFLOW_REF}=require("../src/middleware/marketingAgentOidc");
const {aggregateOnly,dateValid,dayCount}=require("../src/routes/marketingAgent");
const pair=crypto.generateKeyPairSync("rsa",{modulusLength:2048});
const pub={...pair.publicKey.export({format:"jwk"}),kid:"k1",use:"sig",alg:"RS256"};
const now=1791475200;
const claims={iss:"https://token.actions.githubusercontent.com",aud:AUDIENCE,
  repository:"IbrahimMohamed101/basicdiet-marketing-os",repository_id:"1410360280",
  repository_owner_id:"108367693",repository_visibility:"private",
  ref:"refs/heads/main",ref_type:"branch",workflow_ref:WORKFLOW_REF,
  event_name:"workflow_dispatch",sub:"repo:IbrahimMohamed101@108367693/basicdiet-marketing-os@1410360280:ref:refs/heads/main",
  nbf:now-30,iat:now-30,exp:now+300,run_id:"22"};
function token(changes={},key=pair.privateKey) {
  const h=Buffer.from(JSON.stringify({alg:"RS256",typ:"JWT",kid:"k1"})).toString("base64url");
  const b=Buffer.from(JSON.stringify({...claims,...changes})).toString("base64url");
  const body=h+"."+b;
  return body+"."+crypto.sign("RSA-SHA256",Buffer.from(body),key).toString("base64url");
}
(async()=>{
  assert.equal(dateValid("2026-10-07"),true);
  assert.equal(dateValid("2026-02-30"),false);
  assert.equal(dayCount("2026-09-08","2026-10-07"),30);
  assert.equal((await verifyMarketingOidc(token(),{nowMs:now*1000,keysOverride:[pub]})).repository_id,"1410360280");
  for(const changes of [
    {repository:"bad/repo"},{repository_id:"9"},{repository_visibility:"public"},
    {ref:"refs/heads/test"},{workflow_ref:"other"},{aud:"wrong"},
    {event_name:"pull_request"},{exp:now-1},{nbf:now+50},{iat:now-900},
    {sub:"wrong"},{repository_owner_id:"1"},{iss:"https://evil.example"}
  ])await assert.rejects(verifyMarketingOidc(token(changes),{nowMs:now*1000,keysOverride:[pub]}));
  const other=crypto.generateKeyPairSync("rsa",{modulusLength:2048});
  await assert.rejects(verifyMarketingOidc(token({},other.privateKey),{nowMs:now*1000,keysOverride:[pub]}));
  await assert.rejects(verifyMarketingOidc("not-a-token",{nowMs:now*1000,keysOverride:[pub]}));
  const kpis={};
  for(const k of ["registrations","loggedInUsers","checkoutStarted","checkoutUsers","pendingCheckouts",
    "abandonedCheckouts","failedPayments","paidTransactions","paidCustomers","firstTimeSubscribers",
    "repeatSubscribers","newRegistrationsPaid","cancellations","appRevenueHalala","totalSubscriptionRevenueHalala","aovHalala"])kpis[k]=2;
  for(const k of ["registerToPaidRate","checkoutToPaidRate","repeatCustomerRate"])kpis[k]=20;
  const result=aggregateOnly({
    kpis,sensitiveRecords:[{phone:"NEVER_EXPORT",name:"PRIVATE_NAME"}],
    promoPerformance:[{code:"KSA96",paidCount:2,revenueHalala:200,customers:[{phone:"PRIVATE"}]}],
    planPerformance:[{daysCount:26,grams:150,mealsPerDay:2,paidTransactions:2,customersCount:2,revenueHalala:10000}],
    sourceChannels:[{key:"app",amountHalala:10000,privateSecret:"HIDDEN"}]
  },"2026-09-08","2026-10-07");
  assert.equal(result.range.days,30);
  assert.equal(result.kpis.firstTimeSubscribers,2);
  assert.equal(result.promoPerformance[0].code,"KSA96");
  const serialized=JSON.stringify(result);
  for(const privateText of ["NEVER_EXPORT","PRIVATE_NAME","HIDDEN","sensitiveRecords",'"customers"'])assert(!serialized.includes(privateText));
  console.log("marketingAgentOidc.test.js: PASS");
})().catch(err=>{console.error(err);process.exitCode=1});
