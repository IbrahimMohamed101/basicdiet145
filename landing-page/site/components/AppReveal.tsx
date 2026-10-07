"use client";

import { useEffect, useRef } from "react";
import { ANDROID_APP_URL, IOS_APP_URL } from "@/lib/app-links";
import {
  observeMotionVisibility,
  useDocumentVisible,
  usePointerFine,
  useReducedMotion,
} from "@/lib/motion";

const APP_HOME_SCREENSHOT =
  "https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/8d/c0/d3/8dc0d30c-c63a-5caa-6ed4-c476435f7444/Simulator_Screenshot_-_iPhone_16_Pro_Max_-_2026-06-02_at_18.59.40.png/471x1024.webp";

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

function FeatureIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5.1 10.2 3 3.1 6.9-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function trackStoreClick(store: "app_store" | "google_play") {
  window.dispatchEvent(
    new CustomEvent("basicdiet:store_click", {
      detail: { location: "app", store },
    }),
  );
}

export function AppReveal() {
  const stageRef = useRef<HTMLDivElement>(null);
  const pointerFine = usePointerFine();
  const reduce = useReducedMotion();
  const documentVisible = useDocumentVisible();

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let visible = false;
    let frame = 0;
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;
    let bounds = stage.getBoundingClientRect();

    const write = () => {
      stage.style.setProperty("--scene-near-x", `${(currentX * 18).toFixed(2)}px`);
      stage.style.setProperty("--scene-near-y", `${(currentY * 12).toFixed(2)}px`);
      stage.style.setProperty("--scene-mid-x", `${(currentX * 10).toFixed(2)}px`);
      stage.style.setProperty("--scene-mid-y", `${(currentY * 7).toFixed(2)}px`);
      stage.style.setProperty("--scene-far-x", `${(currentX * 5).toFixed(2)}px`);
      stage.style.setProperty("--scene-far-y", `${(currentY * 4).toFixed(2)}px`);
      stage.style.setProperty("--scene-angle-x", `${(currentX * 1.6).toFixed(3)}deg`);
      stage.style.setProperty("--scene-angle-y", `${(currentY * 1.2).toFixed(3)}deg`);
    };

    const animate = () => {
      frame = 0;
      currentX += (targetX - currentX) * 0.14;
      currentY += (targetY - currentY) * 0.14;

      if (Math.abs(targetX - currentX) < 0.0025) currentX = targetX;
      if (Math.abs(targetY - currentY) < 0.0025) currentY = targetY;

      write();

      if (currentX !== targetX || currentY !== targetY) {
        frame = requestAnimationFrame(animate);
      } else {
        stage.dataset.sceneMoving = "false";
      }
    };

    const requestFrame = () => {
      if (!frame) {
        stage.dataset.sceneMoving = "true";
        frame = requestAnimationFrame(animate);
      }
    };

    const reset = () => {
      targetX = 0;
      targetY = 0;
      requestFrame();
    };

    const stopVisibility = observeMotionVisibility(stage, (isVisible) => {
      visible = isVisible;
      stage.dataset.sceneVisible = String(isVisible);
      if (!isVisible) reset();
    });

    if (!pointerFine || reduce || !documentVisible) {
      stage.dataset.sceneInteractive = "false";
      currentX = 0;
      currentY = 0;
      write();

      return () => {
        stopVisibility();
        if (frame) cancelAnimationFrame(frame);
      };
    }

    stage.dataset.sceneInteractive = "true";

    const updateBounds = () => {
      bounds = stage.getBoundingClientRect();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!visible) return;
      const normalizedX = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      const normalizedY = ((event.clientY - bounds.top) / bounds.height) * 2 - 1;
      targetX = Math.max(-1, Math.min(1, normalizedX));
      targetY = Math.max(-1, Math.min(1, normalizedY));
      requestFrame();
    };

    const onPointerEnter = () => updateBounds();
    const onPointerLeave = () => reset();
    const onResize = () => updateBounds();

    stage.addEventListener("pointerenter", onPointerEnter, { passive: true });
    stage.addEventListener("pointermove", onPointerMove, { passive: true });
    stage.addEventListener("pointerleave", onPointerLeave, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });

    return () => {
      stopVisibility();
      if (frame) cancelAnimationFrame(frame);
      stage.removeEventListener("pointerenter", onPointerEnter);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("resize", onResize);
      stage.style.removeProperty("--scene-near-x");
      stage.style.removeProperty("--scene-near-y");
      stage.style.removeProperty("--scene-mid-x");
      stage.style.removeProperty("--scene-mid-y");
      stage.style.removeProperty("--scene-far-x");
      stage.style.removeProperty("--scene-far-y");
      stage.style.removeProperty("--scene-angle-x");
      stage.style.removeProperty("--scene-angle-y");
      delete stage.dataset.sceneInteractive;
      delete stage.dataset.sceneMoving;
    };
  }, [documentVisible, pointerFine, reduce]);

  return (
    <section className="app-reveal-section" id="app" aria-labelledby="app-reveal-title">
      <div className="page-shell app-reveal-grid">
        <div className="app-reveal-copy">
          <p className="eyebrow">
            <span />
            تطبيقك لكل تفاصيل اشتراكك
          </p>

          <h2 id="app-reveal-title">
            وجبتك قدامك.
            <br />
            <span>واشتراكك في يدك.</span>
          </h2>

          <p>
            اختر باقتك ووجباتك، وتابع اشتراكك وإدارة التوصيل أو الاستلام من التطبيق.
          </p>

          <div className="app-reveal-points" aria-label="مزايا التطبيق">
            <span><FeatureIcon />اختيار الباقة</span>
            <span><FeatureIcon />اختيار الوجبات</span>
            <span><FeatureIcon />متابعة الاشتراك</span>
          </div>

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

          <p className="app-store-note">كل تفاصيل اشتراكك من مكان واحد.</p>
        </div>

        <div
          ref={stageRef}
          className="hero-visual-stage app-reveal-stage"
          data-scene-visible="false"
          data-testid="hero-visual-stage"
          aria-label="الشاشة الرئيسية للتطبيق مع وجبة"
        >
          <div className="hero-visual-glow hero-visual-glow--green" aria-hidden="true" />
          <div className="hero-visual-glow hero-visual-glow--orange" aria-hidden="true" />
          <div className="hero-orbit hero-orbit--one" aria-hidden="true" />
          <div className="hero-orbit hero-orbit--two" aria-hidden="true" />

          <div className="hero-phone-layer">
            <div className="hero-phone-float">
              <div className="hero-phone-shell">
                <span className="hero-phone-speaker" aria-hidden="true" />
                <img
                  src={APP_HOME_SCREENSHOT}
                  alt="الشاشة الرئيسية للتطبيق"
                  className="hero-phone-screen"
                  decoding="async"
                  loading="eager"
                />
              </div>
            </div>
          </div>

          <div className="hero-meal-layer">
            <div className="hero-meal-float">
              <div className="hero-plate">
                <span className="hero-plate-rim" aria-hidden="true" />
                <img
                  src="/meals/butter-chicken.png"
                  alt="وجبة دجاج بالزبدة"
                  className="hero-meal-image"
                  decoding="async"
                  loading="lazy"
                />
              </div>
            </div>
          </div>

          <div className="hero-chip hero-chip--grams">
            <strong>150g</strong>
            <span>حجم الوجبة</span>
          </div>

          <div className="hero-chip hero-chip--meals">
            <strong>من 1 إلى 5</strong>
            <span>وجبات يوميًا</span>
          </div>
        </div>
      </div>
    </section>
  );
}
