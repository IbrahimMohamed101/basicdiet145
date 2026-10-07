import { faqItems } from "@/lib/faq-data";

export function FAQ() {
  return (
    <section className="faq-section" id="faq" aria-labelledby="faq-title">
      <div className="page-shell faq-grid">
        <div className="faq-heading"><p className="eyebrow"><span />قبل ما تبدأ</p><h2 id="faq-title">باقي سؤال؟</h2><p>تفاصيل صغيرة، تخلي اختيارك أوضح.</p></div>
        <div className="faq-list">
          {faqItems.map((item) => <details className="faq-item" name="landing-faq" key={item.question}><summary>{item.question}<span className="faq-icon" aria-hidden="true" /></summary><p>{item.answer}</p></details>)}
        </div>
      </div>
    </section>
  );
}
