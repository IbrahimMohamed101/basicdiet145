import Image from "next/image";
import { StoreLinks } from "./StoreLinks";
import { DeferredAppRevealMotion } from "./DeferredAppRevealMotion";

const APP_HOME_SCREENSHOT =
  "https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/8d/c0/d3/8dc0d30c-c63a-5caa-6ed4-c476435f7444/Simulator_Screenshot_-_iPhone_16_Pro_Max_-_2026-06-02_at_18.59.40.png/471x1024.webp";

function FeatureIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5.1 10.2 3 3.1 6.9-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AppReveal() {
  return (
    <section className="app-reveal-section" id="app" aria-labelledby="app-reveal-title">
      <DeferredAppRevealMotion />
      <div className="page-shell app-reveal-grid">
        <div className="app-reveal-copy">
          <p className="eyebrow">
            <span />
            تطبيقك لكل تفاصيل اشتراكك
          </p>

          <h2 id="app-reveal-title">
            وجبتك قدامك.
            <br />
            <span>واشتراكك في يدك.</span>
          </h2>

          <p>
            اختر باقتك ووجباتك، وتابع اشتراكك وإدارة التوصيل أو الاستلام من التطبيق.
          </p>

          <div className="app-reveal-points" aria-label="مزايا التطبيق">
            <span><FeatureIcon />اختيار الباقة</span>
            <span><FeatureIcon />اختيار الوجبات</span>
            <span><FeatureIcon />متابعة الاشتراك</span>
          </div>

        </div>

        <div
          className="hero-visual-stage app-reveal-stage"
          data-scene-visible="false"
          data-testid="hero-visual-stage"
          aria-label="الشاشة الرئيسية للتطبيق مع وجبة"
        >
          <div className="hero-visual-glow hero-visual-glow--green" aria-hidden="true" />
          <div className="hero-visual-glow hero-visual-glow--orange" aria-hidden="true" />
          <div className="hero-orbit hero-orbit--one" aria-hidden="true" />
          <div className="hero-orbit hero-orbit--two" aria-hidden="true" />

          <div className="hero-phone-layer">
            <div className="hero-phone-float">
              <div className="hero-phone-shell">
                <span className="hero-phone-speaker" aria-hidden="true" />
                <img
                  src={APP_HOME_SCREENSHOT}
                  alt="الشاشة الرئيسية للتطبيق"
                  className="hero-phone-screen"
                  decoding="async"
                  loading="eager"
                />
              </div>
            </div>
          </div>

          <div className="hero-meal-layer">
            <div className="hero-meal-float">
              <div className="hero-plate">
                <span className="hero-plate-rim" aria-hidden="true" />
                <Image
                  src="/meals/salmon.png"
                  alt="وجبة سالمون من منيو بيسك دايت"
                  className="hero-meal-image"
                  width={896}
                  height={760}
                  sizes="(max-width: 640px) 56vw, (max-width: 980px) 420px, 446px"
                  quality={76}
                  loading="lazy"
                />
              </div>
            </div>
          </div>

          <div className="hero-chip hero-chip--grams">
            <strong>150g</strong>
            <span>حجم الوجبة</span>
          </div>

          <div className="hero-chip hero-chip--meals">
            <strong>من 1 إلى 5</strong>
            <span>وجبات يوميًا</span>
          </div>
        </div>

        <div className="app-reveal-download">
          <p className="app-reveal-download-label">حمّل التطبيق وابدأ باقتك</p>
          <StoreLinks location="app" />
          <p className="app-store-note">كل تفاصيل اشتراكك من مكان واحد.</p>
        </div>
      </div>
    </section>
  );
}
