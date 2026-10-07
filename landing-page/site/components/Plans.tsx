import { AppCta } from "./AppCta";

const plans = [
  {
    days: "7",
    unit: "أيام",
    label: "بداية مرنة",
    title: "جرب روتينك بدون التزام طويل.",
    copy: "مناسبة لو تبغى تبدأ بفترة أقصر وتتعرف على التجربة.",
    tone: "soft",
  },
  {
    days: "26",
    unit: "يوم",
    label: "الخيار المتوازن",
    title: "روتين منتظم لفترة عملية.",
    copy: "مدة مناسبة لتنظيم وجباتك لفترة أطول مع نفس مرونة التخصيص.",
    tone: "featured",
  },
  {
    days: "30",
    unit: "يوم",
    label: "شهر كامل",
    title: "خطة شهرية لروتين مستمر.",
    copy: "مناسبة لو تفضل تنظيم وجباتك على مدى شهر كامل.",
    tone: "soft",
  },
] as const;

const sharedOptions = [
  "100g · 150g · 200g",
  "من 1 إلى 5 وجبات يوميًا",
  "توصيل أو استلام",
];

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="m5 10.2 3 3.1 7-7.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Plans() {
  return (
    <section className="plans-section" id="plans" aria-labelledby="plans-title">
      <div className="page-shell">
        <div className="plans-heading">
          <div>
            <p className="eyebrow">
              <span />
              اختر المدة
            </p>
            <h2 id="plans-title">
              نفس المرونة،
              <br />
              <span>بمدة تناسبك.</span>
            </h2>
          </div>

          <p>
            كل الباقات قابلة للتخصيص من التطبيق. الفرق الأساسي هو مدة الاشتراك.
          </p>
        </div>

        <div className="plans-shared-options" aria-label="خيارات متاحة في جميع الباقات">
          {sharedOptions.map((option) => (
            <span key={option}>
              <CheckIcon />
              {option}
            </span>
          ))}
        </div>

        <div className="plan-grid">
          {plans.map((plan) => (
            <article
              className={`plan-card plan-card--${plan.tone}`}
              key={plan.days}
            >
              <div className="plan-card-head">
                <span className="plan-label">{plan.label}</span>
                <div className="plan-duration">
                  <strong>{plan.days}</strong>
                  <span>{plan.unit}</span>
                </div>
              </div>

              <div className="plan-card-copy">
                <h3>{plan.title}</h3>
                <p>{plan.copy}</p>
              </div>

              <AppCta location="plans" className="button plan-button">
                اختر باقة {plan.days} {plan.unit}
              </AppCta>
            </article>
          ))}
        </div>

        <p className="plans-note">
          السعر النهائي يظهر داخل التطبيق بعد اختيار الكمية وعدد الوجبات وأي إضافات.
        </p>
      </div>
    </section>
  );
}
