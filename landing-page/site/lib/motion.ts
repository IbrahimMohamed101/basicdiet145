"use client";

import { useSyncExternalStore } from "react";

function createMediaStore(query: string, serverValue: boolean) {
  let media: MediaQueryList | undefined;
  const getMedia = () => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    return (media ??= window.matchMedia(query));
  };
  return {
    subscribe: (listener: () => void) => {
      const current = getMedia();
      current?.addEventListener("change", listener);
      return () => current?.removeEventListener("change", listener);
    },
    getSnapshot: () => getMedia()?.matches ?? serverValue,
    getServerSnapshot: () => serverValue,
  };
}

const reducedMotion = createMediaStore("(prefers-reduced-motion: reduce)", true);
const pointerFine = createMediaStore("(hover: hover) and (pointer: fine)", false);

export function useReducedMotion() {
  return useSyncExternalStore(
    reducedMotion.subscribe,
    reducedMotion.getSnapshot,
    reducedMotion.getServerSnapshot,
  );
}

export function usePointerFine() {
  return useSyncExternalStore(
    pointerFine.subscribe,
    pointerFine.getSnapshot,
    pointerFine.getServerSnapshot,
  );
}

const visibilityListeners = new Set<() => void>();
function publishVisibility() {
  visibilityListeners.forEach((listener) => listener());
}
function subscribeVisibility(listener: () => void) {
  if (visibilityListeners.size === 0) {
    document.addEventListener("visibilitychange", publishVisibility);
  }
  visibilityListeners.add(listener);
  return () => {
    visibilityListeners.delete(listener);
    if (visibilityListeners.size === 0) {
      document.removeEventListener("visibilitychange", publishVisibility);
    }
  };
}
const getDocumentVisible = () => typeof document !== "undefined" && !document.hidden;
const getServerVisible = () => false;

export function useDocumentVisible() {
  return useSyncExternalStore(subscribeVisibility, getDocumentVisible, getServerVisible);
}

type VisibilityListener = (visible: boolean) => void;
const targets = new Map<Element, Set<VisibilityListener>>();
const visibility = new WeakMap<Element, boolean>();
let observer: IntersectionObserver | undefined;

/** One observer for motion consumers; analytics/navigation keep their own semantics. */
export function observeMotionVisibility(element: Element, listener: VisibilityListener) {
  if (typeof window === "undefined") return () => {};
  if (!window.IntersectionObserver) {
    listener(true);
    return () => {};
  }
  observer ??= new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      visibility.set(entry.target, entry.isIntersecting);
      targets.get(entry.target)?.forEach((callback) => callback(entry.isIntersecting));
    });
  });
  let listeners = targets.get(element);
  if (!listeners) {
    listeners = new Set();
    targets.set(element, listeners);
    observer.observe(element);
  }
  listeners.add(listener);
  // A later subscriber needs the current visibility even without another crossing.
  if (visibility.has(element)) {
    queueMicrotask(() => {
      if (listeners.has(listener)) listener(visibility.get(element) ?? false);
    });
  }
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer?.unobserve(element);
      targets.delete(element);
      visibility.delete(element);
    }
    if (targets.size === 0) {
      observer?.disconnect();
      observer = undefined;
    }
  };
}

/** Let CSS choose smooth/auto, including reduced-motion and animation-free mode. */
export function scrollIntoViewWithMotion(element: Element) {
  element.scrollIntoView({ behavior: "auto", block: "start" });
}
