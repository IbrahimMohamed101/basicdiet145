"use client";

import { useEffect, useRef, useState } from "react";
import { AppCta } from "./AppCta";
import { HERO_POSTER_URL, HERO_VIDEO_URL } from "@/lib/app-links";
import {
  observeMotionVisibility,
  useDocumentVisible,
  usePointerFine,
  useReducedMotion,
} from "@/lib/motion";

type Connection = EventTarget & { saveData?: boolean };

const TILT_X_MAX = 2;
const TILT_Y_MAX = 3;

export function Hero() {
  const stageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const reduce = useReducedMotion();
  const pointerFine = usePointerFine();
  const documentVisible = useDocumentVisible();
  const [mounted, setMounted] = useState(false);
  const [saveData, setSaveData] = useState(false);
  const [motionOff, setMotionOff] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: Connection }).connection;
    const root = document.documentElement;
    const sync = () => {
      setSaveData(Boolean(connection?.saveData));
      setMotionOff(root.dataset.motion === "off");
    };
    sync();

    const attributes = new MutationObserver(sync);
    attributes.observe(root, { attributes: true, attributeFilter: ["data-motion"] });
    connection?.addEventListener("change", sync);

    return () => {
      attributes.disconnect();
      connection?.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    setPlaying(!video.paused);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    const card = cardRef.current;
    if (!stage || !card) return;

    let visible = false;
    let frame = 0;
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;
    let bounds = stage.getBoundingClientRect();

    const write = () => {
      card.style.setProperty("--hero-tilt-x", `${currentX.toFixed(3)}deg`);
      card.style.setProperty("--hero-tilt-y", `${currentY.toFixed(3)}deg`);
    };

    const animate = () => {
      frame = 0;
      currentX += (targetX - currentX) * 0.16;
      currentY += (targetY - currentY) * 0.16;

      if (Math.abs(targetX - currentX) < 0.015) currentX = targetX;
      if (Math.abs(targetY - currentY) < 0.015) currentY = targetY;

      write();

      if (currentX !== targetX || currentY !== targetY) {
        frame = window.requestAnimationFrame(animate);
      }
    };

    const requestFrame = () => {
      if (!frame) frame = window.requestAnimationFrame(animate);
    };

    const reset = () => {
      targetX = 0;
      targetY = 0;
      requestFrame();
    };

    const stopVisibility = observeMotionVisibility(stage, (isVisible) => {
      visible = isVisible;
      stage.dataset.heroVisible = String(isVisible);
      if (!isVisible) reset();
    });

    const root = document.documentElement;
    let disabledByQa = root.dataset.motion === "off";
    const motionAttributes = new MutationObserver(() => {
      disabledByQa = root.dataset.motion === "off";
      if (disabledByQa) reset();
    });
    motionAttributes.observe(root, { attributes: true, attributeFilter: ["data-motion"] });

    if (!pointerFine || reduce || !documentVisible) {
      stage.dataset.heroTilt = "off";
      currentX = 0;
      currentY = 0;
      write();

      return () => {
        stopVisibility();
        motionAttributes.disconnect();
        if (frame) window.cancelAnimationFrame(frame);
      };
    }

    stage.dataset.heroTilt = "on";

    const updateBounds = () => {
      bounds = stage.getBoundingClientRect();
    };

    const onPointerEnter = () => {
      updateBounds();
      stage.dataset.heroInteracting = "true";
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!visible || disabledByQa) return;

      const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
      const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));

      targetX = (0.5 - y) * (TILT_X_MAX * 2);
      targetY = (x - 0.5) * (TILT_Y_MAX * 2);
      requestFrame();
    };

    const onPointerLeave = () => {
      delete stage.dataset.heroInteracting;
      reset();
    };

    const onResize = () => updateBounds();

    stage.addEventListener("pointerenter", onPointerEnter, { passive: true });
    stage.addEventListener("pointermove", onPointerMove, { passive: true });
    stage.addEventListener("pointerleave", onPointerLeave, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });

    return () => {
      stopVisibility();
      motionAttributes.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      stage.removeEventListener("pointerenter", onPointerEnter);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("resize", onResize);
      card.style.removeProperty("--hero-tilt-x");
      card.style.removeProperty("--hero-tilt-y");
      delete stage.dataset.heroTilt;
      delete stage.dataset.heroInteracting;
    };
  }, [documentVisible, pointerFine, reduce]);

  const mediaEnabled = mounted && !reduce && !saveData && !motionOff;

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video || !mediaEnabled) return;

    if (!video.paused) {
      video.dataset.userPaused = "true";
      video.pause();
      return;
    }

    delete video.dataset.userPaused;

    const source = video.querySelector<HTMLSourceElement>("source[data-src]");
    if (source && !source.hasAttribute("src") && source.dataset.src) {
      source.src = source.dataset.src;
      video.load();
    }

    try {
      await video.play();
    } catch {
      video.pause();
      source?.removeAttribute("src");
      video.load();
    }
  };

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="page-shell hero-grid">
        <div
          ref={stageRef}
          className="hero-media-stage"
          data-hero-visible="false"
          data-testid="hero-media-stage"
        >
          <span className="hero-depth hero-depth--green" aria-hidden="true" />
          <span className="hero-depth hero-depth--orange" aria-hidden="true" />

          <div ref={cardRef} className="hero-media">
            <video
              ref={videoRef}
              className="hero-video"
              data-motion-video=""
              muted
              loop
              playsInline
              preload="metadata"
              poster={HERO_POSTER_URL || undefined}
              aria-label="وجبات Basic Diet متنوعة"
            >
              <source data-src={HERO_VIDEO_URL} type="video/mp4" />
            </video>

            <div className="hero-media-badge" aria-hidden="true">
              <span className="pulse-dot" />
              وجبات فعلية، روتين أسهل
            </div>

            {mediaEnabled ? (
              <button
                type="button"
                className="hero-media-control"
                onClick={togglePlayback}
                aria-label={playing ? "إيقاف فيديو الوجبات" : "تشغيل فيديو الوجبات"}
                title={playing ? "إيقاف الفيديو" : "تشغيل الفيديو"}
              >
                <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
              </button>
            ) : null}
          </div>
        </div>

        <div className="hero-copy">
          <p className="eyebrow hero-copy-reveal hero-copy-reveal--eyebrow">
            <span />
            اشتراك وجبات مرن في جدة
          </p>

          <h1 id="hero-title" className="hero-title">
            <span className="hero-title-line">وجبات تحبها،</span>
            <span className="hero-title-line hero-title-line--accent">بكميات محسوبة</span>
            <span className="hero-title-line">تناسب روتينك.</span>
          </h1>

          <p className="hero-description hero-copy-reveal hero-copy-reveal--description">
            اختر مدة اشتراكك، كمية الوجبة وعدد وجباتك يوميًا، وتحكم في
            اشتراكك من تطبيق Basic Diet.
          </p>

          <div className="hero-actions hero-copy-reveal hero-copy-reveal--actions">
            <AppCta location="hero" className="button button--hero">
              ابدأ اشتراكك
            </AppCta>
            <a className="text-link" href="#meals">
              شوف الوجبات
              <span aria-hidden="true">←</span>
            </a>
          </div>

          <ul
            className="hero-proof hero-copy-reveal hero-copy-reveal--proof"
            aria-label="خيارات الاشتراك"
          >
            <li>
              <strong>100g · 150g · 200g</strong>
              <span>أحجام مرنة</span>
            </li>
            <li>
              <strong>من 1 إلى 5 وجبات</strong>
              <span>يوميًا</span>
            </li>
            <li>
              <strong>توصيل أو استلام</strong>
              <span>حسب اختيارك</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
