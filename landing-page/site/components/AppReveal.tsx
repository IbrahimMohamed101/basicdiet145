"use client";

import { useEffect, useRef } from "react";
import { AppCta } from "./AppCta";
import {
  observeMotionVisibility,
  useDocumentVisible,
  usePointerFine,
  useReducedMotion,
} from "@/lib/motion";

const APP_HOME_SCREENSHOT =
  "https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/8d/c0/d3/8dc0d30c-c63a-5caa-6ed4-c476435f7444/Simulator_Screenshot_-_iPhone_16_Pro_Max_-_2026-06-02_at_18.59.40.png/471x1024.webp";

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
            كل شيء معك
          </p>
          <h2 id="app-reveal-title">
            وجبتك قدامك.
            <br />
            <span>واشتراكك في يدك.</span>
          </h2>
          <p>
            اختر باقتك ووجباتك، وتابع تفاصيل اشتراكك وإدارة التوصيل أو
            الاستلام من تطبيق Basic Diet.
          </p>

          <div className="app-reveal-points" aria-label="مزايا التطبيق">
            <span>اختيار الباقة</span>
            <span>اختيار الوجبات</span>
            <span>متابعة الاشتراك</span>
          </div>

          <AppCta location="app" className="button app-reveal-cta">
            ابدأ اشتراكك
          </AppCta>
        </div>

        <div
          ref={stageRef}
          className="hero-visual-stage app-reveal-stage"
          data-scene-visible="false"
          data-testid="hero-visual-stage"
          aria-label="الشاشة الرئيسية لتطبيق Basic Diet مع وجبة"
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
                  alt="الشاشة الرئيسية لتطبيق Basic Diet"
                  className="hero-phone-screen"
                  decoding="async"
                  fetchPriority="low"
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
                  alt="وجبة دجاج بالزبدة من Basic Diet"
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
