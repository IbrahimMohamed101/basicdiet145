"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ANDROID_APP_URL, IOS_APP_URL } from "@/lib/app-links";

type MealPrice = { mealsPerDay: number; priceSar: number };
type GramOption = { grams: number; mealsOptions: MealPrice[] };
type Plan = { planId: string; daysCount: number; gramsOptions: GramOption[] };
type Choice = { days: number; grams: number; meals: number; fulfillment: "delivery" | "pickup" };
const KEY = "basicdiet_plan_choice_v2";
const initial: Choice = { days: 26, grams: 150, meals: 2, fulfillment: "delivery" };
const number = new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 2 });

function readChoice(): Choice | null {
  try {
    const url = new URL(window.location.href);
    const saved = JSON.parse(sessionStorage.getItem(KEY) || "null") as Partial<Choice> | null;
    const days = Number(url.searchParams.get("days") || saved?.days || initial.days);
    const grams = Number(url.searchParams.get("grams") || saved?.grams || initial.grams);
    const meals = Number(url.searchParams.get("meals") || saved?.meals || initial.meals);
    const fulfillment = url.searchParams.get("fulfillment") || saved?.fulfillment || initial.fulfillment;
    if (![7, 26, 30].includes(days) || ![100, 150, 200].includes(grams) || ![1, 2, 3, 4, 5].includes(meals)) return null;
    return { days, grams, meals, fulfillment: fulfillment === "pickup" ? "pickup" : "delivery" };
  } catch { return null; }
}

export function PlanCalculator({ sectionId = "plans", context = "home" }: {
  sectionId?: string;
  context?: "home" | "menu";
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const [choice, setChoice] = useState<Choice>(initial);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [bottomBar, setBottomBar] = useState(false);

  useEffect(() => {
    const recovered = readChoice();
    if (recovered) setChoice(recovered);
    let cancelled = false;
    void fetch("/api/plan-catalog", { cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("unavailable");
        const json = await response.json() as { data?: Plan[] };
        if (!Array.isArray(json.data) || !json.data.length) throw new Error("empty");
        if (!cancelled) { setPlans(json.data); setStatus("ready"); }
      }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem(KEY, JSON.stringify(choice)); } catch { /* storage disabled */ }
  }, [choice]);

  useEffect(() => {
    const update = () => {
      const rect = sectionRef.current?.getBoundingClientRect();
      setBottomBar(Boolean(rect && rect.top < 100 && rect.bottom > window.innerHeight + 30));
    };
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, []);

  const selectedPlan = useMemo(() =>
    plans.find(plan => plan.daysCount === choice.days) || plans.find(plan => plan.daysCount === 26) || plans[0],
  [plans, choice.days]);
  const selectedGram = selectedPlan?.gramsOptions.find(item => item.grams === choice.grams);
  const selectedMeal = selectedGram?.mealsOptions.find(item => item.mealsPerDay === choice.meals);
  const matched = Boolean(selectedPlan?.daysCount === choice.days && selectedGram && selectedMeal);
  const price = matched ? selectedMeal?.priceSar : null;
  const availableGrams = selectedPlan?.gramsOptions.map(item => item.grams) || [];
  const availableMeals = selectedGram?.mealsOptions.map(item => item.mealsPerDay) || [];
  const allDays = [...new Set(plans.map(plan => plan.daysCount))];

  function selectDays(days: number) {
    const candidate = plans.find(plan => plan.daysCount === days);
    const grams = candidate?.gramsOptions.find(option => option.grams === choice.grams)?.grams
      || candidate?.gramsOptions.find(option => option.grams === 150)?.grams || candidate?.gramsOptions[0]?.grams || choice.grams;
    const gram = candidate?.gramsOptions.find(option => option.grams === grams);
    const meals = gram?.mealsOptions.find(option => option.mealsPerDay === choice.meals)?.mealsPerDay
      || gram?.mealsOptions.find(option => option.mealsPerDay === 2)?.mealsPerDay || gram?.mealsOptions[0]?.mealsPerDay || choice.meals;
    setChoice(prev => ({ ...prev, days, grams, meals }));
  }
  function selectGrams(grams: number) {
    const gram = selectedPlan?.gramsOptions.find(option => option.grams === grams);
    const meals = gram?.mealsOptions.find(option => option.mealsPerDay === choice.meals)?.mealsPerDay
      || gram?.mealsOptions.find(option => option.mealsPerDay === 2)?.mealsPerDay || gram?.mealsOptions[0]?.mealsPerDay || choice.meals;
    setChoice(prev => ({ ...prev, grams, meals }));
  }
  function contact() {
    if (!matched || !price) return;
    const detail = {
      location: "plans", planDays: choice.days, grams: choice.grams,
      mealsPerDay: choice.meals, fulfillmentMethod: choice.fulfillment,
      sourceDetail: context === "menu" ? "menu_plan_selected" : "home_plan_selected",
      fastContact: true,
    };
    window.dispatchEvent(new CustomEvent("basicdiet:cta", { detail: { location: "plans", planDays: choice.days, context } }));
    window.dispatchEvent(new CustomEvent("basicdiet:open-lead", { detail }));
  }

  const menuUrl = "/menu?days=" + choice.days + "&grams=" + choice.grams + "&meals=" + choice.meals
    + "&fulfillment=" + choice.fulfillment + "#menu-plans";
  const summary = price == null ? "السعر غير متاح" : number.format(price) + " ر.س";

  return (
    <section ref={sectionRef} className={"bd-calculator-section bd-calculator-" + context}
      id={sectionId} aria-labelledby={sectionId + "-heading"}>
      <div className="page-shell">
        <div className="bd-calculator-heading">
          <div>
            <p className="bd-calculator-eyebrow">باقات بيسك دايت / SUBSCRIPTIONS</p>
            <h2 id={sectionId + "-heading"}>احسب باقتك.<br /><span>واختار اللي يناسب يومك.</span></h2>
          </div>
          <p>اختَر المدة ووزن حصة البروتين وعدد الوجبات. هنوضح لك سعر الباقة الأساسي من الأسعار المتاحة، قبل أي إضافات أو خصومات.</p>
        </div>
        <div className="bd-calculator-layout">
          <div className="bd-calculator-controls">
            <fieldset>
              <legend>01 / مدة الاشتراك</legend>
              <div className="bd-calculator-durations">
                {[7, 26, 30].map(days => (
                  <button key={days} type="button" disabled={status !== "ready" || !allDays.includes(days)}
                    aria-pressed={choice.days === days} onClick={() => selectDays(days)}>
                    <b>{days}</b><span>يوم</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>02 / وزن حصة البروتين</legend>
              <div className="bd-calculator-options">
                {[100, 150, 200].map(grams => (
                  <button key={grams} type="button" disabled={status !== "ready" || !availableGrams.includes(grams)}
                    aria-pressed={choice.grams === grams} onClick={() => selectGrams(grams)}>{grams} جم</button>
                ))}
              </div>
              <p className="bd-calculator-hint">الوزن هنا لحصة البروتين في الوجبة، وليس كمية البروتين الغذائية بالجرام.</p>
            </fieldset>
            <fieldset>
              <legend>03 / عدد الوجبات يوميًا</legend>
              <div className="bd-calculator-options">
                {[1, 2, 3, 4, 5].map(meals => (
                  <button key={meals} type="button" disabled={status !== "ready" || !availableMeals.includes(meals)}
                    aria-pressed={choice.meals === meals} onClick={() => setChoice(prev => ({ ...prev, meals }))}>{meals}</button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>04 / الطريقة المفضلة</legend>
              <div className="bd-calculator-options">
                <button type="button" aria-pressed={choice.fulfillment === "delivery"} onClick={() => setChoice(prev => ({ ...prev, fulfillment: "delivery" }))}>توصيل</button>
                <button type="button" aria-pressed={choice.fulfillment === "pickup"} onClick={() => setChoice(prev => ({ ...prev, fulfillment: "pickup" }))}>استلام</button>
              </div>
            </fieldset>
          </div>
          <aside className="bd-calculator-summary" aria-label="ملخص الباقة">
            <span className="bd-calculator-caption">باقتك حسب اختياراتك</span>
            <strong className="bd-calculator-summary-title">{choice.days} يوم · {choice.grams} جم · {choice.meals} {choice.meals === 1 ? "وجبة" : "وجبات"}</strong>
            <p className="bd-calculator-price-label">سعر الباقة الأساسي</p>
            <div className="bd-calculator-price" aria-live="polite" aria-atomic="true">
              {status === "loading" ? "جارٍ تحميل الأسعار…" : status === "error" ? "تعذّر تحميل الأسعار" : summary}
            </div>
            <div className="bd-calculator-specs"><span>{choice.days * choice.meals} وجبة خلال الباقة</span><span>{choice.fulfillment === "delivery" ? "توصيل" : "استلام"}</span></div>
            <p className="bd-calculator-disclaimer">
              السعر المعروض للباقة الأساسية فقط؛ لا يشمل رسوم التوصيل أو الإضافات أو الخصومات. التأكيد النهائي عند إتمام الاشتراك.
              {status === "ready" && !matched && " هذا الاختيار غير متاح حاليًا، جرّب اختيارًا آخر."}
            </p>
            <button type="button" className="bd-calculator-primary" disabled={!matched || !price} onClick={contact}>
              خلّنا نساعدك بالاشتراك <span aria-hidden="true">←</span>
            </button>
            <div className="bd-calculator-secondary">
              <a href={IOS_APP_URL}>App Store</a>
              <a href={ANDROID_APP_URL}>Google Play</a>
              {context === "home" && <a href={menuUrl}>شوف اختياراتك في المنيو</a>}
            </div>
          </aside>
        </div>
      </div>
      {bottomBar && status === "ready" && matched && price != null && (
        <div className="bd-calculator-mobile-summary" role="region" aria-label="ملخص باقتك أثناء التخصيص">
          <div><small>باقتك · {choice.days} يوم</small><strong>{summary}</strong></div>
          <button type="button" onClick={contact}>طلب تواصل ←</button>
        </div>
      )}
    </section>
  );
}
