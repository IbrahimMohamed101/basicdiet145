import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { ProofStrip } from "@/components/ProofStrip";
import { MealGallery } from "@/components/MealGallery";
import { TaglineReveal } from "@/components/TaglineReveal";
import { Benefits } from "@/components/Benefits";
import { HowItWorks } from "@/components/HowItWorks";
import { AppShowcase } from "@/components/AppShowcase";

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
        <TaglineReveal />
        <Benefits />
        <HowItWorks />
        <AppShowcase />

        <div id="plans" />
        <div id="faq" />
      </main>
    </>
  );
}
