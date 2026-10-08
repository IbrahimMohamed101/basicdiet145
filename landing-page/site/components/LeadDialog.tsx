"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { StoreLinks } from "./StoreLinks";

type GramOption = { grams: number; mealsPerDay: number[] };
type PlanOption = { planId: string; daysCount: number; gramsOptions: GramOption[] };
type OpenEvent = CustomEvent<{
  location?: string;
  planDays?: number;
  grams?: number;
  mealsPerDay?: number;
  fulfillmentMethod?: "delivery" | "pickup";
}>;

const ATTRIBUTION_KEY = "basicdiet_lp_attribution_v1";
const SESSION_KEY = "basicdiet_lp_session_v1";
const PRIVACY_URL = "https://basicdiet145-production-51e9.up.railway.app/privacy-policy";

function normalizePhone(value: string) {
  let s = value.replace(/[\s()-]/g, "");
  if (s.startsWith("+966")) s = s.slice(4);
  else if (s.startsWith("966")) s = s.slice(3);
  else if (s.startsWith("0")) s = s.slice(1);
  return /^5\d{8}$/.test(s) ? "+966" + s : "";
}

export function LeadDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const requestId = useRef("");
  const loadId = useRef(0);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [planId, setPlanId] = useState("");
  const [grams, setGrams] = useState(150);
  const [mealsPerDay, setMealsPerDay] = useState(2);
  const [location, setLocation] = useState("hero");
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

  useEffect(() => {
    let cancelled = false;
    const open = (evt: Event) => {
      const details = (evt as OpenEvent).detail || {};
      const currentLoad = ++loadId.current;
      setStep(1); setError(""); setPhone(""); setName(""); setSelectionNotice("");
      setContactConsent(false); setMarketingConsent(false); setWebsite("");
      setLocation(details.location || "hero"); setLoading(true); setPlans([]);
      setFulfillmentMethod(details.fulfillmentMethod === "pickup" ? "pickup" : "delivery");
      requestId.current = crypto.randomUUID();
      if (!dialog.current?.open) dialog.current?.showModal();
      setActive(true);
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
    if (!selected || !selectedGram || !selectedGram.mealsPerDay.includes(mealsPerDay)) {
      setError("اختر باقة متاحة أولًا."); return;
    }
    const normalized = normalizePhone(phone);
    if (!normalized) { setError("اكتب رقم جوال سعودي صحيح، مثل 05xxxxxxxx."); return; }
    if (!contactConsent) { setError("لازم توافق على التواصل معك بشأن طلبك."); return; }
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
          planId: selected.planId, daysCount: selected.daysCount, grams, mealsPerDay,
          fulfillmentMethod,
          phone: normalized, name: name.trim().slice(0, 70),
          contactConsent, marketingConsent, location, sessionId, referrerHost, website,
          source: attribution.source || "",
          medium: attribution.medium || "",
          campaign: attribution.campaign || "",
          content: attribution.content || "",
        }),
      });
      const data = await response.json().catch(() => ({}));
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
        detail: { location, planDays: selected.daysCount },
      }));
    } catch {
      setError("تعذر إرسال الطلب بسبب الاتصال. جرب تاني.");
    } finally {
      setSending(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="lead-dialog"
      dir="rtl"
      aria-labelledby="lead-dialog-heading"
      onClick={event => { if (event.target === event.currentTarget) close(); }}
      onClose={() => setActive(false)}
    >
      {active && (
        <div className="lead-sheet">
          <div className="lead-sheet-top">
            <span className="lead-sheet-kicker">Basic Diet <span aria-hidden="true">•</span> اختيارك يبدأ هنا</span>
            <button type="button" className="lead-close" onClick={close} aria-label="إغلاق النافذة">×</button>
          </div>
          {step < 3 ? (
            <>
              <div className="lead-step-head">
                <span className="lead-step-count">{step} / 2</span>
                <h2 id="lead-dialog-heading">{step === 1 ? "خلّنا نضبط اشتراكك" : "باقي خطوة ونساعدك تبدأ"}</h2>
                <p>{step === 1 ? "اختَر اللي يناسب يومك، والتفاصيل نكملها معك." : "بنستخدم رقمك للتواصل معك بشأن الباقة اللي اخترتها."}</p>
              </div>
              <div className="lead-step-line"><span style={{ width: step === 1 ? "50%" : "100%" }} /></div>
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
                <form className="lead-fields" onSubmit={submit}>
                  <div className="lead-selection-summary">
                    <span>اختيارك</span>
                    <strong>{days} يوم · {grams} جرام · {mealsPerDay} {mealsPerDay === 1 ? "وجبة" : "وجبات"} يوميًا · {fulfillmentMethod === "delivery" ? "توصيل" : "استلام"}</strong>
                  </div>
                  <label className="lead-field">
                    <span>اسمك <em>(اختياري)</em></span>
                    <input value={name} maxLength={70} onChange={e => setName(e.target.value)} placeholder="الاسم" autoComplete="name"/>
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
                    <span>أوافق على التواصل معي بخصوص طلب الاشتراك فقط. <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">سياسة الخصوصية</a></span>
                  </label>
                  <label className="lead-check lead-check--muted">
                    <input type="checkbox" checked={marketingConsent} onChange={e => setMarketingConsent(e.target.checked)}/>
                    <span>أرغب في تلقي عروض مستقبلية (اختياري).</span>
                  </label>
                  {error && <p className="lead-error" role="alert">{error}</p>}
                  <button className="lead-primary" type="submit" disabled={sending || !contactConsent || !normalizePhone(phone)}>
                    {sending ? "جاري إرسال طلبك..." : "اطلب تواصل من Basic Diet"}
                  </button>
                  <button className="lead-back" type="button" onClick={() => { setStep(1); setError(""); }} disabled={sending}>تعديل الاختيارات</button>
                </form>
              )}
              <div className="lead-direct">تفضل تبدأ بنفسك؟ <button type="button" onClick={() => { close(); document.getElementById("app")?.scrollIntoView({ behavior: "smooth" }); }}>روابط تحميل التطبيق</button></div>
            </>
          ) : (
            <div className="lead-success">
              <div className="lead-success-mark" aria-hidden="true">✓</div>
              <h2 id="lead-dialog-heading">وصلنا طلبك!</h2>
              <p>فريق Basic Diet يقدر يتواصل معك بخصوص اشتراكك. وتقدر تبدأ بنفسك من التطبيق في أي وقت.</p>
              <div className="lead-success-stores"><StoreLinks location="app" /></div>
              <button type="button" className="lead-back" onClick={close}>رجوع للموقع</button>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
