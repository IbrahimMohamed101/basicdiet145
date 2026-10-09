"use client";

import { useEffect } from "react";
import { observeMotionVisibility, useDocumentVisible, useReducedMotion } from "@/lib/motion";

type Connection = EventTarget & { saveData?: boolean };

/** Shared lifecycle only: no section entrance or pointer effects are enabled here. */
export function MotionRuntime() {
  const reduce = useReducedMotion();
  const documentVisible = useDocumentVisible();

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.documentHidden = String(!documentVisible);
    return () => { delete root.dataset.documentHidden; };
  }, [documentVisible]);

  useEffect(() => {
    const root = document.documentElement;
    const connection = (navigator as Navigator & { connection?: Connection }).connection;
    const videos = Array.from(document.querySelectorAll<HTMLVideoElement>("video[data-motion-video]"));
    const cleanups = videos.map((video) => {
      let visible = false;
      let disposed = false;
      let playPending = false;
      const source = video.querySelector<HTMLSourceElement>("source[data-src]");
      const shouldPlay = () => !disposed && visible && !document.hidden && documentVisible &&
        !reduce && !connection?.saveData && root.dataset.motion !== "off" && video.dataset.userPaused !== "true";
      const sync = () => {
        if (!shouldPlay()) {
          video.pause();
          if ((reduce || connection?.saveData || root.dataset.motion === "off") && source?.hasAttribute("src")) {
            source.removeAttribute("src");
            video.load(); // Reset to poster; stop media transfer/decoding.
          }
          return;
        }
        if (source && !source.hasAttribute("src") && source.dataset.src) {
          source.src = source.dataset.src;
          video.load();
        }
        if (!video.paused || playPending) return;
        playPending = true;
        video.play().then(() => {
          playPending = false;
          if (!disposed && !shouldPlay()) video.pause();
        }).catch(() => {
          // Autoplay can be denied by Low Power Mode/policy. Keep the poster.
          if (disposed) return;
          playPending = false;
          video.pause();
          source?.removeAttribute("src");
          video.load();
        });
      };
      const stop = observeMotionVisibility(video, (isVisible) => { visible = isVisible; sync(); });
      const attributes = new MutationObserver(sync);
      attributes.observe(root, { attributes: true, attributeFilter: ["data-motion"] });
      connection?.addEventListener("change", sync);
      return () => {
        disposed = true;
        stop();
        attributes.disconnect();
        connection?.removeEventListener("change", sync);
        video.pause();
      };
    });
    return () => { cleanups.forEach((cleanup) => cleanup()); };
  }, [reduce, documentVisible]);

  return null;
}
