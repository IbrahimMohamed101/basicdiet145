import Image from "next/image";
import { PromoOfferText } from "./PromoExperience";
import { HERO_POSTER_URL, HERO_VIDEO_URL } from "@/lib/app-links";

export function Hero() {
  return (
    <section className="hero hero--cinematic" aria-labelledby="hero-title">
      <div className="hero-cinema-media" aria-hidden="true">
        {/* On small screens render a stable, high-priority poster instead of a video LCP. */}
        <Image
          className="hero-cinema-mobile-poster"
          src={HERO_POSTER_URL}
          width={1600}
          height={900}
          sizes="(max-width: 640px) 80vw, 640px"
          quality={75}
          loading="eager"
          preload
          fetchPriority="high"
          unoptimized={HERO_POSTER_URL.startsWith("http")}
          alt=""
        />
        <video
          className="hero-cinema-video"
          data-motion-video=""
          muted
          loop
          playsInline
          preload="none"
          // No HTML video poster: mobile browsers fetched it even with video display:none.
          // The CSS background provides the desktop fallback without mobile transfer.
          style={{ backgroundImage: `url("${HERO_POSTER_URL}")`, backgroundPosition: "center", backgroundSize: "cover" }}
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
          <h1 id="hero-title" className="hero-cinema-title">
            <span className="hero-cinema-title-line">وجبات تحبها،</span>
            <span className="hero-cinema-title-line hero-cinema-title-line--accent">
              بكميات محسوبة
            </span>
            <span className="hero-cinema-title-line">تناسب روتينك.</span>
          </h1>

          <p className="hero-cinema-description">
            مع بيسك دايت (Basic Diet)، اختر اشتراك وجبات صحية في جدة، وحدد مدة الاشتراك وكمية الوجبة وعدد وجباتك يوميًا بكل سهولة.
          </p>

          <PromoOfferText location="hero" />
          <div className="hero-cinema-actions">
            <a className="button button--hero button--hero-cinema" href="#plans">احسب باقتك</a>
            <a className="button button--hero-outline" href="/menu#menu-products">تصفّح المنيو</a>
          </div>
        </div>
      </div>
    </section>
  );
}
