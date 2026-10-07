const steps = [
  {
    number: "01",
    title: "اختر الباقة",
    copy: "حدد مدة الاشتراك المناسبة لروتينك: 7 أو 26 أو 30 يوم.",
  },
  {
    number: "02",
    title: "خصص وجباتك",
    copy: "اختر كمية الوجبة وعدد وجباتك ووجباتك من التطبيق.",
  },
  {
    number: "03",
    title: "تابع اشتراكك",
    copy: "أدر تفاصيل الاشتراك والتوصيل أو الاستلام من التطبيق.",
  },
];

export function HowItWorks() {
  return (
    <section
      className="how-section"
      id="how-it-works"
      aria-labelledby="how-title"
    >
      <div className="page-shell">
        <div className="section-heading section-heading--compact">
          <p className="eyebrow">
            <span />
            بسيطة وواضحة
          </p>
          <h2 id="how-title">
            ثلاث خطوات
            <br />
            <span>وتبدأ.</span>
          </h2>
        </div>

        <div className="steps-grid">
          {steps.map((step) => (
            <article className="step-card" key={step.number}>
              <div className="step-top">
                <span>{step.number}</span>
                <span aria-hidden="true">←</span>
              </div>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
