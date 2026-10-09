"use client";

import { ANDROID_APP_URL, IOS_APP_URL } from "@/lib/app-links";

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16.7 12.9c0-2.3 1.9-3.4 2-3.5a4.3 4.3 0 0 0-3.4-1.8c-1.5-.2-2.9.9-3.6.9-.7 0-1.8-.9-3-.9-1.5 0-3 .9-3.8 2.2-1.7 2.9-.4 7.2 1.2 9.5.8 1.1 1.7 2.4 3 2.3 1.2 0 1.7-.7 3.2-.7s2 .7 3.2.7c1.3 0 2.1-1.1 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7-.1 0-3-.9-3-3.7ZM14.3 6c.6-.7 1-1.8.9-2.9-.9 0-2 .6-2.7 1.3-.6.7-1.1 1.7-1 2.8 1 .1 2.1-.5 2.8-1.2Z"
      />
    </svg>
  );
}

function GooglePlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#34A853" d="M3.4 2.8 13.7 12 3.4 21.2c-.4-.4-.6-1-.6-1.7v-15c0-.7.2-1.3.6-1.7Z" />
      <path fill="#4285F4" d="m13.7 12 3.2-2.9-10.5-6c-.9-.5-1.8-.6-2.5-.2L13.7 12Z" />
      <path fill="#FBBC04" d="m13.7 12-9.8 9.1c.7.4 1.6.3 2.5-.2l10.5-6-3.2-2.9Z" />
      <path fill="#EA4335" d="m21 11.2-4.1-2.3-3.2 3.1 3.2 3.1 4.1-2.3c1-.6 1-1.1 0-1.6Z" />
    </svg>
  );
}

export function StoreLinks({ location }: { location: "app" | "final" }) {
  function trackStoreClick(store: "app_store" | "google_play") {
    window.dispatchEvent(new CustomEvent("basicdiet:store_click", { detail: { location, store } }));
  }
  return (
    <div className="app-store-actions" aria-label="تحميل التطبيق">
      <a
        className="app-store-button"
        href={IOS_APP_URL}
        onClick={() => trackStoreClick("app_store")}
        aria-label="تحميل Basic Diet من App Store"
      >
        <span className="app-store-icon"><AppleIcon /></span>
        <span className="app-store-copy">
          <small>حمّل التطبيق من</small>
          <strong>App Store</strong>
        </span>
      </a>

      <a
        className="app-store-button"
        href={ANDROID_APP_URL}
        onClick={() => trackStoreClick("google_play")}
        aria-label="تحميل Basic Diet من Google Play"
      >
        <span className="app-store-icon app-store-icon--play"><GooglePlayIcon /></span>
        <span className="app-store-copy">
          <small>حمّل التطبيق من</small>
          <strong>Google Play</strong>
        </span>
      </a>
    </div>
  );
}
