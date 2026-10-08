"use client";

import { useEffect, useRef } from "react";

const sectionIds = ["meals", "how-it-works", "app", "plans", "faq", "reels"];
const SESSION_KEY = "basicdiet_lp_session_v1";
const ATTRIBUTION_KEY = "basicdiet_lp_attribution_v1";
let fallbackSession = "";

type Payload = Record<string, unknown>;
type Attribution = Record<"source" | "medium" | "campaign" | "content" | "term", string>;

function sessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    if (!fallbackSession) fallbackSession = crypto.randomUUID();
    return fallbackSession;
  }
}

function attribution(): Attribution {
  const qs = new URLSearchParams(location.search);
  const keys = ["source", "medium", "campaign", "content", "term"] as const;
  let old: Partial<Attribution> = {};
  try { old = JSON.parse(sessionStorage.getItem(ATTRIBUTION_KEY) || "{}") as Partial<Attribution>; } catch { /* storage disabled */ }
  const result = {} as Attribution;
  for (const key of keys) {
    const incoming = qs.get("utm_" + key);
    result[key] = (incoming ?? old[key] ?? "").slice(0, 100);
  }
  if (keys.some(key => qs.has("utm_" + key))) {
    try { sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(result)); } catch { /* storage disabled */ }
  }
  return result;
}

function track(event: string, detail: Payload = {}) {
  const win = window as typeof window & { dataLayer?: Payload[] };
  win.dataLayer = win.dataLayer ?? [];
  win.dataLayer.push({ event, ...detail });
  if (navigator.doNotTrack === "1" || !navigator.sendBeacon && !window.fetch) return;
  const ua = navigator.userAgent.toLowerCase();
  const device = /iphone|ipad|ipod/.test(ua) ? "ios" : /android/.test(ua) ? "android" : "desktop";
  let referrerHost = "";
  try { if (document.referrer) referrerHost = new URL(document.referrer).hostname; } catch { /* no referrer */ }
  const body = JSON.stringify({
    event, eventId: crypto.randomUUID(), sessionId: sessionId(),
    path: location.pathname, device, referrerHost, ...attribution(), ...detail,
  });
  // keepalive keeps a store click from being lost during navigation.
  void fetch("/api/analytics", {
    method: "POST", headers: { "content-type": "application/json" },
    body, keepalive: true, credentials: "same-origin",
  }).catch(() => undefined);
}

export function AnalyticsTracker() {
  const viewed = useRef(false);

  useEffect(() => {
    if (!viewed.current) {
      viewed.current = true;
      track("lp_view");
    }

    const seen = new Set<string>();
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || seen.has(entry.target.id)) continue;
          seen.add(entry.target.id);
          track("lp_section_view", { section: entry.target.id });
        }
      }, { threshold: 0.35 },
    );

    for (const id of sectionIds) {
      const section = document.getElementById(id);
      if (section) observer?.observe(section);
    }

    const onCta = (event: Event) => {
      track("lp_cta_click", (event as CustomEvent).detail || {});
    };
    const onStoreClick = (event: Event) => {
      track("lp_store_click", (event as CustomEvent).detail || {});
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest("a");
      if (link?.hash && link.origin === location.origin) {
        const section = link.hash.slice(1);
        if (["top", ...sectionIds].includes(section)) track("lp_nav_click", { section });
      }
      if (link?.href?.includes("instagram.com")) {
        const reel = link.href.match(/\/reel\/([a-zA-Z0-9_-]+)/)?.[1] || "";
        track("lp_reel_click", { reel, action: "instagram" });
      }
      if (target?.closest(".reel-load")) {
        const card = target.closest(".reel-card");
        const reel = card?.getAttribute("data-reel-shortcode") || "";
        track("lp_reel_click", { reel, action: "embed" });
      }
    };
    const onToggle = (event: Event) => {
      const element = event.target;
      if (element instanceof HTMLDetailsElement && element.open && element.closest("#faq")) {
        track("lp_faq_open", { section: "faq", action: "open" });
      }
    };

    window.addEventListener("basicdiet:cta", onCta);
    window.addEventListener("basicdiet:store_click", onStoreClick);
    document.addEventListener("click", onClick, { capture: true });
    document.addEventListener("toggle", onToggle, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("basicdiet:cta", onCta);
      window.removeEventListener("basicdiet:store_click", onStoreClick);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("toggle", onToggle, true);
    };
  }, []);

  return null;
}
