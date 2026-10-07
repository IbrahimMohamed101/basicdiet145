const links = [
  { href: "#meals", label: "الوجبات" },
  { href: "#plans", label: "الباقات" },
  { href: "#app", label: "التطبيق" },
  { href: "#faq", label: "الأسئلة" },
];

export function Footer() {
  return (
    <footer className="footer">
      <div className="page-shell footer-grid">
        <div>
          <a className="footer-brand" href="#top" aria-label="Basic Diet - الرئيسية">
            <img src="/brand/logo-white.png" alt="Basic Diet" />
          </a>
          <p>وجبات تحبها، بكميات محسوبة تناسب روتينك.</p>
        </div>

        <nav aria-label="روابط أسفل الصفحة">
          {links.map((link) => (
            <a href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className="footer-meta">
          <span>جدة، السعودية</span>
          <span>© 2026 Basic Diet</span>
        </div>
      </div>
    </footer>
  );
}
