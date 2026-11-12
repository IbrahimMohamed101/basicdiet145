"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AppCta } from "./AppCta";
import { PromoHeaderButton } from "./PromoExperience";
import { usePathname } from "next/navigation";

const links = [
  { href: "#meals", label: "الوجبات" },
  { href: "/menu", label: "المنيو" },
  { href: "#how-it-works", label: "كيف يعمل" },
  { href: "#app", label: "التطبيق" },
  { href: "#plans", label: "الباقات" },
  { href: "#faq", label: "الأسئلة" },
];

export function Header() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isMenu = pathname === "/menu";
  const currentLinks = isMenu ? [
    { href: "#restaurant-menu", label: "المنيو" },
    { href: "#menu-plans", label: "الاشتراكات" },
    { href: "#menu-custom", label: "اصنع بنفسك" },
    { href: "#menu-download", label: "تواصل معنا" },
  ] : links;
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
    // Track the section actually sitting below the sticky header.
    // IntersectionObserver's callback order can leave aria-current empty after
    // anchor navigation even when the target is correctly positioned.
    // The home calculator replaces a placeholder section after hydration.
    // Resolve live IDs on every scroll rather than caching detached elements.
    const sectionLinks = currentLinks.filter((link) => link.href.startsWith("#"));

    let frame = 0;
    function updateCurrentSection() {
      frame = 0;
      const headerBottom = document.querySelector(".nav-shell")?.getBoundingClientRect().bottom ?? 0;
      // Use a single content band, not the last of several intersecting sections.
      // Unlinked sections therefore clear aria-current naturally.
      // Keep the band close enough to short sections (e.g. #how-it-works at 1024px).
      const band = Math.min(window.innerHeight * 0.45, Math.max(headerBottom + 24, 128));
      const current = sectionLinks.find(({ href }) => {
        const section = document.getElementById(href.slice(1));
        if (!section) return false;
        const rect = section.getBoundingClientRect();
        return rect.top <= band && rect.bottom > band;
      });
      const next = current?.href || "";
      setActiveHref((previous) => previous === next ? previous : next);
    }
    function onScroll() {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateCurrentSection);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    updateCurrentSection();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pathname]);

  // Keep the single global skip link aligned with each route's actual <main>.
  // Route-local legacy skip links are visually/keyboard-hidden by RootLayout.
  useEffect(() => {
    const skip = document.querySelector<HTMLAnchorElement>('body > a.skip-link[data-global-skip]');
    const main = document.querySelector<HTMLElement>("main");
    if (!skip || !main) return;
    if (!main.id) main.id = "page-main";
    skip.setAttribute("href", `#${main.id}`);
  }, [pathname]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 981px)");
    const onChange = () => { if (desktop.matches) closeMenu(); };
    desktop.addEventListener("change", onChange);
    return () => {
      desktop.removeEventListener("change", onChange);
      unlockScroll.current?.();
    };
  }, []);

  const navLinks = currentLinks.map((link) => (
    <a
      key={link.href}
      href={link.href.startsWith("/") || isHome || isMenu ? link.href : "/" + link.href}
      aria-current={activeHref === link.href ? "location" : undefined}
      onClick={(event) => {
        if (!link.href.startsWith("#")) return;
        const target = document.getElementById(link.href.slice(1));
        if (!target) return;
        event.preventDefault();
        setActiveHref(link.href);
        // Native smooth-anchor scrolling can stop short during deferred home
        // section updates. Keep hash semantics and align below the sticky nav.
        window.location.hash = link.href;
        window.requestAnimationFrame(() => {
          document.getElementById(link.href.slice(1))?.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
            block: "start",
          });
        });
      }}
    >
      {link.label}
    </a>
  ));

  return (
    <>
      <div ref={sentinel} className="nav-sentinel" aria-hidden="true" />
      <header className="site-header" data-menu-open={open}>
        <div className={`nav-shell ${scrolled ? "nav-shell--scrolled" : ""}`}>
          <a ref={brand} href={isHome ? "#top" : "/"} className="brand" aria-label="بيسك دايت Basic Diet - الرئيسية">
            <Image className="brand-logo" src="/brand/logo-primary.png" alt="" width={52} height={48} sizes="52px" priority quality={78} />
            <span className="brand-name">Basic Diet</span>
          </a>
          <nav className="desktop-nav" aria-label="التنقل الرئيسي">{navLinks}</nav>
          <div className="nav-actions">
            {isHome || isMenu ? <PromoHeaderButton className="button button--small" /> : <AppCta location="header" className="button button--small">ابدأ اشتراكك</AppCta>}
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
              {isHome || isMenu ? <PromoHeaderButton className="button" /> : <AppCta location="header" className="button">ابدأ اشتراكك</AppCta>}
            </div>
          </div>
        </dialog>

        <noscript>
          <style>{`.site-header { position: relative; } .site-header .nav-actions, .site-header .desktop-nav { display: none; }`}</style>
          <nav className="nav-fallback" aria-label="التنقل الرئيسي">
            {currentLinks.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
            <a href={isMenu ? "#menu-plans" : isHome ? "#plans" : "#app"} className="button">شوف الباقات</a>
          </nav>
        </noscript>

      </header>
      <span id="content-start" tabIndex={-1} />
    </>
  );
}
