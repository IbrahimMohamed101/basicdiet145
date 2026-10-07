const benefits = [
  {
    number: "01",
    title: "أكل تستمتع فيه",
    copy: "تنوع في الوجبات يخلي الالتزام أسهل من تكرار نفس الطبق كل يوم.",
  },
  {
    number: "02",
    title: "الكمية على حسب روتينك",
    copy: "100g أو 150g أو 200g، ومعها عدد الوجبات اليومية اللي يناسبك.",
  },
  {
    number: "03",
    title: "قرار أقل كل يوم",
    copy: "جهز روتينك من البداية بدل ما تبدأ كل يوم بسؤال: وش آكل؟",
  },
  {
    number: "04",
    title: "كل شيء من التطبيق",
    copy: "اختر، تابع وأدر تفاصيل اشتراكك من مكان واحد.",
  },
];

export function Benefits() {
  return (
    <section className="benefits-section" aria-labelledby="benefits-title">
      <div className="page-shell">
        <div className="section-heading section-heading--compact">
          <p className="eyebrow">
            <span />
            ليه Basic Diet؟
          </p>
          <h2 id="benefits-title">
            اشتراك يمشي مع يومك،
            <br />
            <span>مو العكس.</span>
          </h2>
        </div>

        <div className="benefit-grid">
          {benefits.map((benefit) => (
            <article key={benefit.number} className="benefit-card">
              <span className="benefit-number">{benefit.number}</span>
              <h3>{benefit.title}</h3>
              <p>{benefit.copy}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
