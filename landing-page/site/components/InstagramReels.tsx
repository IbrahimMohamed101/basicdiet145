const reels = [
  {
    shortcode: "DTLby6gDBgM",
    url: "https://www.instagram.com/reel/DTLby6gDBgM/",
    label: "افتتاح Basic Diet",
    title: "شوف التجربة على الطبيعة",
  },
] as const;

export function InstagramReels() {
  return (
    <section className="reels-section" aria-labelledby="reels-title">
      <div className="page-shell reels-shell">
        <div className="reels-heading">
          <div>
            <p className="eyebrow eyebrow--light">
              <span />
              من Instagram
            </p>

            <h2 id="reels-title">
              مش بس صور.
              <br />
              <span>شوف التجربة وهي تتحرك.</span>
            </h2>
          </div>

          <div className="reels-heading-copy">
            <p>
              لقطات من المطعم والأكل والتجربة الحقيقية، عشان تشوف التفاصيل قبل ما تختار باقتك.
            </p>

            <a
              className="reels-profile-link"
              href="https://www.instagram.com/basicdiet.sa/"
              target="_blank"
              rel="noopener noreferrer"
            >
              @basicdiet.sa
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>

        <div className="reels-stage">
          {reels.map((reel) => (
            <article className="reel-card reel-card--featured" key={reel.shortcode}>
              <div className="reel-card-labels" aria-hidden="true">
                <span>Reel</span>
                <span>{reel.label}</span>
              </div>

              <div className="reel-frame">
                <iframe
                  src={`https://www.instagram.com/reel/${reel.shortcode}/embed/`}
                  title={reel.title}
                  loading="lazy"
                  allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>

              <a
                className="reel-open-link"
                href={reel.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                افتح الفيديو على Instagram
                <span aria-hidden="true">↗</span>
              </a>
            </article>
          ))}

          <aside className="reels-side-note" aria-label="تابع Basic Diet على Instagram">
            <span className="reels-side-mark" aria-hidden="true">◎</span>
            <strong>المزيد من اللقطات على Instagram.</strong>
            <p>
              تابع الحساب وشوف باقي الفيديوهات، الأطباق الجديدة، وكواليس التجربة.
            </p>
            <a
              href="https://www.instagram.com/basicdiet.sa/"
              target="_blank"
              rel="noopener noreferrer"
            >
              تابع الحساب
              <span aria-hidden="true">←</span>
            </a>
          </aside>
        </div>
      </div>
    </section>
  );
}
