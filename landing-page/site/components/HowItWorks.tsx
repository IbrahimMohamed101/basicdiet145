const steps = [
  {
    number: "01",
    key: "plan",
    eyebrow: "حدد المدة",
    title: "اختر الباقة",
    copy: "ابدأ بمدة تناسب روتينك: 7 أو 26 أو 30 يوم.",
    meta: "7 · 26 · 30 يوم",
  },
  {
    number: "02",
    key: "customize",
    eyebrow: "اضبط يومك",
    title: "خصص وجباتك",
    copy: "اختر كمية الوجبة وعدد الوجبات اليومية، وبعدها حدد أصنافك.",
    meta: "100g · 150g · 200g  /  1–5 وجبات",
  },
  {
    number: "03",
    key: "follow",
    eyebrow: "ابدأ وتابع",
    title: "استلم وتابع",
    copy: "اختر التوصيل أو الاستلام، وتابع تفاصيل اشتراكك من التطبيق.",
    meta: "توصيل أو استلام",
  },
] as const;

function StepIcon({ type }: { type: (typeof steps)[number]["key"] }) {
  if (type === "plan") {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="6.5" y="8" width="19" height="17.5" rx="3" />
        <path d="M10 5.5v5M22 5.5v5M7 13h18" />
      </svg>
    );
  }

  if (type === "customize") {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M7 9h18M7 16h18M7 23h18" />
        <circle cx="12" cy="9" r="2.3" />
        <circle cx="21" cy="16" r="2.3" />
        <circle cx="15" cy="23" r="2.3" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="10" y="4.5" width="12" height="23" rx="3" />
      <path d="M13 9h6M14 23h4" />
      <path d="m23.5 11.5 2.5 2.5-4.5 4.5" />
    </svg>
  );
}

export function HowItWorks() {
  return (
    <section
      className="how-section"
      id="how-it-works"
      aria-labelledby="how-title"
    >
      <div className="page-shell">
        <div className="how-heading">
          <div>
            <p className="eyebrow">
              <span />
              كيف يعمل؟
            </p>
            <h2 id="how-title">
              من أول اختيار
              <br />
              <span>لحد أول وجبة.</span>
            </h2>
          </div>

          <p>
            ثلاث خطوات واضحة فقط. تختار، تخصص، وبعدها تدير كل شيء من التطبيق.
          </p>
        </div>

        <div className="steps-timeline" aria-label="خطوات الاشتراك">
          <div className="steps-line" aria-hidden="true" />

          {steps.map((step) => (
            <article className="step-card" key={step.number}>
              <div className="step-marker" aria-hidden="true">
                <span>{step.number}</span>
              </div>

              <div className="step-icon">
                <StepIcon type={step.key} />
              </div>

              <div className="step-copy">
                <span className="step-eyebrow">{step.eyebrow}</span>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </div>

              <span className="step-meta">{step.meta}</span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
