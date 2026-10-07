const reels = [
  {
    shortcode: "DTLby6gDBgM",
    url: "https://www.instagram.com/reel/DTLby6gDBgM/",
    label: "من الافتتاح",
    title: "الدايت صار له وجهة جديدة",
  },
  {
    shortcode: "DZk2kKqoAJA",
    url: "https://www.instagram.com/reel/DZk2kKqoAJA/",
    label: "جولة في التجربة",
    title: "أكل صحي بدون إحساس بالحرمان",
  },
  {
    shortcode: "DXulBRdCB7X",
    url: "https://www.instagram.com/reel/DXulBRdCB7X/",
    label: "سناك صحي",
    title: "زبادي وفواكه ومكسرات",
  },
  {
    shortcode: "DX2N3EgIvVM",
    url: "https://www.instagram.com/reel/DX2N3EgIvVM/",
    label: "سلطة بيسك",
    title: "صمم سلطتك على جوك",
  },
] as const;

function InstagramMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.4" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function InstagramReels() {
  return (
    <section id="reels" className="reels-section" aria-labelledby="reels-title">
      <div className="page-shell reels-shell">
        <div className="reels-heading">
          <div>
            <p className="eyebrow eyebrow--light">
              <span />
              من Instagram
            </p>

            <h2 id="reels-title">
              شوف الأكل
              <br />
              <span>على الحقيقة.</span>
            </h2>
          </div>

          <div className="reels-heading-copy">
            <p>
              أربع لقطات من المطعم والأكل والتحضير. افتح أي فيديو وشوف التجربة بنفسك.
            </p>

            <a
              className="reels-profile-link"
              href="https://www.instagram.com/basicdiet.sa/"
              target="_blank"
              rel="noopener noreferrer"
            >
              <InstagramMark />
              @basicdiet.sa
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>

        <div className="reels-grid" aria-label="فيديوهات Basic Diet على Instagram">
          {reels.map((reel, index) => (
            <article className="reel-card" key={reel.shortcode}>
              <div className="reel-card-head">
                <span className="reel-card-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="reel-card-label">{reel.label}</span>
              </div>

              <div className="reel-embed-window">
                <iframe
                  src={`https://www.instagram.com/reel/${reel.shortcode}/embed/`}
                  title={reel.title}
                  loading="lazy"
                  allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>

              <div className="reel-card-foot">
                <strong>{reel.title}</strong>
                <a
                  href={reel.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`فتح ${reel.title} على Instagram`}
                >
                  <span>Instagram</span>
                  <span aria-hidden="true">↗</span>
                </a>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
