import { PromoOfferButton } from "./PromoExperience";
import { SITE_OFFER_CTA } from "@/lib/site-offer";
import { StoreLinks } from "./StoreLinks";

const APP_HOME_SCREENSHOT = "https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/8d/c0/d3/8dc0d30c-c63a-5caa-6ed4-c476435f7444/Simulator_Screenshot_-_iPhone_16_Pro_Max_-_2026-06-02_at_18.59.40.png/471x1024.webp";

export function FinalCTA() {
  return (
    <section className="final-cta" aria-labelledby="final-cta-title">
      <div className="page-shell final-cta-inner">
        <div className="final-cta-copy"><p className="eyebrow eyebrow--light"><span />اختيارك يبدأ بطبق تحبه</p><h2 id="final-cta-title">أكلك على ذوقك.<br /><span>واشتراكك أوفر بـ15%.</span></h2><p>سجّل اسمك وجوالك من الموقع. فريقنا يساعدك تختار باقتك ويؤكد العرض قبل الاشتراك.</p><PromoOfferButton placement="final" className="button final-register">{SITE_OFFER_CTA}<span aria-hidden="true">←</span></PromoOfferButton><p className="final-register-note">بدون دفع الآن · الخصم على الباقة فقط</p><StoreLinks location="final" /></div>
        <div className="final-app-visual"><span className="final-brand-word" aria-hidden="true">Basic<br />Diet.</span><div className="final-phone"><img src={APP_HOME_SCREENSHOT} alt="الشاشة الرئيسية لتطبيق Basic Diet لاختيار اشتراكك" width="471" height="1024" loading="lazy" decoding="async" /></div></div>
      </div>
    </section>
  );
}
