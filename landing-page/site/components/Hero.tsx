import { AppCta } from "./AppCta";
import { HERO_POSTER_URL, HERO_VIDEO_URL } from "@/lib/app-links";

export function Hero() {
  return (
    <section className="hero hero--cinematic" aria-labelledby="hero-title">
      <div className="hero-cinema-media" aria-hidden="true">
        <video
          className="hero-cinema-video"
          data-motion-video=""
          muted
          loop
          playsInline
          preload="none"
          poster={HERO_POSTER_URL || undefined}
          tabIndex={-1}
        >
          <source data-src={HERO_VIDEO_URL} type="video/mp4" />
        </video>
        <span className="hero-cinema-shade" />
        <span className="hero-cinema-vignette" />
        <span className="hero-cinema-glow" />
      </div>

      <div className="page-shell hero-cinema-content">
        <div className="hero-cinema-copy">
          <p className="hero-cinema-eyebrow">
            <span aria-hidden="true" />
            اشتراك وجبات مرن في جدة
          </p>

          <h1 id="hero-title" className="hero-cinema-title">
            <span className="hero-cinema-title-line">وجبات تحبها،</span>
            <span className="hero-cinema-title-line hero-cinema-title-line--accent">
              بكميات محسوبة
            </span>
            <span className="hero-cinema-title-line">تناسب روتينك.</span>
          </h1>

          <p className="hero-cinema-description">
            اختر مدة اشتراكك، كمية الوجبة وعدد وجباتك يوميًا، وتحكم في
            اشتراكك من تطبيق Basic Diet.
          </p>

          <div className="hero-cinema-actions">
            <AppCta location="hero" className="button button--hero button--hero-cinema">
              ابدأ اشتراكك
            </AppCta>
            <a className="hero-cinema-link" href="#app">
              اكتشف التطبيق
              <span aria-hidden="true">↓</span>
            </a>
          </div>

          <ul className="hero-cinema-meta" aria-label="خيارات الاشتراك">
            <li>
              <strong>100g · 150g · 200g</strong>
              <span>أحجام مرنة</span>
            </li>
            <li>
              <strong>من 1 إلى 5 وجبات</strong>
              <span>يوميًا</span>
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
