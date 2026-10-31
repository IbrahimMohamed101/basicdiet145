"use client";

import { useEffect } from "react";
import {
  observeMotionVisibility,
  useDocumentVisible,
  usePointerFine,
  useReducedMotion,
} from "@/lib/motion";

export function AppRevealMotion() {
  const pointerFine = usePointerFine();
  const reduce = useReducedMotion();
  const documentVisible = useDocumentVisible();

  useEffect(() => {
    const stage = document.querySelector<HTMLDivElement>("#app .app-reveal-stage");
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

  return null;
}
