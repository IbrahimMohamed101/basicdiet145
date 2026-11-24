import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const urls = { baseline: process.argv[2], candidate: process.argv[3] };
if (!urls.baseline || !urls.candidate) throw new Error("Usage: node scripts/compare-conversion-performance.mjs BASE CANDIDATE");
const browser = await chromium.launch();
const catalog = { data:[{planId:"fixture",daysCount:26,gramsOptions:[{grams:150,mealsOptions:[{mealsPerDay:2,priceSar:1186}]}]}] };
async function sample(url, label, index) {
  const context = await browser.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, locale:"ar-SA", deviceScaleFactor:2 });
  const page = await context.newPage();
  try {
    await page.route("**/api/plan-catalog", route => route.fulfill({json:catalog}));
    await page.route("**/api/analytics", route => route.fulfill({status:202,json:{status:true}}));
    await page.addInitScript(() => {
      window.__conversionPerf = { lcp:null, interactions:[] };
      try { new PerformanceObserver(list => { for (const e of list.getEntries()) window.__conversionPerf.lcp=e.startTime; })
        .observe({type:"largest-contentful-paint",buffered:true}); } catch {}
      try { new PerformanceObserver(list => { for (const e of list.getEntries()) if(e.interactionId) window.__conversionPerf.interactions.push({id:e.interactionId,duration:e.duration}); })
        .observe({type:"event",buffered:true,durationThreshold:16}); } catch {}
    });
    const cdp=await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled",{cacheDisabled:true});
    await cdp.send("Network.emulateNetworkConditions",{offline:false,latency:150,downloadThroughput:210000,uploadThroughput:100000});
    await cdp.send("Emulation.setCPUThrottlingRate",{rate:4});
    await page.goto(url,{waitUntil:"domcontentloaded"});
    await page.waitForTimeout(5000);
    const initial=await page.evaluate(() => ({
      lcpMs:window.__conversionPerf.lcp,
      initialJsTransferBytes:performance.getEntriesByType("resource").filter(e=>{const u=new URL(e.name); return u.origin===location.origin && u.pathname.endsWith(".js");}).reduce((n,e)=>n+e.transferSize,0),
      initialJsResourceCount:performance.getEntriesByType("resource").filter(e=>{const u=new URL(e.name); return u.origin===location.origin && u.pathname.endsWith(".js");}).length,
      calculatorLoaded:!!document.querySelector("#plans fieldset")
    }));
    await page.locator('.hero-cinema-actions a[href="#plans"]').click();
    await page.locator("#plans fieldset").first().waitFor({state:"visible"});
    const pickup=page.locator("#plans fieldset").last().getByRole("button",{name:"استلام"});
    await pickup.click();
    await page.waitForTimeout(750);
    const after=await page.evaluate(() => {
      const byId=new Map();
      for(const e of window.__conversionPerf.interactions) byId.set(e.id, Math.max(byId.get(e.id)||0,e.duration));
      return { labMaxInteractionMs:byId.size?Math.max(...byId.values()):null, interactionSamples:byId.size };
    });
    if(index===0) await page.screenshot({path:"artifacts/performance-"+label+".png",animations:"disabled"});
    return {...initial,...after};
  } finally { await context.close(); }
}
const results={baseline:[],candidate:[]};
try {
  await mkdir("artifacts",{recursive:true});
  // Alternate builds on the same runner to reduce drift. This is synthetic lab
  // Event Timing, not field INP (null means no qualifying observation).
  for(let i=0;i<3;i++) for(const label of ["baseline","candidate"]) results[label].push(await sample(urls[label],label,i));
  const median=(list)=>{const ns=list.filter(Number.isFinite).sort((a,b)=>a-b);return ns.length?ns[Math.floor(ns.length/2)]:null;};
  const summary=Object.fromEntries(Object.entries(results).map(([label,rows])=>[label,{
    lcpMs:median(rows.map(r=>r.lcpMs)),initialJsTransferBytes:median(rows.map(r=>r.initialJsTransferBytes)),
    labMaxInteractionMs:median(rows.map(r=>r.labMaxInteractionMs)),samples:rows
  }]));
  await writeFile("artifacts/conversion-performance.json",JSON.stringify(summary,null,2));
  console.log("CONVERSION_PERFORMANCE "+JSON.stringify(summary));
  if(Object.values(results).flat().some(r=>!(r.initialJsTransferBytes>0) || !(r.initialJsResourceCount>0) || !(r.lcpMs>0))) throw new Error("Invalid performance sample: missing positive JavaScript transfer, resource count, or LCP");
  if(results.candidate.some(r=>r.calculatorLoaded)) throw new Error("Calculator eager-loaded before interaction");
  if(summary.baseline.initialJsTransferBytes===null || summary.candidate.initialJsTransferBytes===null || summary.baseline.lcpMs===null || summary.candidate.lcpMs===null) throw new Error("Missing comparable measurements");
  // Lab budget, not a claim about field Core Web Vitals.
  if(summary.candidate.lcpMs>2500 || summary.candidate.lcpMs>summary.baseline.lcpMs+Math.max(250,summary.baseline.lcpMs*.20)) throw new Error("Mobile lab LCP budget exceeded");
  // Record, do not hide performance changes. A 10% or 20KiB tolerance
  // catches material initial-JS regression without treating normal lab noise as proof.
  if(summary.candidate.initialJsTransferBytes>summary.baseline.initialJsTransferBytes+Math.max(20480,summary.baseline.initialJsTransferBytes*.10)) throw new Error("Initial JS transfer regression");
} finally { await browser.close(); }
