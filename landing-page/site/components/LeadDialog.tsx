"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { StoreLinks } from "./StoreLinks";

import { normalizeSaudiPhone as normalizePhone } from "@/lib/saudi-phone";
import { SITE_OFFER_CTA, SITE_OFFER_TERMS } from "@/lib/site-offer";

type GramOption = { grams: number; mealsPerDay: number[] };
type PlanOption = { planId: string; daysCount: number; gramsOptions: GramOption[] };
type OpenEvent = CustomEvent<{
  location?: string;
  planDays?: number;
  grams?: number;
  mealsPerDay?: number;
  fulfillmentMethod?: "delivery" | "pickup";
  fastContact?: boolean;
  sourceDetail?: string;
  promoIntent?: string;
  planOptional?: boolean;
  name?: string;
  phone?: string;
}>;

const ATTRIBUTION_KEY = "basicdiet_lp_attribution_v1";
const SESSION_KEY = "basicdiet_lp_session_v1";
const PRIVACY_URL = "/privacy";


export function LeadDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const requestId = useRef("");
  const loadId = useRef(0);
  const submitting = useRef(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [planId, setPlanId] = useState("");
  const [grams, setGrams] = useState(150);
  const [mealsPerDay, setMealsPerDay] = useState(2);
  const [location, setLocation] = useState("hero");
  const [fastContact, setFastContact] = useState(false);
  const [promoMode, setPromoMode] = useState(false);
  const [needsPlanAssistance, setNeedsPlanAssistance] = useState(false);
  const [sourceDetail, setSourceDetail] = useState("");
  const [fulfillmentMethod, setFulfillmentMethod] = useState<"delivery" | "pickup">("delivery");
  const [selectionNotice, setSelectionNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [contactConsent, setContactConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [active, setActive] = useState(false);

  const selected = plans.find(p => p.planId === planId);
  const selectedGram = selected?.gramsOptions.find(g => g.grams === grams);
  const days = selected?.daysCount || 26;
  const isMenuPreview = process.env.NEXT_PUBLIC_MENU_PREVIEW_MODE === "true";

  useEffect(() => {
    let cancelled = false;
    const open = (evt: Event) => {
      const details = (evt as OpenEvent).detail || {};
      const currentLoad = ++loadId.current;
      setSending(false); setStep(1); setError(""); setPhone(details.phone?.slice(0, 32) || ""); setName(details.name?.slice(0, 70) || ""); setSelectionNotice("");
      setFastContact(details.fastContact === true);
      setPromoMode(details.promoIntent === "BASIC15" || (details.sourceDetail || "").includes("basic15"));
      setNeedsPlanAssistance(!details.planDays && (details.planOptional === true || details.fastContact === true));
      setSourceDetail((details.sourceDetail || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40));
      setContactConsent(false); setMarketingConsent(false); setWebsite("");
      const noPlan = !details.planDays && (details.planOptional === true || details.fastContact === true);
      setLocation(details.location || "hero"); setLoading(!noPlan); setPlans([]);
      submitting.current = false;
      setFulfillmentMethod(details.fulfillmentMethod === "pickup" ? "pickup" : "delivery");
      requestId.current = crypto.randomUUID();
      if (!dialog.current?.open) dialog.current?.showModal();
      setActive(true);
      window.dispatchEvent(new CustomEvent("basicdiet:lead_opened", {
        detail: { location: details.location || "hero", offer: details.promoIntent === "BASIC15" || (details.sourceDetail || "").includes("basic15"),
          noPlan, planDays: noPlan ? null : details.planDays, placement: (details.sourceDetail || "").slice(0, 40) },
      }));
      if (noPlan) { setPlanId(""); setStep(2); return; }
      if (details.fastContact === true) setStep(2);
      void fetch("/api/lead-options", { cache: "no-store" })
        .then(res => { if (!res.ok) throw new Error("catalog"); return res.json(); })
        .then((result: { data?: PlanOption[] }) => {
          if (cancelled || currentLoad !== loadId.current || !dialog.current?.open) return;
          const options = Array.isArray(result.data) ? result.data : [];
          const desired = options.find(p => p.daysCount === details.planDays)
            || options.find(p => p.daysCount === 26) || options[0];
          setPlans(options);
          setPlanId(desired?.planId || "");
          const choice = desired?.gramsOptions.find(g => g.grams === details.grams)
            || desired?.gramsOptions.find(g => g.grams === 150)
            || desired?.gramsOptions[0];
          const chosenMeals = details.mealsPerDay && choice?.mealsPerDay.includes(details.mealsPerDay)
            ? details.mealsPerDay
            : choice?.mealsPerDay.includes(2) ? 2 : choice?.mealsPerDay[0] || 1;
          setGrams(choice?.grams || 150);
          setMealsPerDay(chosenMeals);
          if (desired && ((details.grams && details.grams !== choice?.grams)
            || (details.mealsPerDay && details.mealsPerDay !== chosenMeals))) {
            setSelectionNotice("بعض اختياراتك غير متاحة في الباقة الحالية، فعدّلناها لأقرب خيار متاح.");
          }
          if (details.fastContact !== true && desired && choice) setStep(1);
          setLoading(false);
        })
        .catch(() => { if (!cancelled && currentLoad === loadId.current) { setError("تعذر تحميل الباقات الآن. تقدر تبدأ مباشرة من التطبيق."); setLoading(false); } });
    };
    window.addEventListener("basicdiet:open-lead", open);
    return () => { cancelled = true; window.removeEventListener("basicdiet:open-lead", open); };
  }, []);

  const close = () => {
    loadId.current += 1;
    dialog.current?.close();
    submitting.current = false;
    setActive(false);
  };

  function choosePlan(id: string) {
    const p = plans.find(item => item.planId === id);
    if (!p) return;
    const choice = p.gramsOptions.find(g => g.grams === 150) || p.gramsOptions[0];
    setPlanId(id);
    setGrams(choice?.grams || 150);
    setMealsPerDay(choice?.mealsPerDay.includes(2) ? 2 : choice?.mealsPerDay[0] || 1);
    setError("");
  }

  function chooseGram(value: number) {
    const option = selected?.gramsOptions.find(g => g.grams === value);
    if (!option) return;
    setGrams(value);
    if (!option.mealsPerDay.includes(mealsPerDay)) setMealsPerDay(option.mealsPerDay[0] || 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || sending || step === 3) return;
    if (!needsPlanAssistance && (!selected || !selectedGram || !selectedGram.mealsPerDay.includes(mealsPerDay))) {
      setError("اختر باقة متاحة أولًا."); return;
    }
    const normalized = normalizePhone(phone);
    if (!normalized) { setError("اكتب رقم جوال سعودي صحيح، مثل 05xxxxxxxx."); return; }
    if (isMenuPreview) { setError("هذه نسخة معاينة للتصميم فقط، إرسال بيانات التواصل فيها غير مفعّل."); return; }
    if (fastContact && name.trim().length < 2) { setError("اكتب اسمك عشان نقدر نتواصل معك."); return; }
    if (!contactConsent) { setError("لازم توافق على التواصل معك بشأن طلبك."); return; }
    submitting.current = true;
    const submissionLoad = loadId.current;
    setError(""); setSending(true);
    let attribution: Record<string, string> = {};
    let sessionId = "";
    try {
      attribution = JSON.parse(sessionStorage.getItem(ATTRIBUTION_KEY) || "{}");
      sessionId = sessionStorage.getItem(SESSION_KEY) || "";
    } catch { /* disabled storage */ }
    let referrerHost = "";
    try { if (document.referrer) referrerHost = new URL(document.referrer).hostname; } catch { /* no referrer */ }
    try {
      const response = await fetch("/api/leads", {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: requestId.current,
          ...(needsPlanAssistance ? { planUnselected: true } : {
            planId: selected?.planId, daysCount: selected?.daysCount, grams, mealsPerDay,
            fulfillmentMethod,
          }),
          phone: normalized, name: name.trim().slice(0, 70),
          contactConsent, marketingConsent, location, sessionId, referrerHost, website,
          source: attribution.source || "",
          medium: attribution.medium || "",
          campaign: attribution.campaign || "",
          content: [attribution.content?.slice(0, 40) || "", sourceDetail, promoMode ? "offer15" : "",
            needsPlanAssistance ? "plan_to_confirm" : ""].filter(Boolean).join("|").slice(0, 100),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (submissionLoad !== loadId.current) return;
      if (response.status !== 202) {
        if (data.code === "PLAN_UNAVAILABLE" || data.code === "OPTION_UNAVAILABLE") {
          setError("الباقة اتغيرت. اقفل النافذة وافتحها تاني لاختيار الباقة المتاحة.");
        } else if (response.status === 429) {
          setError("في محاولات كتير حاليًا. حاول بعد شوية.");
        } else if (data.code === "INVALID_REQUEST") {
          setError("راجع البيانات وجرب تاني.");
        } else {
          setError("حصلت مشكلة أثناء إرسال الطلب. جرّب تاني أو حمّل التطبيق مباشرة.");
        }
        return;
      }
      setStep(3);
      window.dispatchEvent(new CustomEvent("basicdiet:lead_submitted", {
        detail: { requestId: requestId.current, location, planDays: needsPlanAssistance ? null : selected?.daysCount, planSelected: !needsPlanAssistance, offer: promoMode, placement: sourceDetail },
      }));
    } catch {
      if (submissionLoad !== loadId.current) return;
      setError("تعذر إرسال الطلب بسبب الاتصال. جرب تاني.");
    } finally {
      if (submissionLoad === loadId.current) {
        submitting.current = false;
        setSending(false);
      }
    }
  }

  return (
    <dialog
      ref={dialog}
      className="lead-dialog"
      dir="rtl"
      aria-labelledby="lead-dialog-heading"
      onClick={event => { if (event.target === event.currentTarget) close(); }}
      onCancel={event => { event.preventDefault(); close(); }}
      onClose={() => setActive(false)}
    >
      {active && (
        <div className="lead-sheet">
          <div className="lead-sheet-top">
            <span className="lead-sheet-kicker">Basic Diet <span aria-hidden="true">•</span> {promoMode ? "ميزة التسجيل من الموقع" : "اختيارك يبدأ هنا"}</span>
            <button type="button" className="lead-close" onClick={close} aria-label="إغلاق النافذة">×</button>
          </div>
          {step < 3 ? (
            <>
              <div className={"lead-step-head" + (promoMode ? " lead-step-head--offer" : "")}>
                <span className="lead-step-count">{promoMode && step === 2 ? "تسجيل سريع · بدون دفع الآن" : `${step} / 2`}</span>
                <h2 id="lead-dialog-heading">{promoMode ? "خصم 15% على اشتراكك" : step === 1 ? "خلّنا نضبط اشتراكك" : "باقي خطوة ونساعدك تبدأ"}</h2>
                <p>{promoMode ? "اسمك وجوالك فقط. فريقنا يتواصل معك ويشرح الباقات وخصم الموقع." : step === 1 ? "اختَر اللي يناسب يومك، والتفاصيل نكملها معك." : "بنستخدم رقمك للتواصل معك بشأن الباقة اللي اخترتها."}</p>
              </div>
              {!promoMode && <div className="lead-step-line"><span style={{ width: step === 1 ? "50%" : "100%" }} /></div>}
              {step === 1 ? (
                <div className="lead-fields">
                  {loading ? <p className="lead-state-message" role="status">جاري تحميل الباقات المتاحة...</p> : (
                    <>
                      {plans.length ? (
                        <>
                          <span className="lead-field-label" id="lead-plan-label">مدة الباقة</span>
                          <div className="lead-duration-list" role="group" aria-labelledby="lead-plan-label">
                            {plans.map(p => (
                              <button key={p.planId} type="button"
                                className={"lead-duration" + (planId === p.planId ? " is-selected" : "")}
                                aria-pressed={planId === p.planId}
                                onClick={() => choosePlan(p.planId)}>
                                <b>{p.daysCount}</b><small>يوم</small>
                              </button>
                            ))}
                          </div>
                          <div className="lead-select-row">
                            <label className="lead-field">
                              <span>حجم الوجبة</span>
                              <select value={grams} onChange={e => chooseGram(Number(e.target.value))}>
                                {selected?.gramsOptions.map(g => <option key={g.grams} value={g.grams}>{g.grams} جرام</option>)}
                              </select>
                            </label>
                            <label className="lead-field">
                              <span>وجبات يوميًا</span>
                              <select value={mealsPerDay} onChange={e => setMealsPerDay(Number(e.target.value))}>
                                {selectedGram?.mealsPerDay.map(n => <option key={n} value={n}>{n} {n === 1 ? "وجبة" : "وجبات"}</option>)}
                              </select>
                            </label>
                          </div>
                          <div className="lead-fulfillment">
                            <span className="lead-field-label">طريقة الاستلام المفضلة</span>
                            <div className="lead-fulfillment-options" role="group" aria-label="طريقة الاستلام المفضلة">
                              <button type="button" aria-pressed={fulfillmentMethod === "delivery"}
                                className={fulfillmentMethod === "delivery" ? "is-selected" : ""}
                                onClick={() => setFulfillmentMethod("delivery")}>توصيل</button>
                              <button type="button" aria-pressed={fulfillmentMethod === "pickup"}
                                className={fulfillmentMethod === "pickup" ? "is-selected" : ""}
                                onClick={() => setFulfillmentMethod("pickup")}>استلام</button>
                            </div>
                          </div>
                          {selectionNotice && <p className="lead-small-note" role="status">{selectionNotice}</p>}
                          <p className="lead-small-note">الأسعار وطريقة الاستلام النهائية يؤكدها فريقنا.</p>
                        </>
                      ) : <p role="status" className="lead-state-message">الباقات مش متاحة للعرض دلوقتي. تقدر تبدأ من التطبيق مباشرة.</p>}
                    </>
                  )}
                  {error && <p className="lead-error" role="alert">{error}</p>}
                  {plans.length > 0 && (
                    <button className="lead-primary" type="button" onClick={() => { setError(""); setStep(2); }}>
                      متابعة <span aria-hidden="true">←</span>
                    </button>
                  )}
                </div>
              ) : (
                <form className="lead-form" onSubmit={submit}>
                  <div className="lead-form-scroll lead-fields">
                  <div className="lead-selection-summary">
                    <span>{needsPlanAssistance ? "اختيار الباقة" : "باقتك المختارة"}</span>
                    {needsPlanAssistance ? <strong>لم تحدد باقة · نساعدك تختار بعد التسجيل.</strong> :
                      <strong>{days} يوم · {grams} جرام · {mealsPerDay} {mealsPerDay === 1 ? "وجبة" : "وجبات"} يوميًا · {fulfillmentMethod === "delivery" ? "توصيل" : "استلام"}</strong>}
                  </div>
                  <label className="lead-field">
                    <span>اسمك {fastContact ? <em>(مطلوب)</em> : <em>(اختياري)</em>}</span>
                    <input required={fastContact} minLength={fastContact ? 2 : undefined} value={name} maxLength={70} onChange={e => setName(e.target.value)} placeholder="الاسم" autoComplete="name"/>
                  </label>
                  <label className="lead-field">
                    <span>رقم الجوال</span>
                    <input required value={phone} maxLength={32} inputMode="tel" type="tel" dir="ltr"
                      onChange={e => setPhone(e.target.value)} placeholder="05xxxxxxxx" autoComplete="tel-national"/>
                  </label>
                  <label className="lead-honeypot" aria-hidden="true">
                    اترك هذا الحقل فارغًا
                    <input value={website} tabIndex={-1} autoComplete="off" onChange={e => setWebsite(e.target.value)} />
                  </label>
                  <label className="lead-check">
                    <input type="checkbox" checked={contactConsent} onChange={e => setContactConsent(e.target.checked)} required />
                    <span>أوافق على التواصل معي بخصوص المنيو وطلب الاشتراك فقط. <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">سياسة الخصوصية</a></span>
                  </label>
                  {!promoMode && <label className="lead-check lead-check--muted">
                    <input type="checkbox" checked={marketingConsent} onChange={e => setMarketingConsent(e.target.checked)}/>
                    <span>أرغب في تلقي عروض مستقبلية (اختياري).</span>
                  </label>}
                  {promoMode && <p className="lead-offer-disclaimer">{SITE_OFFER_TERMS}</p>}
                  {isMenuPreview && <p className="lead-small-note" role="status">هذه نسخة معاينة فقط؛ إرسال بيانات التواصل غير مفعّل هنا. التسجيل الفعلي متاح عبر الموقع الرسمي.</p>}
                  {error && <p className="lead-error" role="alert">{error}</p>}
                  {!loading && !selected && !needsPlanAssistance && <button className="lead-back" type="button" onClick={() => { setNeedsPlanAssistance(true); setPlanId(""); setError(""); }}>متابعة بدون تحديد باقة</button>}
                  </div>
                  <div className="lead-form-actions">
                  <button className="lead-primary" type="submit" disabled={isMenuPreview || sending || !contactConsent || !normalizePhone(phone) || (fastContact && name.trim().length < 2) || (!needsPlanAssistance && !selected)}>
                    {sending ? "جاري إرسال طلبك..." : promoMode ? SITE_OFFER_CTA : "اطلب تواصل من Basic Diet"}
                  </button>
                  {!needsPlanAssistance && <button className="lead-back" type="button" onClick={() => { setSending(false); setStep(1); setError(""); }} disabled={sending}>تعديل الاختيارات</button>}
                  </div>
                </form>
              )}
              {!promoMode && <div className="lead-direct">تفضل تبدأ بنفسك؟ <button type="button" onClick={() => { close(); (document.getElementById("menu-download") || document.getElementById("app"))?.scrollIntoView({ behavior: "smooth" }); }}>روابط تحميل التطبيق</button></div>}
            </>
          ) : (
            <div className="lead-success">
              <div className="lead-success-mark" aria-hidden="true">✓</div>
              <h2 id="lead-dialog-heading">وصلنا طلبك!</h2>
              <p>{promoMode ? "وصلتنا بياناتك وطلب الاستفادة من خصم 15%. فريقنا يتواصل معك لاختيار الباقة وتأكيد العرض قبل إتمام الاشتراك." : "وصلنا طلب التواصل. فريقنا يتواصل معك لمراجعة باقتك وإكمال التفاصيل."}</p>
              <div className="lead-success-stores"><StoreLinks location="app" /></div>
              <button type="button" className="lead-back" onClick={close}>رجوع للموقع</button>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
