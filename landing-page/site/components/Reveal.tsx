"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { observeMotionVisibility, useDocumentVisible, useReducedMotion } from "@/lib/motion";

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Reading-order index; CSS caps the total delay at 600ms. */
  index?: number;
};

export function Reveal({ children, className, index = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const documentVisible = useDocumentVisible();

  useEffect(() => {
    const element = ref.current;
    if (!element || reduce || !documentVisible || element.dataset.revealState === "done") return;
    let stop = () => {};
    const finish = () => {
      element.dataset.revealState = "done";
      element.style.removeProperty("--reveal-index");
    };
    const onEnd = (event: AnimationEvent) => {
      if (event.target === element && event.animationName === "landing-reveal") finish();
    };
    element.addEventListener("animationend", onEnd);
    stop = observeMotionVisibility(element, (visible) => {
      if (!visible || document.hidden) return;
      stop();
      if (document.documentElement.dataset.motion === "off") {
        finish();
      } else {
        element.style.setProperty("--reveal-index", String(Math.max(0, Math.min(8, index))));
        element.dataset.revealState = "active";
      }
    });
    return () => {
      stop();
      element.removeEventListener("animationend", onEnd);
      if (element.dataset.revealState === "active") finish();
    };
  }, [reduce, documentVisible, index]);

  return <div ref={ref} className={className} data-reveal="">{children}</div>;
}
