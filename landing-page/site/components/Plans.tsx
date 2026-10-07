import { AppCta } from "./AppCta";

const plans = [
  { days: "7", unit: "أيام", label: "بداية مرنة", copy: "تعرّف على التجربة بمدة أقصر." },
  { days: "26", unit: "يوم", label: "الخيار المتوازن", copy: "رتّب وجباتك لفترة أطول." },
  { days: "30", unit: "يوم", label: "شهر كامل", copy: "خلّ تنظيم وجباتك عادة شهرية." },
];

export function Plans() {
  return (
    <section className="plans-section" id="plans" aria-labelledby="plans-title">
      <div className="page-shell">
        <div className="plans-heading"><div><p className="eyebrow"><span />اختر المدة</p><h2 id="plans-title">نفس المرونة.<br /><span>المدة على راحتك.</span></h2></div><p>ابدأ بالمدة اللي تناسبك، وكمل باقي التفاصيل في التطبيق.</p></div>
        <div className="plan-comparison" aria-label="مقارنة مدد الاشتراك">
          {plans.map((plan) => (
            <article className={`plan-option${plan.days === "26" ? " plan-option--featured" : ""}`} key={plan.days}>
              <div className="plan-duration"><strong>{plan.days}</strong><span>{plan.unit}</span></div>
              <div className="plan-copy"><h3>{plan.label}</h3><p>{plan.copy}</p></div>
              <AppCta location="plans" className="button plan-button">ابدأ مع {plan.days} {plan.unit}<span aria-hidden="true">←</span></AppCta>
            </article>
          ))}
        </div>
        <div className="plans-shared-options"><strong>في كل الباقات</strong><span dir="ltr">100g / 150g / 200g</span><span>1–5 وجبات يوميًا</span><span>توصيل أو استلام</span></div>
        <p className="plans-note">تختار باقتك داخل التطبيق. السعر النهائي يظهر بعد تخصيص الكمية وعدد الوجبات والإضافات.</p>
      </div>
    </section>
  );
}
