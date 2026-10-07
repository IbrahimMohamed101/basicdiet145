"use client";

import { useEffect, useRef, useState } from "react";

const words =
  "الأكل المحسوب مش لازم يكون ممل اختيارات تحبها بكميات تناسب روتينك".split(
    " ",
  );

export function TaglineReveal() {
  const rootRef = useRef<HTMLElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (reducedMotion) {
      setVisibleCount(words.length);
      return;
    }

    let timer: ReturnType<typeof setInterval> | null = null;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || timer) return;

        timer = setInterval(() => {
          setVisibleCount((count) => {
            if (count >= words.length) {
              if (timer) clearInterval(timer);
              return count;
            }
            return count + 1;
          });
        }, 95);
      },
      { threshold: 0.35 },
    );

    observer.observe(root);

    return () => {
      observer.disconnect();
      if (timer) clearInterval(timer);
    };
  }, []);

  return (
    <section ref={rootRef} className="tagline-section" aria-label="رسالة Basic Diet">
      <div className="page-shell tagline-wrap">
        <p>
          {words.map((word, index) => (
            <span
              key={`${word}-${index}`}
              className={index < visibleCount ? "tag-word tag-word--active" : "tag-word"}
            >
              {word}{" "}
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}
