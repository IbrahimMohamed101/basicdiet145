"use client";

import { useEffect } from "react";

const sectionIds = ["meals", "how-it-works", "app", "plans", "faq"];

function pushEvent(event: string, payload: Record<string, unknown> = {}) {
  const win = window as typeof window & {
    dataLayer?: Array<Record<string, unknown>>;
  };

  win.dataLayer = win.dataLayer ?? [];
  win.dataLayer.push({ event, ...payload });
}

export function AnalyticsTracker() {
  useEffect(() => {
    pushEvent("lp_view", {
      path: window.location.pathname,
      source: new URLSearchParams(window.location.search).get("utm_source"),
      medium: new URLSearchParams(window.location.search).get("utm_medium"),
      campaign: new URLSearchParams(window.location.search).get("utm_campaign"),
      content: new URLSearchParams(window.location.search).get("utm_content"),
    });

    const seen = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting || seen.has(entry.target.id)) return;
          seen.add(entry.target.id);
          pushEvent("lp_section_view", { section: entry.target.id });
        });
      },
      { threshold: 0.35 },
    );

    sectionIds.forEach((id) => {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    });

    const onCta = (event: Event) => {
      const detail = (event as CustomEvent).detail ?? {};
      pushEvent("lp_cta_click", detail);
    };

    const onStoreClick = (event: Event) => {
      const detail = (event as CustomEvent).detail ?? {};
      pushEvent("lp_store_click", detail);
    };

    window.addEventListener("basicdiet:cta", onCta);
    window.addEventListener("basicdiet:store_click", onStoreClick);

    return () => {
      observer.disconnect();
      window.removeEventListener("basicdiet:cta", onCta);
      window.removeEventListener("basicdiet:store_click", onStoreClick);
    };
  }, []);

  return null;
}
