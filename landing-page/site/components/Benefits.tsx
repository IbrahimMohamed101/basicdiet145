const benefits = [
  {
    key: "variety",
    title: "تنوع يخليك تكمل",
    copy: "اختيارات مختلفة من الدجاج واللحوم والبحريات عشان روتينك ما يبقاش مكرر.",
    accent: "تنوع يومي",
  },
  {
    key: "grams",
    title: "الكمية على مقاسك",
    copy: "اختر 100g أو 150g أو 200g حسب احتياجك، بدل وجبة واحدة مفروضة على الجميع.",
    accent: "100g · 150g · 200g",
  },
  {
    key: "meals",
    title: "من وجبة إلى خمس",
    copy: "حدد عدد وجباتك اليومية بالطريقة اللي تناسب يومك وخطتك.",
    accent: "1–5 وجبات",
  },
  {
    key: "app",
    title: "كل شيء تحت سيطرتك",
    copy: "اختيار الوجبات ومتابعة الاشتراك والتوصيل أو الاستلام كله من التطبيق.",
    accent: "من التطبيق",
  },
] as const;

function BenefitIcon({ type }: { type: (typeof benefits)[number]["key"] }) {
  if (type === "variety") {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M7 9h18M7 16h18M7 23h11" />
        <circle cx="24" cy="23" r="3" />
      </svg>
    );
  }

  if (type === "grams") {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M10 12h12l3 12H7l3-12Z" />
        <path d="M13 12a3 3 0 0 1 6 0" />
        <path d="M16 17v4" />
      </svg>
    );
  }

  if (type === "meals") {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="10" />
        <path d="M16 10v12M10 16h12" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="10" y="5" width="12" height="22" rx="3" />
      <path d="M13 9h6M14 23h4" />
    </svg>
  );
}

export function Benefits() {
  return (
    <section className="benefits-section" aria-labelledby="benefits-title">
      <div className="page-shell benefits-shell">
        <div className="benefits-intro">
          <p className="eyebrow">
            <span />
            ليه تختارنا؟
          </p>

          <h2 id="benefits-title">
            مرونة حقيقية،
            <br />
            <span>من غير تعقيد.</span>
          </h2>

          <p>
            أنت تختار المدة والكمية وعدد الوجبات، وإحنا نخلي التجربة أبسط من أول اختيار لحد متابعة اشتراكك.
          </p>
        </div>

        <div className="benefit-grid">
          {benefits.map((benefit, index) => (
            <article key={benefit.key} className="benefit-card">
              <div className="benefit-card-top">
                <span className="benefit-icon">
                  <BenefitIcon type={benefit.key} />
                </span>
                <span className="benefit-index">{String(index + 1).padStart(2, "0")}</span>
              </div>

              <div className="benefit-card-copy">
                <span className="benefit-accent">{benefit.accent}</span>
                <h3>{benefit.title}</h3>
                <p>{benefit.copy}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
