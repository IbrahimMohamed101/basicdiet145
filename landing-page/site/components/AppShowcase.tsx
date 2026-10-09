import { AppCta } from "./AppCta";

const screenshots = [
  {
    src: "https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/09/72/b9/0972b9b2-9271-fef6-c5c7-8c2a374af4fb/Simulator_Screenshot_-_iPhone_16_Pro_Max_-_2026-06-02_at_19.01.23.png/471x1024.webp",
    alt: "شاشة من تطبيق Basic Diet",
  },
  {
    src: "https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/8d/c0/d3/8dc0d30c-c63a-5caa-6ed4-c476435f7444/Simulator_Screenshot_-_iPhone_16_Pro_Max_-_2026-06-02_at_18.59.40.png/471x1024.webp",
    alt: "شاشة إدارة من تطبيق Basic Diet",
  },
  {
    src: "https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/a5/0e/38/a50e38e1-e26d-f024-d61b-d5c275d78379/Simulator_Screenshot_-_iPhone_16_Pro_Max_-_2026-06-02_at_19.00.31.png/471x1024.webp",
    alt: "شاشة اشتراك من تطبيق Basic Diet",
  },
];

const labels = [
  "اختر باقتك",
  "اختر وجباتك",
  "تابع اشتراكك",
  "أدر التوصيل أو الاستلام",
];

export function AppShowcase() {
  return (
    <section className="app-section" id="app" aria-labelledby="app-title">
      <div className="page-shell app-grid">
        <div className="app-copy">
          <p className="eyebrow eyebrow--light">
            <span />
            كل شيء معك
          </p>
          <h2 id="app-title">
            اشتراكك معك
            <br />
            <span>في التطبيق.</span>
          </h2>
          <p className="app-description">
            من اختيار الباقة والوجبات إلى متابعة الاشتراك وإدارة التوصيل أو
            الاستلام، كل شيء واضح في مكان واحد.
          </p>

          <ul className="app-labels">
            {labels.map((label) => (
              <li key={label}>
                <span aria-hidden="true">✓</span>
                {label}
              </li>
            ))}
          </ul>

          <AppCta location="app" className="button button--light">
            ابدأ اشتراكك
          </AppCta>
        </div>

        <div className="phones" aria-label="صور تطبيق Basic Diet">
          {screenshots.map((screenshot, index) => (
            <figure
              key={screenshot.src}
              className={`phone-card phone-card--${index + 1}`}
            >
              <img src={screenshot.src} alt={screenshot.alt} />
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
