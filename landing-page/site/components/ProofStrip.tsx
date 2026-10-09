const items = [
  {
    kicker: "100g · 150g · 200g",
    title: "الكمية على حسب روتينك",
    copy: "اختر حجم الوجبة بالطريقة المناسبة ليومك.",
  },
  {
    kicker: "من 1 إلى 5 وجبات",
    title: "مرونة في عدد وجباتك",
    copy: "اختر عدد الوجبات اليومية اللي يناسب روتينك.",
  },
  {
    kicker: "توصيل / استلام",
    title: "خذها بالطريقة الأنسب لك",
    copy: "اختيار واضح من بداية الاشتراك.",
  },
  {
    kicker: "من التطبيق",
    title: "اشتراكك في يدك",
    copy: "تابع تفاصيل اشتراكك وإدارة خياراتك من مكان واحد.",
  },
];

export function ProofStrip() {
  return (
    <section className="proof-strip" aria-label="مميزات الاشتراك">
      <div className="page-shell proof-grid">
        {items.map((item) => (
          <article className="proof-card" key={item.title}>
            <span className="proof-kicker">{item.kicker}</span>
            <h2>{item.title}</h2>
            <p>{item.copy}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
