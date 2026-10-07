import { AppCta } from "./AppCta";
import { HERO_POSTER_URL, HERO_VIDEO_URL } from "@/lib/app-links";

export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="page-shell hero-grid">
        <div className="hero-media">
          <video
            className="hero-video"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster={HERO_POSTER_URL || undefined}
            aria-label="وجبات Basic Diet متنوعة"
          >
            <source src={HERO_VIDEO_URL} type="video/mp4" />
          </video>
          <div className="hero-media-badge" aria-hidden="true">
            <span className="pulse-dot" />
            وجبات فعلية، روتين أسهل
          </div>
        </div>

        <div className="hero-copy">
          <p className="eyebrow">
            <span />
            اشتراك وجبات مرن في جدة
          </p>

          <h1 id="hero-title">
            وجبات تحبها،
            <br />
            <span>بكميات محسوبة</span>
            <br />
            تناسب روتينك.
          </h1>

          <p className="hero-description">
            اختر مدة اشتراكك، كمية الوجبة وعدد وجباتك يوميًا، وتحكم في
            اشتراكك من تطبيق Basic Diet.
          </p>

          <div className="hero-actions">
            <AppCta location="hero" className="button button--hero">
              ابدأ اشتراكك
            </AppCta>
            <a className="text-link" href="#meals">
              شوف الوجبات
              <span aria-hidden="true">←</span>
            </a>
          </div>

          <ul className="hero-proof" aria-label="خيارات الاشتراك">
            <li>
              <strong>100g · 150g · 200g</strong>
              <span>أحجام مرنة</span>
            </li>
            <li>
              <strong>1–5</strong>
              <span>وجبات يوميًا</span>
            </li>
            <li>
              <strong>توصيل أو استلام</strong>
              <span>حسب اختيارك</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
