import { StoreLinks } from "./StoreLinks";
import { AppCta } from "./AppCta";

const APP_HOME_SCREENSHOT = "https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/8d/c0/d3/8dc0d30c-c63a-5caa-6ed4-c476435f7444/Simulator_Screenshot_-_iPhone_16_Pro_Max_-_2026-06-02_at_18.59.40.png/471x1024.webp";

export function FinalCTA() {
  return (
    <section className="final-cta" aria-labelledby="final-cta-title">
      <div className="page-shell final-cta-inner">
        <div className="final-cta-copy"><p className="eyebrow eyebrow--light"><span />يومك يبدأ باختيارك</p><h2 id="final-cta-title">وجبتك الجاية؟<br /><span>اختَرها من التطبيق.</span></h2><p>حمّل Basic Diet، وخلّ اشتراكك على مقاس يومك. وإذا احتجت مساعدة، اسألنا مباشرة.</p><StoreLinks location="final" /><div className="final-contact-actions"><AppCta location="final" className="button final-contact-button">اسأل المطعم <span aria-hidden="true">←</span></AppCta><a href="tel:+966535332639" className="final-contact-phone">اتصل بنا <span aria-hidden="true">↗</span></a></div></div>
        <div className="final-app-visual"><span className="final-brand-word" aria-hidden="true">Basic<br />Diet.</span><div className="final-phone"><img src={APP_HOME_SCREENSHOT} alt="الشاشة الرئيسية لتطبيق Basic Diet لاختيار اشتراكك" width="471" height="1024" loading="lazy" decoding="async" /></div></div>
      </div>
    </section>
  );
}
