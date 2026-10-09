"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AppCta } from "./AppCta";
import { DownloadCta } from "./DownloadCta";

const links = [
  { href: "#meals", label: "الوجبات" },
  { href: "#how-it-works", label: "كيف يعمل" },
  { href: "#app", label: "التطبيق" },
  { href: "#plans", label: "الباقات" },
  { href: "#faq", label: "الأسئلة" },
];

export function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeHref, setActiveHref] = useState("");
  const sentinel = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const brand = useRef<HTMLAnchorElement>(null);
  const unlockScroll = useRef<(() => void) | null>(null);

  function closeMenu() {
    if (!dialog.current?.open) return;
    dialog.current.close();
    unlockScroll.current?.();
    unlockScroll.current = null;
    setOpen(false);
    // A breakpoint change can hide the opener; keep focus in the navigation.
    const target = toggle.current?.getClientRects().length ? toggle.current : brand.current;
    target?.focus({ preventScroll: true });
  }

  function openMenu() {
    const panel = dialog.current;
    if (!panel || panel.open) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const gap = window.innerWidth - root.clientWidth;
    const header = toggle.current?.closest("header");
    const side = root.clientLeft >= gap && gap > 0 ? "paddingLeft" : "paddingRight";
    const previousPadding = root.style[side];
    const previousHeaderPadding = header?.style[side] ?? "";
    // Compensate classic scrollbars without changing viewport units or touch layouts.
    if (gap > 0) {
      root.style[side] = `${parseFloat(getComputedStyle(root)[side]) + gap}px`;
      if (header) header.style[side] = `${parseFloat(getComputedStyle(header)[side]) + gap}px`;
    }
    root.style.overflow = "hidden";
    unlockScroll.current = () => {
      root.style.overflow = previousOverflow;
      root.style[side] = previousPadding;
      if (header) header.style[side] = previousHeaderPadding;
    };
    panel.showModal();
    setOpen(true);
  }

  function trapFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const controls = event.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  useEffect(() => {
    if (!window.IntersectionObserver || !sentinel.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      setScrolled(!entry.isIntersecting);
    });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!window.IntersectionObserver) return;
    // Observe all sections so unlinked sections clear a stale active item too.
    const sections = Array.from(document.querySelectorAll("main section"));
    let observer: IntersectionObserver;
    function observeSections() {
      observer?.disconnect();
      const height = window.innerHeight;
      const bandStart = Math.min(120, height * 0.2);
      observer = new IntersectionObserver(() => {
        const visibleSections = sections.filter((section) => {
          const rect = section.getBoundingClientRect();
          return rect.top <= height * 0.45 && rect.bottom > bandStart;
        });
        const current = visibleSections[visibleSections.length - 1];
        const href = current?.id ? `#${current.id}` : "";
        setActiveHref(links.some((link) => link.href === href) ? href : "");
      }, { rootMargin: `-${bandStart}px 0px -${height * 0.55}px 0px`, threshold: 0 });
      sections.forEach((section) => observer.observe(section));
    }
    observeSections();
    window.addEventListener("resize", observeSections, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", observeSections);
    };
  }, []);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 981px)");
    const onChange = () => { if (desktop.matches) closeMenu(); };
    desktop.addEventListener("change", onChange);
    return () => {
      desktop.removeEventListener("change", onChange);
      unlockScroll.current?.();
    };
  }, []);

  const navLinks = links.map((link) => (
    <a
      key={link.href}
      href={link.href}
      aria-current={activeHref === link.href ? "location" : undefined}
    >
      {link.label}
    </a>
  ));

  return (
    <>
      <div ref={sentinel} className="nav-sentinel" aria-hidden="true" />
      <header className="site-header" data-menu-open={open}>
        <div className={`nav-shell ${scrolled ? "nav-shell--scrolled" : ""}`}>
          <a ref={brand} href="#top" className="brand" aria-label="Basic Diet - الرئيسية">
            <Image className="brand-logo" src="/brand/logo-primary.png" alt="" width={52} height={48} sizes="52px" priority quality={78} />
            <span className="brand-name">Basic Diet</span>
          </a>
          <nav className="desktop-nav" aria-label="التنقل الرئيسي">{navLinks}</nav>
          <div className="nav-actions">
            <DownloadCta location="header" className="button button--small">حمّل التطبيق</DownloadCta>
            <button
              ref={toggle}
              type="button"
              className="menu-toggle"
              aria-label="فتح القائمة"
              aria-expanded={open}
              aria-controls="mobile-menu"
              aria-haspopup="dialog"
              onClick={openMenu}
            >
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </button>
          </div>
        </div>

        <dialog
          ref={dialog}
          id="mobile-menu"
          className="nav-dialog"
          aria-labelledby="mobile-menu-title"
          onCancel={(event) => { event.preventDefault(); closeMenu(); }}
          onClick={(event) => { if (event.target === event.currentTarget) closeMenu(); }}
          onKeyDown={trapFocus}
        >
          <div className="nav-sheet">
            <div className="nav-sheet-heading">
              <h2 id="mobile-menu-title">التنقل الرئيسي</h2>
              <button type="button" className="menu-close" aria-label="إغلاق القائمة" onClick={closeMenu} autoFocus>
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <nav aria-label="التنقل على الجوال" onClick={(event) => {
              if ((event.target as Element).closest("a")) closeMenu();
            }}>{navLinks}</nav>
            <div className="nav-sheet-cta" onClickCapture={closeMenu}>
              <DownloadCta location="header" className="button">حمّل التطبيق</DownloadCta>
              <AppCta location="header" className="button nav-enquiry-button">اسأل المطعم</AppCta>
            </div>
          </div>
        </dialog>

        <noscript>
          <style>{`.site-header { position: relative; } .site-header .nav-actions, .site-header .desktop-nav { display: none; }`}</style>
          <nav className="nav-fallback" aria-label="التنقل الرئيسي">
            {links.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
            <a href="#app" className="button">حمّل التطبيق</a>
          </nav>
        </noscript>

      </header>
    </>
  );
}
