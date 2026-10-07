const steps = [
  {
    number: "01",
    key: "plan",
    eyebrow: "اختار المدة",
    title: "ابدأ بالباقة",
    copy: "حدد المدة اللي تناسب روتينك من غير تفاصيل زيادة.",
  },
  {
    number: "02",
    key: "customize",
    eyebrow: "ظبط يومك",
    title: "خصص وجباتك",
    copy: "اختار الكمية وعدد الوجبات وبعدها أصنافك اليومية.",
  },
  {
    number: "03",
    key: "receive",
    eyebrow: "ابدأ فعليًا",
    title: "استلم وتابع",
    copy: "توصيل أو استلام، وكل تفاصيل اشتراكك تفضل معاك في التطبيق.",
  },
] as const;

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5.5" width="16" height="14" rx="3" />
      <path d="M8 3.5v4M16 3.5v4M4 9.5h16" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 6h14M5 12h14M5 18h14" />
      <circle cx="9" cy="6" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="11" cy="18" r="2" />
    </svg>
  );
}

function DeliveryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 7h10.5v9H3.5zM14 10h3l3.5 3.5V16H14z" />
      <circle cx="7" cy="17.5" r="1.5" />
      <circle cx="17.5" cy="17.5" r="1.5" />
    </svg>
  );
}

function StepVisual({ type }: { type: (typeof steps)[number]["key"] }) {
  if (type === "plan") {
    return (
      <div className="journey-visual journey-visual--plans" aria-label="7 أو 26 أو 30 يوم">
        <span>7</span>
        <span className="is-active">26</span>
        <span>30</span>
        <small>يوم</small>
      </div>
    );
  }

  if (type === "customize") {
    return (
      <div className="journey-visual journey-visual--customize" aria-label="150 جرام و3 وجبات">
        <span className="journey-gram">150g</span>
        <div className="journey-meal-dots">
          <i />
          <i />
          <i className="is-active" />
          <i />
          <i />
        </div>
        <small>3 وجبات يوميًا</small>
      </div>
    );
  }

  return (
    <div className="journey-visual journey-visual--delivery" aria-label="توصيل أو استلام">
      <span className="is-active">توصيل</span>
      <span>استلام</span>
      <small>تابع من التطبيق</small>
    </div>
  );
}

function StepIcon({ type }: { type: (typeof steps)[number]["key"] }) {
  if (type === "plan") return <CalendarIcon />;
  if (type === "customize") return <SlidersIcon />;
  return <DeliveryIcon />;
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
            الرحلة أبسط مما تبدو: اختار الباقة، ظبط يومك، وبعدها سيب الباقي علينا.
          </p>
        </div>

        <div className="journey-road" aria-label="رحلة الاشتراك">
          <div className="journey-track" aria-hidden="true">
            <span />
          </div>

          {steps.map((step) => (
            <article className="journey-step" key={step.number}>
              <span className="journey-number" aria-hidden="true">{step.number}</span>

              <div className="journey-step-top">
                <span className="journey-icon">
                  <StepIcon type={step.key} />
                </span>
                <span className="journey-eyebrow">{step.eyebrow}</span>
              </div>

              <StepVisual type={step.key} />

              <div className="journey-copy">
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </div>
            </article>
          ))}
        </div>

        <div className="journey-handoff">
          <span>وبعدها؟</span>
          <strong>شوف التجربة على الحقيقة.</strong>
          <span className="journey-handoff-arrow" aria-hidden="true">↓</span>
        </div>
      </div>
    </section>
  );
}
