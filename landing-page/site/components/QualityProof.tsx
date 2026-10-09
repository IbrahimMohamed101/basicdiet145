const highlights = [
  {
    title: "الطعم حاضر في التجربة",
    copy: "مراجعات حديثة تصف الوجبات بأنها لذيذة ومشبعة بدون إحساس إن الأكل «دايت» تقليدي.",
  },
  {
    title: "النظافة والجودة مذكورة بوضوح",
    copy: "أكثر من مراجعة أشارت إلى نظافة التجربة وجودة الوجبات بشكل مباشر.",
  },
  {
    title: "تجربة ممكن تقنعك بالاشتراك",
    copy: "في مراجعة منشورة، العميل ذكر إن تجربته الأولى خلته يتحول للاشتراك بعدها.",
  },
] as const;

function Stars() {
  return (
    <div className="quality-stars" aria-label="تقييم 4.7 من 5">
      <span>★</span>
      <span>★</span>
      <span>★</span>
      <span>★</span>
      <span>★</span>
    </div>
  );
}

export function QualityProof() {
  return (
    <section className="quality-section" aria-labelledby="quality-title">
      <div className="page-shell quality-proof-layout">
        <div className="quality-summary-card">
          <p className="eyebrow">
            <span />
            تقييمات العملاء
          </p>

          <div className="quality-rating">
            <strong>4.7</strong>
            <span>/5</span>
          </div>

          <Stars />

          <p className="quality-rating-copy">
            من أكثر من <strong>270 تقييمًا على Google</strong>.
          </p>

          <div className="quality-rating-meta">
            <span>مطعم مأكولات صحية</span>
            <span>جدة</span>
          </div>
        </div>

        <div className="quality-content">
          <div className="quality-heading">
            <h2 id="quality-title">
              قبل ما تشترك،
              <br />
              <span>شوف الناس قالت إيه.</span>
            </h2>
            <p>
              بدل كلام عام عن الجودة، نعرض إشارات واضحة من مراجعات منشورة عن الطعم والنظافة وتجربة الاشتراك.
            </p>
          </div>

          <div className="quality-review-grid">
            {highlights.map((item, index) => (
              <article key={item.title} className="quality-review-card">
                <span className="quality-review-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                  <span className="quality-review-source">من مراجعات Google</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
