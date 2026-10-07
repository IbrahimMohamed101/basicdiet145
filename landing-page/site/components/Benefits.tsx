const gramOptions = ["100g", "150g", "200g"] as const;
const mealOptions = ["1", "2", "3", "4", "5"] as const;

function ScaleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 9h10l2.5 10h-15L7 9Z" />
      <path d="M9.5 9a2.5 2.5 0 0 1 5 0" />
      <path d="M12 13v3" />
    </svg>
  );
}

function MealsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function DeliveryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7h11v10H3zM14 10h3l4 4v3h-7z" />
      <circle cx="7" cy="18" r="1.5" />
      <circle cx="17.5" cy="18" r="1.5" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="3" width="10" height="18" rx="2.5" />
      <path d="M10 6h4M10.5 17.5h3" />
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
            الاشتراك على مقاسك
          </p>

          <h2 id="benefits-title">
            مرونة حقيقية،
            <br />
            <span>على مقاس يومك.</span>
          </h2>

          <p>
            بدل باقة ثابتة للجميع، أنت تختار الكمية وعدد الوجبات وطريقة الاستلام بالطريقة اللي تناسب روتينك.
          </p>

          <div className="benefits-proof-line">
            <span>3 أحجام للوجبة</span>
            <i aria-hidden="true" />
            <span>1–5 وجبات يوميًا</span>
            <i aria-hidden="true" />
            <span>توصيل أو استلام</span>
          </div>
        </div>

        <div className="subscription-configurator" aria-label="مثال على تخصيص الاشتراك">
          <div className="configurator-glow" aria-hidden="true" />

          <div className="configurator-header">
            <div>
              <span className="configurator-kicker">مثال سريع</span>
              <h3>كوّن يومك بطريقتك</h3>
            </div>
            <span className="configurator-status">
              <i aria-hidden="true" />
              مرن
            </span>
          </div>

          <div className="configurator-body">
            <div className="configurator-row">
              <div className="configurator-row-title">
                <span className="configurator-row-icon"><ScaleIcon /></span>
                <div>
                  <strong>حجم الوجبة</strong>
                  <small>اختر الكمية المناسبة لك</small>
                </div>
              </div>

              <div className="configurator-options configurator-options--grams" aria-label="مثال أحجام الوجبة">
                {gramOptions.map((option) => (
                  <span
                    key={option}
                    className={option === "150g" ? "is-selected" : undefined}
                  >
                    {option}
                  </span>
                ))}
              </div>
            </div>

            <div className="configurator-row">
              <div className="configurator-row-title">
                <span className="configurator-row-icon"><MealsIcon /></span>
                <div>
                  <strong>وجباتك اليومية</strong>
                  <small>من وجبة واحدة إلى خمس</small>
                </div>
              </div>

              <div className="configurator-options configurator-options--meals" aria-label="مثال عدد الوجبات">
                {mealOptions.map((option) => (
                  <span
                    key={option}
                    className={option === "3" ? "is-selected" : undefined}
                  >
                    {option}
                  </span>
                ))}
              </div>
            </div>

            <div className="configurator-row">
              <div className="configurator-row-title">
                <span className="configurator-row-icon"><DeliveryIcon /></span>
                <div>
                  <strong>طريقة الاستلام</strong>
                  <small>اختار الأنسب ليومك</small>
                </div>
              </div>

              <div className="configurator-options configurator-options--delivery" aria-label="مثال طريقة الاستلام">
                <span className="is-selected">توصيل</span>
                <span>استلام</span>
              </div>
            </div>
          </div>

          <div className="configurator-summary">
            <span className="configurator-phone"><PhoneIcon /></span>

            <div className="configurator-summary-copy">
              <small>مثال لاختيارك</small>
              <strong>150g · 3 وجبات · توصيل</strong>
            </div>

            <span className="configurator-app-note">
              تقدر تعدل كل ده من التطبيق
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
