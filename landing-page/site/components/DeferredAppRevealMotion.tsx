"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// The whole section remains server-rendered and indexable; only decorative
// pointer tracking is loaded on demand when the user approaches the section.
const Motion = dynamic(() => import("./AppRevealMotion").then(m => m.AppRevealMotion), {
  ssr: false,
});

export function DeferredAppRevealMotion() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const section = document.getElementById("app");
    if (!section || !("IntersectionObserver" in window)) {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setActive(true);
      observer.disconnect();
    }, {rootMargin:"400px 0px"});
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return active ? <Motion /> : null;
}
