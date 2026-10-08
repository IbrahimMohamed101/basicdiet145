"use client";

import { useEffect, useRef, useState } from "react";
import { observeMotionVisibility } from "@/lib/motion";

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

function Reel({ reel, index }: { reel: (typeof reels)[number]; index: number }) {
  const ref = useRef<HTMLElement>(null);
  const titleId = `reel-title-${reel.shortcode}`;
  const [load, setLoad] = useState(false);
  useEffect(() => {
    if (load || !ref.current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = observeMotionVisibility(ref.current, (visible) => {
      clearTimeout(timer);
      if (visible) timer = setTimeout(() => setLoad(true), index * 180);
    });
    return () => { clearTimeout(timer); stop(); };
  }, [index, load]);

  return (
    <article ref={ref} className="reel-card" data-reel-shortcode={reel.shortcode}>
      <div className="reel-card-head"><span>{String(index + 1).padStart(2, "0")}</span><span>{reel.label}</span></div>
      <div className="reel-embed-window">
        {load ? (
          <iframe src={`https://www.instagram.com/reel/${reel.shortcode}/embed/`} title={reel.title} loading="lazy" allow="encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        ) : (
          <button type="button" className="reel-load" onClick={() => setLoad(true)} aria-describedby={titleId}><span aria-hidden="true">▷</span><span>شاهد المقطع</span></button>
        )}
      </div>
      <div className="reel-card-foot"><h3 id={titleId}>{reel.title}</h3><a href={reel.url} target="_blank" rel="noopener noreferrer" aria-describedby={titleId}>شاهد على Instagram <span aria-hidden="true">↗</span></a></div>
    </article>
  );
}

export function InstagramReels() {
  return (
    <section id="reels" className="reels-section" aria-labelledby="reels-title">
      <div className="page-shell reels-shell">
        <div className="reels-heading">
          <div><p className="eyebrow eyebrow--light"><span />من قلب التجربة</p><h2 id="reels-title">أقرب للوجبة.<br /><span>أقرب للتجربة.</span></h2></div>
          <div className="reels-heading-copy"><p>أربع لقطات من حسابنا. شوفها بطريقتك.</p><a className="reels-profile-link" href="https://www.instagram.com/basicdiet.sa/" target="_blank" rel="noopener noreferrer"><bdi>@basicdiet.sa</bdi><span aria-hidden="true">↗</span></a></div>
        </div>
        <p className="reels-scroll-hint">اسحب لاستكشاف المقاطع <span aria-hidden="true">←</span></p>
        <div className="reels-grid" role="region" tabIndex={0} aria-label="فيديوهات Basic Diet على Instagram؛ مرّر أفقيًا للمزيد">
          {reels.map((reel, index) => <Reel key={reel.shortcode} reel={reel} index={index} />)}
        </div>
        <noscript><style>{`.reel-embed-window { display: none; }`}</style><p>شاهد المقاطع الأربعة من روابط Instagram أعلاه.</p></noscript>
      </div>
    </section>
  );
}
