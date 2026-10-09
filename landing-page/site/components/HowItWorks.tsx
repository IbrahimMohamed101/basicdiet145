import { Reveal } from "./Reveal";

const steps = [
  { number: "01", title: "اختر مدتك", copy: "بداية قصيرة أو روتين أطول. اختر الباقة اللي تناسبك.", detail: "7 / 26 / 30", unit: "يوم", key: "duration" },
  { number: "02", title: "كوّن يومك", copy: "حدد حجم الوجبة وعدد وجباتك، واختر أصنافك من التطبيق.", detail: "100 / 150 / 200", unit: "جرام · 1–5 وجبات يوميًا", key: "customize" },
  { number: "03", title: "استلم واستمتع", copy: "توصيل أو استلام. وتفاصيل اشتراكك معك في التطبيق.", detail: "على راحتك", unit: "توصيل أو استلام", key: "receive" },
];

export function HowItWorks() {
  return (
    <section className="how-section" id="how-it-works" aria-labelledby="how-title">
      <div className="page-shell">
        <div className="how-heading">
          <p className="eyebrow"><span />كيف يعمل؟</p>
          <h2 id="how-title">من أول اختيار<br /><span>إلى أول وجبة.</span></h2>
        </div>
        <ol className="journey-road" aria-label="رحلة الاشتراك">
          {steps.map((step, index) => (
            <li className="journey-step" key={step.number}>
              <Reveal className="journey-row" index={index}>
                <span className="journey-number" aria-hidden="true">{step.number}</span>
                <div className="journey-copy"><h3>{step.title}</h3><p>{step.copy}</p></div>
                <div className={`journey-detail journey-detail--${step.key}`}><strong dir={index < 2 ? "ltr" : undefined}>{step.detail}</strong><span>{step.unit}</span></div>
              </Reveal>
            </li>
          ))}
        </ol>
        <a className="journey-handoff" href="#reels"><span>وبعدها؟ <strong>شوف التجربة على الحقيقة.</strong></span><span aria-hidden="true">↓</span></a>
      </div>
    </section>
  );
}
