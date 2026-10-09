import { AppCta } from "./AppCta";
import { DownloadCta } from "./DownloadCta";
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
          <p className="hero-cinema-kicker">اشتراكات وجبات صحية في جدة <span aria-hidden="true">✳</span></p>
          <h1 id="hero-title" className="hero-cinema-title">
            <span className="hero-cinema-title-line">وجبات تحبها،</span>
            <span className="hero-cinema-title-line hero-cinema-title-line--accent">
              بكميات محسوبة
            </span>
            <span className="hero-cinema-title-line">تناسب روتينك.</span>
          </h1>

          <p className="hero-cinema-description">
            اختر مدة اشتراكك، كمية الوجبة وعدد وجباتك يوميًا، وتحكم في اشتراكك بسهولة.
          </p>

          <div className="hero-cinema-actions">
            <DownloadCta location="hero" className="button button--hero button--hero-cinema">
              حمّل التطبيق <span aria-hidden="true">↗</span>
            </DownloadCta>
            <AppCta location="hero" className="button button--hero button--hero-contact">
              اسأل المطعم <span aria-hidden="true">←</span>
            </AppCta>
          </div>
          <p className="hero-cinema-hint">اختر باقتك من التطبيق، أو خلّ فريقنا يساعدك تختار.</p>
        </div>
      </div>
    </section>
  );
}
