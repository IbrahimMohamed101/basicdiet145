"use client";

import { useEffect, useState } from "react";
import { AppCta } from "./AppCta";

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

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 12);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  useEffect(() => {
    const sections = links
      .map((link) => document.querySelector(link.href))
      .filter((section): section is Element => Boolean(section));

    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const active = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (active?.target.id) {
          setActiveHref(`#${active.target.id}`);
        }
      },
      {
        rootMargin: "-28% 0px -58% 0px",
        threshold: [0, 0.2, 0.5, 0.8],
      },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="site-header">
      <div className={`nav-shell ${scrolled ? "nav-shell--scrolled" : ""}`}>
        <a href="#top" className="brand" aria-label="Basic Diet - الرئيسية">
          <img
            className="brand-logo"
            src="/brand/logo-primary.png"
            alt=""
          />
          <span className="brand-name">Basic Diet</span>
        </a>

        <nav className="desktop-nav" aria-label="التنقل الرئيسي">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={activeHref === link.href ? "nav-link--active" : ""}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="nav-actions">
          <AppCta location="header" className="button button--small">
            ابدأ اشتراكك
          </AppCta>

          <button
            type="button"
            className={`menu-toggle ${open ? "menu-toggle--open" : ""}`}
            aria-label={open ? "إغلاق القائمة" : "فتح القائمة"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((value) => !value)}
          >
            <span />
            <span />
          </button>
        </div>
      </div>

      <div
        id="mobile-menu"
        className={`mobile-menu ${open ? "mobile-menu--open" : ""}`}
        aria-hidden={!open}
      >
        <nav aria-label="التنقل على الجوال">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={activeHref === link.href ? "nav-link--active" : ""}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>

      <div className="mobile-sticky-cta">
        <AppCta location="header" className="button">
          ابدأ اشتراكك
        </AppCta>
      </div>
    </header>
  );
}
