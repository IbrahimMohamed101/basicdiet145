import { ANDROID_APP_URL, IOS_APP_URL } from "@/lib/app-links";

export function Footer() {
  return (
    <footer className="footer">
      <div className="page-shell">
        <div className="footer-grid">
          <div><a className="footer-brand" href="#top" aria-label="Basic Diet - الرئيسية"><img src="/brand/logo-white.png" alt="Basic Diet" width="138" height="52" loading="lazy" /></a><p>وجبات تحبها، على مقاس يومك.</p></div>
          <nav aria-label="روابط أسفل الصفحة"><a href="#meals">الوجبات</a><a href="#plans">الباقات</a><a href="#faq">الأسئلة</a></nav>
          <nav aria-label="التطبيق والتواصل"><a href={IOS_APP_URL} lang="en">App Store ↗</a><a href={ANDROID_APP_URL} lang="en">Google Play ↗</a><a href="https://www.instagram.com/basicdiet.sa/" target="_blank" rel="noopener noreferrer"><bdi>@basicdiet.sa ↗</bdi></a></nav>
        </div>
        <div className="footer-meta"><span>جدة، السعودية</span><span>© 2026 Basic Diet</span></div>
      </div>
    </footer>
  );
}
