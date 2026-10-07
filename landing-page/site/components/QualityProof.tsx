const proof = [
  {
    number: "01",
    title: "الطعم حاضر في لغة العملاء",
    copy: "المراجعات العامة المتاحة تعطي إشارة إيجابية متكررة عن الطعم.",
  },
  {
    number: "02",
    title: "الجودة والنظافة جزء من الثقة",
    copy: "ظهرت إشارات إيجابية للجودة والنظافة في مراجعات عامة لـBasic Diet.",
  },
  {
    number: "03",
    title: "التجربة ممكن تتحول لاشتراك",
    copy: "إحدى المراجعات العامة وصفت تجربة الوجبات ثم الانتقال للاشتراك.",
  },
];

export function QualityProof() {
  return (
    <section className="quality-section" aria-labelledby="quality-title">
      <div className="page-shell quality-grid">
        <div className="quality-heading">
          <p className="eyebrow">
            <span />
            ثقة قبل القرار
          </p>
          <h2 id="quality-title">
            الطعم والجودة
            <br />
            <span>هم اللي يخلونك تكمل.</span>
          </h2>
          <p>
            هنا نستخدم فقط إشارات موثقة من مراجعات عامة، بدون اختراع أسماء أو
            تقييمات أو اقتباسات.
          </p>
        </div>

        <div className="quality-list">
          {proof.map((item) => (
            <article key={item.number}>
              <span>{item.number}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
