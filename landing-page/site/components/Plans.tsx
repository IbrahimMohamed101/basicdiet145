import { AppCta } from "./AppCta";

const plans = [
  {
    days: "7 أيام",
    label: "بداية أقصر",
    title: "تجربة أقصر لروتين أخف.",
    copy: "مناسبة إذا كنت تفضل بداية قصيرة قبل الالتزام بمدة أطول.",
  },
  {
    days: "26 يوم",
    label: "روتين منتظم",
    title: "روتين منتظم لفترة أطول.",
    copy: "اختر الكمية وعدد الوجبات اليومية المناسبة لك.",
  },
  {
    days: "30 يوم",
    label: "خطة شهرية",
    title: "خطة شهرية لروتين مستمر.",
    copy: "مناسبة لمن يفضل تنظيم وجباته على مدى أطول.",
  },
];

export function Plans() {
  return (
    <section className="plans-section" id="plans" aria-labelledby="plans-title">
      <div className="page-shell">
        <div className="section-heading section-heading--split">
          <div>
            <p className="eyebrow">
              <span />
              اختر مدتك
            </p>
            <h2 id="plans-title">
              اختر المدة،
              <br />
              <span>والباقي على روتينك.</span>
            </h2>
          </div>
          <p>
            مع كل باقة تقدر تختار كمية الوجبة وعدد وجباتك اليومية من التطبيق.
          </p>
        </div>

        <div className="plan-grid">
          {plans.map((plan) => (
            <article className="plan-card" key={plan.days}>
              <div className="plan-top">
                <span className="plan-duration">{plan.days}</span>
                <span className="plan-label">{plan.label}</span>
              </div>
              <h3>{plan.title}</h3>
              <p>{plan.copy}</p>
              <div className="plan-config">
                <span>100g · 150g · 200g</span>
                <span>1–5 وجبات يوميًا</span>
              </div>
              <AppCta location="plans" className="button plan-button">
                ابدأ اشتراك {plan.days}
              </AppCta>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
