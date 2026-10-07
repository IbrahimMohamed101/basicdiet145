import { AppCta } from "./AppCta";

export function FinalCTA() {
  return (
    <section className="final-cta" aria-labelledby="final-cta-title">
      <div className="page-shell final-cta-inner">
        <p className="eyebrow eyebrow--light">
          <span />
          جاهز تبدأ؟
        </p>
        <h2 id="final-cta-title">
          خلي وجباتك محسوبة،
          <br />
          <span>بدون ما تتنازل عن الأكل اللي تحبه.</span>
        </h2>
        <p>
          اختر باقتك وخصص وجباتك وابدأ روتينك من تطبيق Basic Diet.
        </p>
        <AppCta location="final" className="button button--light button--final">
          ابدأ اشتراكك
        </AppCta>
      </div>
    </section>
  );
}
