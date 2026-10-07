import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { ProofStrip } from "@/components/ProofStrip";
import { MealGallery } from "@/components/MealGallery";

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
        <ProofStrip />
        <MealGallery />

        <div id="how-it-works" />
        <div id="app" />
        <div id="plans" />
        <div id="faq" />
      </main>
    </>
  );
}
