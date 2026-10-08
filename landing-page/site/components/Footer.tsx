import Image from "next/image";
import { ANDROID_APP_URL, IOS_APP_URL } from "@/lib/app-links";

const SOCIAL_LINKS = [
  { label: "Instagram", href: "https://www.instagram.com/basicdiet.sa/", icon: "instagram" },
  { label: "TikTok", href: "https://www.tiktok.com/@basicdiet.sa", icon: "tiktok" },
  { label: "Snapchat", href: "https://www.snapchat.com/@basicdiet.sa", icon: "snapchat" },
  { label: "Google Maps", href: "https://maps.app.goo.gl/CGEn7oQWiKEXJzgG7", icon: "map" },
] as const;

function FooterIcon({ type }: { type: (typeof SOCIAL_LINKS)[number]["icon"] | "phone" | "clock" }) {
  if (type === "instagram") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.4" cy="6.8" r="1" fill="currentColor" stroke="none" /></svg>;
  }
  if (type === "tiktok") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4v10.2a4.8 4.8 0 1 1-4.1-4.75" /><path d="M14 4c1.2 2.6 3 4 5.5 4.2" /></svg>;
  }
  if (type === "snapchat") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.2 9.3C8.2 6.3 9.7 4.5 12 4.5s3.8 1.8 3.8 4.8c0 1.3.3 2.2 1.5 3 .7.5 1.4.7 2.2.9-.4 1.1-1.3 1.8-2.7 2.1-.5 1.2-1.5 1.9-2.9 1.9-.8 0-1.3.6-1.9 1.3-.6-.7-1.1-1.3-1.9-1.3-1.4 0-2.4-.7-2.9-1.9-1.4-.3-2.3-1-2.7-2.1.8-.2 1.5-.4 2.2-.9 1.2-.8 1.5-1.7 1.5-3Z" /></svg>;
  }
  if (type === "map") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z" /><circle cx="12" cy="10" r="2.2" /></svg>;
  }
  if (type === "phone") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5 9.6 8l-1.8 2.2c1.1 2.5 3.2 4.6 5.7 5.7l2.2-1.8 3.8 2.6c-.4 2-1.6 3-3.8 3C9.3 19.7 4.3 14.7 4.3 8.3c0-2.1.9-3.4 2.7-3.8Z" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3.2 2" /></svg>;
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="page-shell">
        <div className="footer-grid">
          <div className="footer-brand-block">
            <a className="footer-brand" href="#top" aria-label="Basic Diet - الرئيسية">
              <Image src="/brand/logo-white.png" alt="Basic Diet" width={138} height={52} sizes="138px" loading="lazy" />
            </a>
            <p>وجبات تحبها، على مقاس يومك.</p>
            <a className="footer-location-link" href="https://maps.app.goo.gl/CGEn7oQWiKEXJzgG7" target="_blank" rel="noopener noreferrer">
              <FooterIcon type="map" />
              <span>جدة، السعودية · افتح الموقع</span>
              <span aria-hidden="true">↗</span>
            </a>
          </div>

          <section className="footer-info" aria-labelledby="footer-contact-title">
            <div className="footer-info-icon"><FooterIcon type="phone" /></div>
            <div>
              <p className="footer-label" id="footer-contact-title">تواصل معنا</p>
              <a className="footer-primary-link" href="tel:+966535332639" dir="ltr">053 533 2639</a>
              <p>لجميع استفساراتك، تواصل معنا ونكون بخدمتك.</p>
            </div>
          </section>

          <section className="footer-info" aria-labelledby="footer-hours-title">
            <div className="footer-info-icon"><FooterIcon type="clock" /></div>
            <div>
              <p className="footer-label" id="footer-hours-title">أوقات العمل</p>
              <strong className="footer-hours">يوميًا · 24 ساعة</strong>
              <p>نخدمكم على مدار اليوم عشان ما تخرب الدايت بأي وقت.</p>
            </div>
          </section>
        </div>

        <div className="footer-linkbar">
          <nav className="footer-nav" aria-label="روابط أسفل الصفحة">
            <a href="#meals">الوجبات</a>
            <a href="#plans">الباقات</a>
            <a href="#faq">الأسئلة</a>
            <a href="/privacy">خصوصية طلب التواصل</a>
          </nav>

          <nav className="footer-socials" aria-label="حسابات Basic Diet">
            {SOCIAL_LINKS.map((link) => (
              <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer">
                <FooterIcon type={link.icon} />
                <span>{link.label}</span>
              </a>
            ))}
          </nav>

          <nav className="footer-stores" aria-label="تحميل التطبيق">
            <a href={IOS_APP_URL} lang="en">App Store ↗</a>
            <a href={ANDROID_APP_URL} lang="en">Google Play ↗</a>
          </nav>
        </div>

        <div className="footer-meta">
          <span>© 2026 Basic Diet</span>
          <a href="tel:+966535332639" dir="ltr">+966 53 533 2639</a>
        </div>
      </div>
    </footer>
  );
}
