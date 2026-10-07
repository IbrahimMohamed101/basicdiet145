import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main">
        انتقل للمحتوى
      </a>
      <Header />
      <main id="main">
        <div id="top" />
        <Hero />

        <section className="next-stage" id="meals" aria-label="المرحلة التالية">
          <div className="page-shell">
            <p>سيتم بناء قسم الوجبات في الحزمة التالية بعد مراجعة الـHero.</p>
          </div>
        </section>

        <div id="how-it-works" />
        <div id="app" />
        <div id="plans" />
        <div id="faq" />
      </main>
    </>
  );
}
